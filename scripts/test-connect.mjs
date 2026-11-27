import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  BLIND_SPOT_CONNECT_ENABLED: "true",
  BLIND_SPOT_CONNECT_WRITES: "true",
  BLIND_SPOT_CONNECT_GEMINI_REGISTRY: "true",
  BLIND_SPOT_CONNECT_GEMINI_PERSISTENT_REFRESH: "true",
  BLIND_SPOT_CONNECT_ORIGIN: "http://localhost:5000",
  BLIND_SPOT_CONNECT_CLIENTS: JSON.stringify([
    {
      client_id: "connect-test",
      client_name: "Connect Tests",
      redirect_uris: ["http://127.0.0.1:6274/oauth/callback"],
    },
  ]),
  BLIND_SPOT_CONNECT_REGISTRATION_REDIRECTS: JSON.stringify([
    "http://127.0.0.1:6274/oauth/callback",
    "https://claude.ai/api/mcp/auth_callback",
  ]),
  APP_ORIGIN: "http://localhost:5000",
  VITE_USE_FIREBASE_EMULATORS: "true",
};
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build"]);
run(process.execPath, [
  "scripts/emulators.mjs",
  "emulators:exec",
  "--headless",
  "--only",
  "auth,firestore,functions,hosting",
  "vitest run --config vitest.firebase.config.ts tests/firebase/connect.test.ts tests/firebase/hosting.test.ts && playwright test --config playwright.firebase.config.ts tests/firebase-e2e/connect.spec.ts",
]);
