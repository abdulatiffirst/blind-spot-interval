import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/firebase/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: ["tests/firebase/safety.ts"],
  },
});
