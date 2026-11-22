import { primaryAvailability } from "../../../packages/calendar-scheduler/src/availability.ts";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "../../../packages/database/src/index.ts";
import {
  apiOrigin,
  appOrigin,
  decrypt,
  encrypt,
  hash,
  random,
} from "./security.ts";
import { enqueue, fail, lock, preferences, availability } from "./service.ts";
import { schedule } from "../../../packages/calendar-scheduler/src/index.ts";
const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export const callback = (kind: string) =>
  `${apiOrigin()}/api/v1/${kind === "login" ? "auth/google" : "calendar"}/callback`;
function credentials() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    fail(503, "Google OAuth is not configured. See docs/DEPLOYMENT.md.");
  return {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  };
}
export async function authorize(kind: "login" | "calendar", user?: string) {
  const c = credentials();
  if (kind === "calendar" && !process.env.TOKEN_ENCRYPTION_KEY)
    fail(503, "Calendar token encryption is not configured");
  const state = random(),
    nonce = random(),
    verifier = random();
  await sql`INSERT INTO oauth_states(id,kind,user_id,nonce,verifier,expires_at) VALUES(${hash(state)},${kind},${user ?? null},${nonce},${verifier},now()+interval '10 minutes')`;
  const query = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: callback(kind),
    response_type: "code",
    scope: kind === "login" ? "openid email profile" : calendarScopes.join(" "),
    state,
    nonce,
    code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
    code_challenge_method: "S256",
    ...(kind === "calendar"
      ? { access_type: "offline", prompt: "consent" }
      : {}),
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
    state,
  };
}
export async function tokenRequest(data: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials(), ...data }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) fail(502, "Google token exchange failed");
  return r.json() as Promise<any>;
}
export async function finish(
  kind: string,
  code: string,
  state: string,
  cookie: string | undefined,
  user?: string,
) {
  if (!cookie || hash(cookie) !== hash(state))
    fail(400, "OAuth browser state mismatch");
  const rows =
    await sql`DELETE FROM oauth_states WHERE id=${hash(state)} AND kind=${kind} AND expires_at>now() RETURNING *`;
  const stored = rows[0];
  if (!stored || (kind === "calendar" && stored.user_id !== user))
    fail(400, "Expired or invalid OAuth state");
  const tokens = await tokenRequest({
    code,
    code_verifier: stored.verifier,
    grant_type: "authorization_code",
    redirect_uri: callback(kind),
  });
  if (kind === "login") {
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: credentials().client_id,
    });
    if (
      payload.nonce !== stored.nonce ||
      !payload.sub ||
      payload.email_verified !== true
    )
      fail(400, "Invalid Google identity");
    const [u] =
      await sql`INSERT INTO users(google_sub,email,display_name) VALUES(${payload.sub},${String(payload.email)},${String(payload.name ?? payload.email)}) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,display_name=excluded.display_name RETURNING *`;
    return u;
  }
  const [old] =
    await sql`SELECT encrypted_tokens FROM calendar_connections WHERE user_id=${user!}`;
  const refresh =
    tokens.refresh_token ??
    (old ? decrypt(old.encrypted_tokens).refresh_token : undefined);
  if (!refresh)
    fail(400, "No offline grant returned. Reconnect Calendar with consent.");
  if (
    !calendarScopes.every((scope) =>
      String(tokens.scope).split(" ").includes(scope),
    )
  )
    fail(400, "Calendar permissions were not granted");
  await sql`INSERT INTO calendar_connections(user_id,encrypted_tokens,scopes) VALUES(${user!},${encrypt({ ...tokens, refresh_token: refresh, expires_at: Date.now() + tokens.expires_in * 1000 })},${tokens.scope}) ON CONFLICT(user_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,scopes=excluded.scopes,connected=true,error=null`;
  await enqueue(sql, user!);
  return null;
}
export async function google(
  user: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const [connection] =
    await sql`SELECT * FROM calendar_connections WHERE user_id=${user} AND connected`;
  if (!connection) fail(409, "Calendar is disconnected");
  let tokens = decrypt(connection.encrypted_tokens);
  if (tokens.expires_at < Date.now() + 60000) {
    const refreshed = await tokenRequest({
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    });
    tokens = {
      ...tokens,
      ...refreshed,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    await sql`UPDATE calendar_connections SET encrypted_tokens=${encrypt(tokens)} WHERE user_id=${user}`;
  }
  const r = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      "content-type": "application/json",
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw Object.assign(new Error(`Google Calendar returned ${r.status}`), {
      status: r.status,
    });
  return r.status === 204 ? null : (r.json() as Promise<any>);
}
const escapeDescription = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function eventDescription(
  topic: any,
  materials: { text: string }[],
  tags: string[],
) {
  return `Study materials:\n${materials.map((m) => "• " + escapeDescription(m.text)).join("\n")}\n\nTags: ${tags.map(escapeDescription).join(", ")}\nImportance: ${topic.importance ?? "Not set"}/5\n\nOpen Blind Spot Interval to review and rate your recall:\n${appOrigin()}/?review=${topic.id}`;
}
export async function ensureCalendar(user: string) {
  const [c] =
    await sql`SELECT * FROM calendar_connections WHERE user_id=${user} AND connected`;
  if (!c) return null;
  if (c.calendar_id) return c;
  const created = await google(user, "calendars", {
    method: "POST",
    body: {
      summary: "Blind Spot Interval",
      description: "Knowledge reviews managed by Blind Spot Interval",
    },
  });
  await sql`UPDATE calendar_connections SET calendar_id=${created.id} WHERE user_id=${user}`;
  return { ...c, calendar_id: created.id };
}
export async function outbound(user: string) {
  const c = await ensureCalendar(user);
  if (!c) return;
  const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
  const sessions =
    await sql`SELECT s.*,t.title,t.importance,t.status AS topic_status FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE t.user_id=${user} AND (s.status='pending' OR EXISTS(SELECT 1 FROM calendar_events e WHERE e.schedule_id=s.id AND e.sync_status<>'deleted')) ORDER BY s.created_at`;
  for (const s of sessions) {
    let [mapping] =
      await sql`SELECT * FROM calendar_events WHERE schedule_id=${s.id}`;
    if (
      s.status !== "pending" ||
      s.topic_status === "archived" ||
      !s.scheduled_at
    ) {
      if (mapping && mapping.sync_status !== "deleted") {
        try {
          await google(user, `${path}/${mapping.google_event_id}`, {
            method: "DELETE",
          });
        } catch (e: any) {
          if (![404, 410].includes(e.status)) throw e;
        }
        await sql`UPDATE calendar_events SET sync_status='deleted' WHERE schedule_id=${s.id}`;
      }
      continue;
    }
    if (mapping?.sync_status === "blocked") continue;
    // IDs use Google's base32hex alphabet; UUID hex is a subset. Keep a stable ID per generation.
    const eventId = mapping?.google_event_id ?? "b" + s.id.replaceAll("-", "");
    if (!mapping) {
      [mapping] =
        await sql`INSERT INTO calendar_events(schedule_id,google_event_id) VALUES(${s.id},${eventId}) ON CONFLICT(schedule_id) DO UPDATE SET schedule_id=excluded.schedule_id RETURNING *`;
    }
    const materials =
      await sql`SELECT text FROM topic_materials WHERE topic_id=${s.topic_id} ORDER BY position`;
    const tags =
      await sql`SELECT name FROM tags JOIN topic_tags tt ON tt.tag_id=tags.id WHERE tt.topic_id=${s.topic_id}`;
    const body = {
      summary: `Blind Spot · ${s.title}`,
      description: eventDescription(
        s,
        materials as any,
        tags.map((t) => t.name),
      ),
      start: { dateTime: new Date(s.scheduled_at).toISOString() },
      end: {
        dateTime: new Date(
          new Date(s.scheduled_at).getTime() + s.duration * 60000,
        ).toISOString(),
      },
      extendedProperties: { private: { blindSpotSchedule: s.id } },
    };
    let remote: any;
    try {
      remote = await google(user, `${path}/${eventId}`);
    } catch (e: any) {
      if (![404, 410].includes(e.status)) throw e;
    }
    // An ETag protects a concurrent external move from being silently overwritten.
    if (
      remote &&
      mapping.etag &&
      remote.etag !== mapping.etag &&
      new Date(remote.start.dateTime).getTime() !==
        new Date(s.scheduled_at).getTime()
    ) {
      await enqueue(sql, user, "inbound");
      continue;
    }
    let result: any;
    if (remote)
      result = await google(user, `${path}/${eventId}`, {
        method: "PATCH",
        headers: { "if-match": remote.etag },
        body,
      });
    else {
      try {
        result = await google(user, path, {
          method: "POST",
          body: { id: eventId, ...body },
        });
      } catch (e: any) {
        if (e.status !== 409) throw e;
        result = await google(user, `${path}/${eventId}`);
      }
    }
    await sql`UPDATE calendar_events SET etag=${result.etag},sync_status='synced' WHERE schedule_id=${s.id}`;
  }
}
export async function inbound(user: string) {
  const c = await ensureCalendar(user);
  if (!c) return;
  const path = `calendars/${encodeURIComponent(c.calendar_id)}/events`;
  const token = c.sync_token;
  let page: string | undefined;
  let nextToken: string | undefined;
  do {
    const query = new URLSearchParams({
      showDeleted: "true",
      maxResults: "250",
      ...(token ? { syncToken: token } : {}),
      ...(page ? { pageToken: page } : {}),
    });
    let data: any;
    try {
      data = await google(user, `${path}?${query}`);
    } catch (e: any) {
      if (e.status === 410 && token) {
        await sql`UPDATE calendar_connections SET sync_token=null WHERE user_id=${user}`;
        return inbound(user);
      }
      throw e;
    }
    for (const event of data.items ?? []) {
      const [mapping] =
        await sql`SELECT e.*,s.topic_id,s.status,s.scheduled_at,s.duration,s.ideal_due_at,t.importance FROM calendar_events e JOIN review_schedules s ON s.id=e.schedule_id JOIN topics t ON t.id=s.topic_id WHERE e.google_event_id=${event.id} AND t.user_id=${user}`;
      if (
        !mapping ||
        mapping.etag === event.etag ||
        mapping.status !== "pending"
      )
        continue;
      if (event.status === "cancelled") {
        await sql.begin(async (tx) => {
          await lock(tx, user);
          const [current] =
            await tx`SELECT * FROM calendar_events WHERE schedule_id=${mapping.schedule_id} FOR UPDATE`;
          if (
            current.google_event_id !== event.id ||
            current.sync_status === "blocked"
          )
            return;
          const count =
            current.last_deleted_at &&
            Date.now() - new Date(current.last_deleted_at).getTime() < 86400000
              ? current.deletion_count + 1
              : 1;
          if (count >= 3) {
            await tx`UPDATE calendar_events SET sync_status='blocked',deletion_count=${count} WHERE schedule_id=${mapping.schedule_id}`;
            await tx`UPDATE review_schedules SET adjustment_reason='Google event deleted repeatedly. External recreation paused; reconnect or resync after resolving the conflict.' WHERE id=${mapping.schedule_id}`;
            return;
          }
          const p = await preferences(user, tx);
          const busy = await availability(user, tx, mapping.schedule_id);
          if (mapping.scheduled_at)
            busy.push({
              start: new Date(mapping.scheduled_at).toISOString(),
              end: new Date(
                new Date(mapping.scheduled_at).getTime() +
                  mapping.duration * 60000,
              ).toISOString(),
            });
          const choice = schedule({
            ideal: new Date(mapping.ideal_due_at),
            now: new Date(),
            duration: mapping.duration,
            preferences: p,
            busy,
          });
          await tx`UPDATE review_schedules SET scheduled_at=${choice.start},mode='automatic',adjustment_reason='Deleted Google event automatically rescheduled' WHERE id=${mapping.schedule_id}`;
          await tx`UPDATE calendar_events SET google_event_id=${"b" + random().replace(/[^0-9a-f]/g, "") + mapping.schedule_id.replaceAll("-", "")},etag=null,sync_status='pending',deletion_count=${count},last_deleted_at=now() WHERE schedule_id=${mapping.schedule_id}`;
          await enqueue(tx, user);
        });
      } else if (event.start?.dateTime && event.end?.dateTime) {
        if (
          mapping.scheduled_at &&
          new Date(event.start.dateTime).getTime() ===
            new Date(mapping.scheduled_at).getTime() &&
          Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime) ===
            mapping.duration * 60000
        ) {
          await sql`UPDATE calendar_events SET etag=${event.etag},sync_status='synced' WHERE schedule_id=${mapping.schedule_id}`;
          continue;
        }
        const at = new Date(event.start.dateTime),
          duration = Math.round(
            (Date.parse(event.end.dateTime) - at.getTime()) / 60000,
          );
        if (duration < 5 || duration > 180) continue;
        await sql.begin(async (tx) => {
          await lock(tx, user);
          await tx`UPDATE review_schedules SET scheduled_at=${at},duration=${duration},mode='manual',adjustment_reason='Moved in Google Calendar' WHERE id=${mapping.schedule_id} AND status='pending'`;
          await tx`UPDATE calendar_events SET etag=${event.etag},sync_status='synced' WHERE schedule_id=${mapping.schedule_id}`;
        });
      }
    }
    page = data.nextPageToken;
    nextToken = data.nextSyncToken ?? nextToken;
  } while (page);
  await sql`UPDATE calendar_connections SET sync_token=${nextToken ?? token},last_sync_at=now(),error=null WHERE user_id=${user}`;
}
export async function renewWatch(user: string) {
  if (!process.env.WEBHOOK_ORIGIN) return;
  const c = await ensureCalendar(user);
  if (
    !c ||
    (c.channel_expires_at &&
      new Date(c.channel_expires_at).getTime() > Date.now() + 86400000)
  )
    return;
  const id = crypto.randomUUID(),
    token = random();
  await sql`UPDATE calendar_connections SET channel_id=${id},channel_token=${hash(token)} WHERE user_id=${user}`;
  const result = await google(
    user,
    `calendars/${encodeURIComponent(c.calendar_id)}/events/watch`,
    {
      method: "POST",
      body: {
        id,
        type: "web_hook",
        address: `${process.env.WEBHOOK_ORIGIN}/api/v1/webhooks/google-calendar`,
        token,
        expiration: String(Date.now() + 6 * 86400000),
      },
    },
  );
  await sql`UPDATE calendar_connections SET resource_id=${result.resourceId},channel_expires_at=${new Date(Number(result.expiration))} WHERE user_id=${user}`;
}
export async function primaryBusy(
  user: string,
  manual?: string,
  duration?: number,
) {
  const [c] =
    await sql`SELECT user_id FROM calendar_connections WHERE user_id=${user} AND connected`;
  if (!c) return [];
  return primaryAvailability(
    (path, options) => google(user, path, options),
    manual,
    duration,
  );
}
export async function refreshAvailability(user: string) {
  const [connected] =
    await sql`SELECT user_id FROM calendar_connections WHERE user_id=${user} AND connected`;
  if (!connected) return;
  const external = await primaryAvailability((path, options) =>
    google(user, path, options),
  );
  const now = new Date();
  await sql.begin(async (tx) => {
    await lock(tx, user);
    const p = await preferences(user, tx);
    const rows =
      await tx`SELECT s.*,t.importance FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE t.user_id=${user} AND s.status='pending' AND s.mode='automatic' ORDER BY t.importance DESC NULLS LAST,s.ideal_due_at`;
    for (const row of rows) {
      const busy = [...external, ...(await availability(user, tx, row.id))];
      if (
        row.scheduled_at &&
        !busy.some(
          (b: any) =>
            Date.parse(b.start) <
              new Date(row.scheduled_at).getTime() + row.duration * 60000 &&
            Date.parse(b.end) > new Date(row.scheduled_at).getTime(),
        )
      )
        continue;
      const choice = schedule({
        ideal: new Date(row.ideal_due_at),
        now,
        duration: row.duration,
        preferences: p,
        busy,
        importance: row.importance,
      });
      await tx`UPDATE review_schedules SET scheduled_at=${choice.start},adjustment_reason=${choice.reason} WHERE id=${row.id}`;
    }
  });
}
