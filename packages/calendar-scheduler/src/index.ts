import { DateTime } from "luxon";
import type { Preferences } from "../../shared/src/index.ts";
export type Busy = { start: string; end: string };
export function schedule(input: {
  ideal: Date;
  now: Date;
  duration: number;
  preferences: Preferences;
  busy: Busy[];
  recovery?: boolean;
  manual?: Date;
  importance?: number;
  risk?: number;
}) {
  const { ideal, now, duration, preferences: p, busy } = input;
  if (input.manual) {
    const chosen = DateTime.fromJSDate(input.manual, { zone: p.timezone });
    const start = chosen.toMillis(),
      end = chosen.plus({ minutes: duration }).toMillis();
    const conflict = busy.some(
      (b) => start < Date.parse(b.end) && end > Date.parse(b.start),
    );
    const localEnd = chosen.plus({ minutes: duration });
    const outside =
      chosen.toFormat("HH:mm") < p.studyStart ||
      localEnd.toFormat("HH:mm") > p.studyEnd ||
      !chosen.hasSame(localEnd, "day");
    return {
      start: input.manual.toISOString(),
      mode: "manual",
      reason: conflict
        ? "Manual time overlaps another review."
        : outside
          ? "Manual time is outside your preferred study hours."
          : null,
    };
  }
  const target = DateTime.fromJSDate(ideal, { zone: p.timezone }).startOf(
    "day",
  );
  const earliest = input.recovery
    ? target
    : target.minus({ days: p.daysBefore });
  const today = DateTime.fromJSDate(now, { zone: p.timezone }).startOf("day");
  const base = earliest > today ? earliest : today;
  const candidates: { start: string; score: number; outside: boolean }[] = [];
  for (let day = 0; day < 30; day++) {
    const date = base.plus({ days: day });
    const [h, m] = p.studyStart.split(":").map(Number),
      [eh, em] = p.studyEnd.split(":").map(Number);
    const start = date.set({ hour: h, minute: m }),
      end = date.set({ hour: eh, minute: em });
    for (
      let slot = start;
      slot.plus({ minutes: duration }) <= end;
      slot = slot.plus({ minutes: 5 })
    ) {
      const a = slot.toMillis(),
        b = slot.plus({ minutes: duration }).toMillis();
      if (
        a < now.getTime() ||
        busy.some((x) => a < Date.parse(x.end) && b > Date.parse(x.start))
      )
        continue;
      const delta = date.diff(target, "days").days;
      const outside = delta > p.daysAfter;
      const urgency = (input.risk ?? 0) + (input.importance ?? 3) / 5;
      candidates.push({
        start: slot.toUTC().toISO()!,
        score:
          Math.abs(delta) * 10000 +
          Math.max(0, delta) * urgency * 100 +
          slot.hour * 60 +
          slot.minute,
        outside,
      });
    }
  }
  candidates.sort(
    (a, b) => a.score - b.score || a.start.localeCompare(b.start),
  );
  const best = candidates[0];
  return best
    ? {
        start: best.start,
        mode: "automatic",
        reason: best.outside
          ? "No availability within your scheduling window; moved to the nearest free day."
          : null,
      }
    : {
        start: null,
        mode: "automatic",
        reason: "No free slot in the 30-day search horizon.",
      };
}
