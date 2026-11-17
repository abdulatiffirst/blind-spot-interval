import { readFile, readdir } from "node:fs/promises";
import { sql, closeDatabase } from "./src/index.ts";
const folder = new URL("./migrations/", import.meta.url);
await sql.begin(async (tx) => {
  await tx`SELECT pg_advisory_xact_lock(987653)`;
  await tx`CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  for (const file of (await readdir(folder))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const name = file.replace(/\.sql$/, "");
    if (!(await tx`SELECT 1 FROM migrations WHERE name=${name}`).length) {
      await tx.unsafe(await readFile(new URL(file, folder), "utf8"));
      await tx`INSERT INTO migrations(name) VALUES(${name})`;
    }
  }
});
await closeDatabase();
console.log("Migrations applied");
