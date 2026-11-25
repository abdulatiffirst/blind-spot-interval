import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import {
  db,
  userRef,
  collection,
  mutate,
  get,
  all,
  fail,
  type RecordData,
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
  await db.runTransaction(async (tx) => {
    const ref = userRef(uid),
      s = await tx.get(ref);
    if (!s.exists) {
      tx.create(ref, {
        id: uid,
        email: profile.email ?? "",
        display_name: profile.name ?? profile.email ?? "Learner",
        timezone: "UTC",
        revision: 0,
        created_at: new Date().toISOString(),
      });
      tx.create(collection(uid, "preferences").doc("default"), defaults);
    } else if (
      (profile.email && profile.email !== s.data()!.email) ||
      (profile.name && profile.name !== s.data()!.display_name)
    ) {
      tx.update(ref, {
        email: profile.email ?? s.data()!.email,
        display_name: profile.name ?? s.data()!.display_name,
      });
    }
  });
  return (await userRef(uid).get()).data()!;
}
export async function preferences(uid: string): Promise<Preferences> {
  return { ...defaults, ...(await get(uid, "preferences", "default")) };
}
export function queue(
  tx: Transaction,
  uid: string,
  revision: number,
  type = "outbound",
  key?: string,
) {
  const id = digest(key ?? `${uid}:${revision}:${type}`);
  tx.set(db.collection("syncJobs").doc(id), {
    uid,
    type,
    status: "pending",
    attempts: 0,
    retryAt: Date.now(),
    createdAt: Date.now(),
  });
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
async function context(
  read: (name: string, id: string) => Promise<RecordData | null>,
  rows: (name: string) => Promise<RecordData[]>,
  topicId?: string,
) {
  const [pref, sessions, tags, topic, memory, materials] = await Promise.all([
    read("preferences", "default"),
    rows("reviewSchedules"),
    rows("tags"),
    topicId ? read("topics", topicId) : null,
    topicId ? read("memoryStates", topicId) : null,
    topicId ? read("topicMaterials", topicId) : null,
  ]);
  if (topicId && !topic) fail(404, "Topic not found");
  return {
    p: { ...defaults, ...pref } as Preferences,
    sessions,
    tags,
    topic: topic!,
    memory: memory!,
    materials: materials?.items ?? [],
  };
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
  const topic = (await get(uid, "topics", id)) ?? fail(404, "Topic not found");
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
export async function listTopics(
  uid: string,
  q: {
    archived?: string;
    q?: string;
    tag?: string;
    sort?: string;
    offset: number;
    limit: number;
  },
) {
  const [topics, sessions, p] = await Promise.all([
    all(uid, "topics"),
    all(uid, "reviewSchedules"),
    preferences(uid),
  ]);
  const filtered = topics
    .filter(
      (t) =>
        t.status === (q.archived === "true" ? "archived" : "active") &&
        (!q.q || t.title.toLowerCase().includes(q.q.toLowerCase())) &&
        (!q.tag || t.tags.includes(q.tag)),
    )
    .map((t): RecordData => ({
      ...t,
      target_retention: p.retention[(t.importance ?? 3) - 1],
      schedule:
        sessions.find(
          (s) => s.id === t.pendingScheduleId && s.status === "pending",
        ) ?? null,
    }));
  filtered.sort((a, b) =>
    q.sort === "title"
      ? a.title.localeCompare(b.title)
      : q.sort === "importance"
        ? (b.importance ?? 3) - (a.importance ?? 3)
        : Date.parse(a.schedule?.scheduled_at ?? "9999-01-01") -
            Date.parse(b.schedule?.scheduled_at ?? "9999-01-01") ||
          a.id.localeCompare(b.id),
  );
  return {
    items: filtered.slice(q.offset, q.offset + q.limit),
    total: filtered.length,
  };
}
export async function createTopic(
  uid: string,
  raw: unknown,
  key?: string,
  availability?: (manual?: string, duration?: number) => Promise<Busy[]>,
) {
  const input = topicInput.parse(raw),
    id = key ? digest(`${uid}:${key}`) : randomUUID(),
    scheduleId = randomUUID(),
    now = new Date();
  if (key && (await get(uid, "topics", id))) return details(uid, id);
  const external = await availability?.(input.scheduledAt, input.duration);
  await mutate(uid, async (tx, read, rows, root) => {
    const existing = await read("topics", id);
    if (existing) return;
    const c = await context(read, rows);
    const topic = {
      id,
      user_id: uid,
      title: input.title,
      initial_knowledge: input.initialKnowledge,
      importance: input.importance,
      target_retention: c.p.retention[(input.importance ?? 3) - 1],
      duration: input.duration,
      status: "active",
      tags: normalizeTags(input.tags, c.tags),
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
    tx.create(collection(uid, "topics").doc(id), topic);
    saveContent(tx, uid, id, input, c.tags);
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
    queue(tx, uid, root.revision + 1);
  });
  return details(uid, id);
}
export async function editTopic(uid: string, id: string, raw: unknown) {
  await mutate(uid, async (tx, read, rows, root) => {
    const c = await context(read, rows, id);
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
    const topic: RecordData = {
      ...c.topic,
      title: input.title,
      importance: input.importance,
      duration: input.duration,
      target_retention: c.p.retention[(input.importance ?? 3) - 1],
      tags: normalizeTags(input.tags, c.tags),
      updated_at: new Date().toISOString(),
    };
    const pending = c.sessions.find(
      (s) => s.id === topic.pendingScheduleId && s.status === "pending",
    );
    tx.set(collection(uid, "topics").doc(id), topic);
    saveContent(tx, uid, id, input, c.tags);
    if (pending)
      tx.update(collection(uid, "reviewSchedules").doc(pending.id), {
        duration: input.duration,
        ...placement(
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
        ),
      });
    queue(tx, uid, root.revision + 1);
  });
  return details(uid, id);
}
export async function archive(uid: string, id: string, restore = false) {
  const nextId = randomUUID(),
    now = new Date();
  await mutate(uid, async (tx, read, rows, root) => {
    const c = await context(read, rows, id);
    if (c.topic.status === (restore ? "active" : "archived")) return;
    const pending = c.sessions.find(
      (s) => s.id === c.topic.pendingScheduleId && s.status === "pending",
    );
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
      tx.create(collection(uid, "reviewSchedules").doc(nextId), {
        id: nextId,
        topic_id: id,
        ideal_due_at: ideal.toISOString(),
        duration: c.topic.duration,
        status: "pending",
        recovery,
        created_at: now.toISOString(),
        ...placement(c.topic, ideal, c.p, c.sessions, now, { recovery }),
      });
    } else if (pending)
      tx.update(collection(uid, "reviewSchedules").doc(pending.id), {
        status: "cancelled",
      });
    tx.update(collection(uid, "topics").doc(id), {
      status: restore ? "active" : "archived",
      pendingScheduleId: restore ? nextId : null,
      updated_at: now.toISOString(),
    });
    queue(tx, uid, root.revision + 1);
  });
  return { ok: true };
}
export async function reschedule(uid: string, id: string, at?: Date) {
  const now = new Date();
  if (at && (!Number.isFinite(at.getTime()) || at <= now))
    fail(400, "Choose a future time");
  await mutate(uid, async (tx, read, rows, root) => {
    const session =
      (await read("reviewSchedules", id)) ?? fail(404, "Review not found");
    if (session.status !== "pending") fail(409, "Review is no longer pending");
    const c = await context(read, rows, session.topic_id);
    tx.update(
      collection(uid, "reviewSchedules").doc(id),
      placement(c.topic, new Date(session.ideal_due_at), c.p, c.sessions, now, {
        manual: at,
        exclude: id,
        recovery: session.recovery,
      }),
    );
    queue(tx, uid, root.revision + 1);
  });
  return { ok: true };
}
export async function complete(
  uid: string,
  id: string,
  rating: number,
  correct = false,
) {
  const nextId = randomUUID(),
    requestTime = new Date();
  return mutate(uid, async (tx, read, rows, root) => {
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
    const c = await context(read, rows, session.topic_id);
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
    tx.set(collection(uid, "reviewHistory").doc(id), {
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
    });
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
    });
    tx.create(collection(uid, "reviewSchedules").doc(nextId), next);
    tx.update(collection(uid, "topics").doc(session.topic_id), {
      pendingScheduleId: nextId,
    });
    queue(tx, uid, root.revision + 1);
    return { duplicate: false, next };
  });
}
export async function savePreferences(uid: string, raw: unknown) {
  const p = preferencesInput.parse(raw);
  await mutate(uid, async (tx, read, rows, root) => {
    const sessions = await rows("reviewSchedules");
    const topics = await rows("topics");
    const previous = await read("preferences", "default");
    const changed =
      !previous ||
      ["timezone", "studyStart", "studyEnd", "daysBefore", "daysAfter"].some(
        (k) => previous[k] !== p[k as keyof Preferences],
      );
    if (changed) {
      const updated = [...sessions];
      for (const session of updated.filter(
        (s) => s.status === "pending" && s.mode === "automatic",
      )) {
        const topic = topics.find((t) => t.id === session.topic_id)!;
        const change = placement(
          topic,
          new Date(session.ideal_due_at),
          p,
          updated,
          new Date(),
          { exclude: session.id, recovery: session.recovery },
        );
        Object.assign(session, change);
        tx.update(collection(uid, "reviewSchedules").doc(session.id), change);
      }
    }
    tx.set(collection(uid, "preferences").doc("default"), p, { merge: true });
    tx.update(userRef(uid), { timezone: p.timezone });
    queue(tx, uid, root.revision + 1);
  });
  return p;
}
export async function reviews(uid: string, today = false) {
  const [sessions, topics, p] = await Promise.all([
    all(uid, "reviewSchedules"),
    all(uid, "topics"),
    preferences(uid),
  ]);
  const end = DateTime.now().setZone(p.timezone).endOf("day").toMillis();
  return sessions
    .filter(
      (s) =>
        s.status === "pending" &&
        (!today || (s.scheduled_at && Date.parse(s.scheduled_at) <= end)),
    )
    .map((s): RecordData => ({
      ...s,
      title: topics.find((t) => t.id === s.topic_id)?.title ?? "",
      importance: topics.find((t) => t.id === s.topic_id)?.importance ?? null,
    }))
    .sort((a, b) =>
      (a.scheduled_at ?? "9999").localeCompare(b.scheduled_at ?? "9999"),
    );
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
) {
  const [p, sessions] = await Promise.all([
    preferences(uid),
    all(uid, "reviewSchedules"),
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
