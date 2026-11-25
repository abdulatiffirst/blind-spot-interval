import { FieldPath, type Query } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { z } from "zod";
import { preferences } from "../domain.ts";
import {
  collection,
  get,
  getByIds as byId,
  fail,
  type RecordData,
} from "../store.ts";
import { safeUrl } from "../../../packages/shared/src/index.ts";
import type { Principal } from "./oauth.ts";

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const tag = z.string().trim().min(1).max(40);
const date = z.iso.date();
const status = z.enum(["active", "archived", "all"]);
export const page = {
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
};
const period = { start: date.optional(), end: date.optional() };
const historyFilter = {
  topicId: id.optional(),
  tag: tag.optional(),
  subject: tag.optional(),
  status: status.default("all"),
  ...period,
  minRating: z.number().int().min(1).max(5).optional(),
  maxRating: z.number().int().min(1).max(5).optional(),
};
export const historyInput = z.strictObject({
  ...page,
  ...historyFilter,
  sort: z.enum(["newest", "oldest"]).default("newest"),
});
export const topicHistoryInput = z.strictObject({
  ...page,
  topicId: id,
  sort: z.enum(["newest", "oldest"]).default("oldest"),
});
export const topicsInput = z.strictObject({
  ...page,
  status: status.default("active"),
  search: z.string().trim().min(1).max(200).optional(),
  tags: z.array(tag).max(5).optional(),
  sort: z.enum(["created", "title", "importance"]).default("created"),
  initialKnowledge: z.number().int().min(1).max(5).optional(),
});
export const dueInput = z.strictObject({
  ...page,
  ...period,
  tag: tag.optional(),
  subject: tag.optional(),
  window: z
    .enum(["today", "tomorrow", "upcoming", "overdue", "range"])
    .default("today"),
});
export const statsInput = z.strictObject({
  ...period,
  topicId: id.optional(),
  tag: tag.optional(),
  subject: tag.optional(),
  groupBy: z.enum(["day", "week", "month"]).default("week"),
});
export const weakInput = statsInput.omit({ groupBy: true }).extend({
  limit: z.number().int().min(1).max(20).default(10),
});

const matches = (topic: RecordData, ...tags: (string | undefined)[]) =>
  tags.every(
    (tag) =>
      !tag ||
      (topic.tags ?? []).some(
        (value: string) => value.toLowerCase() === tag.toLowerCase(),
      ),
  );
const rows = (doc: FirebaseFirestore.QueryDocumentSnapshot): RecordData => ({
  ...doc.data(),
  id: doc.id,
});
const can = (p: Principal, scope: Principal["scopes"][number]) =>
  p.scopes.includes(scope);
function dates(
  timezone: string,
  start?: string,
  end?: string,
  maxDays?: number,
  now: DateTime = DateTime.now(),
) {
  const to = end
    ? DateTime.fromISO(end, { zone: timezone }).startOf("day").plus({ days: 1 })
    : now.setZone(timezone).startOf("day").plus({ days: 1 });
  const from = start
    ? DateTime.fromISO(start, { zone: timezone }).startOf("day")
    : maxDays
      ? to.minus({ days: Math.min(maxDays, 30) })
      : undefined;
  if (
    (from && (!from.isValid || !to.isValid || from >= to)) ||
    (maxDays && from && to.diff(from, "days").days > maxDays)
  )
    fail(
      400,
      maxDays
        ? `Select a valid range of at most ${maxDays} days`
        : "Start date must precede or equal end date",
    );
  return { from, to };
}
function between(query: Query, field: string, from?: DateTime, to?: DateTime) {
  if (from) query = query.where(field, ">=", from.toUTC().toISO()!);
  if (to) query = query.where(field, "<", to.toUTC().toISO()!);
  return query;
}
const cursorSchema = z.tuple([
  z.union([z.string().max(200), z.number(), z.null()]),
  id,
]);
function after(query: Query, cursor?: string) {
  if (!cursor) return query;
  try {
    return query.startAfter(
      ...cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
      ),
    );
  } catch {
    return fail(400, "Invalid pagination cursor");
  }
}
const next = (row: RecordData, field: string) =>
  Buffer.from(JSON.stringify([row[field] ?? null, row.id])).toString(
    "base64url",
  );
