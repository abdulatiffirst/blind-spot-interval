import { build, context } from "esbuild";
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
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else await build(options);
