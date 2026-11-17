import { it, expect } from "vitest";
import { encrypt, decrypt } from "../apps/api/src/security.ts";
import { safeUrl } from "../packages/shared/src/index.ts";
it("encrypts Calendar tokens with randomized authenticated envelopes", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
  const value = { refresh_token: "synthetic-test-fixture" };
  const a = encrypt(value),
    b = encrypt(value);
  expect(a).not.toBe(b);
  expect(a).not.toContain(value.refresh_token);
  expect(decrypt(a)).toEqual(value);
  const raw = Buffer.from(a, "base64url");
  raw[15] ^= 1;
  expect(() => decrypt(raw.toString("base64url"))).toThrow();
});
it("rejects unsafe URL schemes", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///tmp/x",
  ])
    expect(safeUrl(url)).toBeNull();
  expect(safeUrl("https://example.com/path")).toBe("https://example.com/path");
});
