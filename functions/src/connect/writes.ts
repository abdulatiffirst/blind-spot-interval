import { z } from "zod";
import { rating, topicInput } from "../../../packages/shared/src/index.ts";
import { CalendarSync } from "../calendar.ts";
import * as domain from "../domain.ts";
import {
  collection,
  db,
  fail,
  get,
  type MutationGuard,
  type RecordData,
} from "../store.ts";
import {
  account,
  activeGrant,
  audit,
  type Principal,
  type Scope,
} from "./oauth.ts";
import { id, scheduleSummary } from "./reads.ts";

const key = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const common = { idempotencyKey: key };
export const createInput = topicInput
  .omit({ scheduledAt: true })
  .extend({
    ...common,
    notes: z.string().trim().min(1).max(2000).optional(),
    materials: z
      .array(topicInput.shape.materials.unwrap().element)
      .max(50)
      .default([]),
  })
  .strict();
export const completeInput = z.strictObject({
  ...common,
  reviewId: id,
  rating,
});
export const rescheduleInput = z.strictObject({
  ...common,
  reviewId: id,
  scheduledAt: z.iso.datetime({ offset: true }),
});
export const writeNames = [
  "create_topic",
  "complete_review",
  "reschedule_review",
] as const;
export type WriteName = (typeof writeNames)[number];
const writeScopes: Record<WriteName, Scope> = {
  create_topic: "topics:write",
  complete_review: "reviews:write",
  reschedule_review: "reviews:write",
};
type Input =
  | z.infer<typeof createInput>
  | z.infer<typeof completeInput>
  | z.infer<typeof rescheduleInput>;
