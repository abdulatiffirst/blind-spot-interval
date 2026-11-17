import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    "uid-map": { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
if (!values.file)
  throw new Error(
    "Pass --file with a private export path outside the checkout",
  );
const tables = [
  "users",
  "user_preferences",
  "topics",
  "topic_materials",
  "tags",
  "topic_tags",
  "memory_states",
  "review_logs",
  "review_schedules",
  "review_corrections",
  "calendar_events",
];
if (positionals[0] === "export") {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL explicitly for read-only PostgreSQL export",
    );
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL);
  try {
    const data = await sql.begin("read only", async (tx) => {
      const out: Record<string, unknown> = {};
      for (const table of tables)
        out[table] = await tx.unsafe("SELECT * FROM " + table);
      out.calendar_connections =
        await tx`SELECT user_id,calendar_id FROM calendar_connections`;
      return out;
    });
    await writeFile(
      values.file,
      JSON.stringify(
        {
          format: "blind-spot-postgres-v1",
          exportedAt: new Date().toISOString(),
          data,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Export created. OAuth grants, cookies and jobs were deliberately excluded. Protect this file as personal data.",
    );
  } finally {
    await sql.end();
  }
} else if (positionals[0] === "import") {
  if (!values["uid-map"])
    throw new Error(
      "Pass --uid-map mapping each PostgreSQL user UUID to its Firebase Auth UID",
    );
  const file = JSON.parse(await readFile(values.file, "utf8"));
  if (file.format !== "blind-spot-postgres-v1")
    throw new Error("Unknown export format");
  const mapping: Record<string, string> = JSON.parse(
    await readFile(values["uid-map"], "utf8"),
  );
  if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
    throw new Error("UID mapping must be one-to-one");
  const data = file.data as Record<string, any[]>;
  const records: { uid: string; path: string; data: any }[] = [];
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  for (const user of data.users) {
    const uid = mapping[user.id];
    if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))
      throw new Error(
        "Every exported user needs an explicit Firebase UID mapping",
      );
    const topicIds = new Set(
      data.topics.filter((t) => t.user_id === user.id).map((t) => t.id),
    );
    const add = (name: string, id: string, value: any) =>
      records.push({ uid, path: `users/${uid}/${name}/${id}`, data: value });
    records.push({
      uid,
      path: `users/${uid}`,
      data: { ...user, id: uid, legacy_postgres_id: user.id, revision: 0 },
    });
    const connection = (data.calendar_connections ?? []).find(
      (c) => c.user_id === user.id,
    );
    if (connection?.calendar_id)
      records.push({
        uid,
        path: `calendarConnections/${uid}`,
        data: {
          uid,
          calendar_id: connection.calendar_id,
          connected: false,
          encrypted_tokens: "",
          generation: 0,
          error: null,
        },
      });
    const { defaults } = await import("../packages/shared/src/index.ts");
    add(
      "preferences",
      "default",
      data.user_preferences.find((p) => p.user_id === user.id)?.settings ??
        defaults,
    );
    for (const tag of data.tags.filter((t) => t.user_id === user.id))
      add("tags", digest(tag.normalized), {
        name: tag.name,
        normalized: tag.normalized,
      });
    for (const topic of data.topics.filter((t) => topicIds.has(t.id))) {
      const schedules = data.review_schedules.filter(
          (s) => s.topic_id === topic.id,
        ),
        pending = schedules.filter((s) => s.status === "pending");
      if (pending.length > 1)
        throw new Error(
          "Source contains multiple pending reviews for one topic",
        );
      const tags = data.topic_tags
        .filter((t) => t.topic_id === topic.id)
        .map((t) => data.tags.find((tag) => tag.id === t.tag_id)?.name)
        .filter(Boolean);
      add("topics", topic.id, {
        ...topic,
        user_id: uid,
        tags,
        pendingScheduleId: pending[0]?.id ?? null,
      });
      add("topicMaterials", topic.id, {
        topic_id: topic.id,
        items: data.topic_materials
          .filter((m) => m.topic_id === topic.id)
          .sort((a, b) => a.position - b.position)
          .map(({ text, url, position }) => ({ text, url, position })),
      });
      const history = data.review_logs
        .filter((l) => l.topic_id === topic.id)
        .sort((a, b) => a.completed_at.localeCompare(b.completed_at));
      const memory = data.memory_states.find((m) => m.topic_id === topic.id);
      if (memory)
        add("memoryStates", topic.id, {
          ...memory,
          latestReviewId: history.at(-1)?.schedule_id ?? null,
        });
      for (const s of schedules) {
        add("reviewSchedules", s.id, {
          ...s,
          recovery:
            s.status === "pending" &&
            !!history.length &&
            history.at(-1)!.original_rating <= 2,
        });
        const event = (data.calendar_events ?? []).find(
          (e) => e.schedule_id === s.id,
        );
        if (event) add("calendarEvents", s.id, event);
      }
      for (const h of history)
        add("reviewHistory", h.schedule_id, { ...h, id: h.schedule_id });
      for (const c of data.review_corrections.filter((c) =>
        history.some((h) => h.id === c.review_id),
      ))
        add("reviewCorrections", c.id, {
          ...c,
          review_id: history.find((h) => h.id === c.review_id)!.schedule_id,
        });
    }
  }
  console.log(
    `Validated ${records.length} documents for ${data.users.length} explicitly mapped users. ${values.apply ? "Applying to demo emulator." : "Dry run only; pass --apply to write to the demo emulator."}`,
  );
  if (values.apply) {
    if (
      process.env.GCLOUD_PROJECT !== "demo-blind-spot-interval" ||
      process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    )
      throw new Error(
        "Writes are restricted to the explicit demo emulators. Production import requires a separately approved migration.",
      );
    const { db, auth } = await import("../functions/src/store.ts");
    for (const uid of new Set(records.map((r) => r.uid))) {
      await auth.getUser(uid);
      const owner = records.filter((r) => r.uid === uid);
      if (owner.length > 450)
        throw new Error(
          "User export exceeds atomic import limit; implement a reviewed chunked migration first",
        );
      // Atomic create preconditions reject an existing destination without acquiring
      // pessimistic read locks on a whole imported document tree.
      const batch = db.batch();
      for (const record of owner)
        batch.create(db.doc(record.path), record.data);
      await batch.commit();
    }
    console.log(
      "Demo import complete; Calendar must be reconnected separately.",
    );
    await db.terminate();
  }
} else throw new Error("Use export or import");
