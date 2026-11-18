/**
 * School 21 portable worker entrypoint.
 * Firebase remains the single data store. Run ONLY ONE reconciliation scheduler.
 * Requires explicit project ID and Application Default Credentials.
 */
import { setTimeout as delay } from "node:timers/promises";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required");
if (projectId.startsWith("demo-") && !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("Demo projects require FIRESTORE_EMULATOR_HOST");
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.ALLOW_FIREBASE_EMULATOR !== "true")
  throw new Error("Emulator access requires ALLOW_FIREBASE_EMULATOR=true");
if (process.env.ENABLE_SERVER_RECONCILIATION !== "true")
  throw new Error("Set ENABLE_SERVER_RECONCILIATION=true only after disabling the Firebase scheduled reconciler");
const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 300000);
if (!Number.isInteger(intervalMs) || intervalMs < 60000)
  throw new Error("RECONCILE_INTERVAL_MS must be an integer >= 60000");
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
if (!getApps().length)
  initializeApp({ projectId, credential: applicationDefault() });
const { reconcile } = await import("../functions/src/jobs.ts");
const { db } = await import("../functions/src/store.ts");
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => abort.abort());
console.info("Server worker started", { projectId, intervalMs });
try {
  while (!abort.signal.aborted) {
    try { await reconcile(); }
    catch (error) { console.error("Reconciliation failed", error); }
    try { await delay(intervalMs, undefined, { signal: abort.signal }); }
    catch { break; }
  }
} finally {
  await db.terminate();
}
