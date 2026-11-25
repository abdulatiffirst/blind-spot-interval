
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

  // Normalize Windows and Unix path separators.
  const normalizePath = (path: string) => path.replace(/\\/g, "/");

  expect(typeof config.envDir).toBe("string");

  if (typeof config.envDir !== "string") {
    throw new Error("Expected Vite envDir to be a string");
  }

  expect(normalizePath(config.envDir)).toBe(
    normalizePath(resolve(root)),
  );

  expect(normalizePath(config.root)).toBe(
    normalizePath(resolve(root, "apps/web")),
  );
});
