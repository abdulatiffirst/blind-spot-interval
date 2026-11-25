import { randomBytes } from "node:crypto";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import { digest } from "../domain.ts";
import { auth, db, fail, type RecordData } from "../store.ts";
import { emulator } from "../calendar.ts";

export const scopes = [
  "topics:read",
  "topics:write",
  "reviews:read",
  "reviews:write",
  "reviews:history:read",
] as const;
export type Scope = (typeof scopes)[number];
export const scopeSchema = z.enum(scopes);
export const secret = () => randomBytes(32).toString("base64url");
export const handle = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const accessSeconds = 600;
const refreshMillis = 30 * 86400_000;
const grantMillis = 90 * 86400_000;
const fresh = (row: RecordData | undefined) =>
  !!row && row.expiresAt.toMillis() > Date.now();
const transient = (kind: string, value: string) =>
  db.collection("mcpEphemeral").doc(digest(kind + ":" + value));
export const account = (uid: string) => db.collection("mcpAccounts").doc(uid);
const expiry = (ms: number) => new Date(Date.now() + ms);

export type Grant = {
  id: string;
  clientId: string;
  name: string;
  host: string;
  scopes: Scope[];
  connectedAt: string;
  expires: number;
};
export type Principal = {
  uid: string;
  clientId: string;
  grantId: string;
  scopes: Scope[];
};
const getGrant = (
  row: RecordData | undefined,
  client: string,
): Grant | undefined => {
  const grant = row?.grants?.[digest(client)] as Grant | undefined;
  return grant && grant.expires > Date.now() ? grant : undefined;
};
function saveGrants(
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  grants: Record<string, Grant>,
) {
  const active = Object.fromEntries(
    Object.entries(grants).filter(([, grant]) => grant.expires > Date.now()),
  );
  const expirations = Object.values(active).map((grant) => grant.expires);
  if (expirations.length)
    tx.set(ref, {
      grants: active,
      expiresAt: new Date(Math.max(...expirations)),
    });
  else tx.delete(ref);
}
export function activeGrant(row: RecordData | undefined, p: Principal) {
  return getGrant(row, p.clientId)?.id === p.grantId;
}
export async function limit(key: string, maximum: number) {
  const minute = Math.floor(Date.now() / 60000);
  const ref = db
    .collection("rateLimits")
    .doc(digest("mcp:" + key + ":" + minute));
  await db.runTransaction(async (tx) => {
    const count = (await tx.get(ref)).data()?.count ?? 0;
    if (count >= maximum)
      fail(429, "Too many requests. Try again in a minute.");
    tx.set(ref, { count: count + 1, expiresAt: expiry(120_000) });
  });
}
export function audit(event: string, uid: string, client?: string) {
  console.info("Blind Spot Connect", {
    event,
    account: digest(uid),
    application: client,
  });
}

const redirect = z
  .string()
  .max(1024)
  .url()
  .refine((value) => {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].some((key) =>
        ["code", "state", "error", "error_description", "iss"].includes(key),
      )
    )
      return false;
    if (url.protocol === "https:") return true;
    // Native apps can receive their PKCE authorization code over a provisioned
    // loopback port. Authorization and token exchange still require the exact URI.
    return (
      url.protocol === "http:" &&
      !!url.port &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  });
const staticClient = z.strictObject({
  client_id: clientId,
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(redirect).min(1).max(5),
});
export function config() {
  if (process.env.BLIND_SPOT_CONNECT_ENABLED !== "true") return null;
  const issuer = z.url().parse(process.env.BLIND_SPOT_CONNECT_ORIGIN);
  const url = new URL(issuer);
  const local = emulator() && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (local && !emulator())
  )
    throw new Error("Invalid Blind Spot Connect origin");
  return {
    origin: url.origin,
    resource: new URL("/api/mcp", url),
    writes: process.env.BLIND_SPOT_CONNECT_WRITES === "true",
    clients: z
      .array(staticClient)
      .max(50)
      .parse(JSON.parse(process.env.BLIND_SPOT_CONNECT_CLIENTS ?? "[]")),
    redirects: z
      .array(redirect)
      .max(30)
      .parse(
        JSON.parse(
          process.env.BLIND_SPOT_CONNECT_REGISTRATION_REDIRECTS ?? "[]",
        ),
      ),
  };
}
export type Config = NonNullable<ReturnType<typeof config>>;

