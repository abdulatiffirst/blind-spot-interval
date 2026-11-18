import { expect, it } from "vitest";
import { resolveConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

it("loads production VITE variables from the monorepo root", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = await resolveConfig(
    {
      configFile: resolve(root, "apps/web/vite.config.ts"),
      mode: "production",
    },
    "build",
  );
  expect(config.envDir).toBe(resolve(root));
  expect(config.root).toBe(resolve(root, "apps/web"));
});
