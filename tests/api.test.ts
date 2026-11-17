import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { buildApp } from "../apps/api/src/app.ts";
import { sql, closeDatabase } from "../packages/database/src/index.ts";
import { hash, random } from "../apps/api/src/security.ts";
import { defaults } from "../packages/shared/src/index.ts";
let app: Awaited<ReturnType<typeof buildApp>>, topic: any;
const users: string[] = [],
  token = random(),
  csrf = random();
const headers = {
  cookie: `bs_session=${token}`,
  origin: "http://localhost:5173",
  "x-csrf-token": csrf,
};
beforeAll(async () => {
  app = await buildApp();
  for (let i = 0; i < 2; i++) {
    const [u] =
      await sql`INSERT INTO users(google_sub,email,display_name) VALUES(${random()},'test@example.invalid','Test Learner') RETURNING id`;
    users.push(u.id);
  }
  await sql`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(${hash(token)},${users[0]},${csrf},now()+interval '1 hour')`;
});
afterAll(async () => {
  await sql`DELETE FROM review_corrections WHERE review_id IN (SELECT r.id FROM review_logs r JOIN topics t ON t.id=r.topic_id WHERE t.user_id IN ${sql(users)})`;
  await sql`DELETE FROM review_logs WHERE topic_id IN (SELECT id FROM topics WHERE user_id IN ${sql(users)})`;
  await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
  await app.close();
  await closeDatabase();
});
async function request(
  url: string,
  method: any = "GET",
  payload?: any,
  h = headers,
) {
  return app.inject({ url: "/api/v1" + url, method, payload, headers: h });
}
describe("PostgreSQL-backed API", () => {
  it("rejects unauthorized and forged-CSRF requests", async () => {
    expect((await request("/me", "GET", undefined, {} as any)).statusCode).toBe(
      401,
    );
    expect(
      (
        await request(
          "/topics",
          "POST",
          { title: "x" },
          { ...headers, "x-csrf-token": "bad" },
        )
      ).statusCode,
    ).toBe(403);
  });
  it("validates topic names and optional ratings", async () => {
    expect((await request("/topics", "POST", { title: " " })).statusCode).toBe(
      400,
    );
    expect(
      (await request("/topics", "POST", { title: "x", initialKnowledge: 0 }))
        .statusCode,
    ).toBe(400);
  });
  it("creates topic with nullable ratings, ordered materials and deduplicated tags", async () => {
    const r = await request("/topics", "POST", {
      title: "Logarithms",
      tags: ["Math", "math"],
      materials: ["First", "https://example.com", "Third"],
    });
    expect(r.statusCode, r.body).toBe(201);
    topic = r.json();
    expect(topic.initial_knowledge).toBeNull();
    expect(topic.importance).toBeNull();
    expect(topic.tags).toEqual(["Math"]);
    expect(topic.materials.map((m: any) => m.text)).toEqual([
      "First",
      "https://example.com",
      "Third",
    ]);
    expect(topic.memory.review_count).toBe(0);
    expect(topic.memory.card).toBeNull();
    expect(topic.schedule.status).toBe("pending");
  });
  it("blocks cross-user access and invalid IDs", async () => {
    const other = random();
    await sql`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(${hash(other)},${users[1]},${csrf},now()+interval '1 hour')`;
    const r = await request("/topics/" + topic.id, "GET", undefined, {
      ...headers,
      cookie: `bs_session=${other}`,
    });
    expect(r.statusCode).toBe(404);
    expect((await request("/topics/not-a-uuid")).statusCode).toBe(400);
  });
  it("preserves memory during manual rescheduling", async () => {
    const r = await request(
      "/reviews/" + topic.schedule.id + "/schedule",
      "PATCH",
      { scheduledAt: new Date(Date.now() + 86400000).toISOString() },
    );
    expect(r.statusCode, r.body).toBe(200);
    const t = (await request("/topics/" + topic.id)).json();
    expect(t.memory).toEqual(topic.memory);
    expect(t.schedule.mode).toBe("manual");
    expect(
      (
        await request(
          "/reviews/" + topic.schedule.id + "/reset-auto",
          "POST",
          {},
        )
      ).statusCode,
    ).toBe(200);
  });
  it("completes exactly once under duplicate concurrent submissions", async () => {
    const results = await Promise.all([
      request("/reviews/" + topic.schedule.id + "/complete", "POST", {
        rating: 2,
      }),
      request("/reviews/" + topic.schedule.id + "/complete", "POST", {
        rating: 2,
      }),
    ]);
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    expect(results.map((r) => r.json().duplicate).sort()).toEqual([
      false,
      true,
    ]);
    const t = (await request("/topics/" + topic.id)).json();
    expect(t.memory.review_count).toBe(1);
    expect(t.schedule.id).not.toBe(topic.schedule.id);
    expect(new Date(t.memory.last_review_at).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    const logs = (await request("/topics/" + topic.id + "/history")).json();
    expect(logs).toHaveLength(1);
    expect(logs[0].original_rating).toBe(2);
    expect(logs[0].mapped_rating).toBe(1);
  });
  it("corrects latest rating with an audit record", async () => {
    const r = await request(
      "/reviews/" + topic.schedule.id + "/correct",
      "POST",
      { rating: 5 },
    );
    expect(r.statusCode, r.body).toBe(200);
    const t = (await request("/topics/" + topic.id)).json();
    expect(t.memory.review_count).toBe(1);
    expect(t.memory.card.reps).toBe(1);
    const [audit] =
      await sql`SELECT * FROM review_corrections WHERE review_id IN(SELECT id FROM review_logs WHERE topic_id=${topic.id})`;
    expect(audit.old_rating).toBe(2);
    expect(audit.new_rating).toBe(5);
  });
  it("archives and restores without deleting history or resetting memory", async () => {
    const before = (await request("/topics/" + topic.id)).json();
    expect(
      (await request("/topics/" + topic.id + "/archive", "POST", {}))
        .statusCode,
    ).toBe(200);
    expect((await request("/topics/" + topic.id)).json().schedule).toBeNull();
    expect(
      (await request("/topics/" + topic.id + "/restore", "POST", {}))
        .statusCode,
    ).toBe(200);
    const after = (await request("/topics/" + topic.id)).json();
    expect(after.memory).toEqual(before.memory);
    expect(
      (await request("/topics/" + topic.id + "/history")).json(),
    ).toHaveLength(1);
  });
  it("saves preferences and applies importance retention independently of difficulty", async () => {
    expect(
      (
        await request("/preferences", "PATCH", {
          ...defaults,
          timezone: "Asia/Tashkent",
          onboarded: true,
        })
      ).statusCode,
    ).toBe(200);
    const before = (await request("/topics/" + topic.id)).json();
    const r = await request("/topics/" + topic.id, "PATCH", {
      importance: 5,
      title: "Logarithms updated",
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().target_retention).toBeCloseTo(0.95);
    expect(r.json().memory.card.difficulty).toBe(before.memory.card.difficulty);
    expect((await request("/topics?q=updated")).json().total).toBe(1);
  });
  it("rejects unconfigured Google and forged webhook calls", async () => {
    if (!process.env.GOOGLE_CLIENT_ID)
      expect((await request("/auth/google/start")).statusCode).toBe(503);
    expect(
      (await request("/webhooks/google-calendar", "POST", {}, {} as any))
        .statusCode,
    ).toBe(403);
  });
});
