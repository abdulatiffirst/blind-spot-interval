import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createApp } from "./http.ts";
import { processJob, reconcile } from "./jobs.ts";
import { emulator } from "./calendar.ts";
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });
const secrets = emulator()
  ? []
  : ["GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"];
export const api = onRequest(
  { timeoutSeconds: 120, memory: "512MiB", secrets },
  createApp(),
);
export const syncJob = onDocumentCreated(
  {
    document: "syncJobs/{jobId}",
    retry: true,
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets,
  },
  async (event) => {
    await processJob(event.params.jobId);
  },
);
export const reconcileCalendar = onSchedule(
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets,
  },
  async () => {
    await reconcile();
  },
);
