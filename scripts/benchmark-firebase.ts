import "./benchmark-safety.ts";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { auth, collection, db } from "../functions/src/store.ts";
import { createApp } from "../functions/src/http.ts";
import { ensureUser } from "../functions/src/domain.ts";
import { processJob, reconcile } from "../functions/src/jobs.ts";
import { stats, statsInput } from "../functions/src/connect/reads.ts";
import type { Principal } from "../functions/src/connect/oauth.ts";
import { encrypt } from "../apps/api/src/security.ts";
import { signInAsEmulatedGoogleUser } from "../tests/firebase/connect-fixtures.ts";

type Counts = {
  reads: number;
  writes: number;
  deletes: number;
  aggregateQueries: number;
  calendar: number;
  invocations: number;
};
const counts = (): Counts => ({
  reads: 0,
  writes: 0,
  deletes: 0,
  aggregateQueries: 0,
  calendar: 0,
  invocations: 0,
});
const baseline = process.argv.includes("--baseline");
let sample = counts();
const sdk = db as unknown as {
  request(method: string, ...args: any[]): Promise<unknown>;
  requestStream(method: string, ...args: any[]): Promise<NodeJS.EventEmitter>;
};
const request = sdk.request.bind(db);
sdk.request = async (method, ...args) => {
  const counter = sample;
  const result = await request(method, ...args);
  if (method === "commit") {
    for (const write of args[0].writes) {
      if (write.delete) counter.deletes++;
      else counter.writes++;
    }
  }
  return result;
};
const requestStream = sdk.requestStream.bind(db);
sdk.requestStream = async (method, ...args) => {
  const counter = sample;
  const stream = await requestStream(method, ...args);
  if (method === "runQuery" || method === "batchGetDocuments") {
    let rows = 0;
    stream.on("data", (data: any) => {
      if (data.document || data.found || data.missing) {
        counter.reads++;
        rows++;
      }
    });
    stream.on("end", () => {
      if (method === "runQuery" && rows === 0) counter.reads++;
    });
  } else if (method === "runAggregationQuery") {
    counter.aggregateQueries++;
  }
  return stream;
};

const events = new Map<string, any>();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    return originalFetch(input, init);
  if (url.hostname !== "www.googleapis.com")
    throw new Error("Benchmark blocks external requests");
  sample.calendar++;
  const method = init?.method ?? "GET";
  if (url.pathname.endsWith("/watch"))
    return Response.json({
      resourceId: "resource",
      expiration: String(Date.now() + 6 * day),
    });
  if (url.pathname.endsWith("/freeBusy"))
    return Response.json({ calendars: { primary: { busy: [] } } });
  if (url.pathname.endsWith("/events")) {
    if (method === "GET")
      return Response.json({ items: [], nextSyncToken: "benchmark" });
    const body = JSON.parse(String(init?.body));
    const event = { ...body, etag: randomUUID() };
    events.set(event.id, event);
    return Response.json(event);
  }
  const id = url.pathname.split("/").at(-1)!;
  const event = events.get(id);
  if (!event) return Response.json({}, { status: 404 });
  if (method === "DELETE") {
    events.delete(id);
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH") {
    const next = {
      ...event,
      ...JSON.parse(String(init?.body)),
      etag: randomUUID(),
    };
    events.set(id, next);
    return Response.json(next);
  }
  return Response.json(event);
};

const server = createApp().listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (typeof address !== "object" || !address)
  throw new Error("HTTP fixture not available");
const origin = "http://127.0.0.1:" + address.port;
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function seed(uid: string, topics: number, history: number) {
  await ensureUser(uid, {});
  const now = Date.now();
  const writer = db.bulkWriter();
  for (let i = 0; i < topics; i++) {
    const id = "topic-" + i,
      review = "pending-" + i;
    const start = iso(now + 2 * day + i * 15 * 60_000);
    writer.set(collection(uid, "topics").doc(id), {
      title: "Topic " + i,
      status: "active",
      tags: ["Benchmark"],
      importance: null,
      duration: 15,
      initial_knowledge: null,
      created_at: iso(now),
      pendingScheduleId: review,
      nextReviewAt: start,
      importanceOrder: 3,
    });
    writer.set(collection(uid, "memoryStates").doc(id), {
      topic_id: id,
      card: null,
      review_count: 0,
    });
    writer.set(collection(uid, "reviewSchedules").doc(review), {
      status: "pending",
      topic_id: id,
      scheduled_at: start,
      ideal_due_at: start,
      duration: 15,
      mode: "automatic",
      recovery: false,
      created_at: iso(now),
    });
  }
  for (let i = 0; i < history; i++) {
    const id = "completed-" + i,
      topic = "topic-" + (i % topics);
    const date = iso(now - ((i % 90) + 1) * day - i * 100);
    writer.set(collection(uid, "reviewHistory").doc(id), {
      topic_id: topic,
      schedule_id: id,
      completed_at: date,
      original_rating: (i % 5) + 1,
    });
    writer.set(collection(uid, "reviewSchedules").doc(id), {
      topic_id: topic,
      status: "completed",
      scheduled_at: date,
      duration: 15,
    });
  }
  await writer.close();
}

