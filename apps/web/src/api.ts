let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-csrf-token": csrf,
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

export async function loadTopics(archived: boolean, sort: string) {
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
    );
    items.push(...page.items);
    total = page.total;
    if (!page.items.length) break;
  } while (items.length < total);
  return { items, total };
}
