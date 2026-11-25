import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const legacy = (process.env.VITE_BACKEND ?? env.VITE_BACKEND) === "legacy";
  const functionsProxy = {
    target: "http://127.0.0.1:5001",
    rewrite: (path: string) =>
      "/demo-blind-spot-interval/europe-west1/api" + path,
  };
  return {
    envDir: fileURLToPath(new URL("../..", import.meta.url)),
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [
      react(),
      tailwind(),
      {
        name: "build-info",
        apply: "build",
        generateBundle() {
          let commit = process.env.GITHUB_SHA ?? null;
          if (!commit) {
            try {
              commit = execFileSync("git", ["rev-parse", "HEAD"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              }).trim();
            } catch {
              commit = null;
            }
          }
          const { version } = JSON.parse(
            readFileSync(
              new URL("../../package.json", import.meta.url),
              "utf8",
            ),
          );
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify({ version, commit }) + "\n",
          });
        },
      },
    ],
    server: {
      proxy: {
        "/api": legacy ? "http://127.0.0.1:3001" : functionsProxy,
        ...(!legacy && {
          "^/((authorize|token|revoke|register)([/?]|$)|\\.well-known/oauth-)":
            functionsProxy,
        }),
      },
    },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
