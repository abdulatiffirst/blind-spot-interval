import "dotenv/config";
import { buildApp } from "./app.ts";
import { closeDatabase } from "../../../packages/database/src/index.ts";
const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await closeDatabase();
    process.exit(0);
  });