type Manual = Awaited<ReturnType<typeof domain.previewManual>>;
const actions = db.collection("mcpActions");
const expiry = (ms: number) => new Date(Date.now() + ms);
const current = (row: RecordData | undefined, uid: string) => {
  if (!row || row.uid !== uid || row.expiresAt.toMillis() <= Date.now())
    fail(404, "Confirmation unavailable or expired");
  return row;
};
async function target(uid: string, reviewId: string) {
  const review = await get(uid, "reviewSchedules", reviewId);
  if (!review) fail(404, "Review not found");
  const topic = await get(uid, "topics", review.topic_id);
  if (!topic) fail(404, "Topic not found");
  if (review.status !== "pending" || topic.status !== "active")
    fail(409, "Review is no longer pending");
  return {
    title: topic.title,
    previous: review.scheduled_at ?? null,
    duration: review.duration,
  };
}
async function availability(uid: string, at: Date, duration: number) {
  try {
    return await new CalendarSync(uid).availability(at.toISOString(), duration);
  } catch {
    fail(
      409,
      "Google Calendar availability could not be verified. Try again later.",
    );
  }
}
function output(row: RecordData) {
  return {
    action: row.name,
    application: row.application,
    input: row.input,
    preview: row.preview,
    state: row.state,
  };
}
async function receipt(row: RecordData) {
  const { jobId, ...data } = row.receipt;
  const upcoming = data.firstReview ?? data.nextReview ?? data.review;
  if (!upcoming) return data;
  const [connection, mapping, currentSchedule, job] = await db.getAll(
    db.collection("calendarConnections").doc(row.uid),
    collection(row.uid, "calendarEvents").doc(upcoming.id),
    collection(row.uid, "reviewSchedules").doc(upcoming.id),
    ...(jobId ? [db.collection("syncJobs").doc(jobId)] : []),
  );
  const current = currentSchedule.data();
  const currentReview = current
    ? scheduleSummary({ ...current, id: upcoming.id })
    : null;
  const calendarSync = !connection.get("connected")
    ? "not_connected"
    : currentReview?.status !== "pending"
      ? "superseded"
      : !currentReview.scheduledAt
        ? "unscheduled"
        : mapping.get("sync_status") === "blocked"
          ? "blocked"
          : job?.get("status") === "failed"
            ? "failed"
            : mapping.get("sync_status") === "synced" &&
                (mapping.get("publishedStart")
                  ? Date.parse(mapping.get("publishedStart")) ===
                      Date.parse(currentReview.scheduledAt) &&
                    Date.parse(mapping.get("publishedEnd")) ===
                      Date.parse(currentReview.scheduledAt) +
                        currentReview.duration * 60_000
                  : job?.get("status") === "done")
              ? "synced"
              : job?.get("error")
                ? "retrying"
                : "pending";
  return {
    ...data,
    calendarSync,
    ...(currentReview?.scheduledAt !== upcoming.scheduledAt ||
    currentReview?.status !== upcoming.status
      ? { currentReview }
      : {}),
  };
}
export async function requestMutation(
  p: Principal,
  name: WriteName,
  input: Input,
  origin: string,
) {
  const actionId = domain.digest(
    JSON.stringify([p.uid, p.clientId, name, input.idempotencyKey]),
  );
  const ref = actions.doc(actionId);
  const signature = domain.digest(JSON.stringify(input));
  let existing = (await ref.get()).data();
  function check(row: RecordData) {
    if (row.signature !== signature)
      fail(409, "This idempotency key was used for a different action");
    if (row.grantId !== p.grantId)
      fail(409, "Request the action again with a new idempotency key");
    return row;
  }
  if (!existing || existing.expiresAt.toMillis() <= Date.now()) {
    let preview: RecordData = {};
    if (name === "complete_review")
      preview = await target(
        p.uid,
        (input as z.infer<typeof completeInput>).reviewId,
      );
    if (name === "reschedule_review") {
      const { reviewId, scheduledAt } = input as z.infer<
        typeof rescheduleInput
      >;
      const at = new Date(scheduledAt);
      if (at <= new Date()) fail(400, "Choose a future time");
      const { duration } = await target(p.uid, reviewId);
      preview = await domain.previewManual(
        p.uid,
        reviewId,
        at,
        await availability(p.uid, at, duration),
      );
    }
    existing = await db.runTransaction(async (tx) => {
      const [owner, action] = await Promise.all([
        tx.get(account(p.uid)),
        tx.get(ref),
      ]);
      const ownerData = owner.data();
      if (!activeGrant(ownerData, p))
        fail(403, "Application access was revoked");
      const latest = action.data();
      if (latest && latest.expiresAt.toMillis() > Date.now())
        return check(latest);
      const application = ownerData?.grants[domain.digest(p.clientId)].name;
      const row = {
        ...p,
        application,
        name,
        input,
        signature,
        state: "pending",
        preview,
      };
      tx.set(ref, {
        ...row,
        approveUntil: expiry(600_000),
        expiresAt: expiry(15 * 60_000),
      });
      return row;
    });
  } else check(existing);
  if (existing.state === "approved")
    return { state: "applied", result: await receipt(existing) };
  if (existing.state === "cancelled") return { state: "cancelled" };
  if (existing.approveUntil?.toMillis() <= Date.now())
    fail(
      409,
      "Confirmation expired. Request a new one with a new idempotency key.",
    );
  return {
    state: "confirmation_required",
    confirmationUrl: origin + "/connect/confirm#" + actionId,
    preview: existing.preview,
  };
}
export async function inspectAction(uid: string, actionId: string) {
  const row = current((await actions.doc(actionId).get()).data(), uid);
  if (!activeGrant((await account(uid).get()).data(), row as Principal))
    fail(403, "Application access was revoked");
  if (row.state === "pending" && row.approveUntil.toMillis() <= Date.now())
    fail(409, "Confirmation expired");
  return output(row);
}
export async function decideAction(
  uid: string,
  actionId: string,
  allow: boolean,
) {
  const ref = actions.doc(actionId);
  const row = current((await ref.get()).data(), uid);
  const name = z.enum(writeNames).parse(row.name);
  const requirePending = (
    data: RecordData | undefined,
    owner: RecordData | undefined,
  ) => {
    const pending = current(data, uid);
    if (
      !activeGrant(owner, pending as Principal) ||
      !pending.scopes.includes(writeScopes[name])
    )
      fail(403, "Application access was revoked");
    if (pending.state !== "pending") return false;
    if (pending.approveUntil.toMillis() <= Date.now())
      fail(409, "Confirmation expired");
    return true;
  };
  if (row.state !== "pending") return { state: row.state };
  if (!allow) {
    const state = await db.runTransaction(async (tx) => {
      const [action, owner] = await Promise.all([
        tx.get(ref),
        tx.get(account(uid)),
      ]);
      if (!requirePending(action.data(), owner.data()))
        return action.get("state");
      tx.update(ref, { state: "cancelled", expiresAt: expiry(7 * 86400_000) });
      return "cancelled";
    });
    if (state === "cancelled")
      audit("mutation_cancelled:" + name, uid, row.clientId);
    return { state };
  }
  const guard: MutationGuard = async (tx) => {
    const [action, owner] = await Promise.all([
      tx.get(ref),
      tx.get(account(uid)),
    ]);
    if (!requirePending(action.data(), owner.data()))
      fail(409, "Action already decided");
    if (name === "complete_review") {
      const { reviewId, rating } = completeInput.parse(row.input);
      const [review, history] = await Promise.all([
        tx.get(collection(uid, "reviewSchedules").doc(reviewId)),
        tx.get(collection(uid, "reviewHistory").doc(reviewId)),
      ]);
      if (history.exists && history.get("original_rating") !== rating)
        fail(409, "The review already has a different recorded rating");
      const topic = review.exists
        ? await tx.get(collection(uid, "topics").doc(review.get("topic_id")))
        : null;
      if (
        topic?.get("title") !== row.preview.title ||
        (review.get("scheduled_at") ?? null) !== row.preview.previous ||
        review.get("duration") !== row.preview.duration
      )
        fail(409, "Review details changed. Request a new confirmation.");
    }
    return (raw) => {
      const result = raw as RecordData;
      let data: RecordData;
      if (name === "create_topic")
        data = {
          topicId: result.id,
          title: result.title,
          duration: result.duration,
          firstReview: scheduleSummary(result.first),
        };
      else if (name === "complete_review")
        data = {
          review: {
            id: result.review.id,
            topicId: result.review.topic_id,
            completedAt: result.review.completed_at,
            rating: result.review.original_rating,
          },
          nextReview: scheduleSummary(result.next),
        };
      else data = { review: scheduleSummary(result) };
      tx.update(ref, {
        state: "approved",
        receipt: { ...data, jobId: result.jobId ?? null },
        expiresAt: expiry(7 * 86400_000),
      });
    };
  };
  try {
    if (name === "create_topic") {
      const {
        idempotencyKey: _key,
        notes,
        materials,
        ...input
      } = createInput.parse(row.input);
      await domain.createTopic(
        uid,
        { ...input, materials: notes ? [notes, ...materials] : materials },
        "mcp:" + actionId,
        undefined,
        guard,
      );
    } else if (name === "complete_review") {
      const { reviewId, rating } = completeInput.parse(row.input);
      await domain.complete(uid, reviewId, rating, false, guard);
    } else {
      const { reviewId, scheduledAt } = rescheduleInput.parse(row.input);
      const at = new Date(scheduledAt),
        expected = row.preview as Manual;
      await domain.reschedule(uid, reviewId, at, {
        guard,
        expected,
        external: await availability(uid, at, expected.duration),
      });
    }
  } catch (error) {
    const final = (await ref.get()).data()?.state;
    if (final === "approved" || final === "cancelled") return { state: final };
    throw error;
  }
  audit("mutation_applied:" + name, uid, row.clientId);
  return { state: "approved" };
}
