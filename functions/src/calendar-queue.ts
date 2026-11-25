import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { db, type RecordData } from "./store.ts";

export const connections = db.collection("calendarConnections");
export const jobs = db.collection("syncJobs");

export function enqueue(
  tx: Transaction,
  uid: string,
  type: "outbound" | "inbound" | "reconcile",
  generation: number,
  data: RecordData = {},
) {
  const ref = jobs.doc(randomUUID());
  const now = Date.now();
  tx.create(ref, {
    uid,
    type,
    generation,
    status: "pending",
    attempts: 0,
    retryAt: now,
    createdAt: now,
    ...data,
  });
  return ref.id;
}

// Read before the caller makes any transactional writes. A running job has
// already snapshotted its work, so concurrent mutations get a successor job.
export async function prepareOutbound(tx: Transaction, uid: string) {
  const ref = connections.doc(uid);
  const connection = (await tx.get(ref)).data();
  if (!connection?.connected) return () => null;
  const pending = connection.outboundJobId
    ? await tx.get(jobs.doc(connection.outboundJobId))
    : null;
  const merge =
    pending?.get("status") === "pending" &&
    pending.get("generation") === connection.generation &&
    pending.get("attempts") === 0;
  return (ids: (string | undefined)[]) => {
    const changed = [...new Set(ids.filter((id): id is string => !!id))];
    if (!changed.length) return null;
    const previous = merge ? pending?.get("scheduleIds") : [];
    const combined = previous ? [...new Set([...previous, ...changed])] : null;
    const scheduleIds = combined && combined.length <= 500 ? combined : null;
    if (merge && pending) {
      tx.update(pending.ref, { scheduleIds });
      return pending.id;
    }
    const jobId = enqueue(tx, uid, "outbound", connection.generation, {
      scheduleIds,
    });
    tx.update(ref, { outboundJobId: jobId });
    return jobId;
  };
}

const minute = 60_000;
export function reconciliationDelay(connection: RecordData, now: number) {
  const expires = Date.parse(connection.channel_expires_at ?? "");
  const healthyWatch =
    process.env.WEBHOOK_ORIGIN &&
    connection.channel_id &&
    connection.channel_token &&
    expires > now;
  const configured = Number(process.env.CALENDAR_WATCH_FALLBACK_MINUTES ?? 60);
  const watchedMinutes =
    Number.isInteger(configured) && configured >= 5 && configured <= 60
      ? configured
      : 60;
  const interval = (healthyWatch ? watchedMinutes : 5) * minute;
  // Workers catch renewals inside the last day; spread due work across ticks.
  return interval - Math.floor(Math.random() * interval * 0.15);
}
