import { createRequire } from "node:module";
// firebase-tools 15 forces its proxy on localhost, ignoring NO_PROXY.
// Route only HTTP loopback emulator traffic directly. Preserve its proxy and TLS behavior
// for every external destination; never remove proxy environment variables.
import { Agent } from "undici";
const local = new Agent();
const original = globalThis.fetch;
const require = createRequire(import.meta.url);
const cliRequire = createRequire(
  require.resolve("firebase-tools/package.json"),
);
const cliUndici = cliRequire("undici");
const originalRequest = cliUndici.request;
cliUndici.request = (input, options = {}) => {
  let url;
  try {
    url = new URL(input);
  } catch {
    return originalRequest(input, options);
  }
  return originalRequest(
    input,
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ? { ...options, dispatcher: local, maxRedirections: 0 }
      : options,
  );
};
globalThis.fetch = (input, options = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  return original(
    input,
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ? { ...options, dispatcher: local, redirect: "manual" }
      : options,
  );
};
await import("../node_modules/firebase-tools/lib/bin/firebase.js");
