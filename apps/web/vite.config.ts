import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
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
    plugins: [react(), tailwind()],
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
