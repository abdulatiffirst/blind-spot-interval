import { DefaultScheduler } from "ts-fsrs";
import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7";
import { DateTime } from "luxon";
import { mappedRating } from "../../shared/src/index.ts";
export const algorithmVersion = "ts-fsrs@6.0.0/FSRS-7";
export const parameters = [...FSRS7_DEFAULT_WEIGHTS];
export function coldStart(
  now: Date,
  knowledge: number | null,
  timezone: string,
) {
  return DateTime.fromJSDate(now, { zone: timezone })
    .plus({
      days: knowledge === 5 ? 7 : knowledge === 4 ? 4 : knowledge === 3 ? 2 : 1,
    })
    .startOf("day")
    .toJSDate();
}
export async function advance(
  previous: Record<string, unknown> | null,
  rating: number,
  retention: number,
  now: Date,
  timezone: string,
  cardId = "initial",
) {
  const scheduler = await DefaultScheduler({
    version: "FSRS-7",
    desiredRetention: retention,
    enableFuzz: false,
    enableShortTerm: false,
    weights: parameters,
  });
  const card = previous
    ? {
        ...previous,
        dueAt: new Date(previous.dueAt as string),
        lastReviewAt: previous.lastReviewAt
          ? new Date(previous.lastReviewAt as string)
          : null,
      }
    : scheduler.newCard({ now, cardId });
  const result = scheduler.review({
    card: card as Parameters<typeof scheduler.review>[0]["card"],
    grade: mappedRating(rating) as 1 | 2 | 3 | 4,
    now,
  });
  const ideal =
    rating <= 2
      ? DateTime.fromJSDate(now, { zone: timezone })
          .plus({ days: 1 })
          .startOf("day")
          .toJSDate()
      : new Date(result.card.dueAt);
  return {
    card: JSON.parse(JSON.stringify(result.card)),
    log: result.revlog,
    ideal,
    algorithmVersion,
    parameters,
    mappedRating: mappedRating(rating),
  };
}
