import { Timestamp } from "firebase-admin/firestore";
import { db, collection, get, all, mutate, fail } from "./store.ts";
import { queue, digest, placement } from "./domain.ts";
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
  await db
    .collection("oauthStates")
    .doc(hash(state))
    .create({
      uid,
      verifier,
      expiresAt: Timestamp.fromMillis(Date.now() + 600000),
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
    tx.delete(ref);
    return s.data()!;
  });
  const tokens = await exchange(
    {
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
    },
    transport,
  );
  const refConnection = db.collection("calendarConnections").doc(pending.uid);
  const old = (await refConnection.get()).data();
  const refresh =
    tokens.refresh_token ??
    (old?.encrypted_tokens
      ? decrypt(old.encrypted_tokens).refresh_token
      : undefined);
  if (
    !refresh ||
    !scopes.every((s) => String(tokens.scope).split(" ").includes(s))
  )
    fail(
      400,
      "Offline Calendar grant is missing. Reconnect with all requested permissions.",
    );
  await db.runTransaction(async (tx) => {
    const latest = await tx.get(refConnection);
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
      generation: (latest.data()?.generation ?? 0) + 1,
      error: null,
    });
    queue(tx, pending.uid, Date.now(), "reconcile", random());
  });
  return pending.uid as string;
}
export class CalendarSync {
  constructor(
    readonly uid: string,
    readonly transport: typeof fetch = fetch,
  ) {}
  async connection() {
    const c = (
      await db.collection("calendarConnections").doc(this.uid).get()
    ).data();
    return c?.connected ? c : null;
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
        const ref = db.collection("calendarConnections").doc(this.uid),
          latest = await tx.get(ref);
        if (
          latest.data()?.connected &&
          latest.data()?.generation === c.generation
        )
          tx.update(ref, { encrypted_tokens: encrypt(tokens) });
        else fail(409, "Calendar connection changed");
      });
    }
    const latest = await this.connection();
    if (!latest || latest.generation !== c.generation)
      fail(409, "Calendar connection changed");
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
      });
    return r.status === 204 ? null : (r.json() as Promise<any>);
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
    await db
      .collection("calendarConnections")
      .doc(this.uid)
      .update({ calendar_id: calendar.id });
    return { ...c, calendar_id: calendar.id };
  }
  async outbound() {
    const c = await this.ensure();
    if (!c) return;
    const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
    const [sessions, topics, materials] = await Promise.all([
      all(this.uid, "reviewSchedules"),
      all(this.uid, "topics"),
      all(this.uid, "topicMaterials"),
    ]);
    for (const s of sessions) {
      const mappingRef = collection(this.uid, "calendarEvents").doc(s.id);
      let mapping = (await mappingRef.get()).data();
      const topic = topics.find((t) => t.id === s.topic_id);
      if (
        s.status !== "pending" ||
        topic?.status !== "active" ||
        !s.scheduled_at
      ) {
        if (mapping && mapping.sync_status !== "deleted") {
          try {
            await this.request(`${path}/${mapping.google_event_id}`, {
              method: "DELETE",
            });
          } catch (e: any) {
            if (![404, 410].includes(e.status)) throw e;
          }
          await mappingRef.update({ sync_status: "deleted" });
        }
        continue;
      }
      if (mapping?.sync_status === "blocked") continue;
      if (!mapping) {
        await db.runTransaction(async (tx) => {
          const current = await tx.get(mappingRef);
          if (!current.exists)
            tx.create(mappingRef, {
              schedule_id: s.id,
              google_event_id: "b" + digest(`${this.uid}:${s.id}`).slice(0, 40),
              etag: null,
              sync_status: "pending",
              deletion_count: 0,
            });
        });
        mapping = (await mappingRef.get()).data()!;
      }
      const id = mapping.google_event_id;
      const description = eventDescription(
        topic,
        materials.find((m) => m.id === s.topic_id)?.items ?? [],
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
        Date.parse(remote.start.dateTime) !== Date.parse(s.scheduled_at)
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
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(mappingRef);
        if (latest.data()?.google_event_id === id)
          tx.update(mappingRef, { etag: result.etag, sync_status: "synced" });
      });
    }
  }
  async applyRemote(event: any) {
    const mappings = await collection(this.uid, "calendarEvents")
      .where("google_event_id", "==", event.id)
      .limit(1)
      .get();
    if (mappings.empty) return;
    const scheduleId = mappings.docs[0].id;
    const now = new Date();
    await mutate(this.uid, async (tx, read, rows, root) => {
      const [mapping, session, p, allSessions] = await Promise.all([
        read("calendarEvents", scheduleId),
        read("reviewSchedules", scheduleId),
        read("preferences", "default"),
        rows("reviewSchedules"),
      ]);
      if (
        !mapping ||
        !session ||
        mapping.google_event_id !== event.id ||
        mapping.etag === event.etag ||
        session.status !== "pending" ||
        mapping.sync_status === "blocked"
      )
        return;
      const topic = await read("topics", session.topic_id);
      if (!topic) return;
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
          allSessions,
          now,
          { exclude: scheduleId, recovery: session.recovery, external },
        );
        tx.update(collection(this.uid, "reviewSchedules").doc(scheduleId), {
          ...choice,
          mode: "automatic",
          adjustment_reason: "Deleted Google event automatically rescheduled",
        });
        tx.update(collection(this.uid, "calendarEvents").doc(scheduleId), {
          google_event_id: "b" + digest(random()),
          etag: null,
          sync_status: "pending",
          deletion_count: count,
          last_deleted_at: now.toISOString(),
        });
        queue(tx, this.uid, root.revision + 1);
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
        if (moved)
          tx.update(collection(this.uid, "reviewSchedules").doc(scheduleId), {
            scheduled_at: new Date(start).toISOString(),
            duration,
            mode: "manual",
            adjustment_reason: "Moved in Google Calendar",
          });
        tx.update(collection(this.uid, "calendarEvents").doc(scheduleId), {
          etag: event.etag,
          sync_status: "synced",
        });
      }
    });
  }
  async inbound() {
    const c = await this.ensure();
    if (!c) return;
    const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
    let sync = c.sync_token,
      page: string | undefined,
      finalToken: string | undefined,
      reset = false;
    do {
      const q = new URLSearchParams({
        showDeleted: "true",
        maxResults: "250",
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
          result = await this.request(
            `${path}?showDeleted=true&maxResults=250`,
          );
        } else throw e;
      }
      for (const event of result.items ?? []) await this.applyRemote(event);
      page = result.nextPageToken;
      finalToken = result.nextSyncToken ?? finalToken;
    } while (page);
    await db
      .collection("calendarConnections")
      .doc(this.uid)
      .update({
        sync_token: finalToken ?? sync ?? null,
        last_sync_at: new Date().toISOString(),
        error: null,
      });
  }
  async freeBusy() {
    const c = await this.connection();
    if (!c) return;
    const now = new Date();
    const data = await this.request("freeBusy", {
      method: "POST",
      body: {
        timeMin: now.toISOString(),
        timeMax: new Date(Date.now() + 32 * 86400000).toISOString(),
        items: [{ id: "primary" }],
      },
    });
    if (data.calendars?.primary?.errors?.length)
      throw new Error("Primary calendar availability unavailable");
    const external = data.calendars?.primary?.busy;
    if (!Array.isArray(external))
      throw new Error("Invalid availability response");
    await mutate(this.uid, async (tx, read, rows) => {
      const [p, sessions, topics] = await Promise.all([
        read("preferences", "default"),
        rows("reviewSchedules"),
        rows("topics"),
      ]);
      const updated = [...sessions];
      for (const s of updated
        .filter((s) => s.status === "pending" && s.mode === "automatic")
        .sort((a, b) => a.ideal_due_at.localeCompare(b.ideal_due_at))) {
        if (
          s.scheduled_at &&
          !external.some(
            (b) =>
              Date.parse(b.start) <
                Date.parse(s.scheduled_at) + s.duration * 60000 &&
              Date.parse(b.end) > Date.parse(s.scheduled_at),
          )
        )
          continue;
        const topic = topics.find((t) => t.id === s.topic_id);
        if (!topic) continue;
        const choice = placement(
          { ...topic, duration: s.duration },
          new Date(s.ideal_due_at),
          p as any,
          updated,
          now,
          { exclude: s.id, recovery: s.recovery, external },
        );
        Object.assign(s, choice);
        tx.update(collection(this.uid, "reviewSchedules").doc(s.id), choice);
      }
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
    const ref = db.collection("calendarConnections").doc(this.uid);
    await ref.update({
      pending_channel_id: id,
      pending_channel_token: hash(token),
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
    await ref.update({
      channel_id: id,
      channel_token: hash(token),
      resource_id: result.resourceId,
      channel_expires_at: new Date(Number(result.expiration)).toISOString(),
      pending_channel_id: null,
      pending_channel_token: null,
    });
  }
}
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function eventDescription(topic: any, materials: { text: string }[]) {
  return `Study materials:\n${materials.map((m) => "• " + escape(m.text)).join("\n")}\n\nTags: ${(topic.tags ?? []).map(escape).join(", ")}\nImportance: ${topic.importance ?? "Not set"}/5\n\nOpen Blind Spot Interval to review and rate your recall:\n${origin()}/?review=${topic.id}`;
}
export async function disconnect(uid: string) {
  await db.collection("calendarConnections").doc(uid).set(
    {
      connected: false,
      encrypted_tokens: "",
      channel_token: null,
      pending_channel_token: null,
      generation: Date.now(),
    },
    { merge: true },
  );
  return { ok: true };
}
export async function resync(uid: string) {
  await mutate(uid, async (tx, read, rows, root) => {
    const events = await rows("calendarEvents");
    for (const event of events.filter((e) => e.sync_status === "blocked"))
      tx.update(collection(uid, "calendarEvents").doc(event.id), {
        google_event_id: "b" + digest(random()),
        sync_status: "pending",
        etag: null,
        deletion_count: 0,
        last_deleted_at: null,
      });
    tx.set(
      db.collection("calendarConnections").doc(uid),
      { sync_token: null },
      { merge: true },
    );
    queue(tx, uid, root.revision + 1, "reconcile");
  });
  return { ok: true };
}
export async function webhook(headers: Record<string, unknown>) {
  const id = String(headers["x-goog-channel-id"] ?? ""),
    token = hash(String(headers["x-goog-channel-token"] ?? "")),
    resource = String(headers["x-goog-resource-id"] ?? ""),
    number = String(headers["x-goog-message-number"] ?? "");
  if (!id || !resource || !/^\d+$/.test(number)) fail(403, "Invalid webhook");
  let matches = await db
    .collection("calendarConnections")
    .where("channel_id", "==", id)
    .limit(1)
    .get();
  const pending = matches.empty;
  if (pending)
    matches = await db
      .collection("calendarConnections")
      .where("pending_channel_id", "==", id)
      .limit(1)
      .get();
  const c = matches.docs[0]?.data();
  if (
    !c?.connected ||
    (pending ? c.pending_channel_token : c.channel_token) !== token ||
    (!pending && c.resource_id && c.resource_id !== resource)
  )
    fail(403, "Invalid webhook channel");
  const key = digest(`webhook:${id}:${number}`);
  await db.runTransaction(async (tx) => {
    const ref = db.collection("syncJobs").doc(key);
    const existing = await tx.get(ref);
    if (!existing.exists)
      queue(tx, matches.docs[0].id, 0, "inbound", `webhook:${id}:${number}`);
  });
}
