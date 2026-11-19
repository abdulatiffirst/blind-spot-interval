import { expect, it, vi } from "vitest";
import {
  addWords,
  initialZone,
  zoneOption,
  zoneOptions,
} from "../apps/web/src/form-options";
it("detects only for initial setup and preserves existing preferences", () => {
  expect(initialZone("UTC", true)).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(initialZone("UTC", false)).toBe("UTC");
  expect(initialZone("Asia/Tokyo", true)).toBe("Asia/Tokyo");
});
it("labels IANA identifiers with their country and seasonal offset", () => {
  expect(zoneOption("America/New_York", new Date("2026-01-01")).label).toBe(
    "New York, United States — UTC-05:00",
  );
  expect(
    zoneOption("America/New_York", new Date("2026-07-01")).label,
  ).toContain("UTC-04:00");
});
it("includes Tashkent when browser enumeration is unavailable", () => {
  vi.stubGlobal(
    "Intl",
    Object.assign(Object.create(Intl), { supportedValuesOf: undefined }),
  );
  try {
    expect(zoneOptions("UTC")).toContainEqual({
      id: "Asia/Tashkent",
      label: "Tashkent, Uzbekistan — UTC+05:00",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it("preserves saved tags and first casing while splitting new words", () => {
  const { tags, error } = addWords(["Old Tag"], " Math\nExam math ");
  expect(tags).toEqual(["Old Tag", "Math", "Exam"]);
  expect(error).toContain("already");
});
it("reports overlong and excess words", () => {
  const current = Array.from({ length: 19 }, (_, i) => String(i));
  const result = addWords(current, "x".repeat(41) + " final excess");
  expect(result.tags).toEqual([...current, "final"]);
  expect(result.error).toMatch(/40.*20/);
});
