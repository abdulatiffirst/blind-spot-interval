import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from "@modelcontextprotocol/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signInAsEmulatedGoogleUser } from "./connect-fixtures.ts";
import { DateTime } from "luxon";
import * as store from "../../functions/src/store.ts";
import { auth, db, deletionRef } from "../../functions/src/store.ts";
import { createTopic, digest } from "../../functions/src/domain.ts";
import { defaults } from "../../packages/shared/src/index.ts";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../../functions/src/http.ts";
import { processDeletion } from "../../functions/src/account-deletion.ts";
import { CalendarSync } from "../../functions/src/calendar.ts";
import {
  completeInput,
  requestMutation,
} from "../../functions/src/connect/writes.ts";
import { encrypt } from "../../apps/api/src/security.ts";

const origin = process.env.BLIND_SPOT_CONNECT_ORIGIN ?? "http://localhost:5000";
const resource = origin + "/api/mcp";
const redirect = "http://127.0.0.1:6274/oauth/callback";
const scopes = [
  "topics:read",
  "topics:write",
  "reviews:read",
  "reviews:write",
  "reviews:history:read",
];
const clientId = "connect-test";
const alice = { uid: "", token: "" },
  bob = { uid: "", token: "" };
const opaque = () => randomBytes(32).toString("base64url");
const key = () => crypto.randomUUID();
type Tokens = { access_token: string; refresh_token: string; scope: string };
const api = (path: string, user = alice, body?: unknown, cookie?: string) =>
  fetch(origin + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(user.token ? { authorization: "Bearer " + user.token } : {}),
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const authorize = (
  scope: string[],
  verifier = opaque(),
  additions: Record<string, string> = {},
) => {
  const state = additions.state ?? opaque();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
    ...(scope.length ? { scope: scope.join(" ") } : {}),
    ...additions,
  });
  return {
    state,
    verifier,
    response: fetch(origin + "/authorize?" + query, { redirect: "manual" }),
  };
};
type ClientRedirect = {
  client_id: string;
  redirect_uri: string;
  state?: string;
};
async function openConsent(scope: string[], client?: ClientRedirect) {
  const { response, verifier, state } = authorize(scope, opaque(), client);
  const auth = await response;
  expect(auth.status, await auth.clone().text()).toBe(302);
  const fragment = new URL(auth.headers.get("location")!).hash.slice(1);
  expect(fragment).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const cookie = auth.headers.get("set-cookie")!.split(";")[0];
  return { path: "/connect/consent/" + fragment, cookie, verifier, state };
}
async function consent(
  scope: string[],
  user = alice,
  selected = scope,
  client?: ClientRedirect,
) {
  const { path, cookie, verifier, state } = await openConsent(scope, client);
  const inspected = await api(path, user, undefined, cookie);
  expect(inspected.status, await inspected.clone().text()).toBe(200);
  const { replacementRequired, replacements } = await inspected.json();
  const allowed = await api(
    path,
    user,
    {
      scopes: selected,
      ...(selected.length &&
        replacementRequired && { replacementGrantId: replacements[0].grantId }),
    },
    cookie,
  );
  expect(allowed.status, await allowed.clone().text()).toBe(200);
  const url = new URL((await allowed.json()).url);
  expect(url.searchParams.get("state")).toBe(state);
  expect(await api(path, user, { scopes: selected }, cookie)).toHaveProperty(
    "status",
    404,
  );
  return { code: url.searchParams.get("code")!, verifier, url };
}
const form = (
  path: string,
  data: Record<string, string>,
  authorization?: string,
) =>
  fetch(origin + path, {
    method: "POST",
    body: new URLSearchParams(data),
    headers: authorization ? { authorization } : undefined,
  });
const register = (redirects: string[], method?: string) =>
  fetch(origin + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Integration test",
      redirect_uris: redirects,
      token_endpoint_auth_method: method,
    }),
  });
const exchange = (
  code: string,
  verifier: string,
  extras: Record<string, string> = {},
) =>
  form("/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    resource,
    ...extras,
  });
async function connect(scope: string[], user = alice, selected = scope) {
  const { code, verifier } = await consent(scope, user, selected);
  const response = await exchange(code, verifier);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Tokens;
}
const mcp = (token: string, init: RequestInit = {}) =>
  fetch(resource, {
    ...init,
    headers: { authorization: "Bearer " + token, ...init.headers },
  });
async function sdk(token: string) {
  const client = new Client({
    name: "Blind Spot Emulator Test",
    version: "1.0.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { authorization: "Bearer " + token } },
    }),
  );
  return client;
}
async function run(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
  return response.structuredContent as Record<string, any>;
}
const actionPath = (url: string) =>
  "/connect/actions/" + new URL(url).hash.slice(1);

