import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwind()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: { outDir: "dist", emptyOutDir: true },
});
