import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
  check,
  uuid,
  smallint,
  real,
  integer,
  unique,
  jsonb,
  doublePrecision,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const migrations = pgTable("migrations", {
  name: text().primaryKey().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const topics = pgTable(
  "topics",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    title: text().notNull(),
    initialKnowledge: smallint("initial_knowledge"),
    importance: smallint(),
    targetRetention: real("target_retention").notNull(),
    duration: integer().notNull(),
    status: text().default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    uniqueIndex("topics_creation_key")
      .using(
        "btree",
        table.userId.asc().nullsLast(),
        table.idempotencyKey.asc().nullsLast(),
      )
      .where(sql`(idempotency_key IS NOT NULL)`),
    index("topics_user").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "topics_user_id_fkey",
    }).onDelete("cascade"),
    check(
      "topics_title_check",
      sql`(length(title) >= 1) AND (length(title) <= 200)`,
    ),
    check(
      "topics_initial_knowledge_check",
      sql`(initial_knowledge >= 1) AND (initial_knowledge <= 5)`,
    ),
    check(
      "topics_importance_check",
      sql`(importance >= 1) AND (importance <= 5)`,
    ),
    check(
      "topics_target_retention_check",
      sql`(target_retention >= (0.8)::double precision) AND (target_retention <= (0.97)::double precision)`,
    ),
    check("topics_duration_check", sql`(duration >= 5) AND (duration <= 180)`),
    check(
      "topics_status_check",
      sql`status = ANY (ARRAY['active'::text, 'archived'::text])`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    googleSub: text("google_sub").notNull(),
    email: text().notNull(),
    displayName: text("display_name").notNull(),
    timezone: text().default("UTC").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [unique("users_google_sub_key").on(table.googleSub)],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id").primaryKey().notNull(),
    settings: jsonb().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_preferences_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    csrf: text().notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    index("sessions_expiry").using("btree", table.expiresAt.asc().nullsLast()),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: text().primaryKey().notNull(),
    kind: text().notNull(),
    userId: uuid("user_id"),
    nonce: text().notNull(),
    verifier: text().notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "oauth_states_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const topicMaterials = pgTable(
  "topic_materials",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    topicId: uuid("topic_id").notNull(),
    text: text().notNull(),
    url: text(),
    position: integer().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [topics.id],
      name: "topic_materials_topic_id_fkey",
    }).onDelete("cascade"),
    unique("topic_materials_topic_id_position_key").on(
      table.topicId,
      table.position,
    ),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    name: text().notNull(),
    normalized: text().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "tags_user_id_fkey",
    }).onDelete("cascade"),
    unique("tags_user_id_normalized_key").on(table.userId, table.normalized),
  ],
);

export const memoryStates = pgTable(
  "memory_states",
  {
    topicId: uuid("topic_id").primaryKey().notNull(),
    card: jsonb(),
    stability: doublePrecision(),
    difficulty: doublePrecision(),
    algorithmVersion: text("algorithm_version").notNull(),
    parameters: jsonb().notNull(),
    reviewCount: integer("review_count").default(0).notNull(),
    lastReviewAt: timestamp("last_review_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [topics.id],
      name: "memory_states_topic_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const reviewSchedules = pgTable(
  "review_schedules",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    topicId: uuid("topic_id").notNull(),
    idealDueAt: timestamp("ideal_due_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    scheduledAt: timestamp("scheduled_at", {
      withTimezone: true,
      mode: "string",
    }),
    duration: integer().notNull(),
    mode: text().default("automatic").notNull(),
    status: text().default("pending").notNull(),
    adjustmentReason: text("adjustment_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("one_pending_topic")
      .using("btree", table.topicId.asc().nullsLast())
      .where(sql`(status = 'pending'::text)`),
    index("schedule_due")
      .using("btree", table.scheduledAt.asc().nullsLast())
      .where(sql`(status = 'pending'::text)`),
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [topics.id],
      name: "review_schedules_topic_id_fkey",
    }).onDelete("cascade"),
    check(
      "review_schedules_mode_check",
      sql`mode = ANY (ARRAY['automatic'::text, 'manual'::text])`,
    ),
    check(
      "review_schedules_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])`,
    ),
  ],
);

export const reviewLogs = pgTable(
  "review_logs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    topicId: uuid("topic_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    originalRating: smallint("original_rating").notNull(),
    mappedRating: smallint("mapped_rating").notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    previousState: jsonb("previous_state"),
    newState: jsonb("new_state").notNull(),
    fsrsLog: jsonb("fsrs_log").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    parameters: jsonb().notNull(),
    correctedAt: timestamp("corrected_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [topics.id],
      name: "review_logs_topic_id_fkey",
    }),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [reviewSchedules.id],
      name: "review_logs_schedule_id_fkey",
    }),
    unique("review_logs_schedule_id_key").on(table.scheduleId),
    check(
      "review_logs_original_rating_check",
      sql`(original_rating >= 1) AND (original_rating <= 5)`,
    ),
  ],
);

export const reviewCorrections = pgTable(
  "review_corrections",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reviewId: uuid("review_id").notNull(),
    oldRating: smallint("old_rating").notNull(),
    newRating: smallint("new_rating").notNull(),
    oldState: jsonb("old_state").notNull(),
    correctedAt: timestamp("corrected_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.reviewId],
      foreignColumns: [reviewLogs.id],
      name: "review_corrections_review_id_fkey",
    }),
  ],
);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    userId: uuid("user_id").primaryKey().notNull(),
    calendarId: text("calendar_id"),
    encryptedTokens: text("encrypted_tokens").notNull(),
    scopes: text().notNull(),
    syncToken: text("sync_token"),
    channelId: text("channel_id"),
    channelToken: text("channel_token"),
    resourceId: text("resource_id"),
    channelExpiresAt: timestamp("channel_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    connected: boolean().default(true).notNull(),
    lastSyncAt: timestamp("last_sync_at", {
      withTimezone: true,
      mode: "string",
    }),
    error: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "calendar_connections_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    scheduleId: uuid("schedule_id").primaryKey().notNull(),
    googleEventId: text("google_event_id").notNull(),
    etag: text(),
    syncStatus: text("sync_status").default("pending").notNull(),
    deletionCount: integer("deletion_count").default(0).notNull(),
    lastDeletedAt: timestamp("last_deleted_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [reviewSchedules.id],
      name: "calendar_events_schedule_id_fkey",
    }),
    unique("calendar_events_google_event_id_key").on(table.googleEventId),
  ],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    type: text().notNull(),
    payload: jsonb().default({}).notNull(),
    status: text().default("pending").notNull(),
    attempts: integer().default(0).notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    idempotencyKey: text("idempotency_key").notNull(),
    error: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("jobs_ready").using(
      "btree",
      table.status.asc().nullsLast(),
      table.retryAt.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sync_jobs_user_id_fkey",
    }).onDelete("cascade"),
    unique("sync_jobs_idempotency_key_key").on(table.idempotencyKey),
    check(
      "sync_jobs_status_check",
      sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])`,
    ),
  ],
);

export const topicTags = pgTable(
  "topic_tags",
  {
    topicId: uuid("topic_id").notNull(),
    tagId: uuid("tag_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.topicId],
      foreignColumns: [topics.id],
      name: "topic_tags_topic_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tagId],
      foreignColumns: [tags.id],
      name: "topic_tags_tag_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.topicId, table.tagId],
      name: "topic_tags_pkey",
    }),
  ],
);