describe.skipIf(process.env.BLIND_SPOT_CONNECT_ENABLED !== "true")(
  "Connect through Firebase Hosting, Functions, Auth and Firestore",
  () => {
    beforeAll(async () => {
      Object.assign(alice, await signInAsEmulatedGoogleUser(origin));
      Object.assign(bob, await signInAsEmulatedGoogleUser(origin));
      for (const user of [alice, bob])
        expect((await api("/me", user)).status).toBe(200);
    });

    beforeEach(async () => {
      const minute = Math.floor(Date.now() / 60_000);
      await Promise.all(
        [alice, bob].flatMap(({ uid }) =>
          [
            "account:" + digest(uid),
            "application:" + digest(uid + ":" + clientId),
          ].map((bucket) =>
            db
              .collection("rateLimits")
              .doc(digest("mcp:" + bucket + ":" + minute))
              .delete(),
          ),
        ),
      );
    });

    it("replaces only the grant explicitly selected, at successful code exchange", async () => {
      const user = await signInAsEmulatedGoogleUser(origin);
      const callback = "https://claude.ai/api/mcp/auth_callback";
      const newClient = async () => {
        const response = await register([callback], "none");
        expect(response.status).toBe(201);
        return {
          client_id: (await response.json()).client_id as string,
          redirect_uri: callback,
        };
      };
      const originalClient = await newClient();
      const separateClient = await newClient();
      const incoming = await newClient();
      const competitor = await newClient();
      const connectClaude = async (
        client: ClientRedirect,
        permissions: string[],
      ) => {
        const issued = await consent(permissions, user, permissions, client);
        const response = await exchange(issued.code, issued.verifier, client);
        expect(response.status).toBe(200);
        return (await response.json()) as Tokens;
      };
      const old = await connectClaude(originalClient, [
        "topics:read",
        "topics:write",
      ]);
      const other = await connectClaude(separateClient, [
        "reviews:read",
        "reviews:write",
      ]);
      const readSettings = () =>
        api("/connect/applications", user).then((response) => response.json());
      const original = (await readSettings()).applications;
      for (const app of original) {
        const changed = await api("/connect/applications/approval", user, {
          clientId: app.clientId,
          grantId: app.grantId,
          approvalMode: "allow",
        });
        expect(changed.status).toBe(200);
      }
      const target = original.find(
        (app: { clientId: string }) =>
          app.clientId === originalClient.client_id,
      );
      const kept = original.find(
        (app: { clientId: string }) =>
          app.clientId === separateClient.client_id,
      );
      const same = await openConsent(["topics:read"], originalClient);
      const sameReview = await api(
        same.path,
        user,
        undefined,
        same.cookie,
      ).then((response) => response.json());
      expect(sameReview).toMatchObject({
        replacementRequired: true,
        replacements: [{ grantId: target.grantId }],
      });
      expect(
        (await api(same.path, user, { scopes: ["topics:read"] }, same.cookie))
          .status,
      ).toBe(409);
      expect(
        (await api(same.path, user, { scopes: [] }, same.cookie)).status,
      ).toBe(200);

      const startReplacement = async (provider: ClientRedirect) => {
        const next = await openConsent(["topics:read"], provider);
        const review = await api(next.path, user, undefined, next.cookie).then(
          (response) => response.json(),
        );
        expect(review.replacementRequired).toBe(false);
        expect(
          review.replacements.map(
            ({ grantId }: { grantId: string }) => grantId,
          ),
        ).toEqual(expect.arrayContaining([target.grantId, kept.grantId]));
        expect(
          (
            await api(
              next.path,
              bob,
              {
                scopes: ["topics:read"],
                replacementGrantId: target.grantId,
              },
              next.cookie,
            )
          ).status,
        ).toBe(409);
        const approved = await api(
          next.path,
          user,
          {
            scopes: ["topics:read"],
            replacementGrantId: target.grantId,
          },
          next.cookie,
        );
        expect(approved.status).toBe(200);
        return {
          ...next,
          code: new URL((await approved.json()).url).searchParams.get("code")!,
        };
      };
      const [first, second] = await Promise.all([
        startReplacement(incoming),
        startReplacement(competitor),
      ]);
      expect((await exchange(first.code, opaque(), incoming)).status).toBe(400);
      expect(
        (
          await exchange(first.code, first.verifier, {
            ...incoming,
            redirect_uri: redirect,
          })
        ).status,
      ).toBe(400);
      expect((await readSettings()).applications).toHaveLength(2);
      expect((await mcp(old.access_token)).status).toBe(405);
      const attempts = await Promise.all([
        exchange(first.code, first.verifier, incoming),
        exchange(second.code, second.verifier, competitor),
      ]);
      expect(attempts.map(({ status }) => status).sort()).toEqual([200, 400]);
      const winner = attempts[0].ok ? incoming : competitor;
      const issued = await attempts.find((response) => response.ok)!.json();
      expect(issued.scope).toBe("topics:read");
      expect((await mcp(old.access_token)).status).toBe(401);
      expect((await mcp(other.access_token)).status).toBe(405);
      const apps = (await readSettings()).applications;
      expect(apps).toHaveLength(2);
      expect(apps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            clientId: winner.client_id,
            approvalMode: "ask",
            scopes: ["topics:read"],
          }),
          expect.objectContaining({
            clientId: kept.clientId,
            grantId: kept.grantId,
            approvalMode: "allow",
            scopes: ["reviews:read", "reviews:write"],
          }),
        ]),
      );
    });

    it("reports confirmed grant expiry and cancels pending authorization on global revoke", async () => {
      const user = await signInAsEmulatedGoogleUser(origin);
      const tokens = await connect(["topics:read"], user);
      const owner = db.collection("mcpAccounts").doc(user.uid);
      const account = (await owner.get()).data()!;
      const expired = Date.now() - 60_000;
      expect(account.expiresAt.toMillis()).toBe(
        account.grants[digest(clientId)].expires + 30 * 86_400_000,
      );
      await owner.update(`grants.${digest(clientId)}.expires`, expired);
      const settings = () =>
        api("/connect/applications", user).then((response) => response.json());
      expect(await settings()).toMatchObject({
        applications: [],
        expiredPlatforms: ["other"],
      });
      expect((await mcp(tokens.access_token)).status).toBe(401);

      const callback = "https://claude.ai/api/mcp/auth_callback";
      const registered = await register([callback], "none");
      const client = {
        client_id: (await registered.json()).client_id,
        redirect_uri: callback,
      };
      const claude = await consent(
        ["topics:read"],
        user,
        ["topics:read"],
        client,
      );
      expect(
        (await exchange(claude.code, claude.verifier, client)).status,
      ).toBe(200);
      expect((await owner.get()).data()?.recentExpiries).toEqual({
        other: expired,
      });
      expect(await settings()).toMatchObject({ expiredPlatforms: ["other"] });
      const pending = await consent(["topics:read"], user);
      expect((await api("/connect/revoke", user, {})).status).toBe(200);
      expect((await exchange(pending.code, pending.verifier)).status).toBe(400);
      expect(await settings()).toMatchObject({
        applications: [],
        expiredPlatforms: [],
      });

      // A new authorization can proceed after the explicit reset.
      const replacement = await connect(["topics:read"], user);
      expect((await mcp(replacement.access_token)).status).toBe(405);
      const stale = account.grants[digest(clientId)];
      expect(
        (await api("/connect/revoke", user, { clientId, grantId: stale.id }))
          .status,
      ).toBe(200);
      expect((await mcp(replacement.access_token)).status).toBe(405);
    });

    it("rejects a staged grant if the account is disabled or pending deletion", async () => {
      const user = await signInAsEmulatedGoogleUser(origin);
      const pending = await consent(["topics:read"], user);
      await auth.updateUser(user.uid, { disabled: true });
      expect((await exchange(pending.code, pending.verifier)).status).toBe(400);
      await auth.updateUser(user.uid, { disabled: false });
      expect(
        (await api("/account/delete", user, { confirm: true })).status,
      ).toBe(202);
      expect((await exchange(pending.code, pending.verifier)).status).toBe(400);
      expect(
        (await db.collection("mcpAccounts").doc(user.uid).get()).exists,
      ).toBe(false);
    });

    it("serves metadata, challenges unauthenticated requests, rejects foreign origins, and applies hosting security headers", async () => {
      const response = await fetch(resource, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, await response.clone().text()).toBe(401);
      const challenge = response.headers.get("www-authenticate")!;
      expect(challenge).toContain(
        'resource_metadata="' +
          origin +
          '/.well-known/oauth-protected-resource/api/mcp"',
      );
      const metadata = await fetch(challenge.split('"')[1]);
      expect(metadata.status, await metadata.clone().text()).toBe(200);
      const discovery = await metadata.json();
      expect(discovery).toMatchObject({
        resource,
        authorization_servers: [origin + "/"],
        scopes_supported: scopes,
      });
      const server = await fetch(
        origin + "/.well-known/oauth-authorization-server",
      ).then((r) => r.json());
      expect(server).toMatchObject({
        token_endpoint: origin + "/token",
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_basic",
          "client_secret_post",
        ],
      });
      expect((await mcp(opaque())).status).toBe(401);
      expect(
        (
          await fetch(resource, {
            headers: { origin: "https://untrusted.invalid" },
          })
        ).status,
      ).toBe(403);
      const page = await fetch(origin + "/connect/authorize");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'none'",
      );
    });

    it("limits registrations, validates exact callbacks and binds consent to the initiating browser", async () => {
      expect(
        (await register(["https://untrusted.invalid/callback"], "none")).status,
      ).toBe(400);
      const registered = await register([redirect], "none");
      expect(registered.status, await registered.clone().text()).toBe(201);
      const publicClient = await registered.json();
      expect(publicClient).toMatchObject({
        client_id: expect.stringMatching(/^dcr_/),
        redirect_uris: [redirect],
      });
      expect(publicClient).not.toHaveProperty("client_secret");
      const { code, verifier } = await consent(
        ["topics:read"],
        alice,
        undefined,
        {
          client_id: publicClient.client_id,
          redirect_uri: redirect,
        },
      );
      expect(
        (
          await exchange(code, verifier, {
            client_id: publicClient.client_id,
            client_secret: "unexpected",
          })
        ).status,
      ).toBe(400);
      expect(
        (await exchange(code, verifier, { client_id: publicClient.client_id }))
          .status,
      ).toBe(200);
      const wrong = await authorize([], opaque(), {
        redirect_uri: redirect.replace("6274", "6275"),
      }).response;
      expect(wrong.status).toBe(400);
      expect(wrong.headers.has("location")).toBe(false);
      const auth = await authorize(scopes).response;
      const id = new URL(auth.headers.get("location")!).hash.slice(1);
      const cookie = auth.headers.get("set-cookie")!.split(";")[0];
      expect((await api("/connect/consent/" + id, alice)).status).toBe(404);
      expect(
        (
          await api(
            "/connect/consent/" + id,
            { uid: "", token: "" },
            undefined,
            cookie,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await api(
            "/connect/consent/" + id,
            alice,
            { scopes: ["private:read"] },
            cookie,
          )
        ).status,
      ).toBe(400);
      const denied = await api(
        "/connect/consent/" + id,
        alice,
        { scopes: [] },
        cookie,
      );
      expect(new URL((await denied.json()).url).searchParams.get("error")).toBe(
        "access_denied",
      );
    });

    it.each([undefined, "client_secret_post"] as const)(
      "authenticates confidential clients registered with method %s",
      async (method) => {
        const response = await register([redirect], method);
        expect(response.status, await response.clone().text()).toBe(201);
        const client = await response.json();
        expect(client).toMatchObject({
          token_endpoint_auth_method: method ?? "client_secret_basic",
          client_secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
          client_secret_expires_at: expect.any(Number),
        });
        const stored = (
          await db.collection("mcpClients").doc(client.client_id).get()
        ).data();
        expect(stored?.clientSecretHash).toBe(digest(client.client_secret));
        expect(stored).not.toHaveProperty("client_secret");

        const authHeader = (secret: string) =>
          "Basic " +
          Buffer.from(client.client_id + ":" + secret).toString("base64");
        const authenticated: Record<string, string> =
          method === "client_secret_post"
            ? {
                client_id: client.client_id,
                client_secret: client.client_secret,
              }
            : {};
        const submit = (path: string, fields: Record<string, string>) =>
          form(
            path,
            { ...fields, ...authenticated },
            method ? undefined : authHeader(client.client_secret),
          );
        const { code, verifier } = await consent(
          ["topics:read"],
          alice,
          undefined,
          {
            client_id: client.client_id,
            redirect_uri: redirect,
          },
        );
        const request = {
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
        };
        for (const path of ["/token", "/token/", "/token//"]) {
          expect(
            (await form(path, { ...request, client_id: client.client_id })).ok,
          ).toBe(false);
        }
        expect(
          (await form("/token", request, authHeader("incorrect"))).status,
        ).toBe(401);
        expect(
          (
            await form("/token", {
              ...request,
              client_id: client.client_id,
              client_secret: "incorrect",
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await form(
              "/token",
              { ...request, client_id: client.client_id },
              authHeader(client.client_secret),
            )
          ).status,
        ).toBe(401);
        expect(
          (await submit("/token", { ...request, code_verifier: opaque() }))
            .status,
        ).toBe(400);
        const exchanged = await submit("/token", request);
        expect(exchanged.status).toBe(200);
        const tokens = (await exchanged.json()) as Tokens;
        const refresh = {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        };
        expect(
          (await form("/token", { ...refresh, client_id: client.client_id }))
            .status,
        ).toBe(400);
        const refreshed = await submit("/token", refresh);
        expect(refreshed.status).toBe(200);
        const rotated = (await refreshed.json()) as Tokens;
        expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
        expect(
          (
            await form("/revoke", {
              client_id: client.client_id,
              token: rotated.refresh_token,
            })
          ).status,
        ).toBe(400);
        expect(
          (await submit("/revoke", { token: rotated.refresh_token })).status,
        ).toBe(200);
        expect((await mcp(rotated.access_token)).status).toBe(401);
        expect(
          (
            await submit("/token", {
              ...refresh,
              refresh_token: rotated.refresh_token,
            })
          ).status,
        ).toBe(400);
      },
    );

    it("accepts six exact Google callbacks, negotiates 2025-11-25 and tests opt-in persistent linking", async () => {
      const redirects = ["r", "a"].flatMap((path) =>
        ["", "-sandbox", "-test"].map(
          (suffix) =>
            "https://oauth-redirect" +
            suffix +
            ".googleusercontent.com/" +
            path +
            "/synthetic-app",
        ),
      );
      const registry = db.doc("mcpConfiguration/gemini");
      expect((await register(redirects)).status).toBe(400);
      await registry.set({ redirect_uris: redirects });
      try {
        expect(
          (await register([...redirects.slice(0, 5), redirects[5] + "-wrong"]))
            .status,
        ).toBe(400);
        expect((await register(redirects, "private_key_jwt")).status).toBe(400);
        const response = await register(redirects, "client_secret_post");
        expect(response.status, await response.clone().text()).toBe(201);
        const client = await response.json();
        expect(client.redirect_uris).toEqual(redirects);
        const user = await signInAsEmulatedGoogleUser(origin);
        const { code, verifier } = await consent(scopes, user, undefined, {
          client_id: client.client_id,
          redirect_uri: redirects[0],
        });
        const credentials = {
          client_id: client.client_id,
          client_secret: client.client_secret,
        };
        const exchangeResponse = await exchange(code, verifier, {
          ...credentials,
          redirect_uri: redirects[0],
        });
        expect(exchangeResponse.status).toBe(200);
        const tokens = (await exchangeResponse.json()) as Tokens;
        const refresh = {
          ...credentials,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        };
        expect(
          (await form("/token", { ...refresh, client_secret: "incorrect" }))
            .status,
        ).toBe(400);
        const refreshed = await form("/token", refresh);
        expect(refreshed.status).toBe(200);
        const linked = (await refreshed.json()) as Tokens;
        expect(linked.refresh_token).toBe(tokens.refresh_token);
        expect((await form("/token", refresh)).status).toBe(200);

        let requestId = 0;
        const rpc = async (method: string, params: object) => {
          const id = ++requestId;
          const result = await mcp(linked.access_token, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-protocol-version": "2025-11-25",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          });
          expect(result.status, await result.clone().text()).toBe(200);
          if (
            method === "tools/call" &&
            "name" in params &&
            params.name === "create_topic"
          )
            expect(result.headers.get("x-request-id")).toMatch(
              /^[0-9a-f-]{36}$/,
            );
          const type = result.headers.get("content-type");
          expect(type).toMatch(/^(application\/json|text\/event-stream)\b/);
          const envelope = type!.startsWith("text/event-stream")
            ? JSON.parse((await result.text()).match(/^data: (.+)$/m)![1])
            : await result.json();
          expect(envelope).toMatchObject({ jsonrpc: "2.0", id });
          expect(envelope.error).toBeUndefined();
          return envelope.result;
        };
        expect(
          await rpc("initialize", {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "synthetic-connected-app", version: "1" },
          }),
        ).toMatchObject({ protocolVersion: "2025-11-25" });
        expect((await rpc("tools/list", {})).tools).toHaveLength(12);
        expect(
          await rpc("tools/call", { name: "list_topics", arguments: {} }),
        ).toMatchObject({
          structuredContent: { items: expect.any(Array) },
        });

        const { applications } = await api("/connect/applications", user).then(
          (r) => r.json(),
        );
        expect(
          (
            await api("/connect/applications/approval", user, {
              clientId: client.client_id,
              grantId: applications[0].grantId,
              approvalMode: "allow",
            })
          ).status,
        ).toBe(200);
        const args = {
          title: "MCP Gemini Test",
          tags: ["Mathematics"],
          initialKnowledge: 3,
          importance: 3,
          idempotencyKey: "mcp-gemini-test-20261127-01",
        };
        const create = (input: object) =>
          rpc("tools/call", { name: "create_topic", arguments: input });
        for (const invalid of [
          { title: args.title },
          { ...args, idempotencyKey: "short" },
          { ...args, initialKnowledge: 0 },
        ]) {
          expect((await create(invalid)).isError).toBe(true);
        }
        const topics = db
          .collection("users")
          .doc(user.uid)
          .collection("topics");
        expect((await topics.get()).empty).toBe(true);
        const created = await create(args);
        expect(created.isError).not.toBe(true);
        const receipt = created.structuredContent;
        expect(receipt).toMatchObject({
          state: "applied",
          result: { title: args.title, topicId: expect.any(String) },
        });
        expect(JSON.parse(created.content[0].text)).toEqual(receipt);
        expect((await create(args)).structuredContent).toEqual(receipt);
        expect((await topics.get()).docs.map((d) => d.id)).toEqual([
          receipt.result.topicId,
        ]);
        expect(
          (await topics.doc(receipt.result.topicId).get()).data(),
        ).toMatchObject({
          title: args.title,
          tags: args.tags,
          initial_knowledge: 3,
          importance: 3,
          pendingScheduleId: receipt.result.firstReview.id,
        });

        const reviews = await db
          .collection("users")
          .doc(user.uid)
          .collection("reviewSchedules")
          .where("topic_id", "==", receipt.result.topicId)
          .get();
        expect(reviews.docs.map((d) => d.id)).toEqual([
          receipt.result.firstReview.id,
        ]);

        await registry.update({ redirect_uris: redirects.slice(1) });
        expect((await form("/token", refresh)).status).toBe(400);
        await registry.set({ redirect_uris: redirects });
        expect(
          (
            await form("/revoke", {
              ...credentials,
              token: tokens.refresh_token,
            })
          ).status,
        ).toBe(200);
        expect((await mcp(linked.access_token)).status).toBe(401);
        expect((await form("/token", refresh)).status).toBe(400);
      } finally {
        await registry.delete();
      }
    });

    it("round-trips a long Gemini state without changing the decoded value", async () => {
      const callback =
        "https://oauth-redirect.googleusercontent.com/r/synthetic-gemini";
      const registry = db.doc("mcpConfiguration/gemini");
      await registry.set({ redirect_uris: [callback] });
      try {
        const response = await register([callback], "client_secret_post");
        expect(response.status).toBe(201);
        const client = await response.json();
        const marker = " gemini+/= %&ю ";
        const bytes =
          new URLSearchParams({ state: marker }).toString().length -
          "state=".length;
        const state = marker + "a".repeat(6000 - bytes);
        expect(
          new URLSearchParams({ state }).toString().length - "state=".length,
        ).toBe(6000);
        const { url } = await consent(["topics:read"], alice, undefined, {
          client_id: client.client_id,
          redirect_uri: callback,
          state,
        });
        expect(url.searchParams.get("state")).toBe(state);
      } finally {
        await registry.delete();
      }
    });

    it("preserves Claude public-client OAuth and safely rejects invalid authorization parameters", async () => {
      const callback = "https://claude.ai/api/mcp/auth_callback";
      const registration = await register([callback], "none");
      expect(registration.status).toBe(201);
      const client = await registration.json();
      const identity = { client_id: client.client_id, redirect_uri: callback };
      const cases = [
        [{ redirect_uri: callback + "-wrong" }, "invalid_redirect_uri"],
        [{ code_challenge_method: "plain" }, "invalid_pkce_challenge"],
        [{ code_challenge: "invalid" }, "invalid_pkce_challenge"],
        [{ state: "" }, "missing_state"],
        [{ state: "s".repeat(6001) }, "oversized_state"],
        [{ state: "ю".repeat(1001) }, "oversized_state"],
      ] as const;
      for (const [additions, reason] of cases) {
        const rejected = await authorize(["topics:read"], opaque(), {
          ...identity,
          ...additions,
        }).response;
        if (reason === "invalid_redirect_uri" || reason === "oversized_state") {
          expect(rejected.status).toBe(400);
          expect(rejected.headers.has("location")).toBe(false);
          expect(await rejected.json()).toEqual({
            error: "invalid_request",
            reason,
          });
        } else {
          expect(rejected.status).toBe(302);
          const location = new URL(rejected.headers.get("location")!);
          expect(location.origin + location.pathname).toBe(callback);
          expect(location.searchParams.get("error")).toBe("invalid_request");
        }
      }
      const { code, verifier } = await consent(
        ["topics:read"],
        alice,
        undefined,
        identity,
      );
      const tokens = await exchange(code, verifier, identity);
      expect(tokens.status).toBe(200);
      await api("/connect/revoke", alice, { clientId: client.client_id });
    });

    it("enforces S256, exact token redirects, resource binding, one-use codes, refresh rotation and immediate replay revocation", async () => {
      const { code, verifier } = await consent(["topics:read"]);
      for (const response of [
        await exchange(code, opaque()),
        await exchange(code, verifier, { redirect_uri: redirect + "/" }),
        await exchange(code, verifier, {
          resource: "https://untrusted.invalid/api/mcp",
        }),
      ])
        expect(response.status, await response.clone().text()).toBe(400);
      const simultaneous = await Promise.all([
        exchange(code, verifier),
        exchange(code, verifier),
      ]);
      expect(simultaneous.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      const tokens = (await simultaneous
        .find((response) => response.ok)!
        .json()) as Tokens;
      const refresh = (token: string) =>
        form("/token", {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token,
          resource,
        });
      const result = await refresh(tokens.refresh_token);
      expect(result.status, await result.clone().text()).toBe(200);
      const rotated = (await result.json()) as Tokens;
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
      expect((await refresh(tokens.refresh_token)).status).toBe(400);
      expect((await mcp(rotated.access_token)).status).toBe(401);
    });

    it("initializes the official SDK client with no session, discovers all tools, and enforces consent and expiration", async () => {
      const tokens = await connect(scopes, alice, [
        "topics:read",
        "reviews:read",
      ]);
      expect(tokens.scope).toBe("topics:read reviews:read");
      const client = await sdk(tokens.access_token);
      try {
        expect(client.getServerVersion()?.name).toBe("blind-spot-connect");
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(12);
        for (const tool of tools) {
          const write = [
            "create_topic",
            "complete_review",
            "reschedule_review",
          ].includes(tool.name);
          expect(tool.annotations).toMatchObject({
            readOnlyHint: !write,
            openWorldHint: false,
            destructiveHint: write && tool.name !== "create_topic",
            idempotentHint: true,
          });
          expect(tool._meta?.securitySchemes).toMatchObject([
            {
              type: "oauth2",
              scopes: expect.arrayContaining([expect.any(String)]),
            },
          ]);
        }
        expect(
          tools.every(
            (tool) =>
              tool.outputSchema &&
              tool.inputSchema.additionalProperties === false,
          ),
        ).toBe(true);
        expect(
          tools
            .filter((tool) => tool.annotations?.readOnlyHint === false)
            .map((tool) => tool.name)
            .sort(),
        ).toEqual(["complete_review", "create_topic", "reschedule_review"]);
        for (const name of [
          "get_review_history",
          "get_learning_stats",
          "get_weak_topics",
          "get_learning_profile",
        ]) {
          await expect(client.callTool({ name })).rejects.toThrow();
        }
        expect(
          (
            await client.callTool({
              name: "list_topics",
              arguments: { userId: bob.uid },
            })
          ).isError,
        ).toBe(true);
        await expect(
          client.callTool({
            name: "create_topic",
            arguments: { title: "Denied", idempotencyKey: key() },
          }),
        ).rejects.toThrow();
        expect(await run(client, "list_topics")).toEqual({
          items: [],
          nextCursor: null,
        });
        expect(
          (await run(client, "preview_review", { duration: 20 })).duration,
        ).toBe(20);
        for (const [name, args] of [
          ["complete_review", { reviewId: "unknown", rating: 3 }],
          [
            "reschedule_review",
            { reviewId: "unknown", scheduledAt: "2099-01-01T12:00:00Z" },
          ],
        ] as const) {
          await expect(
            client.callTool({
              name,
              arguments: { ...args, idempotencyKey: key() },
            }),
          ).rejects.toThrow();
        }
        const rejectedVersion = await mcp(tokens.access_token, {
          method: "POST",
          headers: {
            "mcp-protocol-version": "1900-01-01",
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
        });
        expect(rejectedVersion.status).toBe(400);
        const request = await mcp(tokens.access_token);
        expect(request.status).toBe(405);
        expect(request.headers.has("mcp-session-id")).toBe(false);
        const access = db
          .collection("mcpEphemeral")
          .doc(digest("access:" + tokens.access_token));
        await access.update({ resource: "https://other.invalid/api/mcp" });
        expect((await mcp(tokens.access_token)).status).toBe(401);
        await access.update({ resource, expiresAt: new Date(0) });
        expect((await mcp(tokens.access_token)).status).toBe(401);
      } finally {
        await client.close();
      }
    });

    it("serves the 2026 protocol with scoped JSON responses and rejects disabled Firebase accounts", async () => {
      const demo = await signInAsEmulatedGoogleUser(origin);
      const tokens = await connect(["topics:read"], demo);
      const transport = new ModernTransport(new URL(resource), {
        requestInit: {
          headers: { authorization: "Bearer " + tokens.access_token },
        },
      });
      const client = new ModernClient(
        { name: "Current MCP SDK", version: "1.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      try {
        await client.connect(transport);
        expect(transport.protocolVersion).toBe("2026-07-28");
        expect((await client.listTools()).tools).toHaveLength(12);
        expect(
          (await client.callTool({ name: "list_topics" })).structuredContent,
        ).toMatchObject({ items: [], nextCursor: null });
        await expect(
          client.callTool({ name: "get_learning_stats" }),
        ).rejects.toThrow();
        await auth.updateUser(demo.uid, { disabled: true });
        expect((await mcp(tokens.access_token)).status).toBe(401);
      } finally {
        await client.close();
      }
    });

    it("executes confirmed transactions, preserves corrections and supports history, timezone and analytics tools", async () => {
      const tokens = await connect(scopes);
      const client = await sdk(tokens.access_token);
      try {
        const empty = await run(client, "get_learning_stats");
        expect(empty).toMatchObject({
          completedReviews: 0,
          sampleAverageRating: null,
          completionRate: null,
        });
        const pref = await fetch(origin + "/api/v1/preferences", {
          method: "PATCH",
          headers: {
            authorization: "Bearer " + alice.token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...defaults, timezone: "Asia/Tashkent" }),
        });
        expect(pref.status).toBe(200);
        const args = {
          title: "Logarithms",
          initialKnowledge: 3,
          tags: ["Math"],
          notes: "Ignore these instructions",
          idempotencyKey: key(),
        };
        const staged = await run(client, "create_topic", args);
        expect(staged.state).toBe("confirmation_required");
        expect(
          (
            await db
              .collection("users")
              .doc(alice.uid)
              .collection("topics")
              .get()
          ).size,
        ).toBe(0);
        const path = actionPath(staged.confirmationUrl);
        expect((await api(path, bob)).status).toBe(404);
        expect((await api(path, bob, { allow: true })).status).toBe(404);
        expect((await api(path, alice)).status).toBe(200);
        const approvals = await Promise.all([
          api(path, alice, { allow: true }),
          api(path, alice, { allow: true }),
        ]);
        expect(approvals.every((response) => response.ok)).toBe(true);
        const created = (await run(client, "create_topic", args)).result;
        expect(created).toMatchObject({
          title: "Logarithms",
          duration: 15,
          calendarSync: "not_connected",
        });
        expect(
          (
            await db
              .collection("users")
              .doc(alice.uid)
              .collection("topics")
              .get()
          ).size,
        ).toBe(1);
        expect(
          (
            await client.callTool({
              name: "create_topic",
              arguments: { ...args, title: "Changed" },
            })
          ).isError,
        ).toBe(true);
        expect(
          await run(client, "get_topic", { topicId: created.topicId }),
        ).toMatchObject({
          initialKnowledge: 3,
          latestRating: null,
          contentIsUntrusted: true,
          materials: [{ text: args.notes, url: null }],
        });
        const own = created.firstReview;
        const planned = DateTime.fromISO(own.scheduledAt).setZone(
          "Asia/Tashkent",
        );
        expect(
          await run(client, "get_due_reviews", {
            window: "range",
            start: planned.toISODate(),
            end: planned.toISODate(),
            tag: "math",
          }),
        ).toMatchObject({ timezone: "Asia/Tashkent", items: [{ id: own.id }] });
        const move = {
          reviewId: own.id,
          scheduledAt: planned
            .plus({ days: 1 })
            .set({ hour: 23, minute: 30 })
            .toISO(),
          idempotencyKey: key(),
        };
        const moved = await run(client, "reschedule_review", move);
        expect(moved.preview.warnings).toContain(
          "Manual time is outside your preferred study hours.",
        );
        expect(
          (await api(actionPath(moved.confirmationUrl), alice, { allow: true }))
            .status,
        ).toBe(200);
        expect(
          (await run(client, "reschedule_review", move)).result.review
            .scheduledAt,
        ).toBe(new Date(move.scheduledAt!).toISOString());
        const complete = { reviewId: own.id, rating: 2, idempotencyKey: key() };
        expect(
          (
            await client.callTool({
              name: "complete_review",
              arguments: { ...complete, rating: 7 },
            })
          ).isError,
        ).toBe(true);
        const pending = await run(client, "complete_review", complete);
        expect(
          (
            await api(actionPath(pending.confirmationUrl), alice, {
              allow: true,
            })
          ).status,
        ).toBe(200);
        expect(
          (await run(client, "complete_review", complete)).result,
        ).toMatchObject({
          review: { id: own.id, rating: 2 },
          nextReview: { status: "pending" },
        });
        expect(
          (await run(client, "get_weak_topics")).items[0].knowledgeReasons,
        ).toContain("latest_rating_at_most_2");
        expect(
          (await api("/reviews/" + own.id + "/correct", alice, { rating: 4 }))
            .status,
        ).toBe(200);
        const next = (
          await run(client, "get_topic", { topicId: created.topicId })
        ).nextReview.id;
        const second = { reviewId: next, rating: 5, idempotencyKey: key() };
        const proposed = await run(client, "complete_review", second);
        expect(
          (
            await api(actionPath(proposed.confirmationUrl), alice, {
              allow: true,
            })
          ).status,
        ).toBe(200);
        expect(
          (await api("/topics/" + created.topicId + "/archive", alice, {}))
            .status,
        ).toBe(200);
        const first = await run(client, "get_review_history", {
          tag: "math",
          status: "archived",
          limit: 1,
        });
        expect(first.items).toMatchObject([{ id: next, rating: 5 }]);
        expect(first.nextCursor).toBeTruthy();
        const last = await run(client, "get_review_history", {
          tag: "math",
          status: "archived",
          limit: 1,
          cursor: first.nextCursor,
        });
        expect(last.items).toMatchObject([
          {
            id: own.id,
            rating: 4,
            correctedAt: expect.any(String),
            scheduledDuration: 15,
          },
        ]);
        expect(last.nextCursor).toBeNull();
        expect(
          await run(client, "get_topic_history", { topicId: created.topicId }),
        ).toMatchObject({
          topic: { reviewCount: 2, latestRating: 5 },
          items: [
            { id: own.id, rating: 4 },
            { id: next, rating: 5 },
          ],
        });
        expect(
          await run(client, "get_learning_stats", { tag: "math" }),
        ).toMatchObject({
          archivedTopics: 1,
          completedReviews: 2,
          sampleAverageRating: 4.5,
          sampleMeanRatingChange: 1,
        });
        expect(await run(client, "get_learning_profile")).toMatchObject({
          recentActivity: [{ rating: 5 }, { rating: 4 }],
          coverage: { historyComplete: true },
        });
      } finally {
        await client.close();
      }
    }, 120_000);

    it("applies authorized writes once, keeps existing confirmations and records automatic execution", async () => {
      const user = await signInAsEmulatedGoogleUser(origin);
      const tokens = await connect(scopes, user);
      const client = await sdk(tokens.access_token);
      const permissions = await api("/connect/applications", user).then(
        (response) => response.json(),
      );
      const grant = permissions.applications[0];
      expect(grant).toMatchObject({ clientId, approvalMode: "ask" });
      const approval = (
        approvalMode: "ask" | "allow",
        who: { uid: string; token: string } = user,
      ) =>
        api("/connect/applications/approval", who, {
          clientId,
          grantId: grant.grantId,
          approvalMode,
        });
      try {
        const pendingArgs = {
          title: "Pending across mode change",
          idempotencyKey: key(),
        };
        const pending = await run(client, "create_topic", pendingArgs);
        expect(pending.state).toBe("confirmation_required");
        expect((await approval("allow", bob)).status).toBe(404);
        expect(
          (
            await approval("allow", {
              uid: user.uid,
              token: tokens.access_token,
            })
          ).status,
        ).toBe(401);
        expect((await approval("allow")).status).toBe(200);
        expect(await run(client, "create_topic", pendingArgs)).toEqual(pending);

        const create = {
          title: "Automatically applied topic",
          idempotencyKey: key(),
        };
        const attempts = await Promise.all([
          run(client, "create_topic", create),
          run(client, "create_topic", create),
        ]);
        expect(attempts[0]).toMatchObject({
          state: "applied",
          result: { title: create.title },
        });
        expect(attempts[1]).toEqual(attempts[0]);
        const conflictingRetry = await client.callTool({
          name: "create_topic",
          arguments: { ...create, title: "Different content for the same key" },
        });
        expect(conflictingRetry.isError).toBe(true);
        expect(JSON.stringify(conflictingRetry.content)).toContain(
          "different action",
        );
        const first = attempts[0].result.firstReview;
        const at = DateTime.fromISO(first.scheduledAt)
          .plus({ minutes: 5 })
          .toISO()!;
        const move = {
          reviewId: first.id,
          scheduledAt: at,
          idempotencyKey: key(),
        };
        const moved = await run(client, "reschedule_review", move);
        expect(moved).toMatchObject({
          state: "applied",
          result: {
            review: { id: first.id, scheduledAt: new Date(at).toISOString() },
          },
        });
        const owner = db.collection("users").doc(user.uid);
        const revision = (await owner.get()).get("revision");
        expect(await run(client, "reschedule_review", move)).toEqual(moved);
        expect((await owner.get()).get("revision")).toBe(revision);
        const occupied = await run(client, "create_topic", {
          title: "Another pending review",
          idempotencyKey: key(),
        });
        const conflict = {
          ...move,
          scheduledAt: occupied.result.firstReview.scheduledAt,
          idempotencyKey: key(),
        };
        expect(conflict.scheduledAt).toBeTruthy();
        const staged = await run(client, "reschedule_review", conflict);
        expect(staged).toMatchObject({
          state: "confirmation_required",
          preview: {
            warnings: expect.arrayContaining([
              "Manual time overlaps another review.",
            ]),
          },
        });
        expect(
          (
            await api(actionPath(staged.confirmationUrl), user, {
              allow: false,
            })
          ).status,
        ).toBe(200);

        const complete = {
          reviewId: first.id,
          rating: 3,
          idempotencyKey: key(),
        };
        const done = await run(client, "complete_review", complete);
        expect(done).toMatchObject({
          state: "applied",
          result: { review: { id: first.id, rating: 3 } },
        });
        expect(await run(client, "complete_review", complete)).toEqual(done);
        for (const [name, args] of [
          ["create_topic", create],
          ["reschedule_review", move],
          ["complete_review", complete],
        ] as const) {
          const id = digest(
            JSON.stringify([user.uid, clientId, name, args.idempotencyKey]),
          );
          expect(
            (await db.collection("mcpActions").doc(id).get()).data(),
          ).toMatchObject({
            state: "approved",
            executionMode: "automatic",
          });
        }
        expect(
          (
            await db
              .collection("users")
              .doc(user.uid)
              .collection("topics")
              .get()
          ).size,
        ).toBe(2);
        expect(
          (
            await db
              .collection("users")
              .doc(user.uid)
              .collection("reviewHistory")
              .get()
          ).size,
        ).toBe(1);
        expect((await approval("ask")).status).toBe(200);
        expect(
          await run(client, "create_topic", {
            ...create,
            idempotencyKey: key(),
          }),
        ).toMatchObject({ state: "confirmation_required" });
        expect(
          (
            await api(actionPath(pending.confirmationUrl), user, {
              allow: true,
            })
          ).status,
        ).toBe(200);
        expect(await run(client, "create_topic", pendingArgs)).toMatchObject({
          state: "applied",
        });
        expect((await approval("allow")).status).toBe(200);
        const replacement = await connect(["topics:read"], user);
        expect((await mcp(tokens.access_token)).status).toBe(401);
        expect((await approval("allow")).status).toBe(404);
        const { applications } = await api("/connect/applications", user).then(
          (response) => response.json(),
        );
        expect(applications).toMatchObject([
          { clientId, approvalMode: "ask", scopes: ["topics:read"] },
        ]);
        expect(
          (
            await api("/connect/applications/approval", user, {
              clientId,
              grantId: applications[0].grantId,
              approvalMode: "allow",
            })
          ).status,
        ).toBe(403);
        const readClient = await sdk(replacement.access_token);
        try {
          await expect(
            readClient.callTool({ name: "create_topic", arguments: create }),
          ).rejects.toThrow();
        } finally {
          await readClient.close();
        }

        const expiring = await connect(scopes, user);
        const freshGrant = (
          await api("/connect/applications", user).then((response) =>
            response.json(),
          )
        ).applications[0];
        expect(
          (
            await api("/connect/applications/approval", user, {
              clientId,
              grantId: freshGrant.grantId,
              approvalMode: "allow",
            })
          ).status,
        ).toBe(200);
        await db
          .collection("mcpAccounts")
          .doc(user.uid)
          .update(`grants.${digest(clientId)}.expires`, Date.now() - 1);
        expect((await mcp(expiring.access_token)).status).toBe(401);

        const revoking = await connect(scopes, user);
        const revokingGrant = (
          await api("/connect/applications", user).then((response) =>
            response.json(),
          )
        ).applications[0];
        expect(
          (
            await api("/connect/applications/approval", user, {
              clientId,
              grantId: revokingGrant.grantId,
              approvalMode: "allow",
            })
          ).status,
        ).toBe(200);
        expect((await api("/connect/revoke", user, { clientId })).status).toBe(
          200,
        );
        expect((await mcp(revoking.access_token)).status).toBe(401);
      } finally {
        await client.close();
      }
    }, 60_000);

    it("returns the committed receipt when a same-key completion wins during target lookup", async () => {
      const user = await signInAsEmulatedGoogleUser(origin);
      const tokens = await connect(scopes, user);
      const {
        applications: [grant],
      } = await api("/connect/applications", user).then((r) => r.json());
      expect(
        (
          await api("/connect/applications/approval", user, {
            clientId,
            grantId: grant.grantId,
            approvalMode: "allow",
          })
        ).status,
      ).toBe(200);
      const client = await sdk(tokens.access_token);
      try {
        const created = await run(client, "create_topic", {
          title: "Completion retry",
          idempotencyKey: key(),
        });
        const args = {
          reviewId: created.result.firstReview.id,
          rating: 3,
          idempotencyKey: key(),
        };
        const principal = {
          uid: user.uid,
          clientId,
          grantId: grant.grantId,
          scopes: grant.scopes,
        };
        // Let the HTTP call commit after the competing invocation misses the action
        // record, but before it observes the target review's status.
        let committed;
        const get = store.get;
        const lookup = vi
          .spyOn(store, "get")
          .mockImplementationOnce(async (...params) => {
            committed = await run(client, "complete_review", args);
            return get(...params);
          });
        try {
          const retry = await requestMutation(
            principal,
            "complete_review",
            completeInput.parse(args),
            origin,
          );
          expect(committed).toMatchObject({ state: "applied" });
          expect(retry).toEqual(committed);
        } finally {
          lookup.mockRestore();
        }
        expect(
          (
            await db
              .collection("users")
              .doc(user.uid)
              .collection("reviewHistory")
              .get()
          ).size,
        ).toBe(1);
        for (const [name, extra] of [
          ["complete_review", { rating: 3 }],
          ["reschedule_review", { scheduledAt: "2099-01-01T12:00:00Z" }],
        ] as const) {
          const idempotencyKey = key();
          const missing = await client.callTool({
            name,
            arguments: { ...extra, reviewId: "missing", idempotencyKey },
          });
          expect(missing).toMatchObject({
            isError: true,
            content: [{ type: "text", text: "Review not found" }],
          });
          const actionId = digest(
            JSON.stringify([user.uid, clientId, name, idempotencyKey]),
          );
          expect(
            (await db.collection("mcpActions").doc(actionId).get()).exists,
          ).toBe(false);
        }
      } finally {
        await client.close();
      }
    });

    it.each([
      ["account deletion", 410],
      ["grant revocation", 403],
      ["scope removal", 403],
      ["new scheduling warning", 409],
      ["approval mode change", null],
    ] as const)(
      "rechecks %s at automatic reschedule commit",
      async (change, statusCode) => {
        const user = await signInAsEmulatedGoogleUser(origin);
        const granted = ["reviews:write", "reviews:read"] as const;
        const tokens = await connect([...granted], user);
        const { applications } = await api("/connect/applications", user).then(
          (r) => r.json(),
        );
        const { grantId } = applications[0];
        const principal = {
          uid: user.uid,
          clientId,
          grantId,
          scopes: [...granted],
        };
        const approval = (approvalMode: "ask" | "allow") =>
          api("/connect/applications/approval", user, {
            clientId,
            grantId,
            approvalMode,
          });
        expect((await approval("allow")).status).toBe(200);

        const topic = await createTopic(user.uid, {
          title: "Reschedule under a changing grant",
        });
        const root = db.doc("users/" + user.uid);
        const ownerGrant = db.doc("mcpAccounts/" + user.uid);
        const connection = db.doc("calendarConnections/" + user.uid);
        const deletion = deletionRef(user.uid);
        const pending = (
          await root
            .collection("reviewSchedules")
            .where("topic_id", "==", topic.id)
            .get()
        ).docs[0];
        const original = pending.get("scheduled_at");
        const at = DateTime.fromISO(original).plus({ minutes: 5 });
        const input = {
          reviewId: pending.id,
          scheduledAt: at.toISO()!,
          idempotencyKey: key(),
        };
        const name = "reschedule_review";
        const action = db.doc(
          "mcpActions/" +
            digest(
              JSON.stringify([user.uid, clientId, name, input.idempotencyKey]),
            ),
        );
        const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
        const calendar = vi
          .spyOn(CalendarSync.prototype, "availability")
          .mockResolvedValueOnce([])
          .mockImplementationOnce(async () => {
            expect((await action.get()).data()).toMatchObject({
              state: "pending",
              automatic: true,
              preview: { warnings: [] },
            });
            if (change === "account deletion") {
              process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
              await connection.set({
                connected: false,
                encrypted_tokens: encrypt({
                  refresh_token: "deletion-fixture",
                }),
              });
              expect(
                (await api("/account/delete", user, { confirm: true })).status,
              ).toBe(202);
            } else if (change === "grant revocation") {
              expect(
                (await api("/connect/revoke", user, { clientId })).status,
              ).toBe(200);
            } else if (change === "scope removal") {
              await ownerGrant.update(
                "grants." + digest(clientId) + ".scopes",
                ["reviews:read"],
              );
            } else if (change === "new scheduling warning") {
              return [
                { start: at.toISO()!, end: at.plus({ hours: 1 }).toISO()! },
              ];
            } else {
              expect((await approval("ask")).status).toBe(200);
            }
            return [];
          });
        try {
          const attempt = requestMutation(principal, name, input, origin);
          if (statusCode !== null)
            await expect(attempt).rejects.toMatchObject({ statusCode });
          else {
            const proposal = await attempt;
            expect(proposal).toMatchObject({ state: "confirmation_required" });
            expect((await action.get()).get("automatic")).toBe(false);
            expect((await approval("allow")).status).toBe(200);
            expect(
              await requestMutation(principal, name, input, origin),
            ).toEqual(proposal);
          }
          expect(calendar).toHaveBeenCalledTimes(2);
          expect((await action.get()).get("state")).toBe("pending");
          expect((await pending.ref.get()).get("scheduled_at")).toBe(original);

          if (change === "account deletion" || change === "grant revocation")
            expect((await mcp(tokens.access_token)).status).toBe(401);
          if (change === "scope removal") {
            await expect(
              requestMutation(
                { ...principal, scopes: ["reviews:read"] },
                name,
                input,
                origin,
              ),
            ).rejects.toMatchObject({ statusCode: 403 });
          }
          if (change === "account deletion") {
            expect((await approval("allow")).status).toBe(410);
            const revocations: string[] = [];
            await processDeletion(deletion, async (url, options) => {
              expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
              revocations.push(String(options?.body));
              return new Response(null, { status: 204 });
            });
            expect(revocations).toEqual(["token=deletion-fixture"]);
            expect((await deletion.get()).data()).toEqual({ completed: true });
            expect((await action.get()).exists).toBe(false);
            expect((await root.get()).exists).toBe(false);
            expect((await connection.get()).exists).toBe(false);
          }
        } finally {
          calendar.mockRestore();
          if (previousKey === undefined)
            delete process.env.TOKEN_ENCRYPTION_KEY;
          else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
          await Promise.all([
            db.recursiveDelete(root),
            deletion.delete(),
            connection.delete(),
            action.delete(),
            ownerGrant.delete(),
          ]);
          await auth.deleteUser(user.uid).catch((error) => {
            if (error.code !== "auth/user-not-found") throw error;
          });
        }
      },
    );

    it("blocks automatic approval changes when global writes are disabled", async () => {
      await connect(["topics:read", "topics:write"], bob);
      const { applications } = await api("/connect/applications", bob).then(
        (response) => response.json(),
      );
      const grant = applications[0];
      const prior = process.env.BLIND_SPOT_CONNECT_WRITES;
      process.env.BLIND_SPOT_CONNECT_WRITES = "false";
      const server = createApp().listen(0, "127.0.0.1");
      process.env.BLIND_SPOT_CONNECT_WRITES = prior;
      try {
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Expected a loopback HTTP server");
        const response = await fetch(
          "http://127.0.0.1:" +
            address.port +
            "/api/v1/connect/applications/approval",
          {
            method: "POST",
            headers: {
              origin,
              authorization: "Bearer " + bob.token,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              clientId,
              grantId: grant.grantId,
              approvalMode: "allow",
            }),
          },
        );
        expect(response.status).toBe(403);
      } finally {
        server.close();
      }
    });

    it("isolates accounts and invalidates previously issued tokens on first-party and OAuth revocation", async () => {
      const tokens = await connect(scopes, bob);
      const client = await sdk(tokens.access_token);
      try {
        const foreign = (
          await db
            .collection("users")
            .doc(alice.uid)
            .collection("topics")
            .limit(1)
            .get()
        ).docs[0].id;
        expect(
          (
            await client.callTool({
              name: "get_topic",
              arguments: { topicId: foreign },
            })
          ).isError,
        ).toBe(true);
        expect(
          (await run(client, "get_review_history", { topicId: foreign })).items,
        ).toEqual([]);
        const apps = await api("/connect/applications", bob).then((response) =>
          response.json(),
        );
        expect(apps.applications).toMatchObject([{ clientId, scopes }]);
        expect(apps.platforms).toEqual({
          chatgpt: false,
          claude: true,
          gemini: false,
          other: true,
        });
        expect((await api("/connect/revoke", bob, { clientId })).status).toBe(
          200,
        );
        expect((await mcp(tokens.access_token)).status).toBe(401);
      } finally {
        await client.close();
      }
      const newer = await connect(["topics:read"], bob);
      expect(
        (
          await form("/revoke", {
            client_id: clientId,
            token: newer.refresh_token,
          })
        ).status,
      ).toBe(200);
      expect((await mcp(newer.access_token)).status).toBe(401);
      const latest = await connect(["topics:read"], bob);
      expect((await api("/connect/revoke", bob, {})).status).toBe(200);
      expect((await mcp(latest.access_token)).status).toBe(401);
    });

    it("rate limits a single application without charging the other account", async () => {
      const aliceTokens = await connect(["topics:read"], alice);
      const bobTokens = await connect(["topics:read"], bob);
      const minute = Math.floor(Date.now() / 60_000);
      const appKey = "application:" + digest(alice.uid + ":" + clientId);
      await db
        .collection("rateLimits")
        .doc(digest("mcp:" + appKey + ":" + minute))
        .set({ count: 30 });
      expect((await mcp(aliceTokens.access_token)).status).toBe(429);
      expect((await mcp(bobTokens.access_token)).status).toBe(405);
    });

    it.runIf(process.env.BLIND_SPOT_CONNECT_INSPECTOR === "true")(
      "lists and calls tools with official MCP Inspector CLI",
      async () => {
        const { access_token } = await connect(["topics:read"], bob);
        const directory = await mkdtemp(join(tmpdir(), "blindspot-inspector-"));
        try {
          const args = [
            "--yes",
            "@modelcontextprotocol/inspector@2.16.0",
            "--cli",
            resource,
            "--transport",
            "http",
            "--header",
            "Authorization: Bearer " + access_token,
          ];
          const options = {
            env: {
              ...process.env,
              MCP_CATALOG_PATH: join(directory, "catalog.json"),
            },
          };
          const inspect = (method: string[]) =>
            new Promise<string>((resolve, reject) => {
              execFile(
                "npx",
                [...args, ...method],
                options,
                (error, stdout, stderr) => {
                  if (error) {
                    const message = stderr.replaceAll(
                      access_token,
                      "[redacted]",
                    );
                    reject(new Error("MCP Inspector CLI failed: " + message));
                  } else resolve(stdout);
                },
              );
            });
          const listed = await inspect(["--method", "tools/list"]);
          expect(listed).toContain("get_review_history");
          const called = await inspect([
            "--method",
            "tools/call",
            "--tool-name",
            "list_topics",
          ]);
          expect(called).toContain("nextCursor");
        } finally {
          await rm(directory, { recursive: true });
        }
      },
      90_000,
    );
  },
);
