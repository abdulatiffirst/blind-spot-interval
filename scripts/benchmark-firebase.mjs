import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "blindspot-benchmark-"));
const config = join(directory, "firebase.json");
const cache = join(tmpdir(), "blindspot-firebase");
const project = "demo-blind-spot-benchmark";
writeFileSync(
  config,
  JSON.stringify({
    emulators: {
      auth: { host: "127.0.0.1", port: 9199 },
      firestore: { host: "127.0.0.1", port: 8180 },
      hub: { host: "127.0.0.1", port: 8480 },
      logging: { host: "127.0.0.1", port: 8481 },
      ui: { enabled: false },
    },
  }),
);
try {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/firebase-cli.mjs",
      "emulators:exec",
      "--only",
      "auth,firestore",
      "--config",
      config,
      "--project",
      project,
      "node --import tsx scripts/benchmark-firebase.ts" +
        (process.argv.includes("--baseline") ? " --baseline" : ""),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FIREBASE_EMULATORS_PATH: join(cache, "emulators"),
        FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
        GCLOUD_PROJECT: project,
        GOOGLE_CLOUD_PROJECT: project,
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
