import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { sql } from "../../../packages/database/src/index.ts";
import {
  preferencesInput,
  rating,
  topicInput,
} from "../../../packages/shared/src/index.ts";
import { coldStart } from "../../../packages/memory-engine/src/index.ts";
import { schedule } from "../../../packages/calendar-scheduler/src/index.ts";
import * as service from "./service.ts";
import * as google from "./google.ts";
import { appOrigin, hash, random } from "./security.ts";
import { DateTime } from "luxon";
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    csrf: string;
  }
}
export async function buildApp() {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        'res.headers["set-cookie"]',
      ],
    },
    disableRequestLogging: true,
    bodyLimit: 300000,
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(rateLimit, { max: 150, timeWindow: "1 minute" });
  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "Invalid input", details: e.issues });
    const status = e.statusCode ?? (e.code === "22P02" ? 400 : 500);
    if (status === 500)
      app.log.error({ code: e.code, name: e.name }, "Internal request failure");
    return reply
      .code(status)
      .send({ error: status === 500 ? "Internal server error" : e.message });
  });
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (
      path === "/health" ||
      path.startsWith("/api/v1/auth/google/") ||
      path === "/api/v1/webhooks/google-calendar"
    )
      return;
    const session = req.cookies.bs_session;
    if (!session) return reply.code(401).send({ error: "Sign in to continue" });
    const [row] =
      await sql`SELECT user_id,csrf FROM sessions WHERE id=${hash(session)} AND expires_at>now()`;
    if (!row) return reply.code(401).send({ error: "Session expired" });
    req.userId = row.user_id;
    req.csrf = row.csrf;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers["x-csrf-token"] !== row.csrf ||
        req.headers.origin !== appOrigin())
    )
      return reply.code(403).send({ error: "CSRF validation failed" });
  });
  app.addHook("preValidation", async (req) => {
    const p = req.params as any;
    if (p?.id) z.uuid().parse(p.id);
    if (p?.scheduleId) z.uuid().parse(p.scheduleId);
  });
  app.get("/health", async () => {
    await sql`SELECT 1`;
    return { status: "ok" };
  });
  app.get("/api/v1/auth/google/start", async (_req, reply) => {
    const auth = await google.authorize("login");
    reply.setCookie("bs_oauth", auth.state, {
      path: "/api/v1",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
    });
    return reply.redirect(auth.url);
  });
  app.get("/api/v1/auth/google/callback", async (req, reply) => {
    const q = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    const user = await google.finish(
      "login",
      q.code,
      q.state,
      req.cookies.bs_oauth,
    );
    const session = random(),
      csrf = random();
    await sql`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(${hash(session)},${user!.id},${csrf},now()+interval '30 days')`;
    reply.clearCookie("bs_oauth", { path: "/api/v1" });
    reply.setCookie("bs_session", session, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 86400,
    });
    return reply.redirect(appOrigin());
  });
  app.post("/api/v1/auth/logout", async (req, reply) => {
    await sql`DELETE FROM sessions WHERE id=${hash(req.cookies.bs_session!)}`;
    reply.clearCookie("bs_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/v1/me", async (req) => {
    const [user] =
      await sql`SELECT id,email,display_name,timezone FROM users WHERE id=${req.userId}`;
    return { user, csrf: req.csrf };
  });
  app.get("/api/v1/preferences", (req) => service.preferences(req.userId));
  app.patch("/api/v1/preferences", async (req) => {
    const p = preferencesInput.parse(req.body);
    await sql.begin(async (tx) => {
      await service.lock(tx, req.userId);
      await tx`INSERT INTO user_preferences(user_id,settings) VALUES(${req.userId},${tx.json(p)}) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings`;
      await tx`UPDATE users SET timezone=${p.timezone} WHERE id=${req.userId}`;
      await tx`UPDATE topics SET target_retention=(${tx.json(p.retention)}::jsonb->>(COALESCE(importance,3)-1))::real WHERE user_id=${req.userId}`;
      await service.enqueue(tx, req.userId);
    });
    return p;
  });
  app.get("/api/v1/topics", async (req) => {
    const q = z
      .object({
        archived: z.enum(["true", "false"]).optional(),
        q: z.string().max(200).optional(),
        tag: z.string().max(40).optional(),
        sort: z.enum(["date", "title", "importance"]).default("date"),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    return service.listTopics(req.userId, q.archived === "true", q);
  });
  app.post("/api/v1/topics", async (req, reply) =>
    reply
      .code(201)
      .send(
        await service.createTopic(
          req.userId,
          topicInput.parse(req.body),
          z.string().max(100).optional().parse(req.headers["idempotency-key"]),
        ),
      ),
  );
  app.get("/api/v1/topics/:id", (req) =>
    service.details(req.userId, (req.params as any).id),
  );
  app.patch("/api/v1/topics/:id", async (req) => {
    const id = (req.params as any).id,
      old = await service.details(req.userId, id);
    const update = topicInput.partial().parse(req.body);
    return service.editTopic(
      req.userId,
      id,
      topicInput.parse({
        title: old.title,
        initialKnowledge: old.initial_knowledge,
        importance: old.importance,
        duration: old.duration,
        tags: old.tags,
        materials: old.materials.map((m) => m.text),
        ...update,
      }),
    );
  });
  app.post("/api/v1/topics/:id/archive", async (req) => {
    await service.archive(req.userId, (req.params as any).id);
    return { ok: true };
  });
  app.post("/api/v1/topics/:id/restore", async (req) => {
    await service.archive(req.userId, (req.params as any).id, true);
    return { ok: true };
  });
  app.put("/api/v1/topics/:id/materials", async (req) => {
    const id = (req.params as any).id,
      old = await service.details(req.userId, id);
    const items = z
      .object({ materials: topicInput.shape.materials })
      .parse(req.body);
    return service.editTopic(req.userId, id, {
      title: old.title,
      initialKnowledge: old.initial_knowledge,
      importance: old.importance,
      duration: old.duration,
      tags: old.tags,
      ...items,
    });
  });
  app.get("/api/v1/topics/:id/history", async (req) => {
    const id = (req.params as any).id;
    await service.owned(req.userId, id);
    return sql`SELECT * FROM review_logs WHERE topic_id=${id} ORDER BY completed_at DESC LIMIT 100`;
  });
  app.get(
    "/api/v1/tags",
    (req) =>
      sql`SELECT name FROM tags WHERE user_id=${req.userId} ORDER BY name`,
  );
  async function reviews(user: string, today: boolean) {
    const p = await service.preferences(user);
    const end = DateTime.now().setZone(p.timezone).endOf("day").toJSDate();
    return sql`SELECT s.*,t.title,t.importance FROM review_schedules s JOIN topics t ON t.id=s.topic_id WHERE t.user_id=${user} AND s.status='pending' AND (${!today} OR s.scheduled_at<=${end}) ORDER BY s.scheduled_at NULLS LAST `;
  }
  app.get("/api/v1/reviews/progress", async (req) => {
    const p = await service.preferences(req.userId),
      start = DateTime.now().setZone(p.timezone).startOf("day").toJSDate(),
      end = DateTime.now().setZone(p.timezone).endOf("day").toJSDate();
    const [r] =
      await sql`SELECT count(*)::int AS completed FROM review_logs l JOIN topics t ON t.id=l.topic_id WHERE t.user_id=${req.userId} AND l.completed_at BETWEEN ${start} AND ${end}`;
    return r;
  });
  app.get("/api/v1/reviews/today", (req) => reviews(req.userId, true));
  app.get("/api/v1/reviews/upcoming", (req) => reviews(req.userId, false));
  app.post("/api/v1/reviews/:scheduleId/complete", (req) =>
    service.complete(
      req.userId,
      (req.params as any).scheduleId,
      z.object({ rating }).parse(req.body).rating,
    ),
  );
  app.post("/api/v1/reviews/:scheduleId/correct", (req) =>
    service.complete(
      req.userId,
      (req.params as any).scheduleId,
      z.object({ rating }).parse(req.body).rating,
      true,
    ),
  );
  app.patch("/api/v1/reviews/:scheduleId/schedule", async (req) => {
    const q = z
      .object({
        scheduledAt: z.iso
          .datetime({ offset: true })
          .refine((v) => Date.parse(v) > Date.now(), "Choose a future time"),
      })
      .parse(req.body);
    await service.reschedule(
      req.userId,
      (req.params as any).scheduleId,
      new Date(q.scheduledAt),
    );
    return { ok: true };
  });
  app.post("/api/v1/reviews/:scheduleId/reset-auto", async (req) => {
    await service.reschedule(req.userId, (req.params as any).scheduleId);
    return { ok: true };
  });
  app.get("/api/v1/schedule/preview", async (req) => {
    const q = z
        .object({
          knowledge: z.coerce.number().int().min(1).max(5).optional(),
          importance: z.coerce.number().int().min(1).max(5).optional(),
          duration: z.coerce.number().int().min(5).max(180).default(15),
        })
        .parse(req.query),
      p = await service.preferences(req.userId),
      ideal = coldStart(new Date(), q.knowledge ?? null, p.timezone);
    return {
      ideal,
      retention: p.retention[(q.importance ?? 3) - 1],
      ...schedule({
        ideal,
        now: new Date(),
        duration: q.duration,
        preferences: p,
        busy: await service.availability(req.userId),
      }),
    };
  });
  app.get("/api/v1/calendar/connect", async (req, reply) => {
    const auth = await google.authorize("calendar", req.userId);
    reply.setCookie("bs_calendar_oauth", auth.state, {
      path: "/api/v1",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
    });
    return reply.redirect(auth.url);
  });
  app.get("/api/v1/calendar/callback", async (req, reply) => {
    const q = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    await google.finish(
      "calendar",
      q.code,
      q.state,
      req.cookies.bs_calendar_oauth,
      req.userId,
    );
    reply.clearCookie("bs_calendar_oauth", { path: "/api/v1" });
    return reply.redirect(appOrigin() + "/?section=Calendar");
  });
  app.get("/api/v1/calendar/status", async (req) => {
    const [c] =
      await sql`SELECT connected,calendar_id,last_sync_at,error,channel_expires_at FROM calendar_connections WHERE user_id=${req.userId}`;
    return c ?? { connected: false };
  });
  app.post("/api/v1/calendar/disconnect", async (req) => {
    await sql`UPDATE calendar_connections SET connected=false,encrypted_tokens='',channel_token=null WHERE user_id=${req.userId}`;
    return { ok: true };
  });
  app.post("/api/v1/calendar/resync", async (req) => {
    await sql`UPDATE calendar_connections SET sync_token=null WHERE user_id=${req.userId}`;
    await sql`UPDATE calendar_events e SET google_event_id='b'||replace(gen_random_uuid()::text,'-',''),etag=null,sync_status='pending',deletion_count=0,last_deleted_at=null FROM review_schedules s,topics t WHERE e.schedule_id=s.id AND s.topic_id=t.id AND t.user_id=${req.userId} AND s.status='pending' AND e.sync_status='blocked'`;
    await service.enqueue(sql, req.userId, "inbound");
    return { ok: true };
  });
  app.post("/api/v1/webhooks/google-calendar", async (req, reply) => {
    const id = String(req.headers["x-goog-channel-id"] ?? ""),
      token = String(req.headers["x-goog-channel-token"] ?? ""),
      resource = String(req.headers["x-goog-resource-id"] ?? "");
    const [c] =
      await sql`SELECT user_id,resource_id FROM calendar_connections WHERE channel_id=${id} AND channel_token=${hash(token)} AND connected`;
    if (!c || !resource || (c.resource_id && c.resource_id !== resource))
      return reply.code(403).send({ error: "Invalid webhook channel" });
    const number = String(req.headers["x-goog-message-number"] ?? "");
    if (!/^\d+$/.test(number))
      return reply.code(400).send({ error: "Invalid message number" });
    await service.enqueue(sql, c.user_id, "inbound", `webhook:${id}:${number}`);
    return reply.code(204).send();
  });
  return app;
}
