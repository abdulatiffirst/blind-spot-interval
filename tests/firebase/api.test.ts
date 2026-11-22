import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { db, auth } from "../../functions/src/store.ts";
import { defaults } from "../../packages/shared/src/index.ts";
const base =
  "http://127.0.0.1:5001/demo-blind-spot-interval/europe-west1/api/api/v1";
const users: { uid: string; token: string }[] = [];
let topic: any;
async function googleUser() {
  const payload = {
    sub: crypto.randomUUID(),
    email: crypto.randomUUID() + "@example.invalid",
    email_verified: true,
    name: "Firebase Test Learner",
    iss: "https://accounts.google.com",
    aud: "demo-client",
  };
  const idToken =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(JSON.stringify(payload)).toString("base64url") +
    ".";
  const r = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: new URLSearchParams({
          id_token: idToken,
          providerId: "google.com",
        }).toString(),
        requestUri: "http://localhost:5174",
        returnSecureToken: true,
        returnIdpCredential: true,
      }),
    },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return { uid: data.localId, token: data.idToken };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  user = users[0],
  extra: Record<string, string> = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${user?.token ?? "invalid"}`,
      origin: "http://localhost:5174",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const u = await googleUser();
    users.push(u);
    const me = await request("/me", "GET", undefined, u);
    expect(me.status).toBe(200);
    expect(me.data.user).toMatchObject({
      id: u.uid,
      email: expect.stringMatching(/@example\.invalid$/),
      display_name: "Firebase Test Learner",
    });
    expect(
      (await db.doc(`users/${u.uid}/preferences/default`).get()).data(),
    ).toEqual(defaults);
  }
});
afterAll(async () => {
  for (const u of users) {
    await db.recursiveDelete(db.collection("users").doc(u.uid));
    const jobs = await db
      .collection("syncJobs")
      .where("uid", "==", u.uid)
      .get();
    for (const j of jobs.docs) await j.ref.delete();
    await auth.deleteUser(u.uid);
  }
});
describe("Firebase Auth → Functions v2 → real Firestore emulator", () => {
  it("rejects missing, invalid, and disabled-account tokens in /me", async () => {
    const missing = await fetch(base + "/me");
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Sign in to continue" });
    const invalid = await request("/me", "GET", undefined, {
      uid: "unused",
      token: "invalid",
    });
    expect(invalid).toEqual({
      status: 401,
      data: { error: "Session expired or invalid" },
    });
    const disabled = await googleUser();
    try {
      await auth.updateUser(disabled.uid, { disabled: true });
      expect(await request("/me", "GET", undefined, disabled)).toEqual(invalid);
      expect((await db.doc(`users/${disabled.uid}`).get()).exists).toBe(false);
    } finally {
      await auth.deleteUser(disabled.uid);
    }
  });

  it("rejects a valid Firebase token from a non-Google provider", async () => {
    const signUp = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true }),
      },
    );
    expect(signUp.ok).toBe(true);
    const { localId: uid, idToken: token } = await signUp.json();
    try {
      expect(await request("/me", "GET", undefined, { uid, token })).toEqual({
        status: 403,
        data: { error: "Use Google Sign-In" },
      });
      expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
    } finally {
      await auth.deleteUser(uid);
    }
  });

  it("rejects unauthenticated requests and invalid input", async () => {
    const r = await fetch(base + "/topics");
    expect(r.status).toBe(401);
    expect(
      (await request("/topics", "POST", { title: "", duration: 0 })).status,
    ).toBe(400);
    expect(
      (
        await request("/preferences", "PATCH", {
          ...defaults,
          timezone: "Invalid/Zone",
        })
      ).status,
    ).toBe(400);
  });
  it("completes onboarding with editable timezone and hours", async () => {
    const r = await request("/preferences", "PATCH", {
      ...defaults,
      timezone: "Asia/Tashkent",
      onboarded: true,
    });
    expect(r.status).toBe(200);
    expect((await request("/preferences")).data.studyStart).toBe("09:00");
  });
  it("creates Logarithms with knowledge 3, importance 5, materials and a real schedule", async () => {
    const r = await request(
      "/topics",
      "POST",
      {
        title: "Logarithms",
        initialKnowledge: 3,
        importance: 5,
        tags: ["Math", "math"],
        materials: [
          "Recall logarithm properties",
          "https://example.com",
          "Apply the change-of-base formula",
        ],
      },
      users[0],
      { "idempotency-key": "logarithms" },
    );
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    topic = r.data;
    expect(topic.initial_knowledge).toBe(3);
    expect(topic.importance).toBe(5);
    expect(topic.target_retention).toBe(0.95);
    expect(topic.memory.card).toBeNull();
    expect(topic.schedule.scheduled_at).toBeTruthy();
    expect(topic.materials.map((m: any) => m.text)).toEqual([
      "Recall logarithm properties",
      "https://example.com",
      "Apply the change-of-base formula",
    ]);
    expect(topic.tags).toHaveLength(1);
  });
  it("deduplicates topic creation by key and isolates owners", async () => {
    const duplicate = await request(
      "/topics",
      "POST",
      { title: "ignored duplicate" },
      users[0],
      { "idempotency-key": "logarithms" },
    );
    expect(duplicate.data.id).toBe(topic.id);
    expect(
      (await request("/topics/" + topic.id, "GET", undefined, users[1])).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/topics/" + topic.id,
          "PATCH",
          { title: "stolen" },
          users[1],
        )
      ).status,
    ).toBe(404);
    expect((await request("/topics")).data.total).toBe(1);
  });
  it("preserves nullable optional ratings", async () => {
    const r = await request("/topics", "POST", {
      title: "No optional ratings",
    });
    expect(r.data.initial_knowledge).toBeNull();
    expect(r.data.importance).toBeNull();
    expect(r.data.target_retention).toBe(0.9);
    expect(r.data.memory.review_count).toBe(0);
  });
  it("serializes concurrent creates to avoid internal double booking", async () => {
    const result = await Promise.all([
      request("/topics", "POST", { title: "Concurrent A" }),
      request("/topics", "POST", { title: "Concurrent B" }),
    ]);
    expect(result.map((r) => r.status)).toEqual([201, 201]);
    expect(result[0].data.schedule.scheduled_at).not.toBe(
      result[1].data.schedule.scheduled_at,
    );
  });
  it("manual changes preserve FSRS state and survive topic edits", async () => {
    const at = new Date(Date.now() + 3 * 86400000).toISOString();
    expect(
      (
        await request("/reviews/" + topic.schedule.id + "/schedule", "PATCH", {
          scheduledAt: at,
        })
      ).status,
    ).toBe(200);
    await request("/topics/" + topic.id, "PATCH", {
      title: "Logarithms",
      duration: 20,
      materials: ["Changed first", "Changed second"],
    });
    const t = (await request("/topics/" + topic.id)).data;
    expect(t.memory.card).toBeNull();
    expect(t.schedule.mode).toBe("manual");
    expect(t.schedule.scheduled_at).toBe(at);
    expect(t.materials[0].text).toBe("Changed first");
    expect(
      (await request("/reviews/" + topic.schedule.id + "/reset-auto", "POST"))
        .status,
    ).toBe(200);
  });
  it("completes rating 4 exactly once under concurrent submissions and queues sync atomically", async () => {
    const result = await Promise.all([
      request("/reviews/" + topic.schedule.id + "/complete", "POST", {
        rating: 4,
      }),
      request("/reviews/" + topic.schedule.id + "/complete", "POST", {
        rating: 4,
      }),
    ]);
    expect(result.map((r) => r.status)).toEqual([200, 200]);
    expect(result.map((r) => r.data.duplicate).sort()).toEqual([false, true]);
    const t = (await request("/topics/" + topic.id)).data;
    for (const r of result) expect(r.data.next.id).toBe(t.schedule.id);
    expect(t.memory.review_count).toBe(1);
    expect(t.memory.card.reps).toBe(1);
    expect(t.memory.card.stabilityFast).toBeGreaterThan(0);
    expect(t.schedule.id).not.toBe(topic.schedule.id);
    const history = (await request("/topics/" + topic.id + "/history")).data;
    expect(history).toHaveLength(1);
    expect(history[0].original_rating).toBe(4);
    expect(history[0].mapped_rating).toBe(3);
    expect(history[0].completed_at).toBe(t.memory.last_review_at);
    expect(
      (await db.collection("syncJobs").where("uid", "==", users[0].uid).get())
        .empty,
    ).toBe(false);
  });
  it("corrects latest review with an audit record without adding a fake repetition", async () => {
    const r = await request(
      "/reviews/" + topic.schedule.id + "/correct",
      "POST",
      { rating: 2 },
    );
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const t = (await request("/topics/" + topic.id)).data;
    expect(t.memory.review_count).toBe(1);
    expect(t.schedule.recovery).toBe(true);
    const again = await request(
      "/reviews/" + topic.schedule.id + "/correct",
      "POST",
      { rating: 2 },
    );
    expect(again.data.next.id).toBe(t.schedule.id);
    expect(
      (await db.collection(`users/${users[0].uid}/reviewCorrections`).get())
        .size,
    ).toBe(1);
  });
  it("archives and restores history and memory", async () => {
    const before = (await request("/topics/" + topic.id)).data;
    expect(
      (await request("/topics/" + topic.id + "/archive", "POST")).status,
    ).toBe(200);
    expect((await request("/topics/" + topic.id)).data.schedule).toBeNull();
    expect(
      (await request("/topics/" + topic.id + "/restore", "POST")).status,
    ).toBe(200);
    const after = (await request("/topics/" + topic.id)).data;
    expect(after.memory).toEqual(before.memory);
    expect(after.schedule.recovery).toBe(true);
    expect(after.schedule.ideal_due_at).toBe(before.schedule.ideal_due_at);
    expect(
      (await request("/topics/" + topic.id + "/history")).data,
    ).toHaveLength(1);
  });
  it("exposes internal calendar and protects private credentials", async () => {
    expect((await request("/reviews/upcoming")).data.length).toBeGreaterThan(0);
    expect((await request("/calendar/status")).data.connected).toBe(false);
    expect(
      (await request("/calendar/status")).data.encrypted_tokens,
    ).toBeUndefined();
    expect((await request("/topics?sort=title&q=Logarithms")).data.total).toBe(
      1,
    );
  });
});

it("preserves untouched fields during material and title updates", async () => {
  const r = await request("/topics", "POST", {
    title: "Audit",
    tags: ["audit"],
    materials: ["old"],
    importance: 5,
    duration: 35,
  });
  const path = "/topics/" + r.data.id;
  expect(
    (await request(path + "/materials", "PUT", { materials: ["new"] })).status,
  ).toBe(200);
  const updated = await request(path, "PATCH", { title: "Renamed" });
  expect(updated.data).toMatchObject({
    importance: 5,
    duration: 35,
    tags: ["audit"],
    materials: [{ text: "new" }],
  });
  for (const endpoint of [
    "/reviews/today",
    "/tags",
    "/reviews/progress",
    "/schedule/preview?duration=20",
  ]) {
    expect((await request(endpoint)).status).toBe(200);
  }
  expect((await request("/schedule/preview?duration=1")).status).toBe(400);
  expect(
    (await request(path + "/materials", "PUT", { materials: 123 })).status,
  ).toBe(400);
  expect((await request("/calendar/resync", "POST")).status).toBe(200);
  expect((await request("/calendar/disconnect", "POST")).status).toBe(200);
  expect((await request("/auth/logout", "POST")).status).toBe(200);
});

it("serves health, validates callback and webhook inputs, and enforces the per-user request limit", async () => {
  expect((await fetch(base.replace(/\/api\/v1$/, "/health"))).status).toBe(200);
  expect((await fetch(base + "/calendar/callback")).status).toBe(400);
  expect(
    (await fetch(base + "/webhooks/google-calendar", { method: "POST" }))
      .status,
  ).toBe(403);
  expect(
    (
      await request("/calendar/connect", "GET", undefined, users[0], {
        origin: "https://untrusted.invalid",
      })
    ).status,
  ).toBe(403);
  expect((await request("/unimplemented")).status).toBe(404);
  expect((await request("/topics/invalid.id")).status).toBe(400);
  const { digest } = await import("../../functions/src/domain.ts");
  const minute = Math.floor(Date.now() / 60000);
  const buckets = [minute, minute + 1].map((m) =>
    db.collection("rateLimits").doc(digest(users[1].uid + ":" + m)),
  );
  try {
    for (const bucket of buckets) await bucket.set({ count: 180 });
    expect((await request("/me", "GET", undefined, users[1])).status).toBe(429);
    expect((await request("/me")).status).toBe(200);
  } finally {
    for (const bucket of buckets) await bucket.delete();
  }
});

it("rejects a previously valid Google session after revocation", async () => {
  const subject = await googleUser();
  try {
    const decoded = await auth.verifyIdToken(subject.token, true);
    // Firebase compares auth_time and validSince in whole seconds.
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, (decoded.auth_time + 1) * 1000 - Date.now() + 50),
      ),
    );
    await auth.revokeRefreshTokens(subject.uid);
    expect((await request("/me", "GET", undefined, subject)).status).toBe(401);
  } finally {
    await auth.deleteUser(subject.uid);
  }
});

it("begins OAuth over HTTP with a browser-bound HttpOnly state cookie", async () => {
  const { createApp } = await import("../../functions/src/http.ts");
  const { vi } = await import("vitest");
  vi.stubEnv("GOOGLE_CLIENT_ID", "emulator-test");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "emulator-test");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Expected local TCP listener");
    const response = await fetch(
      "http://127.0.0.1:" + address.port + "/api/v1/calendar/connect",
      { headers: { authorization: "Bearer " + users[0].token } },
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    const url = new URL((await response.json()).url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(
      cookie.includes("__session=" + url.searchParams.get("state")) &&
        cookie.includes("HttpOnly"),
    ).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("honors a preview, rejects a stale slot atomically, and preserves manual overrides", async () => {
  const user = users[1];
  const preview = await request(
    "/schedule/preview?knowledge=3&importance=4&duration=40",
    "GET",
    undefined,
    user,
  );
  expect(preview.data).toMatchObject({
    mode: "automatic",
    retention: 0.93,
    start: expect.any(String),
  });
  const input = {
    title: "Preview contract",
    duration: 40,
    initialKnowledge: 3,
    importance: 4,
    expectedStart: preview.data.start,
  };
  const first = await request("/topics", "POST", input, user);
  expect(first.data.schedule).toMatchObject({
    scheduled_at: preview.data.start,
    mode: "automatic",
  });
  const stale = await request("/topics", "POST", input, user);
  expect(stale.status).toBe(409);
  const manual = await request(
    "/schedule/preview?duration=40&scheduledAt=" +
      encodeURIComponent(input.expectedStart),
    "GET",
    undefined,
    user,
  );
  expect(manual.data).toMatchObject({
    start: input.expectedStart,
    mode: "manual",
    reason: "Manual time overlaps another review.",
  });
  const saved = await request(
    "/topics",
    "POST",
    { ...input, scheduledAt: manual.data.start },
    user,
  );
  expect(saved.data.schedule).toMatchObject({
    scheduled_at: manual.data.start,
    mode: "manual",
  });
});