async function measure(label: string, task: () => Promise<unknown>) {
  sample = counts();
  const from = performance.now(),
    before = process.memoryUsage().rss,
    cpuBefore = process.cpuUsage();
  const result = await task();
  const ms = performance.now() - from;
  const cpu = process.cpuUsage(cpuBefore);
  return {
    label,
    ...sample,
    ms: Math.round(ms * 10) / 10,
    responseBytes:
      result === undefined ? 0 : Buffer.byteLength(JSON.stringify(result)),
    rssBefore: before,
    rssAfter: process.memoryUsage().rss,
    processMaxRssKiB: process.resourceUsage().maxRSS,
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
  };
}

process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.WEBHOOK_ORIGIN = "https://example.invalid";
const sizes = [
  [10, 100],
  [100, 1000],
  [500, 10000],
];
try {
  for (const [topics, history] of sizes) {
    const { uid, token } = await signInAsEmulatedGoogleUser(origin);
    const ref = db.collection("calendarConnections").doc(uid);
    const started = Date.now();
    const row = {
      uid,
      connected: true,
      generation: 1,
      calendar_id: "fixture-" + uid,
      sync_token: "benchmark",
      channel_id: "fixture",
      channel_token: "fixture",
      nextReconcileAt: started + 3_600_000,
      channel_expires_at: iso(started + 3 * day),
      encrypted_tokens: encrypt({
        access_token: "demo",
        refresh_token: "demo",
        expires_at: started + day,
      }),
    };
    const call = async (path: string, method = "GET", body?: unknown) => {
      sample.invocations++;
      const res = await fetch(origin + "/api/v1" + path, {
        method,
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(
          path + " returned " + res.status + " " + (await res.text()),
        );
      return res.json();
    };
    const job = async (type: string) => {
      const id = randomUUID();
      await db
        .collection("syncJobs")
        .doc(id)
        .create({ uid, type, status: "pending", retryAt: 0, attempts: 0 });
      await processJob(id);
    };
    try {
      events.clear();
      await seed(uid, topics, history);
      await call("/me");
      const measurements = [];
      measurements.push(
        await measure("dashboard", async () => {
          if (!baseline) return call("/dashboard");
          const list = async () => {
            const items = [];
            let total: number;
            do {
              const page = await call(
                "/topics?limit=100&offset=" + items.length,
              );
              items.push(...page.items);
              total = page.total;
            } while (items.length < total);
            return { items, total };
          };
          return Promise.all([
            list(),
            call("/reviews/upcoming"),
            call("/preferences"),
            call("/calendar/status"),
            call("/reviews/progress"),
          ]);
        }),
      );
      measurements.push(
        await measure("first topic page", () => call("/topics?limit=30")),
      );
      let created: any;
      measurements.push(
        await measure(
          "create topic",
          async () =>
            (created = await call("/topics", "POST", { title: "Created" })),
        ),
      );
      const id = created.schedule.id;
      let next: any;
      measurements.push(
        await measure("concurrent completion", async () => {
          const result = await Promise.all([
            call("/reviews/" + id + "/complete", "POST", { rating: 4 }),
            call("/reviews/" + id + "/complete", "POST", { rating: 4 }),
          ]);
          if (result.filter((r) => r.duplicate).length !== 1)
            throw new Error("Concurrent completion duplicated");
          return result;
        }),
      );
      measurements.push(
        await measure(
          "correct rating",
          async () =>
            (next = await call("/reviews/" + id + "/correct", "POST", {
              rating: 2,
            })),
        ),
      );
      measurements.push(
        await measure("topic history", () => call("/topics/topic-0/history")),
      );
      measurements.push(
        await measure("AI statistics handler", async () => {
          sample.invocations++;
          return stats({ uid } as Principal, statsInput.parse({}));
        }),
      );
      measurements.push(
        await measure("reschedule", () =>
          call("/reviews/" + next.next.id + "/schedule", "PATCH", {
            scheduledAt: iso(started + 14 * day),
          }),
        ),
      );
      const unconnectedJobs = await db
        .collection("syncJobs")
        .where("uid", "==", uid)
        .get();
      for (const doc of unconnectedJobs.docs) await doc.ref.delete();
      await ref.set(row);
      await job("reconcile");
      const idle = await measure("idle connected scheduler tick", async () => {
        sample.invocations++;
        await reconcile();
      });
      measurements.push(idle);
      const idJob = randomUUID();
      await db.collection("syncJobs").doc(idJob).create({
        uid,
        type: "reconcile",
        status: "pending",
        retryAt: 0,
        attempts: 0,
        fullOutbound: false,
      });
      measurements.push(
        await measure("connected fallback job", async () => {
          sample.invocations++;
          await processJob(idJob);
        }),
      );
      console.log(JSON.stringify({ topics, history, measurements }));
    } finally {
      await db.recursiveDelete(db.collection("users").doc(uid));
      await ref.delete();
      await db.collection("syncLocks").doc(uid).delete();
      const jobs = await db
        .collection("syncJobs")
        .where("uid", "==", uid)
        .get();
      for (const doc of jobs.docs) await doc.ref.delete();
      await auth.deleteUser(uid);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  server.close();
  await db.terminate();
}
