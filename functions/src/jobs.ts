import { randomUUID } from "node:crypto";
import { db, type RecordData } from "./store.ts";
import { CalendarSync } from "./calendar.ts";
import {
  connections,
  jobs,
  enqueue,
  reconciliationDelay,
} from "./calendar-queue.ts";

export async function processJob(id: string, transport?: typeof fetch) {
  const ref = jobs.doc(id),
    token = randomUUID(),
    now = Date.now();
  const claim = await db.runTransaction<RecordData | null>(async (tx) => {
    const job = (await tx.get(ref)).data();
    if (
      !job ||
      job.status === "done" ||
      job.status === "failed" ||
      job.retryAt > now ||
      (job.status === "running" && job.leaseUntil > now)
    )
      return null;
    const lock = db.collection("syncLocks").doc(job.uid);
    const [owner, connection] = await Promise.all([
      tx.get(lock),
      tx.get(connections.doc(job.uid)),
    ]);
    if (owner.get("until") > now) return null;
    const generation = connection.get("generation");
    if (
      !connection.get("connected") ||
      (job.generation !== undefined && job.generation !== generation)
    ) {
      tx.update(ref, { status: "done", expiresAt: expiry(), leaseUntil: 0 });
      return null;
    }
    tx.set(lock, { token, until: now + 600000 });
    tx.update(ref, {
      status: "running",
      attempts: job.attempts + 1,
      leaseToken: token,
      leaseUntil: now + 600000,
    });
    return { ...job, attempts: job.attempts + 1, generation };
  });
  if (!claim) return false;
  let error: string | null = null,
    retryAfter = 0;
  try {
    const sync = new CalendarSync(claim.uid, transport, claim.generation);
    if (claim.type !== "outbound")
      await sync.inbound(claim.resetCursor === true);
    if (claim.type !== "inbound") {
      const targeted =
        claim.type === "outbound"
          ? (claim.scheduleIds ?? undefined)
          : undefined;
      const periodic =
        claim.type === "reconcile" && claim.fullOutbound === false;
      try {
        await sync.freeBusy(targeted, periodic);
      } finally {
        if (!periodic) await sync.outbound(targeted);
      }
    }
    if (claim.type === "reconcile") await sync.watch();
  } catch (e: any) {
    const status = e?.status;
    retryAfter = e?.retryAfterMs ?? 0;
    error =
      Number.isInteger(status) && status >= 400 && status < 600
        ? `Google Calendar synchronization returned ${status}`
        : "Calendar synchronization failed. Check the connection and retry.";
  }
  const terminal = !error || claim.attempts >= 10;
  await db.runTransaction(async (tx) => {
    const connectionRef = connections.doc(claim.uid);
    const [s, lock, connection] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection("syncLocks").doc(claim.uid)),
      tx.get(connectionRef),
    ]);
    if (s.get("leaseToken") !== token || lock.get("token") !== token) return;
    const backoff = Math.min(3600000, 1000 * 2 ** Math.min(claim.attempts, 12));
    tx.update(ref, {
      status: error ? (terminal ? "failed" : "pending") : "done",
      error,
      retryAt:
        Date.now() +
        Math.max(
          retryAfter,
          backoff + Math.floor(Math.random() * backoff * 0.2),
        ),
      leaseUntil: 0,
      ...(terminal ? { expiresAt: expiry() } : {}),
    });
    tx.delete(lock.ref);
    if (
      !connection.get("connected") ||
      connection.get("generation") !== claim.generation
    )
      return;
    const pointer = claim.type + "JobId";
    const updates: RecordData = {};
    if (terminal && error && claim.type !== "inbound")
      updates.repairOutbound = true;
    if (!error && claim.type === "reconcile" && claim.fullOutbound !== false)
      updates.repairOutbound = false;
    if (terminal && connection.get(pointer) === id) updates[pointer] = null;
    // A successful inbound ping may coexist with an outbound or availability failure.
    if (error || claim.type !== "inbound") updates.error = error;
    if (
      !error &&
      claim.type === "reconcile" &&
      (connection.get(pointer) === id || !connection.get(pointer))
    ) {
      const next = Date.now();
      updates.nextReconcileAt =
        next + reconciliationDelay(connection.data()!, next);
    }
    if (Object.keys(updates).length) tx.update(connectionRef, updates);
  });
  if (error && terminal)
    console.warn("Calendar job exhausted retries", {
      type: claim.type,
      attempts: claim.attempts,
    });
  return true;
}

const expiry = () => new Date(Date.now() + 30 * 86_400_000);
const concurrency = 8;
async function batches<T>(items: T[], run: (value: T) => Promise<unknown>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      for (; next < items.length;) await run(items[next++]);
    }),
  );
}

export async function reconcile() {
  const now = Date.now();
  const [due, pending, stale] = await Promise.all([
    connections
      .where("connected", "==", true)
      .where("nextReconcileAt", ">=", 0)
      .where("nextReconcileAt", "<=", now)
      .orderBy("nextReconcileAt")
      .limit(250)
      .get(),
    jobs
      .where("status", "==", "pending")
      .where("retryAt", "<=", now - 45_000)
      .orderBy("retryAt")
      .limit(100)
      .get(),
    jobs
      .where("status", "==", "running")
      .where("leaseUntil", "<=", now)
      .orderBy("leaseUntil")
      .limit(100)
      .get(),
  ]);
  // Newly created work is dispatched solely by the Firestore create trigger.
  // The scheduler recovers delayed retries, contention and abandoned leases.
  await Promise.all([
    batches(due.docs, (doc) =>
      db.runTransaction(async (tx) => {
        const row = await tx.get(doc.ref);
        if (
          !row.get("connected") ||
          typeof row.get("nextReconcileAt") !== "number" ||
          row.get("nextReconcileAt") > now
        )
          return;
        const pointer = row.get("reconcileJobId");
        let queued = pointer ? await tx.get(jobs.doc(pointer)) : null;
        if (
          queued?.get("generation") !== row.get("generation") ||
          !["pending", "running"].includes(queued?.get("status"))
        )
          queued = null;
        const reconcileJobId =
          queued?.id ??
          enqueue(tx, doc.id, "reconcile", row.get("generation"), {
            fullOutbound: false,
          });
        tx.update(doc.ref, {
          reconcileJobId,
          nextReconcileAt: now + reconciliationDelay(row.data()!, now),
        });
      }),
    ),
    batches([...pending.docs, ...stale.docs], async (job) => {
      await processJob(job.id);
    }),
  ]);
}
