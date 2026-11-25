import { primaryAvailability } from "../../packages/calendar-scheduler/src/availability.ts";
import { Timestamp } from "firebase-admin/firestore";
import {
  db,
  calendarOAuthLock,
  deletionRef,
  requireActiveAccount,
  collection,
  get,
  getByIds,
  records,
  pendingSchedules,
  mutate,
  fail,
} from "./store.ts";
import { digest, placement, nextReviewSortKey } from "./domain.ts";
import {
  connections,
  enqueue,
  jobs,
  prepareOutbound,
} from "./calendar-queue.ts";
import { encrypt, decrypt, random, hash } from "../../apps/api/src/security.ts";
export const scopes = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
export const emulator = () =>
  process.env.FUNCTIONS_EMULATOR === "true" ||
  (process.env.GCLOUD_PROJECT ?? "").startsWith("demo-");
export const origin = () =>
  process.env.APP_ORIGIN ??
  (emulator()
    ? "http://localhost:5174"
    : fail(503, "APP_ORIGIN must be configured"));
export const redirectUri = () =>
  process.env.CALENDAR_REDIRECT_URI ?? origin() + "/api/v1/calendar/callback";
function credentials() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    fail(503, "Google Calendar OAuth is not configured");
  return {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  };
}
export async function authorize(uid: string) {
  const c = credentials();
  if (!process.env.TOKEN_ENCRYPTION_KEY)
    fail(503, "Calendar encryption key is not configured");
  const state = random(),
    verifier = random();
  await db.runTransaction(async (tx) => {
    await requireActiveAccount(uid, tx);
    tx.create(db.collection("oauthStates").doc(hash(state)), {
      uid,
      verifier,
      expiresAt: Timestamp.fromMillis(Date.now() + 600000),
    });
  });
  const params = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
    code_challenge_method: "S256",
  });
  return {
    state,
    url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
  };
}
async function exchange(
  values: Record<string, string>,
  transport: typeof fetch = fetch,
) {
  const r = await transport("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials(), ...values }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw Object.assign(new Error("Google offline token exchange failed"), {
      status: r.status,
    });
  return r.json() as Promise<any>;
}
export async function finish(
  code: string,
  state: string,
  cookie: string | undefined,
  transport: typeof fetch = fetch,
) {
  if (!cookie || hash(cookie) !== hash(state))
    fail(400, "OAuth browser state mismatch");
  const ref = db.collection("oauthStates").doc(hash(state));
  const pending = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data()!.expiresAt.toMillis() < Date.now())
      fail(400, "OAuth state expired or already used");
    const row = s.data()!;
    await requireActiveAccount(row.uid, tx);
    const lock = calendarOAuthLock(row.uid);
    if ((await tx.get(lock)).get("until") > Date.now())
      fail(409, "Another Calendar connection is in progress");
    tx.set(lock, { state: ref.id, until: Date.now() + 120_000 });
    tx.delete(ref);
    return row;
  });
  const lock = calendarOAuthLock(pending.uid);
  try {
    const tokens = await exchange(
      {
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
        code_verifier: pending.verifier,
      },
      transport,
    );
    const refConnection = connections.doc(pending.uid);
    const connected = await db.runTransaction(async (tx) => {
      const deletion = deletionRef(pending.uid);
      const [latest, deleting, claim] = await tx.getAll(
        refConnection,
        deletion,
        lock,
      );
      if (deleting.exists) {
        const credential = tokens.refresh_token ?? tokens.access_token;
        if (
          credential &&
          !deleting.get("completed") &&
          claim.get("state") === ref.id
        )
          tx.set(deletion.collection("calendarTokens").doc(ref.id), {
            encrypted: encrypt({ refresh_token: credential }),
          });
        return false;
      }
      if (claim.get("state") !== ref.id)
        fail(409, "Calendar connection expired");
      const encrypted = latest.get("encrypted_tokens");
      const refresh =
        tokens.refresh_token ??
        (encrypted ? decrypt(encrypted).refresh_token : undefined);
      if (
        !refresh ||
        !scopes.every((s) => String(tokens.scope).split(" ").includes(s))
      )
        fail(
          400,
          "Offline Calendar grant is missing. Reconnect with all requested permissions.",
        );
      const generation = (latest.get("generation") ?? 0) + 1;
      const jobId = enqueue(tx, pending.uid, "reconcile", generation);
      tx.set(refConnection, {
        ...latest.data(),
        uid: pending.uid,
        connected: true,
        encrypted_tokens: encrypt({
          ...tokens,
          refresh_token: refresh,
          expires_at: Date.now() + tokens.expires_in * 1000,
        }),
        scopes: tokens.scope,
        generation,
        nextReconcileAt: Date.now() + 300_000,
        channel_id: null,
        channel_token: null,
        channel_expires_at: null,
        pending_channel_id: null,
        pending_channel_token: null,
        reconcileJobId: jobId,
        inboundJobId: null,
        outboundJobId: null,
        error: null,
      });
      return true;
    });
    if (!connected) fail(410, "Account deletion has been requested");
    return pending.uid as string;
  } finally {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(lock)).get("state") === ref.id) tx.delete(lock);
    });
  }
}
function retryAfter(header: string | null) {
  if (!header) return 0;
  return /^\d+$/.test(header)
    ? Number(header) * 1000
    : Date.parse(header) - Date.now() || 0;
}

