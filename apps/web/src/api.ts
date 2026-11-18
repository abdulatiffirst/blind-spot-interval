import { usesFirebase, authToken, logout } from "./firebase";
import type { User } from "firebase/auth";
let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  { user, signal }: { user?: User; signal?: AbortSignal } = {},
) {
  if (usesFirebase && path === "/auth/logout") {
    await logout();
    return { ok: true };
  }
  const token = usesFirebase ? await authToken(user) : null;
  if (usesFirebase && !token)
    throw Object.assign(new Error("Sign in to continue"), { status: 401 });
  const r = await fetch("/api/v1" + path, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(usesFirebase
        ? { authorization: `Bearer ${token}` }
        : { "x-csrf-token": csrf }),
      ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(value.error ?? "Request failed"), {
      status: r.status,
    });
  return value;
}

export async function loadTopics(
  archived: boolean,
  sort: string,
  signal?: AbortSignal,
) {
  const items = [];
  let total: number;
  do {
    const page = await api(
      "/topics?limit=100&offset=" +
        items.length +
        "&archived=" +
        archived +
        "&sort=" +
        sort,
      "GET",
      undefined,
      { signal },
    );
    items.push(...page.items);
    total = page.total;
    if (!page.items.length) break;
  } while (items.length < total);
  return { items, total };
}

export async function connectCalendar() {
  if (!usesFirebase) {
    location.assign("/api/v1/calendar/connect");
    return;
  }
  const result = await api("/calendar/connect");
  location.assign(result.url);
}
