import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/memory.test.ts",
      "tests/scheduler*.test.ts",
      "tests/security.test.ts",
      "tests/web-config.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
