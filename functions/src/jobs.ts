import { randomUUID } from "node:crypto";
import { db, type RecordData } from "./store.ts";
import { CalendarSync } from "./calendar.ts";
import { digest } from "./domain.ts";
export async function processJob(id: string, transport?: typeof fetch) {
  const ref = db.collection("syncJobs").doc(id),
    token = randomUUID(),
    now = Date.now();
  const claim = await db.runTransaction<RecordData | null>(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const job = s.data()!;
    if (
      job.status === "done" ||
      job.status === "failed" ||
      job.retryAt > now ||
      (job.status === "running" && job.leaseUntil > now)
    )
      return null;
    const lock = db.collection("syncLocks").doc(job.uid);
    const owner = await tx.get(lock);
    if (owner.exists && owner.data()!.until > now) return null;
    tx.set(lock, { token, until: now + 600000 });
    tx.update(ref, {
      status: "running",
      attempts: job.attempts + 1,
      leaseToken: token,
      leaseUntil: now + 600000,
    });
    return { ...job, attempts: job.attempts + 1 };
  });
  if (!claim) return false;
  let error: string | null = null;
  try {
    const sync = new CalendarSync(claim.uid, transport);
    if (await sync.connection()) {
      if (claim.type !== "outbound") await sync.inbound();
      await sync.freeBusy();
      await sync.outbound();
      await sync.watch();
    }
  } catch (e: any) {
    error = String(e.message).slice(0, 200);
  }
  await db.runTransaction(async (tx) => {
    const [s, l] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection("syncLocks").doc(claim.uid)),
    ]);
    if (s.data()?.leaseToken !== token || l.data()?.token !== token) return;
    tx.update(ref, {
      status: error ? (claim.attempts >= 10 ? "failed" : "pending") : "done",
      error,
      retryAt:
        Date.now() +
        Math.min(3600000, 1000 * 2 ** Math.min(claim.attempts, 12)),
      leaseUntil: 0,
      ...(error && claim.attempts < 10
        ? {}
        : { expiresAt: new Date(Date.now() + 30 * 86400000) }),
    });
    tx.delete(l.ref);
    if (error)
      tx.set(
        db.collection("calendarConnections").doc(claim.uid),
        { error },
        { merge: true },
      );
  });
  return true;
}
export async function reconcile() {
  const connections = await db
    .collection("calendarConnections")
    .where("connected", "==", true)
    .get();
  for (const c of connections.docs) {
    const id = digest(`reconcile:${c.id}:${Math.floor(Date.now() / 300000)}`);
    const ref = db.collection("syncJobs").doc(id);
    await db.runTransaction(async (tx) => {
      const exists = await tx.get(ref);
      if (!exists.exists)
        tx.create(ref, {
          uid: c.id,
          type: "reconcile",
          status: "pending",
          attempts: 0,
          retryAt: Date.now(),
          createdAt: Date.now(),
        });
    });
  }
  const [pending, stale] = await Promise.all([
    db
      .collection("syncJobs")
      .where("status", "==", "pending")
      .where("retryAt", "<=", Date.now())
      .orderBy("retryAt")
      .limit(100)
      .get(),
    db
      .collection("syncJobs")
      .where("status", "==", "running")
      .where("leaseUntil", "<=", Date.now())
      .orderBy("leaseUntil")
      .limit(100)
      .get(),
  ]);
  for (const j of [...pending.docs, ...stale.docs]) await processJob(j.id);
}
