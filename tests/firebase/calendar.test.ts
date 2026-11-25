import {
  processDeletion,
  requestDeletion,
} from "../../functions/src/account-deletion.ts";
import { beforeAll, afterAll, it, expect } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { db, collection, deletionRef } from "../../functions/src/store.ts";
import {
  complete,
  preview,
  ensureUser,
  createTopic,
  details,
  editTopic,
  reschedule,
} from "../../functions/src/domain.ts";
import {
  CalendarSync,
  authorize,
  finish,
  scopes,
  webhook,
  disconnect,
  resync,
} from "../../functions/src/calendar.ts";
import { processJob } from "../../functions/src/jobs.ts";
import { encrypt, decrypt, random, hash } from "../../apps/api/src/security.ts";
const uid = "calendar-" + crypto.randomUUID();
let retryJob: string;
let topic: any,
  version = 0,
  calendars = 0,
  failNext = false,
  expired = false;
const events = new Map<string, any>();
const calls: { url: string; method: string; body: any }[] = [];
const transport: typeof fetch = async (input, opts = {}) => {
  const url = String(input),
    method = opts.method ?? "GET",
    body = opts.body
      ? opts.headers &&
        String((opts.headers as any)["content-type"]).includes(
          "x-www-form-urlencoded",
        )
        ? Object.fromEntries(new URLSearchParams(String(opts.body)))
        : JSON.parse(String(opts.body))
      : null;
  calls.push({ url, method, body });
  if (failNext) {
    failNext = false;
    return Response.json({}, { status: 503 });
  }
  if (url === "https://oauth2.googleapis.com/token")
    return Response.json({
      access_token: "refreshed-test-only",
      refresh_token: "test-refresh",
      scope: scopes.join(" "),
      expires_in: 3600,
    });
  if (url.endsWith("/calendars"))
    return Response.json({ id: "dedicated-" + ++calendars });
  if (url.endsWith("/freeBusy"))
    return Response.json({ calendars: { primary: { busy: [] } } });
  if (url.endsWith("/watch"))
    return Response.json({
      resourceId: "resource",
      expiration: String(Date.now() + 6 * 86400000),
    });
  if (url.includes("/events?")) {
    if (expired && url.includes("syncToken=")) {
      expired = false;
      return Response.json({}, { status: 410 });
    }
    return Response.json({
      items: [...events.values()],
      nextSyncToken: "sync-" + version,
    });
  }
  if (url.endsWith("/events") && method === "POST") {
    if (events.has(body.id)) return Response.json({}, { status: 409 });
    const e = { ...body, etag: "v" + ++version };
    events.set(e.id, e);
    return Response.json(e);
  }
  const id = url.split("/").pop()!,
    e = events.get(id);
  if (!e) return Response.json({}, { status: 404 });
  if (method === "DELETE") {
    events.delete(id);
    return new Response(null, { status: 200 });
  }
  if (method === "PATCH") {
    const next = { ...e, ...body, etag: "v" + ++version };
    events.set(id, next);
    return Response.json(next);
  }
  return Response.json(e);
};
const sync = new CalendarSync(uid, transport);
beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  process.env.GOOGLE_CLIENT_ID = "test-only-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-only-secret";
  await ensureUser(uid, { email: "calendar@example.invalid" });
  topic = await createTopic(uid, {
    title: "Logarithms",
    importance: 5,
    materials: ["First <unsafe>", "https://example.com", "Third"],
    tags: ["Math"],
  });
  retryJob = "retry-" + random();
  await db.collection("syncJobs").doc(retryJob).create({
    uid,
    type: "outbound",
    status: "pending",
    attempts: 0,
    retryAt: 0,
  });
  for (let i = 0; i < 100; i++) {
    if (
      (await db.collection("syncJobs").doc(retryJob).get()).data()?.status ===
      "done"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(
    (await db.collection("syncJobs").doc(retryJob).get()).data()!.status,
  ).toBe("done");
  await db
    .collection("calendarConnections")
    .doc(uid)
    .set({
      uid,
      connected: true,
      generation: 1,
      encrypted_tokens: encrypt({
        access_token: "test-only",
        refresh_token: "test-only",
        expires_at: Date.now() + 3600000,
      }),
    });
});
afterAll(async () => {
  await db.recursiveDelete(db.collection("users").doc(uid));
  await db.collection("calendarConnections").doc(uid).delete();
  await db.collection("syncLocks").doc(uid).delete();
  const jobs = await db.collection("syncJobs").where("uid", "==", uid).get();
  for (const j of jobs.docs) await j.ref.delete();
});
it("previews connected calendar conflicts without moving an existing review", async () => {
  const input = { duration: 40, knowledge: 5, importance: 4 };
  const baseline = await preview(uid, input);
  const start = baseline.start!;
  const end = new Date(Date.parse(start) + 40 * 60000).toISOString();
  const calendar = new CalendarSync(uid, async (url) => {
    expect(String(url)).toMatch(/\/freeBusy$/);
    return Response.json({
      calendars: { primary: { busy: [{ start, end }] } },
    });
  });
  const automatic = await preview(uid, input, await calendar.availability());
  expect(automatic.start).toBe(end);
  const manual = await preview(
    uid,
    { ...input, scheduledAt: start },
    await calendar.availability(start, 40),
  );
  expect(manual).toMatchObject({
    start,
    mode: "manual",
    reason: "Manual time overlaps another event.",
  });
  expect((await details(uid, topic.id)).schedule.scheduled_at).toBe(
    topic.schedule.scheduled_at,
  );
});
it("creates a dedicated calendar once and reuses it across reconnect", async () => {
  await sync.ensure();
  await sync.ensure();
  expect(calendars).toBe(1);
});
it("creates exactly one event with stable ID, ordered escaped materials and metadata", async () => {
  await sync.outbound();
  await sync.outbound();
  expect(events.size).toBe(1);
  const e = [...events.values()][0];
  expect(e.description).toContain("First &lt;unsafe&gt;");
  expect(e.description.indexOf("First")).toBeLessThan(
    e.description.indexOf("Third"),
  );
  expect(e.extendedProperties.private.blindSpotSchedule).toBe(
    topic.schedule.id,
  );
  expect(
    calls.filter((c) => c.url.endsWith("/events") && c.method === "POST"),
  ).toHaveLength(1);
});
it("app changes update descriptions and times without changing memory", async () => {
  await editTopic(uid, topic.id, {
    materials: ["Updated first", "Updated second"],
  });
  await sync.outbound();
  const event = [...events.values()][0];
  expect(event.description).toContain("• Updated first\n• Updated second");
  const at = new Date(Date.now() + 2 * 86400000);
  await reschedule(uid, topic.schedule.id, at);
  await sync.outbound();
  expect(Date.parse(events.get(event.id).start.dateTime)).toBe(at.getTime());
  expect((await details(uid, topic.id)).memory.review_count).toBe(0);
});
it("external moves become manual without changing memory", async () => {
  const e = [...events.values()][0],
    at = new Date(Date.now() + 4 * 86400000).toISOString();
  events.set(e.id, {
    ...e,
    etag: "moved",
    start: { dateTime: at },
    end: { dateTime: new Date(Date.parse(at) + 900000).toISOString() },
  });
  await sync.inbound();
  const t = await details(uid, topic.id);
  expect(t.schedule.mode).toBe("manual");
  expect(t.schedule.scheduled_at).toBe(at);
  expect(t.memory.review_count).toBe(0);
});
it("recovers expired sync tokens with a full scan", async () => {
  expired = true;
  await sync.inbound();
  expect(expired).toBe(false);
  expect(
    (await db.collection("calendarConnections").doc(uid).get()).data()!
      .sync_token,
  ).toMatch(/^sync-/);
});
it("deletions reschedule safely and pause recreation after the third deletion", async () => {
  for (let i = 0; i < 3; i++) {
    const mapping = (
      await collection(uid, "calendarEvents").doc(topic.schedule.id).get()
    ).data()!;
    events.set(mapping.google_event_id, {
      id: mapping.google_event_id,
      status: "cancelled",
      etag: "cancelled-" + i,
    });
    await sync.inbound();
    if (i < 2) {
      events.delete(mapping.google_event_id);
      await sync.outbound();
    }
  }
  const e = (
    await collection(uid, "calendarEvents").doc(topic.schedule.id).get()
  ).data()!;
  expect(e.sync_status).toBe("blocked");
  const n = calls.length;
  await sync.outbound();
  expect(calls.length).toBe(n);
  await resync(uid);
  await sync.outbound();
  expect(
    (
      await collection(uid, "calendarEvents").doc(topic.schedule.id).get()
    ).data()!.sync_status,
  ).toBe("synced");
});
it("refreshes expired offline access tokens only on the server", async () => {
  await db
    .collection("calendarConnections")
    .doc(uid)
    .update({
      encrypted_tokens: encrypt({
        access_token: "expired",
        refresh_token: "offline",
        expires_at: 0,
      }),
    });
  await sync.request("freeBusy", { method: "POST", body: {} });
  const c = (await db.collection("calendarConnections").doc(uid).get()).data()!;
  expect(decrypt(c.encrypted_tokens).access_token).toBe("refreshed-test-only");
});
it("separate PKCE OAuth state is browser-bound, single-use and retains calendar identity", async () => {
  const grant = await authorize(uid);
  const url = new URL(grant.url);
  expect(url.searchParams.get("scope")).not.toContain("openid");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  await expect(
    finish("code", grant.state, "wrong", transport),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(await finish("code", grant.state, grant.state, transport)).toBe(uid);
  await expect(
    finish("code", grant.state, grant.state, transport),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect((await sync.ensure())!.calendar_id).toBe("dedicated-1");
});
it("validates and deduplicates webhook notifications without trusting an event payload", async () => {
  const token = random(),
    channel = random();
  await db
    .collection("calendarConnections")
    .doc(uid)
    .update({
      channel_id: channel,
      channel_token: hash(token),
      resource_id: "resource",
    });
  const headers = {
    "x-goog-channel-id": channel,
    "x-goog-channel-token": token,
    "x-goog-resource-id": "resource",
    "x-goog-message-number": "1",
  };
  await webhook(headers);
  const outbox = db
    .collection("syncJobs")
    .where("uid", "==", uid)
    .where("type", "==", "inbound");
  const first = (await outbox.get()).docs.map((doc) => doc.id);
  expect(first.length).toBeGreaterThan(0);
  await webhook(headers);
  expect((await outbox.get()).docs.map((doc) => doc.id)).toEqual(first);
  expect((await sync.connection())?.channel_message).toBe("1");
  await expect(
    webhook({ ...headers, "x-goog-channel-token": "forged" }),
  ).rejects.toMatchObject({ statusCode: 403 });
});
it("renews push watches and avoids duplicate renewal while active", async () => {
  process.env.WEBHOOK_ORIGIN = "https://hooks.example.invalid";
  try {
    const count = calls.filter((c) => c.url.endsWith("/watch")).length;
    await sync.watch();
    await sync.watch();
    expect(calls.filter((c) => c.url.endsWith("/watch")).length).toBe(
      count + 1,
    );
    await db
      .collection("calendarConnections")
      .doc(uid)
      .update({ channel_expires_at: new Date(0).toISOString() });
    await sync.watch();
    expect(calls.filter((c) => c.url.endsWith("/watch")).length).toBe(
      count + 2,
    );
    expect(
      (await db.collection("calendarConnections").doc(uid).get()).data()!
        .resource_id,
    ).toBe("resource");
  } finally {
    delete process.env.WEBHOOK_ORIGIN;
  }
});
it("replaces a future event after early completion and converges on retry", async () => {
  await sync.outbound();
  const original = (await details(uid, topic.id)).schedule;
  expect(Date.parse(original.scheduled_at)).toBeGreaterThan(Date.now());
  const oldEvent = (
    await collection(uid, "calendarEvents").doc(original.id).get()
  ).get("google_event_id");
  expect(events.has(oldEvent)).toBe(true);
  const outbox = db.collection("syncJobs").where("uid", "==", uid);
  const previousJobs = new Set((await outbox.get()).docs.map((doc) => doc.id));
  const result = await complete(uid, original.id, 2);
  const created = (await outbox.get()).docs.filter(
    (doc) => !previousJobs.has(doc.id) && doc.get("type") === "outbound",
  );
  expect(created).toHaveLength(1);
  const ref = created[0].ref;
  const next = result.next!;
  expect((await details(uid, topic.id)).pendingScheduleId).toBe(next.id);
  expect(
    (await collection(uid, "reviewSchedules").doc(original.id).get()).get(
      "status",
    ),
  ).toBe("completed");
  expect(
    (await collection(uid, "reviewHistory").doc(original.id).get()).exists,
  ).toBe(true);
  const unavailable: typeof fetch = (url, options) =>
    String(url).endsWith("/freeBusy")
      ? Promise.resolve(Response.json({}, { status: 429 }))
      : transport(url, options);
  async function run(google: typeof fetch) {
    await expect
      .poll(
        async () => {
          // Advance backoff for this demo job. Respect any lease held by the emulator trigger.
          await db.runTransaction(async (tx) => {
            const job = await tx.get(ref);
            if (
              job.get("status") === "pending" &&
              job.get("retryAt") > Date.now()
            )
              tx.update(ref, { retryAt: 0 });
          });
          return processJob(ref.id, google);
        },
        { timeout: 20000 },
      )
      .toBe(true);
  }
  await run(unavailable);
  expect((await ref.get()).get("status")).toBe("pending");
  expect(events.has(oldEvent)).toBe(false);
  const replacement = [...events.values()].filter(
    (e) => e.extendedProperties?.private.blindSpotSchedule === next.id,
  );
  expect(replacement).toHaveLength(1);
  expect(replacement[0].start.dateTime).toBe(next.scheduled_at);
  await run(async () => {
    throw new Error("private transport detail");
  });
  expect((await ref.get()).get("error")).toBe(
    "Calendar synchronization failed. Check the connection and retry.",
  );
  expect((await sync.connection())?.error).toBe((await ref.get()).get("error"));
  await run(transport);
  expect((await ref.get()).get("status")).toBe("done");
  expect(
    [...events.values()].filter((event) => event.status !== "cancelled"),
  ).toHaveLength(1);
  expect((await sync.connection())?.error).toBeNull();
  expect(await processJob(ref.id, transport)).toBe(false);
});
it("leased durable jobs retry with backoff and are not completed on external failure", async () => {
  const id = retryJob;
  for (let i = 0; i < 100; i++) {
    if (!(await db.collection("syncLocks").doc(uid).get()).exists) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await db
    .collection("syncJobs")
    .doc(id)
    .update({ status: "pending", attempts: 0, retryAt: 0 });
  failNext = true;
  let claimed = false;
  for (let i = 0; i < 100 && !claimed; i++) {
    claimed = await processJob(id, transport);
    if (!claimed) await new Promise((r) => setTimeout(r, 100));
  }
  expect(claimed).toBe(true);
  const failed = (await db.collection("syncJobs").doc(id).get()).data()!;
  expect(failed.status).toBe("pending");
  expect(failed.attempts).toBe(1);
  expect(failed.retryAt).toBeGreaterThan(Date.now());
  expect(failed.error).toContain("503");
  await disconnect(uid);
  await db.collection("syncJobs").doc(id).update({ retryAt: 0 });
  await processJob(id, transport);
  expect((await db.collection("syncJobs").doc(id).get()).data()!.status).toBe(
    "done",
  );
});
it("disconnect preserves topics while preventing external API use", async () => {
  const n = calls.length;
  await sync.outbound();
  expect(calls.length).toBe(n);
  expect((await details(uid, topic.id)).title).toBe("Logarithms");
});
it("rejects expired OAuth state without contacting Google", async () => {
  const state = random();
  await db
    .collection("oauthStates")
    .doc(hash(state))
    .create({ uid, verifier: random(), expiresAt: Timestamp.fromMillis(0) });
  await expect(finish("code", state, state, transport)).rejects.toMatchObject({
    statusCode: 400,
  });
  await db.collection("oauthStates").doc(hash(state)).delete();
});

it("coalesces webhook work while an inbound job is pending and ignores replayed numbers", async () => {
  const ref = db.collection("calendarConnections").doc(uid);
  const channel = random(),
    token = random(),
    job = random();
  const generation = (await ref.get()).get("generation");
  const queued = db.collection("syncJobs").doc(job);
  await queued.create({
    uid,
    generation,
    type: "inbound",
    status: "pending",
    attempts: 0,
    retryAt: Date.now() + 60 * 60_000,
  });
  await ref.update({
    connected: true,
    channel_id: channel,
    channel_token: hash(token),
    resource_id: "resource",
    channel_message: null,
    inboundJobId: job,
  });
  const deliver = (number: string) =>
    webhook({
      "x-goog-channel-id": channel,
      "x-goog-channel-token": token,
      "x-goog-resource-id": "resource",
      "x-goog-message-number": number,
    });
  await deliver("3");
  await deliver("1");
  await deliver("4");
  const next = await ref.get();
  expect(next.get("inboundJobId")).toBe(job);
  expect(next.get("channel_message")).toBe("4");
  expect((await queued.get()).get("attempts")).toBe(0);
});

it("publishes a new event after an unscheduled review gets another slot", async () => {
  const owner = "calendar-tombstone-" + random();
  const connection = db.collection("calendarConnections").doc(owner);
  try {
    await ensureUser(owner, {});
    const created = await createTopic(owner, { title: "Tombstone test" });
    const review = created.schedule;
    const schedule = collection(owner, "reviewSchedules").doc(review.id);
    const mapping = collection(owner, "calendarEvents").doc(review.id);
    await connection.set({
      connected: true,
      generation: 1,
      calendar_id: "old-event-fixture",
      encrypted_tokens: encrypt({
        access_token: "test-only",
        expires_at: Date.now() + 3600000,
      }),
    });
    const calendar = new CalendarSync(owner, async (url, options) => {
      if (options?.method !== "DELETE") return transport(url, options);
      const id = String(url).split("/").at(-1)!;
      events.set(id, { ...events.get(id), status: "cancelled" });
      return new Response(null, { status: 204 });
    });
    await calendar.outbound([review.id]);
    const previous = (await mapping.get()).get("google_event_id");
    await schedule.update({ scheduled_at: null });
    await calendar.outbound([review.id]);
    expect((await mapping.get()).get("sync_status")).toBe("deleted");
    expect(events.get(previous).status).toBe("cancelled");
    await schedule.update({ scheduled_at: review.scheduled_at });
    await calendar.outbound([review.id]);
    const current = await mapping.get();
    expect(current.get("google_event_id")).not.toBe(previous);
    expect(current.get("sync_status")).toBe("synced");
    expect(events.get(current.get("google_event_id")).start.dateTime).toBe(
      review.scheduled_at,
    );
  } finally {
    await connection.delete();
    await db.recursiveDelete(db.collection("users").doc(owner));
  }
});

it("hands an in-flight Calendar grant to account deletion without scheduling sync", async () => {
  const member = "calendar-delete-" + crypto.randomUUID();
  const job = deletionRef(member);
  const connection = db.collection("calendarConnections").doc(member);
  const root = db.collection("users").doc(member);
  const acquired = Promise.withResolvers<void>();
  const completeExchange = Promise.withResolvers<void>();
  await ensureUser(member, {});
  const { state } = await authorize(member);
  const finishCallback = finish("synthetic-code", state, state, async () => {
    acquired.resolve();
    await completeExchange.promise;
    return Response.json({
      access_token: "access-test-only",
      refresh_token: "late-test-token",
      scope: scopes.join(" "),
      expires_in: 3600,
    });
  }).catch((error) => error);
  try {
    await Promise.race([
      acquired.promise,
      finishCallback.then((error) => {
        throw error;
      }),
    ]);
    await requestDeletion(member, Math.floor(Date.now() / 1000));
    expect((await job.get()).get("nextAttemptAt")).toBeGreaterThan(Date.now());
    completeExchange.resolve();
    expect(await finishCallback).toMatchObject({ statusCode: 410 });
    expect((await connection.get()).exists).toBe(false);
    expect((await job.collection("calendarTokens").get()).size).toBe(1);
    await job.update({ nextAttemptAt: Date.now() });
    const calls: string[] = [];
    await processDeletion(job, async (url, options) => {
      expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
      calls.push(String(options?.body));
      return new Response(null, { status: 204 });
    });
    expect(calls).toEqual(["token=late-test-token"]);
    expect((await job.get()).data()).toEqual({ completed: true });
    expect((await job.collection("calendarTokens").get()).empty).toBe(true);
  } finally {
    completeExchange.resolve();
    await finishCallback;
    await Promise.all([
      db.recursiveDelete(job),
      db.recursiveDelete(root),
      connection.delete(),
    ]);
  }
});
