import { prepareOutbound } from "./calendar-queue.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  FieldPath,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  db,
  userRef,
  requireActiveAccount,
  collection,
  mutate,
  get,
  records,
  pendingSchedules,
  getByIds,
  type Rows,
  fail,
  type RecordData,
  type MutationGuard,
} from "./store.ts";
import {
  defaults,
  preferencesInput,
  topicInput,
  verifyPreview,
  applyTopicPatch,
  safeUrl,
  type Preferences,
  type TopicInput,
} from "../../packages/shared/src/index.ts";
import {
  advance,
  coldStart,
  algorithmVersion,
  parameters,
} from "../../packages/memory-engine/src/index.ts";
import {
  schedule,
  type Busy,
} from "../../packages/calendar-scheduler/src/index.ts";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
export async function ensureUser(
  uid: string,
  profile: { email?: string; name?: string },
) {
  const ref = userRef(uid);
  await requireActiveAccount(uid);
  const current = (await ref.get()).data();
  const changed = (user: RecordData) =>
    (profile.email && profile.email !== user.email) ||
    (profile.name && profile.name !== user.display_name);
  if (current && !changed(current)) return current;
  return db.runTransaction(async (tx) => {
    await requireActiveAccount(uid, tx);
    const existing = (await tx.get(ref)).data();
    if (existing) {
      if (!changed(existing)) return existing;
      const update = {
        email: profile.email ?? existing.email,
        display_name: profile.name ?? existing.display_name,
      };
      tx.update(ref, update);
      return { ...existing, ...update };
    }
    const created = {
      id: uid,
      email: profile.email ?? "",
      display_name: profile.name ?? profile.email ?? "Learner",
      timezone: "UTC",
      revision: 0,
      topicIndexVersion: 1,
      created_at: new Date().toISOString(),
    };
    tx.create(ref, created);
    tx.create(collection(uid, "preferences").doc("default"), defaults);
    return created;
  });
}
export async function preferences(uid: string): Promise<Preferences> {
  return { ...defaults, ...(await get(uid, "preferences", "default")) };
}
function busy(sessions: RecordData[], except?: string): Busy[] {
  return sessions
    .filter((s) => s.status === "pending" && s.scheduled_at && s.id !== except)
    .map((s) => ({
      start: s.scheduled_at,
      end: new Date(
        Date.parse(s.scheduled_at) + s.duration * 60000,
      ).toISOString(),
    }));
}
export function placement(
  topic: RecordData,
  ideal: Date,
  p: Preferences,
  sessions: RecordData[],
  now: Date,
  opts: {
    manual?: Date;
    recovery?: boolean;
    exclude?: string;
    external?: Busy[];
  } = {},
) {
  const choice = schedule({
    ideal,
    now,
    duration: topic.duration,
    preferences: p,
    busy: [...busy(sessions, opts.exclude), ...(opts.external ?? [])],
    manual: opts.manual,
    recovery: opts.recovery,
    importance: topic.importance ?? 3,
  });
  return {
    scheduled_at: choice.start,
    mode: choice.mode,
    adjustment_reason: choice.reason,
  };
}
const pendingQuery = (ref: FirebaseFirestore.CollectionReference) =>
  pendingSchedules(ref).limit(1001);
