import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const headless = args.includes("--headless");
if (headless) args.splice(args.indexOf("--headless"), 1);
if (headless) {
  const config = JSON.parse(readFileSync("firebase.json", "utf8"));
  config.emulators.ui.enabled = false;
  writeFileSync(".firebase.headless.json", JSON.stringify(config));
  args.push("--config", ".firebase.headless.json");
}
if (
  args.some(
    (v) => v === "deploy" || v === "--project" || v.startsWith("--project="),
  )
)
  throw new Error(
    "This script only runs the demo emulator project. Use explicit deployment commands separately.",
  );
const cache = join(tmpdir(), "blindspot-firebase");
mkdirSync(cache, { recursive: true });
const env = {
  ...process.env,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? cache + "/config",
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? cache + "/cache",
  FIREBASE_EMULATORS_PATH:
    process.env.FIREBASE_EMULATORS_PATH ?? cache + "/emulators",
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
  GCLOUD_PROJECT: "demo-blind-spot-interval",
  GOOGLE_CLOUD_PROJECT: "demo-blind-spot-interval",
};
if (
  !env.FIRESTORE_EMULATOR_BINARY_PATH &&
  existsSync(cache + "/verified-emulator.json")
) {
  const verified = JSON.parse(
    readFileSync(cache + "/verified-emulator.json", "utf8"),
  );
  if (
    [verified, ...(verified.dependencies ?? [])].some(
      (item) =>
        createHash("sha256").update(readFileSync(item.jar)).digest("hex") !==
        item.sha256,
    )
  )
    throw new Error("Cached Firestore emulator integrity check failed");
  env.FIRESTORE_EMULATOR_BINARY_PATH = verified.jar;
}
const child = spawn(
  process.execPath,
  [
    "scripts/firebase-cli.mjs",
    ...args,
    "--project",
    "demo-blind-spot-interval",
  ],
  { stdio: "inherit", env },
);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code ?? 1));
