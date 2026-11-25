import { FieldPath } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const args = new Set(process.argv.slice(2));
const project = [...args]
  .find((arg) => arg.startsWith("--project="))
  ?.slice(10);
const target = [...args].find((arg) => arg.startsWith("--only="))?.slice(7);
const apply = args.has("--apply");
const repair = args.has("--repair");
if (
  !project ||
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
  !["calendars", "topics"].includes(target ?? "") ||
  args.size !== 2 + Number(apply) + Number(repair)
)
  throw new Error(
    "Use --project=PROJECT --only=calendars|topics [--apply] [--repair]",
  );
if (
  process.env.FIRESTORE_EMULATOR_HOST &&
  (!project.startsWith("demo-") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST))
)
  throw new Error(
    "Emulator backfills require a demo project and a loopback address",
  );
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;
const { db, collection, getByIds } = await import("../functions/src/store.ts");
const { nextReviewSortKey } = await import("../functions/src/domain.ts");

async function* pages(query: FirebaseFirestore.Query) {
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const ordered = query.orderBy(FieldPath.documentId()).limit(150);
    const page = await (last ? ordered.startAfter(last) : ordered).get();
    if (page.empty) return;
    yield page.docs;
    if (page.size < 150) return;
    last = page.docs.at(-1);
  }
}
let visited = 0,
  eligible = 0,
  updated = 0;
try {
  if (target === "calendars") {
    for await (const documents of pages(
      db
        .collection("calendarConnections")
        .where("connected", "==", true)
        .select("nextReconcileAt"),
    )) {
      for (const doc of documents) {
        visited++;
        if (typeof doc.get("nextReconcileAt") === "number") continue;
        eligible++;
        if (!apply) continue;
        const changed = await db.runTransaction(async (tx) => {
          const current = await tx.get(doc.ref);
          if (
            !current.get("connected") ||
            typeof current.get("nextReconcileAt") === "number"
          )
            return false;
          const bucket =
            createHash("sha256").update(doc.id).digest().readUInt32BE() %
            300_000;
          tx.update(doc.ref, {
            nextReconcileAt: Date.now() + bucket,
            repairOutbound: true,
          });
          return true;
        });
        if (changed) updated++;
      }
    }
  } else {
    for await (const owners of pages(
      db.collection("users").select("topicIndexVersion"),
    )) {
      for (const owner of owners) {
        visited++;
        if (!repair && owner.get("topicIndexVersion") === 1) continue;
        eligible++;
        if (!apply) continue;
        for await (const topics of pages(
          collection(owner.id, "topics").select(),
        )) {
          await db.runTransaction(async (tx) => {
            // Share the owner lock with online scheduling writes while resolving each batch.
            if (!(await tx.get(owner.ref)).exists) return;
            const current = await getByIds(
              owner.id,
              "topics",
              topics.map((doc) => doc.id),
              tx,
            );
            const schedules = await getByIds(
              owner.id,
              "reviewSchedules",
              [...current.values()].map((topic) => topic.pendingScheduleId),
              tx,
            );
            for (const topic of current.values()) {
              const pending = schedules.get(topic.pendingScheduleId);
              const nextReviewAt = nextReviewSortKey(
                pending?.status === "pending" ? pending.scheduled_at : null,
              );
              const importanceOrder = topic.importance ?? 3;
              if (
                topic.nextReviewAt !== nextReviewAt ||
                topic.importanceOrder !== importanceOrder
              )
                tx.update(collection(owner.id, "topics").doc(topic.id), {
                  nextReviewAt,
                  importanceOrder,
                });
            }
          });
        }
        // All current writers populate both sort fields for newly created topics.
        await owner.ref.update({ topicIndexVersion: 1 });
        updated++;
      }
    }
  }
  console.log(
    JSON.stringify({ project, target, apply, visited, eligible, updated }),
  );
} finally {
  await db.terminate();
}