export class CalendarSync {
  constructor(
    readonly uid: string,
    readonly transport: typeof fetch = fetch,
    readonly generation?: number,
  ) {}
  async connection() {
    const c = (await connections.doc(this.uid).get()).data();
    if (
      this.generation !== undefined &&
      (!c?.connected || c.generation !== this.generation)
    )
      fail(409, "Calendar connection changed");
    return c?.connected ? c : null;
  }
  async updateConnection(generation: number, data: Record<string, unknown>) {
    const ref = connections.doc(this.uid);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.get("connected") || current.get("generation") !== generation)
        fail(409, "Calendar connection changed");
      tx.update(ref, data);
    });
  }
  async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) {
    const c = await this.connection();
    if (!c) fail(409, "Calendar is disconnected");
    let tokens = decrypt(c.encrypted_tokens);
    if (tokens.expires_at < Date.now() + 60000) {
      const refreshed = await exchange(
        { grant_type: "refresh_token", refresh_token: tokens.refresh_token },
        this.transport,
      );
      tokens = {
        ...tokens,
        ...refreshed,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
      await db.runTransaction(async (tx) => {
        const ref = connections.doc(this.uid),
          latest = await tx.get(ref);
        if (
          latest.data()?.connected &&
          latest.data()?.generation === c.generation
        )
          tx.update(ref, { encrypted_tokens: encrypt(tokens) });
        else fail(409, "Calendar connection changed");
      });
    }
    const r = await this.transport(
      "https://www.googleapis.com/calendar/v3/" + path,
      {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
          ...options.headers,
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!r.ok)
      throw Object.assign(new Error(`Google Calendar returned ${r.status}`), {
        status: r.status,
        retryAfterMs: Math.min(
          86_400_000,
          Math.max(0, retryAfter(r.headers.get("retry-after"))),
        ),
      });
    return options.method === "DELETE" || r.status === 204
      ? null
      : (r.json() as Promise<any>);
  }
  async ensure() {
    const c = await this.connection();
    if (!c) return null;
    if (c.calendar_id) return c;
    const calendar = await this.request("calendars", {
      method: "POST",
      body: {
        summary: "Blind Spot Interval",
        description: "Knowledge reviews managed by Blind Spot Interval",
      },
    });
    await this.updateConnection(c.generation, { calendar_id: calendar.id });
    return { ...c, calendar_id: calendar.id };
  }
  async outbound(scheduleIds?: string[]) {
    if (scheduleIds?.length === 0) return;
    const c = await this.ensure();
    if (!c) return;
    const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
    const [sessions, mappings] = scheduleIds
      ? await Promise.all([
          getByIds(this.uid, "reviewSchedules", scheduleIds),
          getByIds(this.uid, "calendarEvents", scheduleIds),
        ])
      : await Promise.all([
          pendingSchedules(collection(this.uid, "reviewSchedules"))
            .get()
            .then(
              (snapshot) => new Map(records(snapshot).map((s) => [s.id, s])),
            ),
          collection(this.uid, "calendarEvents")
            .where("sync_status", "in", ["pending", "synced", "blocked"])
            .get()
            .then(
              (snapshot) => new Map(records(snapshot).map((m) => [m.id, m])),
            ),
        ]);
    const active = [...sessions.values()].filter(
      (s) => s.status === "pending" && s.scheduled_at,
    );
    if (!scheduleIds) {
      const missing = active.filter((s) => !mappings.has(s.id));
      // Deleted or other legacy mappings may allow recreation with their saved event ID.
      for (const [id, mapping] of await getByIds(
        this.uid,
        "calendarEvents",
        missing.map((s) => s.id),
      ))
        mappings.set(id, mapping);
    }
    const [topics, materials] = await Promise.all([
      getByIds(
        this.uid,
        "topics",
        active.map((s) => s.topic_id),
      ),
      getByIds(
        this.uid,
        "topicMaterials",
        active.map((s) => s.topic_id),
      ),
    ]);
    // Remove superseded events before publishing their replacements.
    const ids = [...new Set([...mappings.keys(), ...sessions.keys()])];
    for (const scheduleId of ids) {
      const s = sessions.get(scheduleId);
      const topic = s && topics.get(s.topic_id);
      const mapping = mappings.get(scheduleId);
      if (
        s?.status === "pending" &&
        topic?.status === "active" &&
        s.scheduled_at
      )
        continue;
      if (!mapping || mapping.sync_status === "deleted") continue;
      // A full job's pending query may overlap a newer app mutation.
      const current = await get(this.uid, "reviewSchedules", scheduleId);
      if (
        current?.status === "pending" &&
        current.scheduled_at &&
        current.scheduled_at !== s?.scheduled_at
      )
        continue;
      try {
        await this.request(`${path}/${mapping.google_event_id}`, {
          method: "DELETE",
        });
      } catch (e: any) {
        if (![404, 410].includes(e.status)) throw e;
      }
      await this.updateMapping(
        c.generation,
        scheduleId,
        mapping.google_event_id,
        {
          sync_status: "deleted",
          publishedHash: null,
        },
      );
    }
    for (const s of active) {
      const topic = topics.get(s.topic_id);
      if (topic?.status !== "active") continue;
      const mappingRef = collection(this.uid, "calendarEvents").doc(s.id);
      let mapping = mappings.get(s.id);
      if (mapping?.sync_status === "blocked") continue;
      if (!mapping || mapping.sync_status === "deleted") {
        mapping = await db.runTransaction(async (tx) => {
          const [current, connection] = await Promise.all([
            tx.get(mappingRef),
            tx.get(connections.doc(this.uid)),
          ]);
          this.verifyGeneration(connection, c.generation);
          if (current.exists && current.get("sync_status") !== "deleted")
            return current.data()!;
          // Google can retain a tombstone under the previous event ID.
          const created = {
            schedule_id: s.id,
            google_event_id:
              "b" +
              digest(current.exists ? random() : `${this.uid}:${s.id}`).slice(
                0,
                40,
              ),
            etag: null,
            sync_status: "pending",
            deletion_count: 0,
          };
          if (current.exists) tx.set(mappingRef, created);
          else tx.create(mappingRef, created);
          return created;
        });
      }
      const id = mapping.google_event_id;
      const description = eventDescription(
        topic,
        materials.get(s.topic_id)?.items ?? [],
      );
      const body = {
        summary: "Blind Spot · " + topic.title,
        description,
        start: { dateTime: s.scheduled_at },
        end: {
          dateTime: new Date(
            Date.parse(s.scheduled_at) + s.duration * 60000,
          ).toISOString(),
        },
        extendedProperties: {
          private: { blindSpotSchedule: s.id, blindSpotOwner: this.uid },
        },
      };
      const publishedHash = digest(JSON.stringify(body));
      if (
        mapping.sync_status === "synced" &&
        mapping.publishedHash === publishedHash
      )
        continue;
      let remote: any;
      try {
        remote = await this.request(`${path}/${id}`);
      } catch (e: any) {
        if (![404, 410].includes(e.status)) throw e;
      }
      if (remote?.status === "cancelled") {
        await this.applyRemote(remote);
        continue;
      }
      if (
        remote &&
        remote.etag !== mapping.etag &&
        remote.start?.dateTime &&
        (Date.parse(remote.start.dateTime) !== Date.parse(s.scheduled_at) ||
          (mapping.publishedEnd &&
            Date.parse(remote.end?.dateTime) !==
              Date.parse(mapping.publishedEnd)))
      ) {
        await this.applyRemote(remote);
        continue;
      }
      const current = await get(this.uid, "reviewSchedules", s.id);
      if (
        !current ||
        current.status !== s.status ||
        current.scheduled_at !== s.scheduled_at ||
        current.duration !== s.duration
      )
        continue;
      let result: any;
      if (remote) {
        if (
          remote.summary === body.summary &&
          remote.description === body.description &&
          Date.parse(remote.start.dateTime) ===
            Date.parse(body.start.dateTime) &&
          Date.parse(remote.end.dateTime) === Date.parse(body.end.dateTime)
        ) {
          result = remote;
        } else
          result = await this.request(`${path}/${id}`, {
            method: "PATCH",
            body,
            headers: { "if-match": remote.etag },
          });
      } else {
        try {
          result = await this.request(path, {
            method: "POST",
            body: { id, ...body },
          });
        } catch (e: any) {
          if (e.status !== 409) throw e;
          result = await this.request(`${path}/${id}`);
        }
      }
      await this.updateMapping(c.generation, s.id, id, {
        etag: result.etag,
        sync_status: "synced",
        publishedHash,
        publishedStart: body.start.dateTime,
        publishedEnd: body.end.dateTime,
      });
    }
  }
  verifyGeneration(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    generation: number,
  ) {
    if (!snapshot.get("connected") || snapshot.get("generation") !== generation)
      fail(409, "Calendar connection changed");
  }
  async updateMapping(
    generation: number,
    scheduleId: string,
    googleId: string,
    data: Record<string, unknown>,
  ) {
    const ref = collection(this.uid, "calendarEvents").doc(scheduleId);
    await db.runTransaction(async (tx) => {
      const [latest, connection] = await Promise.all([
        tx.get(ref),
        tx.get(connections.doc(this.uid)),
      ]);
      this.verifyGeneration(connection, generation);
      if (latest.get("google_event_id") === googleId) tx.update(ref, data);
    });
  }
  async applyRemotePage(events: any[]) {
    const byId = new Map(
      events.filter((e) => typeof e.id === "string").map((e) => [e.id, e]),
    );
    const ids = [...byId.keys()];
    const mappings = collection(this.uid, "calendarEvents");
    for (let offset = 0; offset < ids.length; offset += 30) {
      const matches = await mappings
        .where("google_event_id", "in", ids.slice(offset, offset + 30))
        .select("google_event_id", "etag", "sync_status")
        .get();
      for (const mapping of matches.docs)
        await this.applyRemote(
          byId.get(mapping.get("google_event_id")),
          mapping,
        );
    }
  }
  async applyRemote(
    event: any,
    knownMapping?: FirebaseFirestore.QueryDocumentSnapshot,
  ) {
    const mappingSnapshot =
      knownMapping ??
      (
        await collection(this.uid, "calendarEvents")
          .where("google_event_id", "==", event.id)
          .limit(1)
          .get()
      ).docs[0];
    const unchanged =
      event.status !== "cancelled" &&
      event.etag &&
      mappingSnapshot?.get("etag") === event.etag;
    if (
      !mappingSnapshot ||
      unchanged ||
      ["deleted", "blocked"].includes(mappingSnapshot.get("sync_status"))
    )
      return;
    const scheduleId = mappingSnapshot.id;
    const now = new Date();
    await mutate(this.uid, async (tx, read, rows) => {
      const [mapping, session, connection] = await Promise.all([
        read("calendarEvents", scheduleId),
        read("reviewSchedules", scheduleId),
        tx.get(connections.doc(this.uid)),
      ]);
      if (this.generation !== undefined)
        this.verifyGeneration(connection, this.generation);
      if (
        !connection.get("connected") ||
        !mapping ||
        !session ||
        mapping.google_event_id !== event.id ||
        (event.status !== "cancelled" &&
          event.etag &&
          mapping.etag === event.etag) ||
        session.status !== "pending" ||
        mapping.sync_status === "blocked"
      )
        return;
      if (event.status === "cancelled") {
        const count =
          mapping.last_deleted_at &&
          Date.now() - Date.parse(mapping.last_deleted_at) < 86400000
            ? mapping.deletion_count + 1
            : 1;
        if (count >= 3) {
          tx.update(collection(this.uid, "calendarEvents").doc(scheduleId), {
            sync_status: "blocked",
            deletion_count: count,
          });
          tx.update(collection(this.uid, "reviewSchedules").doc(scheduleId), {
            adjustment_reason:
              "Google event deleted repeatedly; external recreation paused. Use Resync to resume.",
          });
          return;
        }
        const [topic, p, sessions, outbound] = await Promise.all([
          read("topics", session.topic_id),
          read("preferences", "default"),
          rows("reviewSchedules", pendingSchedules),
          prepareOutbound(tx, this.uid),
        ]);
        if (!topic) return;
        const external = session.scheduled_at
          ? [
              {
                start: session.scheduled_at,
                end: new Date(
                  Date.parse(session.scheduled_at) + session.duration * 60000,
                ).toISOString(),
              },
            ]
          : [];
        const choice = placement(
          topic,
          new Date(session.ideal_due_at),
          p as any,
          sessions,
          now,
          { exclude: scheduleId, recovery: session.recovery, external },
        );
        tx.update(collection(this.uid, "reviewSchedules").doc(scheduleId), {
          ...choice,
          mode: "automatic",
          adjustment_reason: "Deleted Google event automatically rescheduled",
        });
        if (topic.pendingScheduleId === scheduleId)
          tx.update(collection(this.uid, "topics").doc(topic.id), {
            nextReviewAt: nextReviewSortKey(choice.scheduled_at),
          });
        tx.update(collection(this.uid, "calendarEvents").doc(scheduleId), {
          google_event_id: "b" + digest(random()),
          etag: null,
          sync_status: "pending",
          publishedHash: null,
          deletion_count: count,
          last_deleted_at: now.toISOString(),
        });
        outbound([scheduleId]);
      } else if (event.start?.dateTime && event.end?.dateTime) {
        const start = Date.parse(event.start.dateTime),
          end = Date.parse(event.end.dateTime),
          duration = (end - start) / 60000;
        if (
          !Number.isFinite(start) ||
          !Number.isInteger(duration) ||
          duration < 5 ||
          duration > 180
        )
          return;
        const moved =
          start !== Date.parse(session.scheduled_at) ||
          duration !== session.duration;
        if (moved) {
          const topic = await read("topics", session.topic_id);
          const scheduledAt = new Date(start).toISOString();
          tx.update(collection(this.uid, "reviewSchedules").doc(scheduleId), {
            scheduled_at: scheduledAt,
            duration,
            mode: "manual",
            adjustment_reason: "Moved in Google Calendar",
          });
          if (topic?.pendingScheduleId === scheduleId)
            tx.update(collection(this.uid, "topics").doc(topic.id), {
              nextReviewAt: scheduledAt,
            });
        }
        tx.update(collection(this.uid, "calendarEvents").doc(scheduleId), {
          etag: event.etag ?? null,
          sync_status: "synced",
          publishedHash: null,
          publishedStart: event.start.dateTime,
          publishedEnd: event.end.dateTime,
        });
      }
    });
  }
  async inbound(resetCursor = false) {
    const c = await this.ensure();
    if (!c) return;
    const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
    let sync = resetCursor ? null : c.sync_token,
      page: string | undefined,
      finalToken: string | undefined,
      reset = false;
    const seen = new Set<string>();
    for (;;) {
      const q = new URLSearchParams({
        showDeleted: "true",
        maxResults: "250",
        fields:
          "nextPageToken,nextSyncToken,items(id,etag,status,start(dateTime),end(dateTime))",
        ...(sync ? { syncToken: sync } : {}),
        ...(page ? { pageToken: page } : {}),
      });
      let result: any;
      try {
        result = await this.request(`${path}?${q}`);
      } catch (e: any) {
        if (e.status === 410 && sync && !reset) {
          sync = null;
          reset = true;
          page = undefined;
          finalToken = undefined;
          continue;
        } else throw e;
      }
      const events = result.items ?? [];
      if (!sync) for (const event of events) seen.add(event.id);
      await this.applyRemotePage(events);
      page = result.nextPageToken;
      finalToken = result.nextSyncToken ?? finalToken;
      if (!page) break;
    }
    if (!finalToken)
      throw new Error(
        "Google Calendar did not return a synchronization cursor",
      );
    if (!sync) {
      const mapped = await collection(this.uid, "calendarEvents")
        .where("sync_status", "==", "synced")
        .get();
      for (const mapping of mapped.docs) {
        const id = mapping.get("google_event_id");
        if (id && !seen.has(id))
          await this.applyRemote({ id, status: "cancelled" }, mapping);
      }
    }
    await this.updateConnection(c.generation, {
      sync_token: finalToken ?? sync ?? null,
      last_sync_at: new Date().toISOString(),
    });
  }
  async availability(manual?: string, duration?: number) {
    if (!(await this.connection())) return [];
    return primaryAvailability(this.request.bind(this), manual, duration);
  }
  async freeBusy(scheduleIds?: string[], queueChanges = false) {
    if (scheduleIds?.length === 0) return;
    if (!(await this.connection())) return;
    const isAutomatic = (s: FirebaseFirestore.DocumentData) =>
      s.status === "pending" && s.mode === "automatic";
    const candidates = scheduleIds
      ? [
          ...(
            await getByIds(this.uid, "reviewSchedules", scheduleIds)
          ).values(),
        ].some(isAutomatic)
      : !(
          await pendingSchedules(collection(this.uid, "reviewSchedules"))
            .where("mode", "==", "automatic")
            .limit(1)
            .get()
        ).empty;
    if (!candidates) return;
    const now = new Date();
    const external = await primaryAvailability(this.request.bind(this));
    const ids = scheduleIds ? new Set(scheduleIds) : null;
    const needsPlacement = (s: FirebaseFirestore.DocumentData) =>
      isAutomatic(s) &&
      (!ids || ids.has(s.id)) &&
      (!s.scheduled_at ||
        external.some(
          (b) =>
            Date.parse(b.start) <
              Date.parse(s.scheduled_at) + s.duration * 60000 &&
            Date.parse(b.end) > Date.parse(s.scheduled_at),
        ));
    // Avoid opening an owner transaction when primary availability changed no affected slots.
    if (!external.length) {
      const unscheduled = await pendingSchedules(
        collection(this.uid, "reviewSchedules"),
      )
        .where("scheduled_at", "==", null)
        .where("mode", "==", "automatic")
        .limit(1)
        .get();
      if (unscheduled.empty) return;
    }
    await mutate(this.uid, async (tx, read, rows) => {
      const sessions = await rows("reviewSchedules", pendingSchedules);
      const affected = sessions
        .filter(needsPlacement)
        .sort((a, b) => a.ideal_due_at.localeCompare(b.ideal_due_at));
      if (!affected.length) return;
      const [p, topics, outbound, connection] = await Promise.all([
        read("preferences", "default"),
        getByIds(
          this.uid,
          "topics",
          affected.map((s) => s.topic_id),
          tx,
        ),
        queueChanges ? prepareOutbound(tx, this.uid) : undefined,
        tx.get(connections.doc(this.uid)),
      ]);
      if (this.generation !== undefined)
        this.verifyGeneration(connection, this.generation);
      if (!connection.get("connected")) return;
      const changed: string[] = [];
      for (const s of affected) {
        const topic = topics.get(s.topic_id);
        if (!topic) continue;
        const choice = placement(
          { ...topic, duration: s.duration },
          new Date(s.ideal_due_at),
          p as any,
          sessions,
          now,
          { exclude: s.id, recovery: s.recovery, external },
        );
        if (
          choice.scheduled_at === s.scheduled_at &&
          choice.adjustment_reason === s.adjustment_reason
        )
          continue;
        Object.assign(s, choice);
        changed.push(s.id);
        tx.update(collection(this.uid, "reviewSchedules").doc(s.id), choice);
        if (topic.pendingScheduleId === s.id)
          tx.update(collection(this.uid, "topics").doc(topic.id), {
            nextReviewAt: nextReviewSortKey(choice.scheduled_at),
          });
      }
      outbound?.(changed);
    });
  }
  async watch() {
    if (!process.env.WEBHOOK_ORIGIN) return;
    const c = await this.ensure();
    if (
      !c ||
      (c.channel_expires_at &&
        Date.parse(c.channel_expires_at) > Date.now() + 86400000)
    )
      return;
    const id = crypto.randomUUID(),
      token = random();
    await this.updateConnection(c.generation, {
      pending_channel_id: id,
      pending_channel_token: hash(token),
      pending_channel_message: null,
    });
    const result = await this.request(
      `calendars/${encodeURIComponent(c.calendar_id)}/events/watch`,
      {
        method: "POST",
        body: {
          id,
          type: "web_hook",
          address:
            process.env.WEBHOOK_ORIGIN + "/api/v1/webhooks/google-calendar",
          token,
          expiration: String(Date.now() + 6 * 86400000),
        },
      },
    );
    // A notification may arrive before Google's watch response.
    const ref = connections.doc(this.uid);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      this.verifyGeneration(current, c.generation);
      if (current.get("pending_channel_id") !== id)
        fail(409, "Calendar watch changed");
      tx.update(ref, {
        channel_id: id,
        channel_token: hash(token),
        channel_message: current.get("pending_channel_message") ?? null,
        resource_id: result.resourceId,
        channel_expires_at: new Date(Number(result.expiration)).toISOString(),
        pending_channel_id: null,
        pending_channel_token: null,
        pending_channel_message: null,
      });
    });
  }
}
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function eventDescription(topic: any, materials: { text: string }[]) {
  return `Study materials:\n${materials.map((m) => "• " + escape(m.text)).join("\n")}\n\nTags: ${(topic.tags ?? []).map(escape).join(", ")}\nImportance: ${topic.importance ?? "Not set"}/5\n\nOpen Blind Spot Interval to review and rate your recall:\n${origin()}/?review=${topic.id}`;
}
export async function disconnect(uid: string) {
  await db.runTransaction(async (tx) => {
    await requireActiveAccount(uid, tx);
    tx.set(
      connections.doc(uid),
      {
        connected: false,
        encrypted_tokens: "",
        channel_token: null,
        pending_channel_token: null,
        channel_expires_at: null,
        generation: Date.now(),
        reconcileJobId: null,
        nextReconcileAt: null,
        inboundJobId: null,
        outboundJobId: null,
      },
      { merge: true },
    );
  });
  return { ok: true };
}
export async function resync(uid: string) {
  await mutate(uid, async (tx, _read, rows) => {
    const ref = connections.doc(uid);
    const connection = await tx.get(ref);
    if (!connection.get("connected")) return;
    const events = await rows("calendarEvents", (ref) =>
      ref.where("sync_status", "==", "blocked"),
    );
    for (const event of events)
      tx.update(collection(uid, "calendarEvents").doc(event.id), {
        google_event_id: "b" + digest(random()),
        sync_status: "pending",
        etag: null,
        publishedHash: null,
        deletion_count: 0,
        last_deleted_at: null,
      });
    const jobId = enqueue(tx, uid, "reconcile", connection.get("generation"), {
      resetCursor: true,
    });
    tx.update(ref, { reconcileJobId: jobId });
  });
  return { ok: true };
}
export async function webhook(headers: Record<string, unknown>) {
  const id = String(headers["x-goog-channel-id"] ?? ""),
    token = hash(String(headers["x-goog-channel-token"] ?? "")),
    resource = String(headers["x-goog-resource-id"] ?? ""),
    number = String(headers["x-goog-message-number"] ?? "");
  if (
    !id ||
    id.length > 128 ||
    !resource ||
    resource.length > 256 ||
    !/^\d{1,20}$/.test(number)
  )
    fail(403, "Invalid webhook");
  const active = await connections.where("channel_id", "==", id).limit(1).get();
  const match =
    active.docs[0] ??
    (await connections.where("pending_channel_id", "==", id).limit(1).get())
      .docs[0];
  if (!match) fail(403, "Invalid webhook channel");
  await db.runTransaction(async (tx) => {
    const current = await tx.get(match.ref);
    const pending = current.get("pending_channel_id") === id;
    const prefix = pending ? "pending_channel" : "channel";
    if (
      !current.get("connected") ||
      current.get(prefix + "_id") !== id ||
      current.get(prefix + "_token") !== token ||
      (!pending && current.get("resource_id") !== resource)
    )
      fail(403, "Invalid webhook channel");
    const previous = current.get(prefix + "_message");
    if (previous && BigInt(number) <= BigInt(previous)) return;
    const existing = current.get("inboundJobId");
    const queued = existing ? await tx.get(jobs.doc(existing)) : null;
    const jobId =
      queued?.get("status") === "pending" &&
      queued.get("generation") === current.get("generation")
        ? queued.id
        : enqueue(tx, match.id, "inbound", current.get("generation"));
    tx.update(match.ref, {
      [prefix + "_message"]: number,
      inboundJobId: jobId,
    });
  });
}
