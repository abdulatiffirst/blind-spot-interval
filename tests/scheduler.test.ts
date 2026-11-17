import { describe, it, expect } from "vitest";
import { schedule } from "../packages/calendar-scheduler/src/index.ts";
import { defaults } from "../packages/shared/src/index.ts";
import { DateTime } from "luxon";
const input = {
  ideal: new Date("2026-05-02T00:00:00Z"),
  now: new Date("2026-05-01T08:00:00Z"),
  duration: 15,
  preferences: defaults,
  busy: [],
};
describe("Availability scheduling", () => {
  it("chooses ideal day at study start without Google", () =>
    expect(schedule(input).start).toBe("2026-05-02T09:00:00.000Z"));
  it("fits full duration around busy slots", () =>
    expect(
      schedule({
        ...input,
        duration: 45,
        busy: [{ start: "2026-05-02T09:00:00Z", end: "2026-05-02T10:12:00Z" }],
      }).start,
    ).toBe("2026-05-02T10:15:00.000Z"));
  it("avoids other reviews and past times", () => {
    const a = schedule({ ...input, now: new Date("2026-05-02T09:02:00Z") });
    expect(a.start).toBe("2026-05-02T09:05:00.000Z");
    const b = schedule({
      ...input,
      busy: [{ start: a.start!, end: "2026-05-02T09:20:00Z" }],
    });
    expect(b.start).toBe("2026-05-02T09:20:00.000Z");
  });
  it("does not schedule failed-review recovery before tomorrow", () => {
    const r = schedule({
      ...input,
      recovery: true,
      busy: [{ start: "2026-05-02T00:00:00Z", end: "2026-05-03T00:00:00Z" }],
    });
    expect(r.start).toBe("2026-05-03T09:00:00.000Z");
  });
  it("searches beyond configured window with a reason", () => {
    const r = schedule({
      ...input,
      preferences: { ...defaults, daysBefore: 0, daysAfter: 0 },
      busy: [{ start: "2026-05-02T00:00:00Z", end: "2026-05-06T00:00:00Z" }],
    });
    expect(r.start).toBe("2026-05-06T09:00:00.000Z");
    expect(r.reason).toContain("nearest free day");
  });
  it("marks a fully busy horizon unscheduled", () => {
    const r = schedule({
      ...input,
      busy: [{ start: "2026-05-01T00:00:00Z", end: "2026-08-01T00:00:00Z" }],
    });
    expect(r.start).toBeNull();
    expect(r.reason).toContain("30-day");
  });
  it("preserves manual overrides", () =>
    expect(
      schedule({ ...input, manual: new Date("2026-05-20T23:00:00Z") }).mode,
    ).toBe("manual"));
  it.each(["America/New_York", "Europe/Berlin", "Asia/Tashkent"])(
    "honors timezone and DST in %s",
    (zone) => {
      const r = schedule({
        ...input,
        ideal: new Date("2026-03-08T15:00:00Z"),
        now: new Date("2026-03-07T15:00:00Z"),
        preferences: { ...defaults, timezone: zone },
      });
      expect(DateTime.fromISO(r.start!, { zone }).toMillis()).toBe(
        Date.parse("2026-03-08T15:00:00Z"),
      );
    },
  );
  it("handles spring-forward study hours deterministically", () => {
    const p = {
      ...defaults,
      timezone: "America/New_York",
      studyStart: "01:30",
      studyEnd: "04:00",
      daysBefore: 0,
      daysAfter: 0,
    };
    const r = schedule({
      ...input,
      ideal: new Date("2026-03-08T05:00:00Z"),
      now: new Date("2026-03-08T06:50:00Z"),
      preferences: p,
      duration: 60,
    });
    const start = DateTime.fromISO(r.start!, { zone: p.timezone });
    expect(start.hour).toBe(1);
    expect(start.minute).toBe(50);
    expect(start.plus({ minutes: 60 }).hour).toBe(3);
  });
});
