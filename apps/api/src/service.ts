import { eq } from "drizzle-orm";
import { userPreferences } from "../../../packages/database/src/schema.ts";
import { sql, db } from "../../../packages/database/src/index.ts";
import {
  advance,
  algorithmVersion,
  coldStart,
  parameters,
} from "../../../packages/memory-engine/src/index.ts";
import {
  schedule,
  type Busy,
} from "../../../packages/calendar-scheduler/src/index.ts";
import {
  applyTopicPatch,
  defaults,
  safeUrl,
  type TopicInput,
  type Preferences,
} from "../../../packages/shared/src/index.ts";
import type { TransactionSql } from "postgres";
type Tx = TransactionSql;
type TopicRecord = {
  id: string;
  user_id: string;
  title: string;
  initial_knowledge: number | null;
  importance: number | null;
  target_retention: number;
  duration: number;
  status: string;
};
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export async function preferences(
  user: string,
  tx: Tx | typeof sql = sql,
): Promise<Preferences> {
  if (tx === sql) {
    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user));
    return { ...defaults, ...(row?.settings as Partial<Preferences>) };
  }
  const [row] =
    await tx`SELECT settings FROM user_preferences WHERE user_id=${user}`;
  return { ...defaults, ...row?.settings };
}
export async function lock(tx: Tx, user: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${user},0))`;
}
export async function enqueue(
  tx: Tx | typeof sql,
  user: string,
  type = "outbound",
  key: string = crypto.randomUUID(),
) {
  await tx`INSERT INTO sync_jobs(user_id,type,idempotency_key) VALUES(${user},${type},${key}) ON CONFLICT DO NOTHING`;
}
export async function owned(
  user: string,
  id: string,
  tx: Tx | typeof sql = sql,
) {
  const [row] =
    await tx`SELECT * FROM topics WHERE id=${id} AND user_id=${user}`;
  return (row as TopicRecord) ?? fail(404, "Topic not found");
}
export async function details(
  user: string,
  id: string,
  tx: Tx | typeof sql = sql,
) {
  const topic = await owned(user, id, tx);
  const [materials, tags, memory, schedules] = await Promise.all([
    tx`SELECT text,url,position FROM topic_materials WHERE topic_id=${id} ORDER BY position`,
    tx`SELECT t.name FROM tags t JOIN topic_tags tt ON tt.tag_id=t.id WHERE tt.topic_id=${id} ORDER BY t.name`,
    tx`SELECT * FROM memory_states WHERE topic_id=${id}`,
    tx`SELECT * FROM review_schedules WHERE topic_id=${id} AND status='pending'`,
  ]);
  return {
    ...topic,
    materials,
    tags: tags.map((t) => t.name),
    memory: memory[0],
    schedule: schedules[0] ?? null,
  };
}
export async function listTopics(
  user: string,
  archived: boolean,
  q: { q?: string; tag?: string; sort: string; offset: number; limit: number },
) {
  const where = sql`t.user_id=${user} AND t.status=${archived ? "archived" : "active"} AND (${q.q ?? null}::text IS NULL OR position(lower(${q.q ?? ""}) in lower(t.title))>0) AND (${q.tag ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM tags tag JOIN topic_tags tt ON tt.tag_id=tag.id WHERE tt.topic_id=t.id AND tag.name=${q.tag ?? ""}))`;
  const order =
    q.sort === "title"
      ? sql`t.title,t.id`
      : q.sort === "importance"
        ? sql`COALESCE(t.importance,3) DESC,t.id`
        : sql`(SELECT scheduled_at FROM review_schedules s WHERE s.topic_id=t.id AND s.status='pending') NULLS LAST,t.id`;
  const items =
    await sql`SELECT t.*,COALESCE((SELECT json_agg(tag.name ORDER BY tag.name) FROM tags tag JOIN topic_tags tt ON tag.id=tt.tag_id WHERE tt.topic_id=t.id),'[]') AS tags,(SELECT row_to_json(s) FROM review_schedules s WHERE s.topic_id=t.id AND s.status='pending') AS schedule FROM topics t WHERE ${where} ORDER BY ${order} OFFSET ${q.offset} LIMIT ${q.limit}`;
  const [count] =
    await sql`SELECT count(*)::int AS total FROM topics t WHERE ${where}`;
  return { items, total: count.total };
}
async function materials(tx: Tx, id: string, items: string[]) {
  await tx`DELETE FROM topic_materials WHERE topic_id=${id}`;
  for (const [i, text] of items.entries())
    await tx`INSERT INTO topic_materials(topic_id,text,url,position) VALUES(${id},${text},${safeUrl(text)},${i})`;
}
async function tags(tx: Tx, user: string, id: string, items: string[]) {
  await tx`DELETE FROM topic_tags WHERE topic_id=${id}`;
  for (const name of items.filter(
    (v, i) =>
      items.findIndex(
        (x) => x.toLocaleLowerCase() === v.toLocaleLowerCase(),
      ) === i,
  )) {
    const [tag] =
      await tx`INSERT INTO tags(user_id,name,normalized) VALUES(${user},${name},${name.toLocaleLowerCase()}) ON CONFLICT(user_id,normalized) DO UPDATE SET normalized=excluded.normalized RETURNING id`;
    await tx`INSERT INTO topic_tags(topic_id,tag_id) VALUES(${id},${tag.id}) ON CONFLICT DO NOTHING`;
  }
}
export async function availability(
  user: string,
  tx: Tx | typeof sql = sql,
  exclude?: string,
): Promise<Busy[]> {
  const rows =
    await tx`SELECT s.scheduled_at,s.duration FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE t.user_id=${user} AND s.status='pending' AND s.scheduled_at IS NOT NULL AND (${exclude ?? null}::uuid IS NULL OR s.id<>${exclude ?? null}::uuid)`;
  return rows.map((r) => ({
    start: new Date(r.scheduled_at).toISOString(),
    end: new Date(
      new Date(r.scheduled_at).getTime() + r.duration * 60000,
    ).toISOString(),
  }));
}
export async function makeSchedule(
  tx: Tx,
  user: string,
  topic: any,
  ideal: Date,
  options: { manual?: Date; recovery?: boolean } = {},
) {
  const p = await preferences(user, tx),
    busy = await availability(user, tx);
  const result = schedule({
    ideal,
    now: new Date(),
    duration: topic.duration,
    preferences: p,
    busy,
    importance: topic.importance,
    ...options,
  });
  const [row] =
    await tx`INSERT INTO review_schedules(topic_id,ideal_due_at,scheduled_at,duration,mode,adjustment_reason) VALUES(${topic.id},${ideal},${result.start},${topic.duration},${result.mode},${result.reason}) RETURNING *`;
  return row;
}
export async function createTopic(
  user: string,
  input: TopicInput,
  idempotencyKey?: string,
) {
  let id = "";
  await sql.begin(async (tx) => {
    await lock(tx, user);
    if (idempotencyKey) {
      const [existing] =
        await tx`SELECT id FROM topics WHERE user_id=${user} AND idempotency_key=${idempotencyKey}`;
      if (existing) {
        id = existing.id;
        return;
      }
    }
    const p = await preferences(user, tx);
    const retention = p.retention[(input.importance ?? 3) - 1];
    const [topic] =
      await tx`INSERT INTO topics(user_id,title,initial_knowledge,importance,target_retention,duration,idempotency_key) VALUES(${user},${input.title},${input.initialKnowledge},${input.importance},${retention},${input.duration},${idempotencyKey ?? null}) RETURNING *`;
    id = topic.id;
    await materials(tx, id, input.materials);
    await tags(tx, user, id, input.tags);
    await tx`INSERT INTO memory_states(topic_id,algorithm_version,parameters) VALUES(${id},${algorithmVersion},${tx.json(parameters)})`;
    await makeSchedule(
      tx,
      user,
      topic,
      coldStart(new Date(), input.initialKnowledge, p.timezone),
      { manual: input.scheduledAt ? new Date(input.scheduledAt) : undefined },
    );
    await enqueue(tx, user);
  });
  return details(user, id);
}
export async function editTopic(user: string, id: string, patch: unknown) {
  await sql.begin(async (tx) => {
    await lock(tx, user);
    const old = await details(user, id, tx);
    const input = applyTopicPatch(
      {
        title: old.title,
        initialKnowledge: old.initial_knowledge,
        importance: old.importance,
        duration: old.duration,
        tags: old.tags,
        materials: old.materials.map((m) => m.text),
      },
      patch,
    );
    const p = await preferences(user, tx);
    await tx`UPDATE topics SET title=${input.title},importance=${input.importance},target_retention=${p.retention[(input.importance ?? 3) - 1]},duration=${input.duration},updated_at=now() WHERE id=${id}`;
    await materials(tx, id, input.materials);
    await tags(tx, user, id, input.tags);
    await tx`UPDATE review_schedules SET duration=${input.duration} WHERE topic_id=${old.id} AND status='pending'`;
    const [pending] =
      await tx`SELECT * FROM review_schedules WHERE topic_id=${id} AND status='pending' AND mode='automatic'`;
    if (pending) {
      const choice = schedule({
        ideal: new Date(pending.ideal_due_at),
        now: new Date(),
        duration: input.duration,
        preferences: p,
        busy: await availability(user, tx, pending.id),
        importance: input.importance ?? 3,
      });
      await tx`UPDATE review_schedules SET scheduled_at=${choice.start},adjustment_reason=${choice.reason} WHERE id=${pending.id}`;
    }
    await enqueue(tx, user);
  });
  return details(user, id);
}
export async function archive(user: string, id: string, restore = false) {
  await sql.begin(async (tx) => {
    await lock(tx, user);
    const topic = await owned(user, id, tx);
    if (topic.status === (restore ? "active" : "archived")) return;
    await tx`UPDATE topics SET status=${restore ? "active" : "archived"},updated_at=now() WHERE id=${id}`;
    if (restore) {
      const [m] = await tx`SELECT * FROM memory_states WHERE topic_id=${id}`;
      const p = await preferences(user, tx);
      const [last] =
        await tx`SELECT original_rating,completed_at FROM review_logs WHERE topic_id=${id} ORDER BY completed_at DESC LIMIT 1`;
      const recovery = !!last && last.original_rating <= 2;
      const ideal = recovery
        ? coldStart(new Date(last.completed_at), null, p.timezone)
        : m.card?.dueAt
          ? new Date(m.card.dueAt)
          : coldStart(new Date(), topic.initial_knowledge, p.timezone);
      await makeSchedule(tx, user, topic, ideal, { recovery });
    } else
      await tx`UPDATE review_schedules SET status='cancelled' WHERE topic_id=${id} AND status='pending'`;
    await enqueue(tx, user);
  });
}
export async function reschedule(user: string, id: string, at?: Date) {
  await sql.begin(async (tx) => {
    await lock(tx, user);
    const [s] =
      await tx`SELECT s.*,t.user_id,t.importance FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE s.id=${id} AND t.user_id=${user} AND s.status='pending'`;
    if (!s) fail(404, "Pending review not found");
    const p = await preferences(user, tx);
    const result = schedule({
      ideal: new Date(s.ideal_due_at),
      now: new Date(),
      duration: s.duration,
      preferences: p,
      busy: await availability(user, tx, id),
      manual: at,
      importance: s.importance,
    });
    await tx`UPDATE review_schedules SET scheduled_at=${result.start},mode=${result.mode},adjustment_reason=${result.reason} WHERE id=${id}`;
    await enqueue(tx, user);
  });
}
export async function complete(
  user: string,
  scheduleId: string,
  rating: number,
  correction = false,
) {
  return sql.begin(async (tx) => {
    await lock(tx, user);
    const [s] =
      await tx`SELECT s.*,t.user_id,t.target_retention FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE s.id=${scheduleId} AND t.user_id=${user}`;
    if (!s) fail(404, "Review not found");
    const [existing] =
      await tx`SELECT * FROM review_logs WHERE schedule_id=${scheduleId}`;
    if (existing && !correction) {
      const [pending] =
        await tx`SELECT * FROM review_schedules WHERE topic_id=${s.topic_id} AND status='pending'`;
      return { duplicate: true, review: existing, next: pending ?? null };
    }
    if (!existing && s.status !== "pending")
      fail(409, "Review is no longer pending");
    const topic = await owned(user, s.topic_id, tx);
    if (topic.status !== "active") fail(409, "Topic is archived");
    const [memory] =
      await tx`SELECT * FROM memory_states WHERE topic_id=${s.topic_id}`;
    const p = await preferences(user, tx);
    let previous = memory.card;
    let now = new Date();
    if (correction) {
      if (!existing) fail(404, "Review not found");
      if (
        new Date(memory.last_review_at).getTime() !==
        new Date(existing.completed_at).getTime()
      )
        fail(409, "Only the latest review can be corrected");
      const pending =
        await tx`SELECT * FROM review_schedules WHERE topic_id=${s.topic_id} AND status='pending'`;
      if (existing.original_rating === rating && pending[0])
        return { duplicate: true, review: existing, next: pending[0] };
      if (pending.some((v) => v.mode === "manual"))
        fail(
          409,
          "Return the next review to automatic scheduling before correcting",
        );
      previous = existing.previous_state;
      now = new Date(existing.completed_at);
      await tx`INSERT INTO review_corrections(review_id,old_rating,new_rating,old_state) VALUES(${existing.id},${existing.original_rating},${rating},${tx.json(existing.new_state)})`;
      await tx`UPDATE review_schedules SET status='cancelled' WHERE topic_id=${s.topic_id} AND status='pending'`;
    }
    const result = await advance(
      previous,
      rating,
      topic.target_retention,
      now,
      p.timezone,
      s.topic_id,
    );
    if (correction)
      await tx`UPDATE review_logs SET original_rating=${rating},mapped_rating=${result.mappedRating},new_state=${tx.json(result.card)},fsrs_log=${tx.json(result.log as any)},corrected_at=now() WHERE id=${existing.id}`;
    else {
      await tx`INSERT INTO review_logs(topic_id,schedule_id,original_rating,mapped_rating,completed_at,previous_state,new_state,fsrs_log,algorithm_version,parameters) VALUES(${s.topic_id},${s.id},${rating},${result.mappedRating},${now},${previous ? tx.json(previous) : null},${tx.json(result.card)},${tx.json(result.log as any)},${algorithmVersion},${tx.json(parameters)})`;
      await tx`UPDATE review_schedules SET status='completed' WHERE id=${s.id}`;
    }
    await tx`UPDATE memory_states SET card=${tx.json(result.card)},stability=${result.card.stability},difficulty=${result.card.difficulty},last_review_at=${now},review_count=review_count+${correction ? 0 : 1} WHERE topic_id=${s.topic_id}`;
    const next = await makeSchedule(tx, user, topic, result.ideal, {
      recovery: rating <= 2,
    });
    await enqueue(tx, user);
    return { duplicate: false, next };
  });
}
