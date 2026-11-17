// Local equivalent of the deployed scheduled reconciliation function. Demo-only.
import { setTimeout } from "node:timers/promises";
const project = "demo-blind-spot-interval";
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== project)
  throw new Error("Local reconciliation refuses a non-demo project");
if (
  process.env.FIRESTORE_EMULATOR_HOST &&
  !["127.0.0.1:8080", "localhost:8080"].includes(
    process.env.FIRESTORE_EMULATOR_HOST,
  )
)
  throw new Error("Local reconciliation requires the Firestore emulator");
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
// Match the emulator's local configuration without exposing values in logs.
const { config } = await import("dotenv");
config({
  path: [
    "functions/.secret.local",
    "functions/.env.local",
    "functions/.env.demo-blind-spot-interval",
    "functions/.env",
  ],
  quiet: true,
});
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => stop.abort());
const { reconcile } = await import("../functions/src/jobs.ts");
const { db } = await import("../functions/src/store.ts");
while (!stop.signal.aborted) {
  try {
    await reconcile();
  } catch {
    console.error(
      "Local Firebase reconciliation is waiting for the emulators or a retry.",
    );
  }
  try {
    await setTimeout(10000, undefined, { signal: stop.signal });
  } catch {
    break;
  }
}
await db.terminate();
