import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
export const sql = postgres(
  process.env.DATABASE_URL ??
    "postgres://blindspot:blindspot@localhost:5432/blindspot",
  { max: 10, transform: { undefined: null } },
);
// Drizzle installs JSON pass-through serializers; keep its client separate from tagged SQL.
export const db = drizzle(
  postgres(
    process.env.DATABASE_URL ??
      "postgres://blindspot:blindspot@localhost:5432/blindspot",
    { max: 1 },
  ),
);
export type SQL = typeof sql;

export async function closeDatabase() {
  await Promise.all([sql.end(), db.$client.end()]);
}
