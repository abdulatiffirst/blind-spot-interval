import { decrypt } from "../../apps/api/src/security.ts";
import { account } from "./connect/oauth.ts";
import { connections, jobs } from "./calendar-queue.ts";
import { randomUUID } from "node:crypto";
import {
  auth,
  calendarOAuthLock,
  db,
  deletionRef,
  deletions,
  fail,
  userRef,
} from "./store.ts";

// Leave time for the shared 540-second scheduler invocation to terminate.
const leaseMs = 10 * 60_000;
const syncLock = (uid: string) => db.collection("syncLocks").doc(uid);
const retryDelay = (attempt: number) =>
  Math.min(60 * 60_000, 60_000 * 2 ** Math.min(attempt, 6));

export async function requestDeletion(uid: string, authenticatedAt: number) {
  const now = Date.now();
  if (
    !Number.isFinite(authenticatedAt) ||
    authenticatedAt * 1000 > now + 5000 ||
    now - authenticatedAt * 1000 > 5 * 60_000
  )
    fail(403, "Sign in with Google again to delete your account");
  const ref = deletionRef(uid);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) return;
    const connection = await tx.get(connections.doc(uid));
    const [lock, oauthLock] = await tx.getAll(
      syncLock(uid),
      calendarOAuthLock(uid),
    );
    tx.create(ref, {
      uid,
      nextAttemptAt: Math.max(
        now,
        lock.get("until") ?? 0,
        oauthLock.get("until") ?? 0,
      ),
      attempts: 0,
    });
    tx.set(userRef(uid), { deleting: true }, { merge: true });
    tx.delete(account(uid));
    if (connection.exists) tx.update(connection.ref, { connected: false });
  });
}

async function revokeCalendarToken(token: string, transport = fetch) {
  const response = await transport("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.ok) return;
  // A prior attempt may have revoked the token before its Firestore write.
  if (
    response.status === 400 &&
    (await response.json().catch(() => null))?.error === "invalid_token"
  )
    return;
  throw new Error("Google Calendar credential revocation failed");
}

async function deleteRows(query: FirebaseFirestore.Query) {
  for (;;) {
    const page = await query.limit(200).get();
    if (page.empty) return;
    const batch = db.batch();
    for (const doc of page.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

export async function processDeletion(
  ref: FirebaseFirestore.DocumentReference,
  transport: typeof fetch = fetch,
) {
  const lease = randomUUID();
  const job = await db.runTransaction(async (tx) => {
    const row = (await tx.get(ref)).data();
    if (!row?.uid || row.nextAttemptAt > Date.now()) return null;
    tx.update(ref, { lease, nextAttemptAt: Date.now() + leaseMs });
    return { uid: row.uid as string, attempts: row.attempts as number };
  });
  if (!job) return;
  const { uid, attempts } = job;
  try {
    const connection = connections.doc(uid);
    const encrypted = (await connection.get()).get("encrypted_tokens");
    const late = await ref.collection("calendarTokens").get();
    for (const value of [
      encrypted,
      ...late.docs.map((doc) => doc.get("encrypted")),
    ].filter(Boolean)) {
      const { refresh_token, access_token } = decrypt(value);
      const token = refresh_token ?? access_token;
      if (typeof token !== "string" || !token)
        throw new Error("Calendar credential is missing");
      await revokeCalendarToken(token, transport);
    }
    await connection.delete();
    await Promise.all(late.docs.map((doc) => doc.ref.delete()));
    await Promise.all([
      deleteRows(jobs.where("uid", "==", uid)),
      deleteRows(db.collection("oauthStates").where("uid", "==", uid)),
      deleteRows(db.collection("mcpEphemeral").where("uid", "==", uid)),
      deleteRows(db.collection("mcpActions").where("uid", "==", uid)),
      db.recursiveDelete(userRef(uid)),
    ]);
    await Promise.all([
      syncLock(uid).delete(),
      calendarOAuthLock(uid).delete(),
    ]);
    await auth.deleteUser(uid).catch((error) => {
      if (error.code !== "auth/user-not-found") throw error;
    });
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).get("lease") === lease)
        tx.set(ref, { completed: true });
    });
  } catch {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).get("lease") === lease)
        tx.update(ref, {
          attempts: attempts + 1,
          nextAttemptAt: Date.now() + retryDelay(attempts),
        });
    });
    console.warn("Blind Spot account deletion will retry", {
      attempts: attempts + 1,
    });
  }
}

export async function processDeletions() {
  const due = await deletions
    .where("nextAttemptAt", "<=", Date.now())
    .limit(20)
    .get();
  await Promise.all(due.docs.map((job) => processDeletion(job.ref)));
}
