import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signInAsEmulatedGoogleUser } from "../firebase/connect-fixtures.ts";
import { defaults } from "../../packages/shared/src/index.ts";

const origin = process.env.BLIND_SPOT_CONNECT_ORIGIN ?? "http://localhost:5000";
const redirect = "http://127.0.0.1:6274/oauth/callback";
const resource = origin + "/api/mcp";

test("approves read and write consents and a topic, then revokes the app in Russian", async ({
  page,
}) => {
  test.skip(
    process.env.BLIND_SPOT_CONNECT_ENABLED !== "true",
    "Connect emulator suite loads the enabled Hosting build",
  );
  const user = await signInAsEmulatedGoogleUser(origin);
  // Start with an authenticated emulator user, using Firebase's browser persistence contract.
  await page.addInitScript(({ uid, token, refreshToken, email }) => {
    if (
      location.origin === "http://localhost:5000" &&
      !localStorage.getItem("firebase:authUser:demo-api-key:[DEFAULT]")
    ) {
      localStorage.setItem(
        "firebase:authUser:demo-api-key:[DEFAULT]",
        JSON.stringify({
          uid,
          email,
          emailVerified: true,
          isAnonymous: false,
          apiKey: "demo-api-key",
          appName: "[DEFAULT]",
          stsTokenManager: {
            accessToken: token,
            refreshToken,
            expirationTime: Date.now() + 3_600_000,
          },
        }),
      );
    }
  }, user);
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: "connect-test",
    redirect_uri: redirect,
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
    scope: "topics:read topics:write reviews:history:read",
  });
  await page.route(redirect + "?*", (route) =>
    route.fulfill({ body: "OAuth returned to client" }),
  );
  await page.goto(origin + "/authorize?" + query);
  await expect(
    page.getByRole("heading", { name: "Authorize an AI application" }),
  ).toBeVisible();
  const write = page.getByRole("checkbox", {
    name: "Request creation of learning topics",
  });
  await expect(write).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Read completed reviews/ }),
  ).not.toBeChecked();
  await write.check();
  await page
    .getByRole("button", { name: "Allow selected permissions" })
    .click();
  await expect(page.getByText("OAuth returned to client")).toBeVisible();
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  const token = await fetch(origin + "/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "connect-test",
      redirect_uri: redirect,
      resource,
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
    }),
  });
  expect(token.status).toBe(200);
  const { access_token } = await token.json();
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { authorization: "Bearer " + access_token } },
  });
  const client = new Client({
    name: "connect-browser-tests",
    version: "1.0.0",
  });
  await client.connect(transport);
  try {
    const args = {
      title: "Browser logarithms",
      notes: "A worked example",
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await client.callTool({
      name: "create_topic",
      arguments: args,
    });
    const staged = result.structuredContent as {
      state: string;
      confirmationUrl: string;
    };
    expect(staged.state).toBe("confirmation_required");
    await page.goto(staged.confirmationUrl);
    await expect(page.getByText("Browser logarithms")).toBeVisible();
    await expect(page.getByText("A worked example")).toBeVisible();
    await page.getByRole("button", { name: "Apply this change" }).click();
    await expect(page.getByRole("status")).toContainText("Change applied.");
    expect(
      (await client.callTool({ name: "create_topic", arguments: args }))
        .structuredContent,
    ).toMatchObject({ state: "applied" });
    const preferences = await fetch(origin + "/api/v1/preferences", {
      method: "PATCH",
      headers: {
        authorization: "Bearer " + user.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...defaults, onboarded: true }),
    });
    expect(preferences.ok).toBe(true);
    await page.goto(origin + "/?section=Settings");
    await expect(
      page.getByRole("heading", { name: "Connected AI Applications" }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Language / Язык" })
      .selectOption("ru");
    await expect(
      page.getByRole("heading", { name: "Подключённые ИИ-приложения" }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("textbox", { name: "Адрес MCP-сервера" })
        .inputValue(),
    ).toBe(resource);
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Отозвать доступ", exact: true })
      .click();
    await expect(page.getByText("Доступ отозван.")).toBeVisible();
    expect(
      (
        await fetch(resource, {
          headers: { authorization: "Bearer " + access_token },
        })
      ).status,
    ).toBe(401);
  } finally {
    await client.close();
  }
});