function boundedPending(sessions: RecordData[]) {
  if (sessions.length > 1000)
    fail(409, "This schedule exceeds the Connect preview and mutation limit");
  return sessions;
}
async function pendingSessions(uid: string) {
  const snapshot = await pendingQuery(collection(uid, "reviewSchedules")).get();
  return boundedPending(records(snapshot));
}
async function context(
  read: (name: string, id: string) => Promise<RecordData | null>,
  rows: Rows,
  topicId?: string,
  mcp = false,
  extra?: "memoryStates" | "topicMaterials",
) {
  const [pref, sessions, topic, extraRecord] = await Promise.all([
    read("preferences", "default"),
    rows("reviewSchedules", mcp ? pendingQuery : pendingSchedules),
    topicId ? read("topics", topicId) : null,
    topicId && extra ? read(extra, topicId) : null,
  ]);
  if (topicId && !topic) fail(404, "Topic not found");
  return {
    p: { ...defaults, ...pref } as Preferences,
    sessions: mcp ? boundedPending(sessions) : sessions,
    topic: topic!,
    memory: extraRecord!,
    materials: extraRecord?.items ?? [],
  };
}
async function existingTags(uid: string, tags: string[], tx: Transaction) {
  const result = await getByIds(
    uid,
    "tags",
    tags.map((tag) => digest(tag.toLocaleLowerCase())),
    tx,
  );
  return [...result.values()];
}
function saveContent(
  tx: Transaction,
  uid: string,
  id: string,
  input: TopicInput,
  tags: RecordData[],
) {
  tx.set(collection(uid, "topicMaterials").doc(id), {
    topic_id: id,
    items: input.materials.map((text, position) => ({
      text,
      url: safeUrl(text),
      position,
    })),
  });
  for (const name of input.tags) {
    const normalized = name.toLocaleLowerCase(),
      tagId = digest(normalized);
    if (!tags.some((t) => t.id === tagId))
      tx.set(collection(uid, "tags").doc(tagId), {
        id: tagId,
        name,
        normalized,
      });
  }
}
function normalizeTags(items: string[], existing: RecordData[]) {
  return [
    ...new Map(
      items.map((name) => [
        name.toLocaleLowerCase(),
        existing.find((t) => t.normalized === name.toLocaleLowerCase())?.name ??
          name,
      ]),
    ).values(),
  ];
}
export async function details(uid: string, id: string): Promise<RecordData> {
  const {
    nextReviewAt: _sortDate,
    importanceOrder: _sortImportance,
    ...topic
  } = (await get(uid, "topics", id)) ?? fail(404, "Topic not found");
  const [materials, memory, review, p] = await Promise.all([
    get(uid, "topicMaterials", id),
    get(uid, "memoryStates", id),
    topic.pendingScheduleId
      ? get(uid, "reviewSchedules", topic.pendingScheduleId)
      : null,
    preferences(uid),
  ]);
  return {
    ...topic,
    target_retention: p.retention[(topic.importance ?? 3) - 1],
    materials: materials?.items ?? [],
    memory,
    schedule: review?.status === "pending" ? review : null,
  };
}
export const nextReviewSortKey = (at?: string | null) => at ?? "9999-01-01";
type TopicQuery = {
  archived?: string;
  q?: string;
  tag?: string;
  sort?: string;
  offset: number;
  limit: number;
  cursor?: string;
};
function topicCursor(q: TopicQuery): [string | number, string] | undefined {
  if (!q.cursor) return;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(q.cursor, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      (q.sort === "importance"
        ? typeof value[0] === "number" && Number.isFinite(value[0])
        : typeof value[0] === "string" && value[0].length <= 200) &&
      typeof value[1] === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(value[1])
    )
      return [value[0], value[1]];
  } catch {
    /* Return a consistent validation error. */
  }
  fail(400, "Invalid pagination cursor");
}
export async function listTopics(uid: string, q: TopicQuery, indexed = false) {
  let base: Query = collection(uid, "topics").where(
    "status",
    "==",
    q.archived === "true" ? "archived" : "active",
  );
  if (q.tag) base = base.where("tags", "array-contains", q.tag);
  const cursor = topicCursor(q);
  const field = q.sort === "importance" ? "importanceOrder" : "nextReviewAt";
  const direction = q.sort === "importance" ? "desc" : "asc";
  let total: number, page: RecordData[], hasMore: boolean;
  let key = (t: RecordData): string | number => t[field];
  if (indexed && q.sort !== "title" && !q.q && !q.offset) {
    let query = base.orderBy(field, direction).orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(...cursor);
    const [snapshot, count] = await Promise.all([
      query.limit(q.limit + 1).get(),
      base.count().get(),
    ]);
    const docs = records(snapshot);
    total = count.data().count;
    page = docs.slice(0, q.limit);
    hasMore = docs.length > q.limit;
  } else {
    // Firestore cannot match arbitrary substrings or the browser's localeCompare order.
    // Sort a status/tag-filtered projection and load full documents only for this page.
    const candidates = records(
      await base
        .select("title", "importance", "pendingScheduleId", "nextReviewAt")
        .get(),
    ).filter(
      (topic) => !q.q || topic.title.toLowerCase().includes(q.q.toLowerCase()),
    );
    const schedules =
      !indexed && q.sort !== "title" && q.sort !== "importance"
        ? await getByIds(
            uid,
            "reviewSchedules",
            candidates.map((topic) => topic.pendingScheduleId),
          )
        : new Map<string, RecordData>();
    key = (t) => {
      if (q.sort === "title") return t.title;
      if (q.sort === "importance") return t.importance ?? 3;
      if (indexed) return t.nextReviewAt;
      const schedule = schedules.get(t.pendingScheduleId);
      return nextReviewSortKey(
        schedule?.status === "pending" ? schedule.scheduled_at : null,
      );
    };
    const compare = (
      a: string | number,
      b: string | number,
      id: string,
      otherId: string,
    ) =>
      (typeof a === "number"
        ? Number(b) - a
        : q.sort === "title"
          ? a.localeCompare(String(b))
          : Date.parse(a) - Date.parse(String(b))) ||
      (id < otherId ? -1 : id === otherId ? 0 : 1);
    candidates.sort((a, b) => compare(key(a), key(b), a.id, b.id));
    total = candidates.length;
    const position = cursor
      ? candidates.findIndex(
          (t) => compare(key(t), cursor[0], t.id, cursor[1]) > 0,
        )
      : q.offset;
    const selected =
      position < 0 ? [] : candidates.slice(position, position + q.limit);
    const docs = await getByIds(
      uid,
      "topics",
      selected.map((t) => t.id),
    );
    page = selected
      .map((t) => docs.get(t.id))
      .filter((t): t is RecordData => !!t);
    hasMore = position >= 0 && position + q.limit < total;
  }
  const [pref, schedules] = await Promise.all([
    preferences(uid),
    getByIds(
      uid,
      "reviewSchedules",
      page.map((t) => t.pendingScheduleId),
    ),
  ]);
  const last = page.at(-1);
  return {
    items: page.map((t) => {
      const schedule = schedules.get(t.pendingScheduleId);
      const {
        nextReviewAt: _sortDate,
        importanceOrder: _sortImportance,
        ...topic
      } = t;
      return {
        ...topic,
        target_retention: pref.retention[(t.importance ?? 3) - 1],
        schedule: schedule?.status === "pending" ? schedule : null,
      };
    }),
    total,
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify([key(last), last.id])).toString(
            "base64url",
          )
        : null,
  };
}
export async function createTopic(
  uid: string,
  raw: unknown,
  key?: string,
  availability?: (manual?: string, duration?: number) => Promise<Busy[]>,
  guard?: MutationGuard,
) {
  const input = topicInput.parse(raw),
    id = key ? digest(`${uid}:${key}`) : randomUUID(),
    scheduleId = randomUUID(),
    now = new Date();
  if (!guard && key && (await get(uid, "topics", id))) return details(uid, id);
  const external = await availability?.(input.scheduledAt, input.duration);
  await mutate(
    uid,
    async (tx, read, rows) => {
      const existing = await read("topics", id);
      if (existing)
        return {
          id,
          title: existing.title,
          duration: existing.duration,
          first: null,
        };
      const [c, outbound, tags] = await Promise.all([
        context(read, rows, undefined, !!guard),
        prepareOutbound(tx, uid),
        existingTags(uid, input.tags, tx),
      ]);
      const topic = {
        id,
        user_id: uid,
        title: input.title,
        initial_knowledge: input.initialKnowledge,
        importance: input.importance,
        target_retention: c.p.retention[(input.importance ?? 3) - 1],
        duration: input.duration,
        status: "active",
        tags: normalizeTags(input.tags, tags),
        pendingScheduleId: scheduleId,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      const ideal = coldStart(now, input.initialKnowledge, c.p.timezone);
      const session = {
        id: scheduleId,
        topic_id: id,
        ideal_due_at: ideal.toISOString(),
        duration: input.duration,
        status: "pending",
        recovery: false,
        created_at: now.toISOString(),
        ...placement(topic, ideal, c.p, c.sessions, now, {
          external,
          manual: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        }),
      };
      verifyPreview(input.expectedStart, session.scheduled_at);
      tx.create(collection(uid, "topics").doc(id), {
        ...topic,
        nextReviewAt: nextReviewSortKey(session.scheduled_at),
        importanceOrder: input.importance ?? 3,
      });
      saveContent(tx, uid, id, input, tags);
      tx.create(collection(uid, "memoryStates").doc(id), {
        topic_id: id,
        card: null,
        stability: null,
        difficulty: null,
        algorithm_version: algorithmVersion,
        parameters,
        review_count: 0,
        last_review_at: null,
      });
      tx.create(collection(uid, "reviewSchedules").doc(scheduleId), session);
      const jobId = outbound([scheduleId]);
      return {
        id,
        title: topic.title,
        duration: topic.duration,
        first: session,
        jobId,
      };
    },
    guard,
  );
  return details(uid, id);
}
export async function editTopic(uid: string, id: string, raw: unknown) {
  await mutate(uid, async (tx, read, rows) => {
    const [c, outbound] = await Promise.all([
      context(read, rows, id, false, "topicMaterials"),
      prepareOutbound(tx, uid),
    ]);
    const input = applyTopicPatch(
      {
        title: c.topic.title,
        initialKnowledge: c.topic.initial_knowledge,
        importance: c.topic.importance,
        duration: c.topic.duration,
        tags: c.topic.tags,
        materials: c.materials.map((m: RecordData) => m.text),
      },
      raw,
    );
    const tags = await existingTags(uid, input.tags, tx);
    const topic: RecordData = {
      ...c.topic,
      title: input.title,
      importance: input.importance,
      duration: input.duration,
      target_retention: c.p.retention[(input.importance ?? 3) - 1],
      tags: normalizeTags(input.tags, tags),
      updated_at: new Date().toISOString(),
    };
    const pending = c.sessions.find(
      (s) => s.id === topic.pendingScheduleId && s.status === "pending",
    );
    const change = pending
      ? placement(
          topic,
          new Date(pending.ideal_due_at),
          c.p,
          c.sessions,
          new Date(),
          {
            exclude: pending.id,
            recovery: pending.recovery,
            manual:
              pending.mode === "manual" && pending.scheduled_at
                ? new Date(pending.scheduled_at)
                : undefined,
          },
        )
      : null;
    tx.set(collection(uid, "topics").doc(id), {
      ...topic,
      nextReviewAt: nextReviewSortKey(change?.scheduled_at),
      importanceOrder: input.importance ?? 3,
    });
    saveContent(tx, uid, id, input, tags);
    if (pending && change)
      tx.update(collection(uid, "reviewSchedules").doc(pending.id), {
        duration: input.duration,
        ...change,
      });
    outbound([pending?.id]);
  });
  return details(uid, id);
}
export async function archive(uid: string, id: string, restore = false) {
  const nextId = randomUUID(),
    now = new Date();
  await mutate(uid, async (tx, read, rows) => {
    const c = await context(
      read,
      rows,
      id,
      false,
      restore ? "memoryStates" : undefined,
    );
    if (c.topic.status === (restore ? "active" : "archived")) return;
    const pending = c.sessions.find(
      (s) => s.id === c.topic.pendingScheduleId && s.status === "pending",
    );
    const outbound = await prepareOutbound(tx, uid);
    let nextReviewAt = nextReviewSortKey();
    if (restore) {
      const last = c.memory?.latestReviewId
        ? await read("reviewHistory", c.memory.latestReviewId)
        : null;
      const recovery = !!last && last.original_rating <= 2;
      const ideal = recovery
        ? coldStart(new Date(last!.completed_at), null, c.p.timezone)
        : c.memory?.card?.dueAt
          ? new Date(c.memory.card.dueAt)
          : coldStart(now, c.topic.initial_knowledge, c.p.timezone);
      const choice = placement(c.topic, ideal, c.p, c.sessions, now, {
        recovery,
      });
      nextReviewAt = nextReviewSortKey(choice.scheduled_at);
      tx.create(collection(uid, "reviewSchedules").doc(nextId), {
        id: nextId,
        topic_id: id,
        ideal_due_at: ideal.toISOString(),
        duration: c.topic.duration,
        status: "pending",
        recovery,
        created_at: now.toISOString(),
        ...choice,
      });
    } else if (pending)
      tx.update(collection(uid, "reviewSchedules").doc(pending.id), {
        status: "cancelled",
      });
    tx.update(collection(uid, "topics").doc(id), {
      status: restore ? "active" : "archived",
      pendingScheduleId: restore ? nextId : null,
      nextReviewAt,
      importanceOrder: c.topic.importance ?? 3,
      updated_at: now.toISOString(),
    });
    outbound([restore ? nextId : pending?.id]);
  });
  return { ok: true };
}
type ManualContext = {
  topic: RecordData;
  p: Preferences;
  sessions: RecordData[];
};
function manualChoice(
  c: ManualContext,
  session: RecordData,
  now: Date,
  at?: Date,
  external?: Busy[],
) {
  return placement(
    { ...c.topic, duration: session.duration },
    new Date(session.ideal_due_at),
    c.p,
    c.sessions,
    now,
    { manual: at, exclude: session.id, recovery: session.recovery, external },
  );
}
function manualWarnings(
  c: ManualContext,
  session: RecordData,
  now: Date,
  at: Date,
  external: Busy[],
) {
  const internal = manualChoice(c, session, now, at);
  const hours = manualChoice({ ...c, sessions: [] }, session, now, at);
  const overlapsCalendar = external.some(
    (b) =>
      at.getTime() < Date.parse(b.end) &&
      at.getTime() + session.duration * 60_000 > Date.parse(b.start),
  );
  const local = DateTime.fromJSDate(at, { zone: c.p.timezone }).startOf("day");
  const ideal = DateTime.fromISO(session.ideal_due_at, {
    zone: c.p.timezone,
  }).startOf("day");
  const outside =
    local < ideal.minus({ days: session.recovery ? 0 : c.p.daysBefore }) ||
    local > ideal.plus({ days: c.p.daysAfter });
  return [
    ...(internal.adjustment_reason &&
    internal.adjustment_reason !== hours.adjustment_reason
      ? [internal.adjustment_reason]
      : []),
    ...(hours.adjustment_reason ? [hours.adjustment_reason] : []),
    ...(overlapsCalendar
      ? ["Manual time overlaps Google Calendar availability."]
      : []),
    ...(outside
      ? ["Manual time is outside your preferred scheduling window."]
      : []),
  ];
}
function ensureManualDate(at: Date) {
  if (!Number.isFinite(at.getTime()) || at <= new Date())
    fail(400, "Choose a future time");
}
export async function previewManual(
  uid: string,
  id: string,
  at: Date,
  external: Busy[],
) {
  ensureManualDate(at);
  const session =
    (await get(uid, "reviewSchedules", id)) ?? fail(404, "Review not found");
  if (session.status !== "pending") fail(409, "Review is no longer pending");
  const [t, p, sessions] = await Promise.all([
    get(uid, "topics", session.topic_id),
    preferences(uid),
    pendingSessions(uid),
  ]);
  if (!t || t.status !== "active") fail(409, "Topic is archived");
  return {
    title: t.title,
    duration: session.duration,
    timezone: p.timezone,
    previous: session.scheduled_at ?? null,
    warnings: manualWarnings(
      { topic: t, p, sessions },
      session,
      new Date(),
      at,
      external,
    ),
  };
}
export async function reschedule(
  uid: string,
  id: string,
  at?: Date,
  confirmation?: {
    guard: MutationGuard;
    external: Busy[];
    expected: Awaited<ReturnType<typeof previewManual>>;
  },
) {
  if (at) ensureManualDate(at);
  const now = new Date();
  await mutate(
    uid,
    async (tx, read, rows) => {
      const session =
        (await read("reviewSchedules", id)) ?? fail(404, "Review not found");
      if (session.status !== "pending")
        fail(409, "Review is no longer pending");
      const c = await context(read, rows, session.topic_id, !!confirmation);
      if (confirmation && at) {
        const { expected, external } = confirmation;
        const warnings = manualWarnings(c, session, now, at, external);
        if (
          c.topic.status !== "active" ||
          c.topic.title !== expected.title ||
          c.p.timezone !== expected.timezone ||
          session.duration !== expected.duration ||
          (session.scheduled_at ?? null) !== expected.previous ||
          JSON.stringify(warnings) !== JSON.stringify(expected.warnings)
        )
          fail(
            409,
            "Scheduling conditions changed. Request a new confirmation.",
          );
      }
      const choice = confirmation
        ? manualChoice(c, session, now, at, confirmation.external)
        : placement(
            c.topic,
            new Date(session.ideal_due_at),
            c.p,
            c.sessions,
            now,
            {
              manual: at,
              exclude: id,
              recovery: session.recovery,
            },
          );
      const outbound = await prepareOutbound(tx, uid);
      tx.update(collection(uid, "reviewSchedules").doc(id), choice);
      if (c.topic.pendingScheduleId === id)
        tx.update(collection(uid, "topics").doc(c.topic.id), {
          nextReviewAt: nextReviewSortKey(choice.scheduled_at),
        });
      const jobId = outbound([id]);
      return { ...session, ...choice, jobId };
    },
    confirmation?.guard,
  );
  return { ok: true };
}
export async function complete(
  uid: string,
  id: string,
  rating: number,
  correct = false,
  guard?: MutationGuard,
) {
  const nextId = randomUUID(),
    requestTime = new Date();
  return mutate(
    uid,
    async (tx, read, rows) => {
      const [session, existing] = await Promise.all([
        read("reviewSchedules", id),
        read("reviewHistory", id),
      ]);
      if (!session) fail(404, "Review not found");
      if (existing && !correct) {
        const topic = await read("topics", session.topic_id);
        const next = topic?.pendingScheduleId
          ? await read("reviewSchedules", topic.pendingScheduleId)
          : null;
        return { duplicate: true, review: existing, next };
      }
      if (session.status !== "pending" && !correct)
        fail(409, "Review is no longer pending");
      const c = await context(
        read,
        rows,
        session.topic_id,
        !!guard,
        "memoryStates",
      );
      if (c.topic.status !== "active") fail(409, "Topic is archived");
      let previous = c.memory.card,
        now = requestTime;
      const pending = c.sessions.find(
        (s) => s.id === c.topic.pendingScheduleId && s.status === "pending",
      );
      if (correct) {
        if (!existing || c.memory.latestReviewId !== id)
          fail(409, "Only the latest review can be corrected");
        if (existing.original_rating === rating && pending)
          return { duplicate: true, review: existing, next: pending };
        if (pending?.mode === "manual")
          fail(
            409,
            "Return the next review to automatic scheduling before correcting",
          );
        previous = existing.previous_state;
        now = new Date(existing.completed_at);
      }
      const result = await advance(
        previous,
        rating,
        c.p.retention[(c.topic.importance ?? 3) - 1],
        now,
        c.p.timezone,
        session.topic_id,
      );
      const next = {
        id: nextId,
        topic_id: session.topic_id,
        ideal_due_at: result.ideal.toISOString(),
        duration: c.topic.duration,
        status: "pending",
        recovery: rating <= 2,
        created_at: requestTime.toISOString(),
        ...placement(
          c.topic,
          result.ideal,
          c.p,
          c.sessions.filter((s) => s.id !== id && s.id !== pending?.id),
          requestTime,
          { recovery: rating <= 2 },
        ),
      };
      const outbound = await prepareOutbound(tx, uid);
      if (correct) {
        tx.create(collection(uid, "reviewCorrections").doc(randomUUID()), {
          review_id: id,
          old_rating: existing!.original_rating,
          new_rating: rating,
          old_state: existing!.new_state,
          corrected_at: requestTime.toISOString(),
        });
        if (pending)
          tx.update(collection(uid, "reviewSchedules").doc(pending.id), {
            status: "cancelled",
          });
      }
      const review = {
        id,
        topic_id: session.topic_id,
        schedule_id: id,
        original_rating: rating,
        mapped_rating: result.mappedRating,
        completed_at: now.toISOString(),
        previous_state: previous,
        new_state: result.card,
        fsrs_log: json(result.log),
        algorithm_version: algorithmVersion,
        parameters,
        ...(correct ? { corrected_at: requestTime.toISOString() } : {}),
      };
      tx.set(collection(uid, "reviewHistory").doc(id), review);
      tx.update(collection(uid, "reviewSchedules").doc(id), {
        status: "completed",
      });
      tx.update(collection(uid, "memoryStates").doc(session.topic_id), {
        card: result.card,
        stability: result.card.stability,
        difficulty: result.card.difficulty,
        review_count: c.memory.review_count + (correct ? 0 : 1),
        last_review_at: now.toISOString(),
        latestReviewId: id,
        latestRating: rating,
      });
      tx.create(collection(uid, "reviewSchedules").doc(nextId), next);
      tx.update(collection(uid, "topics").doc(session.topic_id), {
        pendingScheduleId: nextId,
        nextReviewAt: nextReviewSortKey(next.scheduled_at),
      });
      const jobId = outbound([id, nextId, correct ? pending?.id : undefined]);
      return { duplicate: false, next, ...(guard ? { review, jobId } : {}) };
    },
    guard,
  );
}
export async function savePreferences(uid: string, raw: unknown) {
  const { language, ...p } = preferencesInput.parse(raw);
  return mutate(uid, async (tx, read, rows) => {
    const previous = await read("preferences", "default");
    const changed =
      !previous ||
      (
        [
          "timezone",
          "studyStart",
          "studyEnd",
          "daysBefore",
          "daysAfter",
        ] as const
      ).some((k) => previous[k] !== p[k]);
    if (changed) {
      const sessions = await rows("reviewSchedules", pendingSchedules);
      const automatic = sessions.filter(
        (session) => session.mode === "automatic",
      );
      if (automatic.length) {
        const [topics, outbound] = await Promise.all([
          getByIds(
            uid,
            "topics",
            automatic.map((session) => session.topic_id),
            tx,
          ),
          prepareOutbound(tx, uid),
        ]);
        const changedIds: string[] = [];
        const now = new Date();
        for (const session of automatic) {
          const topic = topics.get(session.topic_id);
          if (!topic) continue;
          const change = placement(
            topic,
            new Date(session.ideal_due_at),
            p,
            sessions,
            now,
            { exclude: session.id, recovery: session.recovery },
          );
          if (
            change.scheduled_at === session.scheduled_at &&
            change.adjustment_reason === session.adjustment_reason
          )
            continue;
          Object.assign(session, change);
          changedIds.push(session.id);
          tx.update(collection(uid, "reviewSchedules").doc(session.id), change);
          if (topic.pendingScheduleId === session.id)
            tx.update(collection(uid, "topics").doc(topic.id), {
              nextReviewAt: nextReviewSortKey(change.scheduled_at),
            });
        }
        outbound(changedIds);
      }
    }
    const savedLanguage = previous?.language ?? language;
    tx.set(
      collection(uid, "preferences").doc("default"),
      {
        ...p,
        ...(savedLanguage ? { language: savedLanguage } : {}),
      },
      { merge: true },
    );
    tx.update(userRef(uid), { timezone: p.timezone });
    return { ...p, ...(savedLanguage ? { language: savedLanguage } : {}) };
  });
}
async function titledReviews(uid: string, query: Query) {
  const sessions = records(await query.get());
  const topics = await getByIds(
    uid,
    "topics",
    sessions.map((s) => s.topic_id),
  );
  return sessions
    .map((s): RecordData => ({
      ...s,
      title: topics.get(s.topic_id)?.title ?? "",
      importance: topics.get(s.topic_id)?.importance ?? null,
    }))
    .sort((a, b) =>
      (a.scheduled_at ?? "9999").localeCompare(b.scheduled_at ?? "9999"),
    );
}
const endOfToday = (timezone: string) =>
  DateTime.now().setZone(timezone).endOf("day").toUTC().toISO()!;
export async function reviews(uid: string, today = false) {
  const query = pendingSchedules(collection(uid, "reviewSchedules"));
  return titledReviews(
    uid,
    today
      ? query
          .where("scheduled_at", ">", "")
          .where(
            "scheduled_at",
            "<=",
            endOfToday((await preferences(uid)).timezone),
          )
      : query,
  );
}

export async function progress(uid: string, timezone: string) {
  const start = DateTime.now().setZone(timezone).startOf("day");
  const snapshot = await collection(uid, "reviewHistory")
    .where("completed_at", ">=", start.toUTC().toISO()!)
    .where("completed_at", "<", start.plus({ days: 1 }).toUTC().toISO()!)
    .count()
    .get();
  return { completed: snapshot.data().count };
}
export async function todaySummary(uid: string, timezone: string) {
  const pending = pendingSchedules(collection(uid, "reviewSchedules"));
  const end = endOfToday(timezone);
  const [today, upcoming, active, hasTopics, completed] = await Promise.all([
    titledReviews(
      uid,
      pending.where("scheduled_at", ">", "").where("scheduled_at", "<=", end),
    ),
    titledReviews(
      uid,
      pending.where("scheduled_at", ">", end).orderBy("scheduled_at").limit(3),
    ),
    pending.count().get(),
    collection(uid, "topics").limit(1).select().get(),
    progress(uid, timezone),
  ]);
  if (
    upcoming.length < 3 &&
    active.data().count > today.length + upcoming.length
  ) {
    upcoming.push(
      ...(await titledReviews(
        uid,
        pending.where("scheduled_at", "==", null).limit(3 - upcoming.length),
      )),
    );
  }
  return {
    today,
    upcoming,
    activeCount: active.data().count,
    hasTopics: !hasTopics.empty,
    ...completed,
  };
}

export async function topicHistory(
  uid: string,
  id: string,
  page?: { limit: number; cursor?: string },
) {
  if (!(await collection(uid, "topics").doc(id).get()).exists)
    fail(404, "Topic not found");
  let query = collection(uid, "reviewHistory")
    .where("topic_id", "==", id)
    .orderBy("completed_at", "desc")
    .orderBy(FieldPath.documentId());
  if (page?.cursor) {
    let value: unknown;
    try {
      value = JSON.parse(
        Buffer.from(page.cursor, "base64url").toString("utf8"),
      );
    } catch {
      fail(400, "Invalid pagination cursor");
    }
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      !Number.isFinite(Date.parse(value[0])) ||
      typeof value[1] !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value[1])
    )
      fail(400, "Invalid pagination cursor");
    query = query.startAfter(...value);
  }
  if (!page) return records(await query.limit(100).get());
  const docs = records(await query.limit(page.limit + 1).get());
  const items = docs.slice(0, page.limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      docs.length > page.limit && last
        ? Buffer.from(JSON.stringify([last.completed_at, last.id])).toString(
            "base64url",
          )
        : null,
  };
}

export async function preview(
  uid: string,
  input: {
    knowledge?: number;
    importance?: number;
    duration: number;
    scheduledAt?: string;
  },
  external: Busy[] = [],
  pendingOnly = false,
) {
  const [p, sessions] = await Promise.all([
    preferences(uid),
    pendingOnly
      ? pendingSessions(uid)
      : pendingSchedules(collection(uid, "reviewSchedules"))
          .get()
          .then(records),
  ]);
  const now = new Date(),
    ideal = coldStart(now, input.knowledge ?? null, p.timezone);
  const result = placement(
    { duration: input.duration, importance: input.importance },
    ideal,
    p,
    sessions,
    now,
    {
      external,
      manual: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
    },
  );
  return {
    ideal: ideal.toISOString(),
    retention: p.retention[(input.importance ?? 3) - 1],
    start: result.scheduled_at,
    mode: result.mode,
    reason: result.adjustment_reason,
  };
}
