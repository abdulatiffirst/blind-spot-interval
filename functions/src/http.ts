import express from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { auth, db, all, fail } from "./store.ts";
import * as domain from "./domain.ts";
import * as calendar from "./calendar.ts";
import { mountAccount, mountPublic } from "./connect/server.ts";
import { config, type Config } from "./connect/oauth.ts";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const cookie = (text: string | undefined, name: string) =>
  text
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
function safe(fn: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
export function createApp() {
  const app = express();
  let connect: Config | null = null;
  try {
    connect = config();
  } catch {
    console.error(
      "Blind Spot Connect disabled because its configuration is invalid",
    );
  }
  app.disable("x-powered-by");
  app.use(express.json({ limit: "300kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    const connectRequest =
      req.path === "/api/mcp" ||
      req.path.startsWith("/api/v1/connect/") ||
      ["/authorize", "/token", "/revoke", "/register"].includes(req.path) ||
      req.path.startsWith("/.well-known/oauth-");
    const firstParty = connectRequest ? connect?.origin : undefined;
    if (origin && origin !== (firstParty ?? calendar.origin()))
      return res.status(403).json({ error: "Origin not allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,Idempotency-Key,Mcp-Protocol-Version,Mcp-Method,Mcp-Name,Mcp-Session-Id,Last-Event-ID",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,PUT,OPTIONS",
      );
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  mountPublic(app, connect);
  app.get(
    "/health",
    safe(async (_req, res) => {
      await db.collection("_health").limit(1).get();
      res.json({ status: "ok", backend: "firebase" });
    }),
  );
  app.get(
    "/api/v1/calendar/callback",
    safe(async (req, res) => {
      const q = z
        .object({ code: z.string().max(10000), state: z.string().max(200) })
        .parse(req.query);
      await calendar.finish(
        q.code,
        q.state,
        cookie(req.headers.cookie, "__session"),
      );
      res.clearCookie("__session", { path: "/api/v1" });
      res.redirect(calendar.origin() + "/?section=Calendar");
    }),
  );
  app.post(
    "/api/v1/webhooks/google-calendar",
    safe(async (req, res) => {
      await calendar.webhook(req.headers);
      res.sendStatus(204);
    }),
  );
  app.use(
    "/api/v1",
    safe(async (req, res, next) => {
      try {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer "))
          return res.status(401).json({ error: "Sign in to continue" });
        let decoded;
        try {
          decoded = await auth.verifyIdToken(header.slice(7), true);
        } catch {
          return res.status(401).json({ error: "Session expired or invalid" });
        }
        if (decoded.firebase?.sign_in_provider !== "google.com")
          return res.status(403).json({ error: "Use Google Sign-In" });
        res.locals.uid = decoded.uid;
        await domain.ensureUser(decoded.uid, {
          email: decoded.email,
          name: decoded.name,
        });
        const bucket = db
          .collection("rateLimits")
          .doc(
            domain.digest(decoded.uid + ":" + Math.floor(Date.now() / 60000)),
          );
        await db.runTransaction(async (tx) => {
          const s = await tx.get(bucket);
          if ((s.data()?.count ?? 0) >= 180)
            fail(429, "Too many requests; retry shortly");
          tx.set(bucket, {
            count: (s.data()?.count ?? 0) + 1,
            expiresAt: new Date(Date.now() + 120000),
          });
        });
        next();
      } catch (e) {
        next(e);
      }
    }),
  );
  mountAccount(app, connect);
  app.get(
    "/api/v1/me",
    safe(async (_req, res) => {
      const user = (
        await db.collection("users").doc(res.locals.uid).get()
      ).data();
      res.json({ user, csrf: "" });
    }),
  );
  app.post("/api/v1/auth/logout", (_req, res) => res.json({ ok: true }));
  app.get(
    "/api/v1/preferences",
    safe(async (_req, res) =>
      res.json(await domain.preferences(res.locals.uid)),
    ),
  );
  app.patch(
    "/api/v1/preferences",
    safe(async (req, res) =>
      res.json(await domain.savePreferences(res.locals.uid, req.body)),
    ),
  );
  app.get(
    "/api/v1/topics",
    safe(async (req, res) => {
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
      res.json(await domain.listTopics(res.locals.uid, q));
    }),
  );
  app.post(
    "/api/v1/topics",
    safe(async (req, res) =>
      res
        .status(201)
        .json(
          await domain.createTopic(
            res.locals.uid,
            req.body,
            z
              .string()
              .min(1)
              .max(100)
              .optional()
              .parse(req.headers["idempotency-key"]),
          ),
        ),
    ),
  );
  app.get(
    "/api/v1/topics/:id",
    safe(async (req, res) =>
      res.json(await domain.details(res.locals.uid, id.parse(req.params.id))),
    ),
  );
  app.patch(
    "/api/v1/topics/:id",
    safe(async (req, res) =>
      res.json(
        await domain.editTopic(
          res.locals.uid,
          id.parse(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  app.put(
    "/api/v1/topics/:id/materials",
    safe(async (req, res) => {
      const body = z
        .object({ materials: z.array(z.string().max(2000)).max(100) })
        .parse(req.body);
      res.json(
        await domain.editTopic(res.locals.uid, id.parse(req.params.id), body),
      );
    }),
  );
  app.post(
    "/api/v1/topics/:id/archive",
    safe(async (req, res) =>
      res.json(await domain.archive(res.locals.uid, id.parse(req.params.id))),
    ),
  );
  app.post(
    "/api/v1/topics/:id/restore",
    safe(async (req, res) =>
      res.json(
        await domain.archive(res.locals.uid, id.parse(req.params.id), true),
      ),
    ),
  );
  app.get(
    "/api/v1/topics/:id/history",
    safe(async (req, res) => {
      const topicId = id.parse(req.params.id);
      await domain.details(res.locals.uid, topicId);
      const history = await all(res.locals.uid, "reviewHistory");
      res.json(
        history
          .filter((h) => h.topic_id === topicId)
          .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
          .slice(0, 100),
      );
    }),
  );
  app.get(
    "/api/v1/tags",
    safe(async (_req, res) =>
      res.json(
        (await all(res.locals.uid, "tags"))
          .map((t) => ({ name: t.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    ),
  );
  app.get(
    "/api/v1/reviews/today",
    safe(async (_req, res) =>
      res.json(await domain.reviews(res.locals.uid, true)),
    ),
  );
  app.get(
    "/api/v1/reviews/upcoming",
    safe(async (_req, res) => res.json(await domain.reviews(res.locals.uid))),
  );
  app.get(
    "/api/v1/reviews/progress",
    safe(async (_req, res) => {
      const p = await domain.preferences(res.locals.uid),
        today = DateTime.now().setZone(p.timezone),
        history = await all(res.locals.uid, "reviewHistory");
      res.json({
        completed: history.filter((h) =>
          DateTime.fromISO(h.completed_at)
            .setZone(p.timezone)
            .hasSame(today, "day"),
        ).length,
      });
    }),
  );
  app.post(
    "/api/v1/reviews/:id/complete",
    safe(async (req, res) =>
      res.json(
        await domain.complete(
          res.locals.uid,
          id.parse(req.params.id),
          z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body)
            .rating,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/reviews/:id/correct",
    safe(async (req, res) =>
      res.json(
        await domain.complete(
          res.locals.uid,
          id.parse(req.params.id),
          z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body)
            .rating,
          true,
        ),
      ),
    ),
  );
  app.patch(
    "/api/v1/reviews/:id/schedule",
    safe(async (req, res) => {
      const body = z
        .object({ scheduledAt: z.iso.datetime({ offset: true }) })
        .parse(req.body);
      res.json(
        await domain.reschedule(
          res.locals.uid,
          id.parse(req.params.id),
          new Date(body.scheduledAt),
        ),
      );
    }),
  );
  app.post(
    "/api/v1/reviews/:id/reset-auto",
    safe(async (req, res) =>
      res.json(
        await domain.reschedule(res.locals.uid, id.parse(req.params.id)),
      ),
    ),
  );
  app.get(
    "/api/v1/schedule/preview",
    safe(async (req, res) =>
      res.json(
        await domain.preview(
          res.locals.uid,
          z
            .object({
              knowledge: z.coerce.number().int().min(1).max(5).optional(),
              importance: z.coerce.number().int().min(1).max(5).optional(),
              duration: z.coerce.number().int().min(5).max(180).default(15),
            })
            .parse(req.query),
        ),
      ),
    ),
  );
  app.get(
    "/api/v1/calendar/connect",
    safe(async (_req, res) => {
      const grant = await calendar.authorize(res.locals.uid);
      res.cookie("__session", grant.state, {
        path: "/api/v1",
        httpOnly: true,
        sameSite: "lax",
        secure: calendar.origin().startsWith("https:"),
        maxAge: 600000,
      });
      res.json({ url: grant.url });
    }),
  );
  app.get(
    "/api/v1/calendar/status",
    safe(async (_req, res) => {
      const c = (
        await db.collection("calendarConnections").doc(res.locals.uid).get()
      ).data();
      res.json(
        c
          ? {
              connected: c.connected,
              calendar_id: c.calendar_id ?? null,
              last_sync_at: c.last_sync_at ?? null,
              error: c.error ?? null,
            }
          : { connected: false },
      );
    }),
  );
  app.post(
    "/api/v1/calendar/disconnect",
    safe(async (_req, res) =>
      res.json(await calendar.disconnect(res.locals.uid)),
    ),
  );
  app.post(
    "/api/v1/calendar/resync",
    safe(async (_req, res) => res.json(await calendar.resync(res.locals.uid))),
  );
  app.use((_req, res) => res.status(404).json({ error: "Endpoint not found" }));
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const code =
        error instanceof z.ZodError
          ? 400
          : (error.statusCode ??
            (error.type === "entity.parse.failed" ? 400 : 500));
      res.status(code).json({
        error:
          code === 500
            ? "Internal server error"
            : error instanceof z.ZodError
              ? "Invalid input"
              : error.message,
        ...(error instanceof z.ZodError ? { details: error.issues } : {}),
      });
      if (code === 500)
        console.error("Firebase API failure", {
          name: error.name,
          code: error.code,
        });
    },
  );
  return app;
}
