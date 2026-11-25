import { build, context } from "esbuild";
import { execFileSync } from "node:child_process";
const commit = (() => {
  if (/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""))
    return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
})();
const options = {
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "bundle",
  external: [
    "firebase-admin",
    "firebase-admin/*",
    "firebase-functions",
    "firebase-functions/*",
  ],
  sourcemap: true,
  define: { __BLIND_SPOT_COMMIT__: JSON.stringify(commit) },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else await build(options);
