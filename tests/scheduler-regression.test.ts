import { it, expect } from "vitest";
import { schedule } from "../packages/calendar-scheduler/src/index.ts";
import { defaults } from "../packages/shared/src/index.ts";
const base = {
  ideal: new Date("2026-05-02T16:17:00Z"),
  now: new Date("2026-05-01T08:00:00Z"),
  duration: 15,
  preferences: defaults,
  busy: [],
};
it("preserves a precise FSRS ideal time by rounding up to a five-minute slot", () =>
  expect(schedule(base).start).toBe("2026-05-02T16:20:00.000Z"));
it.each([0, -5, 4, 181, NaN, Infinity])(
  "rejects invalid duration %s before generating candidates",
  (duration) => expect(() => schedule({ ...base, duration })).toThrow(),
);
it("honors the inclusive zero-day window before considering fallback days", () => {
  const r = schedule({
    ...base,
    preferences: { ...defaults, daysBefore: 0, daysAfter: 0 },
  });
  expect(r.start).toBe("2026-05-02T16:20:00.000Z");
  expect(r.reason).toBeNull();
});
it("recovery never chooses a time on the preceding day", () => {
  const r = schedule({
    ...base,
    recovery: true,
    busy: [{ start: "2026-05-02T00:00:00Z", end: "2026-05-03T00:00:00Z" }],
  });
  expect(r.start).toBe("2026-05-03T09:00:00.000Z");
});
it("invalid timezone and ideal dates are rejected", () => {
  expect(() => schedule({ ...base, ideal: new Date(NaN) })).toThrow();
  expect(() =>
    schedule({
      ...base,
      preferences: { ...defaults, timezone: "Invalid/Zone" },
    }),
  ).toThrow();
});
