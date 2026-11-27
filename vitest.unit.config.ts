import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/i18n.test.ts",
      "tests/material-links.test.ts",
      "tests/memory.test.ts",
      "tests/connect.test.ts",
      "tests/scheduler*.test.ts",
      "tests/security.test.ts",
      "tests/web-config.test.ts",
      "tests/form-options.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
