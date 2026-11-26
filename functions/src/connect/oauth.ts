import { randomBytes, timingSafeEqual } from "node:crypto";
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
import {
  auth,
  db,
  fail,
  requireActiveAccount,
  type RecordData,
} from "../store.ts";
import { emulator } from "../calendar.ts";
import {
  connectPlatformForHost,
  type ConnectApprovalMode,
} from "../../../packages/shared/src/connect-platforms.ts";

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
// Firebase Hosting rejected an 8 KiB request target. Budget for form encoding
// and leave room for the other OAuth parameters and the callback URL.
const maxEncodedState = 6000;
export function authorizationStateError(state: unknown) {
  if (typeof state !== "string" || !state) return "missing_state";
  if (
    state.length > maxEncodedState ||
    new URLSearchParams({ state }).toString().length - "state=".length >
      maxEncodedState
  )
    return "oversized_state";
}
export const handle = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const clientId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const clientAuthMethods = [
  "none",
  "client_secret_basic",
  "client_secret_post",
] as const;
const clientAuthMethod = z.enum(clientAuthMethods);
const registrationSeconds = 180 * 86400;
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
  approvalMode?: ConnectApprovalMode;
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
export function matchingGrant(
  row: RecordData | undefined,
  p: Pick<Principal, "clientId" | "grantId">,
) {
  const grant = getGrant(row, p.clientId);
  if (grant?.id === p.grantId) return grant;
}
export function activeGrant(row: RecordData | undefined, p: Principal) {
  return !!matchingGrant(row, p);
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
    const url = URL.parse(value);
    if (
      !url ||
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
function geminiRedirect(value: string) {
  const url = URL.parse(value);
  return (
    !!url &&
    url.protocol === "https:" &&
    connectPlatformForHost(url.host) === "gemini" &&
    /^\/[ra]\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
    value === url.origin + url.pathname
  );
}
const geminiRedirects = z.array(redirect.refine(geminiRedirect)).max(180);

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
    geminiRegistry: process.env.BLIND_SPOT_CONNECT_GEMINI_REGISTRY === "true",
    geminiPersistentRefresh:
      process.env.BLIND_SPOT_CONNECT_GEMINI_PERSISTENT_REFRESH === "true",
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

export async function registrationRedirects(settings: Config) {
  if (!settings.geminiRegistry) return settings.redirects;
  const registry = (await db.doc("mcpConfiguration/gemini").get()).data();
  const result = geminiRedirects.safeParse(registry?.redirect_uris ?? []);
  if (!result.success) {
    console.warn("Blind Spot Connect Gemini redirect registry rejected");
    return settings.redirects;
  }
  return [...settings.redirects, ...result.data];
}

function rejectRegistration(reason: string): never {
  console.warn("Blind Spot Connect registration rejected", { reason });
  throw new InvalidClientMetadataError(
    "Use a supported client method and approved callback URLs",
  );
}

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
  const registrationEnabled =
    settings.redirects.length > 0 || settings.geminiRegistry;
  async function lookupClient(id: string) {
    if (!clientId.safeParse(id).success) return;
    const provisioned = configured.get(id);
    if (provisioned) return { info: provisioned, secretHash: undefined };
    if (!registrationEnabled) return;
    const row = (await db.collection("mcpClients").doc(id).get()).data();
    if (!row || !fresh(row)) return;
    const info: OAuthClientInformationFull = {
      client_id: id,
      client_name: row.client_name,
      redirect_uris: row.redirect_uris,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      client_secret_expires_at: row.client_secret_expires_at,
    };
    if (info.redirect_uris.every((uri) => settings.redirects.includes(uri)))
      return { info, secretHash: row.clientSecretHash as string | undefined };
    if (settings.geminiRegistry) {
      const approved = await registrationRedirects(settings);
      if (info.redirect_uris.every((uri) => approved.includes(uri)))
        return { info, secretHash: row.clientSecretHash as string | undefined };
    }
  }

  const clientsStore: OAuthServerProvider["clientsStore"] = {
    async getClient(id) {
      return (await lookupClient(id))?.info;
    },
    ...(registrationEnabled
      ? {
          async registerClient(
            input: Omit<OAuthClientInformationFull, "client_id">,
          ) {
            const method = clientAuthMethod.safeParse(
              input.token_endpoint_auth_method ?? "client_secret_basic",
            );
            if (!method.success) rejectRegistration("unsupported_auth_method");
            if (
              !input.redirect_uris.length ||
              input.redirect_uris.length > 6 ||
              !input.redirect_uris.every(
                (uri) => redirect.safeParse(uri).success,
              )
            )
              rejectRegistration("invalid_redirects");
            const approved = input.redirect_uris.every((uri) =>
              settings.redirects.includes(uri),
            )
              ? settings.redirects
              : await registrationRedirects(settings);
            if (!input.redirect_uris.every((uri) => approved.includes(uri)))
              rejectRegistration("unapproved_redirect");
            if (
              input.grant_types?.some(
                (type) =>
                  !["authorization_code", "refresh_token"].includes(type),
              ) ||
              input.response_types?.some((type) => type !== "code")
            )
              rejectRegistration("unsupported_grant_or_response_type");
            const confidential = method.data !== "none";
            const clientSecret = confidential ? secret() : undefined;
            const issuedAt = Math.floor(Date.now() / 1000);
            const registered = {
              client_id: "dcr_" + secret(),
              client_name: (
                input.client_name?.trim() ||
                new URL(input.redirect_uris[0]).hostname
              ).slice(0, 100),
              redirect_uris: input.redirect_uris,
              token_endpoint_auth_method: method.data,
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              client_id_issued_at: issuedAt,
              ...(confidential
                ? { client_secret_expires_at: issuedAt + registrationSeconds }
                : {}),
            };
            await db
              .collection("mcpClients")
              .doc(registered.client_id)
              .create({
                ...registered,
                ...(clientSecret
                  ? { clientSecretHash: digest(clientSecret) }
                  : {}),
                expiresAt: new Date((issuedAt + registrationSeconds) * 1000),
              });
            return {
              ...registered,
              ...(clientSecret ? { client_secret: clientSecret } : {}),
            };
          },
        }
      : {}),
  };
  async function authenticateClient(
    id: string,
    method: string,
    credential?: string,
  ) {
    const client = await lookupClient(id);
    if (!client || method !== client.info.token_endpoint_auth_method)
      return false;
    if (method === "none")
      return !client.secretHash && credential === undefined;
    if (
      !credential ||
      !client.secretHash ||
      !/^[0-9a-f]{64}$/.test(client.secretHash) ||
      !client.info.client_secret_expires_at ||
      client.info.client_secret_expires_at <= Date.now() / 1000
    )
      return false;
    return timingSafeEqual(
      Buffer.from(digest(credential), "hex"),
      Buffer.from(client.secretHash, "hex"),
    );
  }
  function persistentFor(client: OAuthClientInformationFull) {
    return (
      settings.geminiPersistentRefresh &&
      (client.token_endpoint_auth_method === "client_secret_post" ||
        client.token_endpoint_auth_method === "client_secret_basic") &&
      client.redirect_uris.every(geminiRedirect)
    );
  }
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
  function issue(
    tx: FirebaseFirestore.Transaction,
    principal: Principal,
    persistent: boolean,
    existingRefresh?: {
      ref: FirebaseFirestore.DocumentReference;
      token: string;
    },
  ) {
    const access = secret();
    const refresh = existingRefresh?.token ?? secret();
    tx.create(transient("access", access), {
      ...principal,
      resource,
      expiresAt: expiry(accessSeconds * 1000),
    });
    const expiresAt = expiry(refreshMillis);
    if (existingRefresh)
      tx.update(existingRefresh.ref, { scopes: principal.scopes, expiresAt });
    else
      tx.create(transient("refresh", refresh), {
        ...principal,
        resource,
        expiresAt,
        persistent,
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
        authorizationStateError(params.state)
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
        return issue(
          tx,
          {
            uid: row.uid,
            clientId: row.clientId,
            grantId: row.grantId,
            scopes: row.scopes,
          },
          persistentFor(client),
        );
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
        const persistent = row.persistent === true && persistentFor(client);
        if (!persistent) tx.update(ref, { used: true });
        return {
          tokens: issue(
            tx,
            {
              uid: row.uid,
              clientId: row.clientId,
              grantId: row.grantId,
              scopes: selected,
            },
            persistent,
            persistent ? { ref, token } : undefined,
          ),
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
  return { provider, available, authenticateClient };
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
    await requireActiveAccount(uid, tx);
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
    .map(({ id, clientId, name, host, scopes, connectedAt, approvalMode }) => ({
      grantId: id,
      approvalMode: approvalMode ?? "ask",
      clientId,
      name,
      host,
      scopes,
      connectedAt,
    }));
}
export async function setApprovalMode(
  uid: string,
  clientId: string,
  grantId: string,
  approvalMode: ConnectApprovalMode,
) {
  const owner = account(uid);
  await db.runTransaction(async (tx) => {
    await requireActiveAccount(uid, tx);
    const data = (await tx.get(owner)).data();
    const grant = matchingGrant(data, { clientId, grantId });
    if (!grant) fail(404, "Application grant is unavailable");
    if (
      approvalMode === "allow" &&
      !grant.scopes.some((scope) => scope.endsWith(":write"))
    )
      fail(403, "Write permissions are required");
    tx.update(owner, `grants.${digest(clientId)}.approvalMode`, approvalMode);
  });
  audit("approval_mode_" + approvalMode, uid, clientId);
  return { approvalMode };
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
