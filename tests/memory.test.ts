import { describe, it, expect } from "vitest";
import {
  advance,
  coldStart,
  algorithmVersion,
  parameters,
} from "../packages/memory-engine/src/index.ts";
import { defaults, mappedRating } from "../packages/shared/src/index.ts";
import { DateTime } from "luxon";
const now = new Date("2026-03-07T17:00:00Z");
describe("FSRS-7 memory policy", () => {
  it.each([
    [null, 1],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 4],
    [5, 7],
  ])(
    "cold start %s is %s local days with no fabricated review",
    (knowledge, days) => {
      const ideal = coldStart(now, knowledge, "America/New_York");
      expect(
        DateTime.fromJSDate(ideal, { zone: "America/New_York" }).toISODate(),
      ).toBe(
        DateTime.fromJSDate(now, { zone: "America/New_York" })
          .plus({ days: days! })
          .toISODate(),
      );
      expect(ideal > now).toBe(true);
    },
  );
  it.each([1, 2, 3, 4, 5])(
    "applies original rating %s using current public API",
    async (rating) => {
      const r = await advance(null, rating, 0.9, now, "America/New_York");
      expect(r.card.reps).toBe(1);
      expect(r.card.stability).toBeGreaterThan(0);
      expect(r.card.stabilityFast).toBeGreaterThan(0);
      expect(r.card.lastReviewAt).toBe(now.toISOString());
      expect(r.algorithmVersion).toBe(algorithmVersion);
      expect(r.parameters).toEqual(parameters);
      expect(r.mappedRating).toBe(mappedRating(rating));
      if (rating <= 2)
        expect(
          DateTime.fromJSDate(r.ideal, {
            zone: "America/New_York",
          }).toISODate(),
        ).toBe("2026-03-08");
    },
  );
  it("replays 5 → 4 → 2 → 5 deterministically without mutating snapshots", async () => {
    let card = null;
    for (const [i, rating] of [5, 4, 2, 5].entries()) {
      const at = new Date(now.getTime() + i * 86400000);
      const before = JSON.stringify(card);
      const a = await advance(card, rating, 0.9, at, "UTC");
      expect(JSON.stringify(card)).toBe(before);
      expect(await advance(card, rating, 0.9, at, "UTC")).toEqual(a);
      card = a.card;
      expect(card.reps).toBe(i + 1);
    }
  });
  it("uses actual time for early and late reviews", async () => {
    const first = await advance(null, 4, 0.9, now, "UTC");
    for (const days of [0.1, 90]) {
      const at = new Date(now.getTime() + days * 86400000);
      const result = await advance(first.card, 4, 0.9, at, "UTC");
      expect(result.card.lastReviewAt).toBe(at.toISOString());
      expect(result.card.reps).toBe(2);
    }
  });
  it("higher importance retention shortens future intervals", async () => {
    const intervals = await Promise.all(
      defaults.retention.map((retention) =>
        advance(null, 5, retention, now, "UTC"),
      ),
    );
    expect(intervals[4].ideal.getTime()).toBeLessThan(
      intervals[0].ideal.getTime(),
    );
  });
});
