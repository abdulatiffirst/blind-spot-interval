import "dotenv/config";
import { sql, closeDatabase } from "../../../packages/database/src/index.ts";
import {
  inbound,
  outbound,
  refreshAvailability,
  renewWatch,
} from "../../api/src/google.ts";
import { enqueue } from "../../api/src/service.ts";
let stopped = false;
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () => {
    stopped = true;
  });
let reconcile = 0;
while (!stopped) {
  try {
    if (Date.now() - reconcile > 300000) {
      const connections =
        await sql`SELECT user_id FROM calendar_connections WHERE connected`;
      for (const c of connections)
        await enqueue(
          sql,
          c.user_id,
          "reconcile",
          `reconcile:${c.user_id}:${Math.floor(Date.now() / 300000)}`,
        );
      await sql`DELETE FROM oauth_states WHERE expires_at<now()`;
      await sql`DELETE FROM sessions WHERE expires_at<now()`;
      reconcile = Date.now();
    }
    const [job] =
      await sql`UPDATE sync_jobs SET status='running',locked_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM sync_jobs WHERE ((status='pending' AND retry_at<=now()) OR (status='running' AND locked_at<now()-interval '10 minutes')) AND NOT EXISTS(SELECT 1 FROM sync_jobs other WHERE other.user_id=sync_jobs.user_id AND other.status='running' AND other.locked_at>=now()-interval '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    if (!job) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    try {
      await sql.reserve().then(async (connection) => {
        try {
          await connection`SELECT pg_advisory_lock(hashtextextended(${job.user_id},1))`;
          if (job.type !== "outbound") await inbound(job.user_id);
          await refreshAvailability(job.user_id);
          await outbound(job.user_id);
          await renewWatch(job.user_id);
        } finally {
          await connection`SELECT pg_advisory_unlock(hashtextextended(${job.user_id},1))`;
          connection.release();
        }
      });
      await sql`UPDATE sync_jobs SET status='done',error=null WHERE id=${job.id}`;
    } catch (e: any) {
      const retry = new Date(
        Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)),
      );
      const error = String(e.message).slice(0, 200);
      await sql`UPDATE sync_jobs SET status=${job.attempts >= 10 ? "failed" : "pending"},retry_at=${retry},error=${error} WHERE id=${job.id}`;
      await sql`UPDATE calendar_connections SET error=${error} WHERE user_id=${job.user_id}`;
      console.error("Calendar job failed", {
        id: job.id,
        attempt: job.attempts,
        error,
      });
    }
  } catch {
    console.error("Worker database operation failed");
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await closeDatabase();