async function scan(
  query: Query,
  field: string,
  limit: number,
  transform: (data: RecordData[]) => Promise<(RecordData | null)[]>,
  cursor?: string,
  postFilter = true,
) {
  const budget = postFilter ? Math.min(100, Math.max(25, limit * 3)) : limit;
  const scanned = (
    await after(query, cursor)
      .limit(budget + 1)
      .get()
  ).docs.map(rows);
  const data = scanned.slice(0, budget);
  const transformed = await transform(data);
  const items: RecordData[] = [];
  let last = 0;
  for (const value of transformed) {
    last++;
    if (value) items.push(value);
    if (items.length >= limit) break;
  }
  return {
    items,
    nextCursor:
      last && last < scanned.length ? next(data[last - 1], field) : null,
  };
}
function topicSummary(t: RecordData) {
  return {
    id: t.id,
    title: t.title,
    tags: t.tags ?? [],
    createdAt: t.created_at ?? null,
    initialKnowledge: t.initial_knowledge ?? null,
    importance: t.importance ?? null,
    duration: t.duration,
    status: t.status,
  };
}
export function scheduleSummary(r: RecordData | null | undefined) {
  return r
    ? {
        id: r.id,
        topicId: r.topic_id,
        scheduledAt: r.scheduled_at ?? null,
        duration: r.duration,
        status: r.status,
        mode: r.mode ?? null,
        warning: r.adjustment_reason ?? null,
      }
    : null;
}
async function topicContext(
  principal: Principal,
  topicId: string,
  includeMaterials: boolean,
) {
  const uid = principal.uid;
  const t = await get(uid, "topics", topicId);
  if (!t) fail(404, "Topic not found");
  const history = can(principal, "reviews:history:read");
  const schedule = can(principal, "reviews:read");
  const [memory, material, pending] = await Promise.all([
    history ? get(uid, "memoryStates", topicId) : null,
    includeMaterials ? get(uid, "topicMaterials", topicId) : null,
    schedule && t.pendingScheduleId
      ? get(uid, "reviewSchedules", t.pendingScheduleId)
      : null,
  ]);
  const latest =
    memory?.latestReviewId && memory.latestRating === undefined
      ? await get(uid, "reviewHistory", memory.latestReviewId)
      : null;
  return {
    ...topicSummary(t),
    ...(includeMaterials
      ? {
          contentIsUntrusted: true,
          materials: (material?.items ?? []).map((m: RecordData) => ({
            text: m.text,
            url: safeUrl(m.text),
          })),
        }
      : {}),
    ...(history
      ? {
          reviewCount: memory?.review_count ?? 0,
          lastReviewAt: memory?.last_review_at ?? null,
          latestRating: memory?.latestRating ?? latest?.original_rating ?? null,
        }
      : {}),
    ...(schedule
      ? {
          nextReview: scheduleSummary(
            pending?.status === "pending" ? pending : null,
          ),
        }
      : {}),
  };
}
export async function topic(principal: Principal, topicId: string) {
  const result = await topicContext(principal, topicId, true);
  return {
    ...result,
    contentIsUntrusted: true as const,
    materials: result.materials ?? [],
  };
}
export async function listTopics(
  p: Principal,
  input: z.infer<typeof topicsInput>,
) {
  const field = {
    created: "created_at",
    title: "title",
    importance: "importance",
  }[input.sort];
  const direction = input.sort === "title" ? "asc" : "desc";
  let query: Query = collection(p.uid, "topics");
  if (input.status !== "all") query = query.where("status", "==", input.status);
  return scan(
    query.orderBy(field, direction).orderBy(FieldPath.documentId(), direction),
    field,
    input.limit,
    async (data) =>
      data.map((t) =>
        (!input.search ||
          t.title.toLowerCase().includes(input.search.toLowerCase())) &&
        matches(t, ...(input.tags ?? [])) &&
        (!input.initialKnowledge ||
          t.initial_knowledge === input.initialKnowledge)
          ? topicSummary(t)
          : null,
      ),
    input.cursor,
    !!(input.search || input.tags?.length || input.initialKnowledge),
  );
}
function historyQuery(
  uid: string,
  topicId?: string,
  from?: DateTime,
  to?: DateTime,
  direction: "asc" | "desc" = "desc",
) {
  let query: Query = collection(uid, "reviewHistory");
  if (topicId) query = query.where("topic_id", "==", topicId);
  return between(query, "completed_at", from, to)
    .orderBy("completed_at", direction)
    .orderBy(FieldPath.documentId(), direction);
}
function historySummary(h: RecordData, t: RecordData, s?: RecordData) {
  return {
    id: h.id,
    topicId: t.id,
    title: t.title,
    completedAt: h.completed_at,
    rating: h.original_rating,
    scheduledAt: s?.scheduled_at ?? null,
    scheduledDuration: s?.duration ?? null,
    intervalDays:
      h.fsrs_log?.scheduledDays ?? h.new_state?.scheduledDays ?? null,
    correctedAt: h.corrected_at ?? null,
  };
}
export async function history(
  p: Principal,
  input: z.infer<typeof historyInput>,
) {
  const { timezone } = await preferences(p.uid);
  const { from, to } = dates(timezone, input.start, input.end);
  if (input.minRating && input.maxRating && input.minRating > input.maxRating)
    fail(400, "Minimum rating exceeds maximum rating");
  const query = historyQuery(
    p.uid,
    input.topicId,
    from,
    input.end ? to : undefined,
    input.sort === "newest" ? "desc" : "asc",
  );
  const result = await scan(
    query,
    "completed_at",
    input.limit,
    async (data) => {
      const candidates = data.filter(
        (h) =>
          h.original_rating >= (input.minRating ?? 1) &&
          h.original_rating <= (input.maxRating ?? 5),
      );
      const topics = await byId(
        p.uid,
        "topics",
        candidates.map((h) => h.topic_id),
      );
      const filtered = candidates.filter((h) => {
        const t = topics.get(h.topic_id);
        return (
          t &&
          (input.status === "all" || t.status === input.status) &&
          matches(t, input.tag, input.subject)
        );
      });
      const schedules = await byId(
        p.uid,
        "reviewSchedules",
        filtered.map((h) => h.schedule_id),
      );
      const summaries = new Map(
        filtered.map((h) => [
          h.id,
          historySummary(
            h,
            topics.get(h.topic_id)!,
            schedules.get(h.schedule_id),
          ),
        ]),
      );
      return data.map((h) => summaries.get(h.id) ?? null);
    },
    input.cursor,
    !!(
      input.tag ||
      input.subject ||
      input.status !== "all" ||
      input.minRating ||
      input.maxRating
    ),
  );
  return { timezone, ...result };
}
export async function topicHistory(
  p: Principal,
  input: z.infer<typeof topicHistoryInput>,
) {
  const [summary, records] = await Promise.all([
    topicContext(p, input.topicId, false),
    history(p, historyInput.parse(input)),
  ]);
  const {
    materials: _materials,
    contentIsUntrusted: _untrusted,
    ...info
  } = summary;
  return { topic: info, ...records };
}
function pending(uid: string, from?: DateTime, to?: DateTime) {
  return between(
    collection(uid, "reviewSchedules").where("status", "==", "pending"),
    "scheduled_at",
    from,
    to,
  )
    .orderBy("scheduled_at")
    .orderBy(FieldPath.documentId());
}
export async function due(p: Principal, input: z.infer<typeof dueInput>) {
  const { timezone } = await preferences(p.uid);
  const now = DateTime.now().setZone(timezone),
    today = now.startOf("day"),
    tomorrow = today.plus({ days: 1 });
  if (input.window === "range" && (!input.start || !input.end))
    fail(400, "Provide start and end dates for a date range");
  if (input.window !== "range" && (input.start || input.end))
    fail(400, "Use the range window with start and end dates");
  const custom = dates(
    timezone,
    input.start,
    input.end,
    input.window === "range" ? 366 : undefined,
    now,
  );
  const intervals = {
    today: [today, tomorrow],
    tomorrow: [tomorrow, tomorrow.plus({ days: 1 })],
    upcoming: [now, undefined],
    overdue: [undefined, now],
    range: [custom.from, custom.to],
  };
  const [from, to] = intervals[input.window];
  const query = pending(p.uid, from, to).where("scheduled_at", ">", "");
  const result = await scan(
    query,
    "scheduled_at",
    input.limit,
    async (data) => {
      const topics = await byId(
        p.uid,
        "topics",
        data.map((r) => r.topic_id),
      );
      const matching = data.filter((r) => {
        const t = topics.get(r.topic_id);
        return t?.status === "active" && matches(t, input.tag, input.subject);
      });
      const memory = can(p, "reviews:history:read")
        ? await byId(
            p.uid,
            "memoryStates",
            matching.map((r) => r.topic_id),
          )
        : new Map();
      const latest = await byId(
        p.uid,
        "reviewHistory",
        [...memory.values()]
          .filter((m) => m.latestRating === undefined)
          .map((m) => m.latestReviewId),
      );
      const summaries = new Map(
        matching.map((r) => [
          r.id,
          {
            ...scheduleSummary(r),
            title: topics.get(r.topic_id)!.title,
            ...(can(p, "reviews:history:read")
              ? {
                  lastRating:
                    memory.get(r.topic_id)?.latestRating ??
                    latest.get(memory.get(r.topic_id)?.latestReviewId)
                      ?.original_rating ??
                    null,
                }
              : {}),
          },
        ]),
      );
      return data.map((r) => summaries.get(r.id) ?? null);
    },
    input.cursor,
  );
  return { timezone, ...result };
}