export function oauth(settings: Config) {
  const resource = settings.resource.href;
  const available = scopes.filter(
    (scope) => settings.writes || !scope.endsWith(":write"),
  );
  const configured = new Map(
    settings.clients.map((client) => [
      client.client_id,
      { ...client, token_endpoint_auth_method: "none" },
    ]),
  );
  const audience = (target?: URL) => {
    // Clients omitting RFC 8707 still receive a token bound to the sole resource.
    if (target && target.href !== resource)
      throw new InvalidTargetError("Unknown resource");
  };
  const clientsStore: OAuthServerProvider["clientsStore"] = {
    async getClient(id) {
      if (!clientId.safeParse(id).success) return;
      const provisioned = configured.get(id);
      if (provisioned || !settings.redirects.length) return provisioned;
      const registered = (
        await db.collection("mcpClients").doc(id).get()
      ).data();
      if (
        registered &&
        fresh(registered) &&
        registered.redirect_uris.every((uri: string) =>
          settings.redirects.includes(uri),
        )
      )
        return registered as OAuthClientInformationFull;
    },
    ...(settings.redirects.length
      ? {
          async registerClient(
            input: Omit<OAuthClientInformationFull, "client_id"> & {
              client_id?: string;
            },
          ) {
            if (
              input.token_endpoint_auth_method !== "none" ||
              !input.redirect_uris.length ||
              input.redirect_uris.length > 5 ||
              !input.redirect_uris.every((uri) =>
                settings.redirects.includes(uri),
              ) ||
              input.grant_types?.some(
                (type) =>
                  !["authorization_code", "refresh_token"].includes(type),
              ) ||
              input.response_types?.some((type) => type !== "code")
            )
              throw new InvalidClientMetadataError(
                "Use public PKCE credentials and an approved callback URL",
              );
            const registered = {
              client_id: "dcr_" + secret(),
              client_name: (
                input.client_name || new URL(input.redirect_uris[0]).hostname
              )
                .trim()
                .slice(0, 100),
              redirect_uris: input.redirect_uris,
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              client_id_issued_at: Math.floor(Date.now() / 1000),
            };
            await db
              .collection("mcpClients")
              .doc(registered.client_id)
              .create({ ...registered, expiresAt: expiry(180 * 86400_000) });
            return registered;
          },
        }
      : {}),
  };
  function validateCode(row: RecordData | undefined, client: string) {
    if (
      !row ||
      !fresh(row) ||
      row.clientId !== client ||
      row.resource !== resource
    )
      throw new InvalidGrantError("Invalid or expired authorization code");
    return row;
  }
  function issue(tx: FirebaseFirestore.Transaction, principal: Principal) {
    const access = secret(),
      refresh = secret();
    tx.create(transient("access", access), {
      ...principal,
      resource,
      expiresAt: expiry(accessSeconds * 1000),
    });
    tx.create(transient("refresh", refresh), {
      ...principal,
      resource,
      expiresAt: expiry(refreshMillis),
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: accessSeconds,
      scope: principal.scopes.join(" "),
    };
  }
  const provider: OAuthServerProvider = {
    clientsStore,
    async authorize(client, params: AuthorizationParams, res) {
      audience(params.resource);
      if (
        !client.redirect_uris.includes(params.redirectUri) ||
        !handle.safeParse(params.codeChallenge).success ||
        !params.state ||
        params.state.length > 1024
      )
        throw new InvalidRequestError(
          "A registered redirect URI, S256 challenge and state are required",
        );
      const requested = [
        ...new Set(
          params.scopes?.length
            ? params.scopes
            : ["topics:read", "reviews:read"],
        ),
      ] as Scope[];
      if (!requested.every((scope) => available.includes(scope)))
        throw new InvalidScopeError("Unknown or disabled scope");
      const id = secret(),
        browser = secret();
      await transient("consent", id).create({
        clientId: client.client_id,
        name: client.client_name || new URL(params.redirectUri).hostname,
        redirectUri: params.redirectUri,
        scopes: requested,
        challenge: params.codeChallenge,
        state: params.state,
        browser: digest(browser),
        resource,
        expiresAt: expiry(600_000),
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.cookie("__session", browser, {
        path: "/api/v1/connect",
        httpOnly: true,
        sameSite: "lax",
        secure: settings.origin.startsWith("https:"),
        maxAge: 600_000,
      });
      res.redirect(302, settings.origin + "/connect/authorize#" + id);
    },
    async challengeForAuthorizationCode(client, code) {
      if (!handle.safeParse(code).success)
        throw new InvalidGrantError("Invalid authorization code");
      return validateCode(
        (await transient("code", code).get()).data(),
        client.client_id,
      ).challenge;
    },
    async exchangeAuthorizationCode(
      client,
      code,
      _verifier,
      redirectUri,
      target,
    ) {
      audience(target);
      const ref = transient("code", code);
      return db.runTransaction(async (tx) => {
        const row = validateCode((await tx.get(ref)).data(), client.client_id);
        if (
          row.redirectUri !== redirectUri ||
          !activeGrant(
            (await tx.get(account(row.uid))).data(),
            row as Principal,
          )
        )
          throw new InvalidGrantError(
            "Invalid authorization grant or redirect URI",
          );
        tx.delete(ref);
        return issue(tx, {
          uid: row.uid,
          clientId: row.clientId,
          grantId: row.grantId,
          scopes: row.scopes,
        });
      });
    },
    async exchangeRefreshToken(client, token, requested, target) {
      audience(target);
      if (!handle.safeParse(token).success)
        throw new InvalidGrantError("Invalid refresh token");
      const ref = transient("refresh", token);
      const result = await db.runTransaction(async (tx) => {
        const row = (await tx.get(ref)).data();
        if (
          !row ||
          !fresh(row) ||
          row.clientId !== client.client_id ||
          row.resource !== resource
        )
          throw new InvalidGrantError("Invalid or expired refresh token");
        const owner = account(row.uid);
        const grants = (await tx.get(owner)).data()?.grants ?? {};
        if (!activeGrant({ grants }, row as Principal))
          throw new InvalidGrantError("Grant revoked");
        if (row.used) {
          delete grants[digest(client.client_id)];
          saveGrants(tx, owner, grants);
          return { replayUid: row.uid } as const;
        }
        const selected = requested ? [...new Set(requested)] : row.scopes;
        if (!selected.every((scope: Scope) => row.scopes.includes(scope)))
          throw new InvalidScopeError("Cannot expand the original scopes");
        tx.update(ref, { used: true });
        return {
          tokens: issue(tx, {
            uid: row.uid,
            clientId: row.clientId,
            grantId: row.grantId,
            scopes: selected,
          }),
        };
      });
      if (result.tokens) return result.tokens;
      audit("refresh_replay", result.replayUid, client.client_id);
      throw new InvalidGrantError("Refresh token already used");
    },
    async verifyAccessToken(token) {
      if (!handle.safeParse(token).success)
        throw new InvalidTokenError("Invalid access token");
      const row = (await transient("access", token).get()).data();
      if (
        !row ||
        !fresh(row) ||
        row.resource !== resource ||
        !activeGrant((await account(row.uid).get()).data(), row as Principal)
      )
        throw new InvalidTokenError("Invalid, expired or revoked token");
      const identity = await auth.getUser(row.uid).catch((error) => {
        if (error.code !== "auth/user-not-found") throw error;
        return null;
      });
      if (!identity || identity.disabled)
        throw new InvalidTokenError("Account is unavailable");
      const granted = row.scopes.filter((scope: Scope) =>
        available.includes(scope),
      );
      const principal: Principal = {
        uid: row.uid,
        clientId: row.clientId,
        grantId: row.grantId,
        scopes: granted,
      };
      return {
        token,
        clientId: row.clientId,
        scopes: granted,
        expiresAt: row.expiresAt.seconds,
        resource: settings.resource,
        extra: { principal },
      };
    },
    async revokeToken(client, { token }) {
      if (!handle.safeParse(token).success) return;
      const [access, refresh] = await db.getAll(
        transient("access", token),
        transient("refresh", token),
      );
      const row = access.data() ?? refresh.data();
      if (row?.clientId === client.client_id)
        await revoke(row.uid, row.clientId, row.grantId);
    },
  };
  return { provider, available };
}

function consentValid(
  row: RecordData | undefined,
  browser: string | undefined,
) {
  if (!row || !fresh(row) || !browser || row.browser !== digest(browser))
    fail(
      404,
      "This authorization request has expired or was opened in another browser",
    );
  return row;
}
export async function inspectConsent(id: string, browser: string | undefined) {
  const row = consentValid(
    (await transient("consent", id).get()).data(),
    browser,
  );
  return {
    name: row.name,
    host: new URL(row.redirectUri).host,
    scopes: row.scopes,
  };
}
export async function respondToConsent(
  uid: string,
  id: string,
  browser: string | undefined,
  selected: Scope[],
) {
  const ref = transient("consent", id),
    code = secret();
  const result = await db.runTransaction(async (tx) => {
    const row = consentValid((await tx.get(ref)).data(), browser);
    if (
      new Set(selected).size !== selected.length ||
      !selected.every((scope) => row.scopes.includes(scope))
    )
      fail(400, "Select only requested permissions");
    const url = new URL(row.redirectUri);
    url.searchParams.set("state", row.state);
    if (selected.length) {
      const owner = account(uid),
        key = digest(row.clientId);
      const current: Record<string, Grant> =
        (await tx.get(owner)).data()?.grants ?? {};
      const grants = Object.fromEntries(
        Object.entries(current).filter(
          ([, grant]) => grant.expires > Date.now(),
        ),
      );
      if (!Object.hasOwn(grants, key) && Object.keys(grants).length >= 25)
        fail(409, "Disconnect an application before adding another");
      const grant: Grant = {
        id: secret(),
        clientId: row.clientId,
        name: row.name,
        host: url.host,
        scopes: selected,
        connectedAt: new Date().toISOString(),
        expires: Date.now() + grantMillis,
      };
      grants[key] = grant;
      saveGrants(tx, owner, grants);
      tx.create(transient("code", code), {
        uid,
        clientId: row.clientId,
        grantId: grant.id,
        scopes: selected,
        resource: row.resource,
        challenge: row.challenge,
        redirectUri: row.redirectUri,
        expiresAt: expiry(120_000),
      });
      url.searchParams.set("code", code);
    } else url.searchParams.set("error", "access_denied");
    tx.delete(ref);
    return { url: url.href, client: row.clientId };
  });
  audit(
    selected.length ? "consent_granted" : "consent_denied",
    uid,
    result.client,
  );
  return { url: result.url };
}
export async function listGrants(uid: string) {
  const row = (await account(uid).get()).data();
  return (Object.values(row?.grants ?? {}) as Grant[])
    .filter((grant) => grant.expires > Date.now())
    .map(({ clientId, name, host, scopes, connectedAt }) => ({
      clientId,
      name,
      host,
      scopes,
      connectedAt,
    }));
}
export async function revoke(uid: string, client?: string, expected?: string) {
  const owner = account(uid);
  await db.runTransaction(async (tx) => {
    const grants = (await tx.get(owner)).data()?.grants ?? {};
    if (client) {
      const key = digest(client);
      if (!grants[key] || (expected && grants[key].id !== expected)) return;
      delete grants[key];
    }
    saveGrants(tx, owner, client ? grants : {});
  });
  audit(
    client ? "application_revoked" : "all_applications_revoked",
    uid,
    client,
  );
}
