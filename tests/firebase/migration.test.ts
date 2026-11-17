import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auth, db } from "../../functions/src/store.ts";
const run = promisify(execFile);
it("migration dry-run preserves NULL ratings, ordered materials and refuses overwrites", async () => {
  const uid = "migration-" + crypto.randomUUID(),
    old = "postgres-user",
    topic = "topic";
  const dir = await mkdtemp(join(tmpdir(), "blindspot-migration-"));
  const source = join(dir, "export.json"),
    mapping = join(dir, "uids.json");
  await auth.createUser({ uid });
  const data = {
    users: [
      {
        id: old,
        email: "migration@example.invalid",
        display_name: "Migrated",
        timezone: "UTC",
      },
    ],
    user_preferences: [],
    topics: [
      {
        id: topic,
        user_id: old,
        title: "Imported",
        initial_knowledge: null,
        importance: null,
        duration: 15,
        status: "active",
      },
    ],
    topic_materials: [
      { topic_id: topic, text: "second", url: null, position: 1 },
      { topic_id: topic, text: "first", url: null, position: 0 },
    ],
    tags: [],
    topic_tags: [],
    memory_states: [{ topic_id: topic, card: null, review_count: 0 }],
    review_logs: [],
    review_schedules: [
      {
        id: "schedule",
        topic_id: topic,
        status: "pending",
        ideal_due_at: "2026-12-01T09:00:00.000Z",
        scheduled_at: "2026-12-01T09:00:00.000Z",
        duration: 15,
        mode: "automatic",
      },
    ],
    review_corrections: [],
    calendar_connections: [
      { user_id: old, calendar_id: "existing-app-calendar" },
    ],
    calendar_events: [
      {
        schedule_id: "schedule",
        google_event_id: "existing-event",
        etag: "etag",
        sync_status: "synced",
      },
    ],
  };
  await writeFile(
    source,
    JSON.stringify({ format: "blind-spot-postgres-v1", data }),
    { mode: 0o600 },
  );
  await writeFile(mapping, JSON.stringify({ [old]: uid }), { mode: 0o600 });
  const args = [
    "--import",
    "tsx",
    "scripts/migrate-postgres-to-firestore.ts",
    "import",
    "--file",
    source,
    "--uid-map",
    mapping,
  ];
  try {
    const dry = await run(process.execPath, args, { timeout: 15000 });
    expect(dry.stdout).toContain("Dry run only");
    expect((await db.doc("users/" + uid).get()).exists).toBe(false);
    await run(process.execPath, [...args, "--apply"], { timeout: 15000 });
    const imported = (
      await db.doc(`users/${uid}/topics/${topic}`).get()
    ).data()!;
    expect(imported.initial_knowledge).toBeNull();
    expect(imported.importance).toBeNull();
    expect(imported.pendingScheduleId).toBe("schedule");
    const connection = (
      await db.doc(`calendarConnections/${uid}`).get()
    ).data()!;
    expect(connection.calendar_id).toBe("existing-app-calendar");
    expect(connection.connected).toBe(false);
    expect(connection.encrypted_tokens).toBe("");
    expect(
      (await db.doc(`users/${uid}/calendarEvents/schedule`).get()).data()!
        .google_event_id,
    ).toBe("existing-event");
    expect(
      (await db.doc(`users/${uid}/topicMaterials/${topic}`).get())
        .data()!
        .items.map((m: any) => m.text),
    ).toEqual(["first", "second"]);
    await expect(
      run(process.execPath, [...args, "--apply"], { timeout: 15000 }),
    ).rejects.toThrow();
    await expect(
      run(process.execPath, [...args, "--apply"], {
        env: { ...process.env, GCLOUD_PROJECT: "production-project" },
      }),
    ).rejects.toThrow();
  } finally {
    await db.recursiveDelete(db.doc("users/" + uid));
    await auth.deleteUser(uid);
    await db.doc(`calendarConnections/${uid}`).delete();
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