const analysisLimit = 200;
type AnalysisInput = z.infer<typeof statsInput>;
async function sample(query: Query) {
  const docs = (await query.limit(analysisLimit + 1).get()).docs;
  return {
    items: docs.slice(0, analysisLimit).map(rows),
    complete: docs.length <= analysisLimit,
  };
}
async function analysis(p: Principal, input: Omit<AnalysisInput, "groupBy">) {
  const uid = p.uid;
  const pref = await preferences(uid);
  const now = DateTime.now().setZone(pref.timezone);
  const { from, to } = dates(pref.timezone, input.start, input.end, 366, now);
  const selected = input.topicId
    ? await byId(uid, "topics", [input.topicId])
    : null;
  if (input.topicId && !selected?.has(input.topicId))
    fail(404, "Topic not found");
  let scheduled = pending(uid).where("scheduled_at", ">", "");
  if (input.topicId)
    scheduled = scheduled.where("topic_id", "==", input.topicId);
  const [topics, history, schedules] = await Promise.all([
    selected
      ? { items: [...selected.values()], complete: true }
      : sample(
          collection(uid, "topics")
            .orderBy("created_at", "desc")
            .select("title", "tags", "importance", "status"),
        ),
    sample(
      historyQuery(uid, input.topicId, from, to).select(
        "topic_id",
        "completed_at",
        "original_rating",
        "corrected_at",
        "fsrs_log.scheduledDays",
        "new_state.scheduledDays",
      ),
    ),
    sample(
      scheduled.select(
        "topic_id",
        "scheduled_at",
        "duration",
        "status",
        "mode",
        "adjustment_reason",
      ),
    ),
  ]);
  const joined = new Map(topics.items.map((t) => [t.id, t]));
  const missing = [...history.items, ...schedules.items]
    .map((r) => r.topic_id)
    .filter((key) => !joined.has(key));
  for (const [key, value] of await byId(uid, "topics", missing))
    joined.set(key, value);
  const filter = (t: RecordData) => matches(t, input.tag, input.subject);
  const included = (row: RecordData) => {
    const t = joined.get(row.topic_id);
    return t && filter(t);
  };
  const reviews = history.items
    .filter(included)
    .filter(
      (r) =>
        Number.isInteger(r.original_rating) &&
        r.original_rating >= 1 &&
        r.original_rating <= 5,
    );
  const waiting = schedules.items
    .filter(included)
    .filter((r) => joined.get(r.topic_id)?.status === "active");
  const byTopic = new Map<string, RecordData[]>();
  for (const review of reviews) {
    if (!byTopic.has(review.topic_id)) byTopic.set(review.topic_id, []);
    byTopic.get(review.topic_id)!.push(review);
  }
  return {
    pref,
    now,
    from: from!,
    to,
    topics: topics.items.filter(filter),
    joined,
    reviews,
    waiting,
    byTopic,
    coverage: {
      topicsComplete: topics.complete,
      historyComplete: history.complete,
      scheduleComplete: schedules.complete,
      scanLimitPerCollection: analysisLimit,
      sampledReviews: reviews.length,
      oldestSampledCompletion: reviews.at(-1)?.completed_at ?? null,
      latestSampledCompletion: reviews[0]?.completed_at ?? null,
    },
  };
}
type Analysis = Awaited<ReturnType<typeof analysis>>;
export function prioritize(
  t: RecordData,
  recent: RecordData[],
  pendingReview: RecordData | undefined,
  now: DateTime,
) {
  const ratings = recent.slice(0, 5).map((r) => r.original_rating as number);
  const low = ratings.filter((rating) => rating <= 2).length;
  const declining =
    ratings.length >= 3 && ratings[0] <= ratings[ratings.length - 1] - 2;
  const overdue =
    !!pendingReview?.scheduled_at &&
    Date.parse(pendingReview.scheduled_at) < now.toMillis();
  const inactive =
    !!recent[0] &&
    now.toMillis() - Date.parse(recent[0].completed_at) >= 30 * 86400_000;
  const knowledgeScore =
    (ratings[0] <= 2 ? 4 : 0) + (low >= 2 ? 3 : 0) + (declining ? 2 : 0);
  return {
    topicId: t.id,
    title: t.title,
    latestRating: ratings[0] ?? null,
    recentRatings: ratings,
    reviewedInPeriod: recent.length,
    nextReview: scheduleSummary(pendingReview),
    dataSufficiency:
      ratings.length >= 3
        ? "three_or_more"
        : ratings.length
          ? "limited"
          : "unreviewed_in_sample",
    knowledgeReasons: [
      ...(ratings[0] <= 2 ? ["latest_rating_at_most_2"] : []),
      ...(low >= 2 ? ["at_least_two_low_ratings_in_last_five"] : []),
      ...(declining ? ["rating_declined_by_two_or_more"] : []),
    ],
    schedulingReasons: [
      ...(overdue ? ["review_overdue"] : []),
      ...(inactive ? ["last_observed_review_at_least_30_days_ago"] : []),
    ],
    priority:
      knowledgeScore +
      (overdue ? 2 : 0) +
      (inactive ? 1 : 0) +
      (knowledgeScore && (t.importance ?? 0) >= 4 ? 1 : 0),
  };
}
async function weakRows(uid: string, a: Analysis, limit: number) {
  const schedules = new Map(
    a.waiting.map((schedule) => [schedule.topic_id, schedule]),
  );
  const ranked = [...a.joined.values()]
    .filter(
      (t) =>
        t.status === "active" && (a.byTopic.has(t.id) || schedules.has(t.id)),
    )
    .map((t) =>
      prioritize(t, a.byTopic.get(t.id) ?? [], schedules.get(t.id), a.now),
    )
    .filter((item) => item.priority > 0)
    .sort(
      (a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId),
    )
    .slice(0, limit);
  const memory = await byId(
    uid,
    "memoryStates",
    ranked.map((row) => row.topicId),
  );
  return ranked.map((row) => ({
    ...row,
    reviewCount: memory.get(row.topicId)?.review_count ?? null,
  }));
}
const rangeSummary = (a: Analysis) => ({
  timezone: a.pref.timezone,
  start: a.from.toISODate(),
  end: a.to.minus({ days: 1 }).toISODate(),
  coverage: a.coverage,
});
export async function weak(p: Principal, input: z.infer<typeof weakInput>) {
  const a = await analysis(p, input);
  return {
    ...rangeSummary(a),
    items: await weakRows(p.uid, a, input.limit),
    ranking:
      "Award 4 points for a latest rating of 2 or below, 3 for repeated low ratings, 2 for a decline, 2 for an overdue review, 1 for inactivity, and 1 for high importance with knowledge evidence.",
  };
}
function summarize(a: Analysis, group: AnalysisInput["groupBy"]) {
  const ratings = [0, 0, 0, 0, 0];
  const buckets: Record<string, number> = {};
  const days = new Set<string>();
  for (const r of a.reviews) {
    ratings[r.original_rating - 1]++;
    const local = DateTime.fromISO(r.completed_at, { zone: a.pref.timezone });
    days.add(local.toISODate()!);
    const key = local.startOf(group).toISODate()!;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  const changes = [...a.byTopic.values()]
    .filter((r) => r.length >= 2)
    .map((r) => r[0].original_rating - r[r.length - 1].original_rating);
  const count = a.reviews.length;
  const elapsedDays = Math.max(
    0,
    Math.min(
      a.to.diff(a.from, "days").days,
      a.now.startOf("day").plus({ days: 1 }).diff(a.from, "days").days,
    ),
  );
  const overdue = a.waiting.filter(
    (r) => Date.parse(r.scheduled_at) < a.now.toMillis(),
  ).length;
  return {
    ...rangeSummary(a),
    totalTopics: a.coverage.topicsComplete ? a.topics.length : null,
    activeTopics: a.coverage.topicsComplete
      ? a.topics.filter((t) => t.status === "active").length
      : null,
    archivedTopics: a.coverage.topicsComplete
      ? a.topics.filter((t) => t.status === "archived").length
      : null,
    completedReviews: a.coverage.historyComplete ? count : null,
    upcomingReviews: a.coverage.scheduleComplete
      ? a.waiting.length - overdue
      : null,
    overdueReviews: a.coverage.scheduleComplete ? overdue : null,
    sampleAverageRating: count
      ? ratings.reduce((sum, n, i) => sum + n * (i + 1), 0) / count
      : null,
    sampleRatingDistribution: ratings,
    sampleMeanRatingChange: changes.length
      ? changes.reduce((a, b) => a + b, 0) / changes.length
      : null,
    changeDenominatorTopics: changes.length,
    sampleMostReviewed: [...a.byTopic.entries()]
      .map(([topicId, r]) => ({
        topicId,
        title: a.joined.get(topicId)?.title,
        count: r.length,
      }))
      .sort((a, b) => b.count - a.count || a.topicId.localeCompare(b.topicId))
      .slice(0, 10),
    sampleCompletionsByBucket: buckets,
    groupBy: group,
    completionRate: null,
    activeReviewDays: a.coverage.historyComplete ? days.size : null,
    elapsedDays,
    reviewConsistency:
      elapsedDays && a.coverage.historyComplete
        ? days.size / elapsedDays
        : null,
  };
}
export async function stats(p: Principal, input: AnalysisInput) {
  return summarize(await analysis(p, input), input.groupBy);
}
export async function profile(p: Principal) {
  const a = await analysis(p, {});
  const metrics = summarize(a, "week");
  const { timezone, studyStart, studyEnd, duration, daysBefore, daysAfter } =
    a.pref;
  return {
    ...rangeSummary(a),
    totalTopics: metrics.totalTopics,
    activeTags: [
      ...new Set(
        a.topics
          .filter((t) => t.status === "active")
          .flatMap((t) => t.tags as string[]),
      ),
    ].slice(0, 20),
    recentActivity: a.reviews
      .slice(0, 8)
      .map((r) => historySummary(r, a.joined.get(r.topic_id)!)),
    upcoming: a.waiting
      .filter((r) => Date.parse(r.scheduled_at) >= a.now.toMillis())
      .slice(0, 8)
      .map((r) => ({
        ...scheduleSummary(r)!,
        title: a.joined.get(r.topic_id)?.title,
      })),
    strongest: [...a.byTopic.entries()]
      .filter(
        ([topicId, r]) =>
          a.joined.get(topicId)?.status === "active" &&
          r.length >= 2 &&
          r[0].original_rating >= 4,
      )
      .map(([topicId, r]) => ({
        topicId,
        title: a.joined.get(topicId)?.title,
        latestRating: r[0].original_rating,
        reviewedInPeriod: r.length,
      }))
      .sort(
        (a, b) =>
          b.latestRating - a.latestRating ||
          b.reviewedInPeriod - a.reviewedInPeriod ||
          a.topicId.localeCompare(b.topicId),
      )
      .slice(0, 8),
    priorities: await weakRows(p.uid, a, 8),
    sampleMeanRatingChange: metrics.sampleMeanRatingChange,
    reviewConsistency: metrics.reviewConsistency,
    activeReviewDays: metrics.activeReviewDays,
    elapsedDays: metrics.elapsedDays,
    preferences: {
      timezone,
      studyStart,
      studyEnd,
      duration,
      daysBefore,
      daysAfter,
    },
  };
}
