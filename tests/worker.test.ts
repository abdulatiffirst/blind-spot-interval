import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { sql, closeDatabase } from "../packages/database/src/index.ts";
import { random } from "../apps/api/src/security.ts";
it("a dedicated worker consumes a committed offline outbox job", async () => {
  const [user] =
    await sql`INSERT INTO users(google_sub,email,display_name) VALUES(${random()},'worker@example.invalid','Worker Test') RETURNING id`;
  const [job] =
    await sql`INSERT INTO sync_jobs(user_id,type,idempotency_key) VALUES(${user.id},'outbound',${random()}) RETURNING id`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/worker/src/index.ts"],
    { stdio: "ignore", env: { ...process.env } },
  );
  try {
    let status = "";
    for (let i = 0; i < 100; i++) {
      const [row] = await sql`SELECT status FROM sync_jobs WHERE id=${job.id}`;
      status = row.status;
      if (status === "done") break;
      if (child.exitCode !== null)
        throw new Error("Worker exited before consuming job");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("done");
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    await sql`DELETE FROM users WHERE id=${user.id}`;
    await closeDatabase();
  }
}, 20000);
