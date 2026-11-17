import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: mocks.verify,
}));
import { buildApp } from "../apps/api/src/app.ts";
import { sql, closeDatabase } from "../packages/database/src/index.ts";
import { hash, random } from "../apps/api/src/security.ts";
let app: Awaited<ReturnType<typeof buildApp>>,
  state: string,
  nonce: string,
  session: string,
  user: string;
const sub = "test-" + random();
beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  app = await buildApp();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ id_token: "mocked-transport-identity" })),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await sql`DELETE FROM users WHERE google_sub=${sub}`;
  await app.close();
  await closeDatabase();
});
describe("OIDC protocol and session protections with mocked Google identity verification", () => {
  it("requests login scopes only and uses state/nonce/PKCE", async () => {
    const r = await app.inject({ url: "/api/v1/auth/google/start" });
    expect(r.statusCode).toBe(302);
    const url = new URL(r.headers.location!);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    state = url.searchParams.get("state")!;
    nonce = url.searchParams.get("nonce")!;
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();
    expect(r.cookies[0].httpOnly).toBe(true);
  });
  it("rejects callback without matching browser state", async () => {
    const r = await app.inject({
      url: `/api/v1/auth/google/callback?code=x&state=${state}`,
    });
    expect(r.statusCode).toBe(400);
  });
  it("creates a session after verified identity with nonce", async () => {
    mocks.verify.mockResolvedValueOnce({
      payload: {
        sub,
        email: "auth@example.invalid",
        name: "Auth Test",
        email_verified: true,
        nonce,
      },
    });
    const r = await app.inject({
      url: `/api/v1/auth/google/callback?code=x&state=${state}`,
      headers: { cookie: `bs_oauth=${state}` },
    });
    expect(r.statusCode, r.body).toBe(302);
    session = r.cookies.find((c) => c.name === "bs_session")!.value;
    expect(r.cookies.find((c) => c.name === "bs_session")!.httpOnly).toBe(true);
    const me = await app.inject({
      url: "/api/v1/me",
      headers: { cookie: `bs_session=${session}` },
    });
    expect(me.statusCode).toBe(200);
    user = me.json().user.id;
  });
  it("rejects replay of consumed OAuth state", async () => {
    const r = await app.inject({
      url: `/api/v1/auth/google/callback?code=x&state=${state}`,
      headers: { cookie: `bs_oauth=${state}` },
    });
    expect(r.statusCode).toBe(400);
  });
  it("rejects nonce mismatch and creates no new session", async () => {
    const start = await app.inject({ url: "/api/v1/auth/google/start" });
    const state2 = new URL(start.headers.location!).searchParams.get("state")!;
    mocks.verify.mockResolvedValueOnce({
      payload: {
        sub,
        email: "auth@example.invalid",
        email_verified: true,
        nonce: "wrong",
      },
    });
    const r = await app.inject({
      url: `/api/v1/auth/google/callback?code=x&state=${state2}`,
      headers: { cookie: `bs_oauth=${state2}` },
    });
    expect(r.statusCode).toBe(400);
  });
  it("reuses stable sub for a returning account", async () => {
    const start = await app.inject({ url: "/api/v1/auth/google/start" });
    const u = new URL(start.headers.location!),
      s = u.searchParams.get("state")!;
    mocks.verify.mockResolvedValueOnce({
      payload: {
        sub,
        email: "changed@example.invalid",
        email_verified: true,
        nonce: u.searchParams.get("nonce"),
      },
    });
    const r = await app.inject({
      url: `/api/v1/auth/google/callback?code=x&state=${s}`,
      headers: { cookie: `bs_oauth=${s}` },
    });
    expect(r.statusCode).toBe(302);
    const [row] = await sql`SELECT * FROM users WHERE google_sub=${sub}`;
    expect(row.id).toBe(user);
    expect(row.email).toBe("changed@example.invalid");
  });
  it("expires sessions server-side", async () => {
    await sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=${hash(session)}`;
    const r = await app.inject({
      url: "/api/v1/me",
      headers: { cookie: `bs_session=${session}` },
    });
    expect(r.statusCode).toBe(401);
  });
});
