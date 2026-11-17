import { buildApp } from "../apps/api/src/app.ts";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { sql, closeDatabase } from "../packages/database/src/index.ts";
import { createTopic, details, reschedule } from "../apps/api/src/service.ts";
import {
  ensureCalendar,
  outbound,
  inbound,
  google,
  eventDescription,
} from "../apps/api/src/google.ts";
import { encrypt, random, hash } from "../apps/api/src/security.ts";
let user: string,
  topic: any,
  version = 0,
  calendars = 0,
  expireSync = false;
const events = new Map<string, any>();
const calls: { path: string; method: string; body: any }[] = [];
beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const [u] =
    await sql`INSERT INTO users(google_sub,email,display_name) VALUES(${random()},'calendar@example.invalid','Calendar Test') RETURNING id`;
  user = u.id;
  await sql`INSERT INTO calendar_connections(user_id,encrypted_tokens,scopes) VALUES(${user},${encrypt({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Date.now() + 3600000 })},'test scopes')`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opts: any = {}) => {
      const path = String(url),
        method = opts.method ?? "GET",
        body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ path, method, body });
      if (path.endsWith("/calendars") && method === "POST")
        return Response.json({ id: `calendar-${++calendars}` });
      if (path.includes("/events?")) {
        if (expireSync && path.includes("syncToken=")) {
          expireSync = false;
          return Response.json({}, { status: 410 });
        }
        return Response.json({
          items: [...events.values()],
          nextSyncToken: "sync-" + version,
        });
      }
      if (path.endsWith("/events") && method === "POST") {
        if (events.has(body.id)) return Response.json({}, { status: 409 });
        const e = { ...body, etag: "v" + ++version };
        events.set(e.id, e);
        return Response.json(e);
      }
      const id = path.split("/").pop()!;
      const event = events.get(id);
      if (!event) return Response.json({}, { status: 404 });
      if (method === "DELETE") {
        events.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        const e = { ...event, ...body, etag: "v" + ++version };
        events.set(id, e);
        return Response.json(e);
      }
      return Response.json(event);
    }),
  );
  topic = await createTopic(user, {
    title: "Recall <b>carefully</b>",
    initialKnowledge: null,
    importance: 5,
    duration: 15,
    tags: ["Study"],
    materials: ["First", "https://example.com/?a=1&b=2", "Third"],
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await sql`DELETE FROM calendar_events WHERE schedule_id IN(SELECT s.id FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE t.user_id=${user})`;
  await sql`DELETE FROM users WHERE id=${user}`;
  await closeDatabase();
});
describe("Google Calendar protocol with mocked transport and real persistence", () => {
  it("creates one calendar and reuses it", async () => {
    await ensureCalendar(user);
    await ensureCalendar(user);
    expect(calendars).toBe(1);
  });
  it("creates one event idempotently with ordered materials and private metadata", async () => {
    await outbound(user);
    await outbound(user);
    expect(events.size).toBe(1);
    const event = [...events.values()][0];
    expect(event.description.indexOf("First")).toBeLessThan(
      event.description.indexOf("Third"),
    );
    expect(event.extendedProperties.private.blindSpotSchedule).toBe(
      topic.schedule.id,
    );
    expect(
      calls.filter((c) => c.method === "POST" && c.path.endsWith("/events")),
    ).toHaveLength(1);
  });
  it("updates app reschedules and recognizes its own notifications", async () => {
    const at = new Date(Date.now() + 3 * 86400000);
    await reschedule(user, topic.schedule.id, at);
    await outbound(user);
    await inbound(user);
    const t = await details(user, topic.id);
    expect(new Date(t.schedule.scheduled_at).getTime()).toBe(at.getTime());
    expect(t.memory.card).toBeNull();
  });
  it("imports external moves as manual without advancing memory", async () => {
    const event = [...events.values()][0];
    const start = new Date(Date.now() + 4 * 86400000).toISOString();
    events.set(event.id, {
      ...event,
      etag: "external-1",
      start: { dateTime: start },
      end: { dateTime: new Date(Date.parse(start) + 900000).toISOString() },
    });
    await inbound(user);
    const t = await details(user, topic.id);
    expect(t.schedule.mode).toBe("manual");
    expect(new Date(t.schedule.scheduled_at).toISOString()).toBe(start);
    expect(t.memory.review_count).toBe(0);
  });
  it("replaces deleted events with bounded loop protection", async () => {
    for (let i = 0; i < 3; i++) {
      const [mapping] =
        await sql`SELECT * FROM calendar_events WHERE schedule_id=${topic.schedule.id}`;
      events.set(mapping.google_event_id, {
        id: mapping.google_event_id,
        status: "cancelled",
        etag: "deleted-" + i,
      });
      await inbound(user);
      if (i < 2) {
        events.delete(mapping.google_event_id);
        await outbound(user);
      }
    }
    const [mapping] =
      await sql`SELECT * FROM calendar_events WHERE schedule_id=${topic.schedule.id}`;
    expect(mapping.sync_status).toBe("blocked");
    const before = calls.length;
    await outbound(user);
    expect(calls.length).toBe(before);
  });
  it("recovers from expired incremental sync tokens", async () => {
    expireSync = true;
    await inbound(user);
    expect(expireSync).toBe(false);
    const [c] =
      await sql`SELECT sync_token FROM calendar_connections WHERE user_id=${user}`;
    expect(c.sync_token).toContain("sync-");
  });
  it("surfaces temporary API failures for durable retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(
      google(user, "freeBusy", { method: "POST", body: {} }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("explicit resync restarts a blocked event generation safely", async () => {
    const token = random(),
      csrf = random();
    await sql`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(${hash(token)},${user},${csrf},now()+interval '1 hour')`;
    const app = await buildApp();
    try {
      const result = await app.inject({
        url: "/api/v1/calendar/resync",
        method: "POST",
        headers: {
          cookie: `bs_session=${token}`,
          origin: "http://localhost:5173",
          "x-csrf-token": csrf,
        },
      });
      expect(result.statusCode, result.body).toBe(200);
      const [e] =
        await sql`SELECT * FROM calendar_events WHERE schedule_id=${topic.schedule.id}`;
      expect(e.sync_status).toBe("pending");
      expect(e.deletion_count).toBe(0);
      await outbound(user);
      expect(events.has(e.google_event_id)).toBe(true);
    } finally {
      await app.close();
    }
  });
  it("does not access Google when disconnected", async () => {
    await sql`UPDATE calendar_connections SET connected=false WHERE user_id=${user}`;
    const count = calls.length;
    await outbound(user);
    expect(calls.length).toBe(count);
    expect(
      eventDescription(
        { id: "topic", importance: 3 },
        [{ text: "one" }, { text: "two" }],
        ["tag"],
      ),
    ).toContain("• one\n• two");
  });
});
