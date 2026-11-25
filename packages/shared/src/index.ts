import { z } from "zod";
import { DateTime } from "luxon";
export const rating = z.number().int().min(1).max(5);
export const topicInput = z.object({
  title: z.string().trim().min(1).max(200),
  initialKnowledge: rating.nullable().default(null),
  importance: rating.nullable().default(null),
  duration: z.number().int().min(5).max(180).default(15),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  materials: z.array(z.string().max(2000)).max(100).default([]),
  expectedStart: z.iso.datetime({ offset: true }).nullable().optional(),
  scheduledAt: z.iso
    .datetime({ offset: true })
    .refine((v) => Date.parse(v) > Date.now(), "Choose a future time")
    .optional(),
});
export const previewInput = z.object({
  knowledge: z.coerce.number().int().min(1).max(5).optional(),
  importance: z.coerce.number().int().min(1).max(5).optional(),
  duration: z.coerce.number().int().min(5).max(180).default(15),
  scheduledAt: topicInput.shape.scheduledAt,
});
export function verifyPreview(
  expected: string | null | undefined,
  actual: string | null,
) {
  if (expected !== undefined && expected !== actual)
    throw Object.assign(
      new Error("Availability changed. Check the updated preview."),
      { statusCode: 409 },
    );
}
export function applyTopicPatch(current: unknown, patch: unknown) {
  const fields = z.record(z.string(), z.unknown());
  return topicInput.parse({ ...fields.parse(current), ...fields.parse(patch) });
}
export const preferencesInput = z
  .object({
    timezone: z
      .string()
      .refine((v) => DateTime.now().setZone(v).isValid, "Invalid timezone"),
    studyStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    studyEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    duration: z.number().int().min(5).max(180),
    daysBefore: z.number().int().min(0).max(7),
    daysAfter: z.number().int().min(0).max(14),
    retention: z.array(z.number().min(0.8).max(0.97)).length(5),
    onboarded: z.boolean().default(true),
    language: z.enum(["en", "ru"]).optional(),
  })
  .refine((v) => v.studyStart < v.studyEnd, "Study end must follow start");
export type Preferences = z.infer<typeof preferencesInput>;
export type TopicInput = z.infer<typeof topicInput>;
export { defaults, safeUrl } from "./client.ts";
export const mappedRating = (n: number) => (n <= 2 ? 1 : n - 1);
