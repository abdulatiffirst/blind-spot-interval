import {
  test,
  expect,
  type Page,
  type Locator,
  type TestInfo,
} from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signInAsEmulatedGoogleUser } from "../firebase/connect-fixtures.ts";
import { defaults } from "../../packages/shared/src/index.ts";
import { db } from "../../functions/src/store.ts";
import { digest } from "../../functions/src/domain.ts";

const origin = process.env.BLIND_SPOT_CONNECT_ORIGIN ?? "http://localhost:5000";
const redirect = "http://127.0.0.1:6274/oauth/callback";
const resource = origin + "/api/mcp";

async function signedIn(page: Page, appOrigin: string) {
  const user = await signInAsEmulatedGoogleUser(appOrigin);
  // Start with an authenticated emulator user, using Firebase's browser persistence contract.
  await page.addInitScript(
    ({ uid, token, refreshToken, email, appOrigin }) => {
      if (
        location.origin === appOrigin &&
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
    },
    { ...user, appOrigin },
  );
  return user;
}

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  target?: Locator,
) {
  if (process.env.CONNECT_UX_SCREENSHOTS !== "true") return;
  const options = {
    path: info.outputPath(name + ".png"),
    animations: "disabled" as const,
  };
  if (target) await target.screenshot(options);
  else await page.screenshot({ ...options, fullPage: true });
}

test("approves read and write consents and a topic, then revokes the app in Russian", async ({
  page,
}, info) => {
  test.skip(
    process.env.BLIND_SPOT_CONNECT_ENABLED !== "true",
    "Connect emulator suite loads the enabled Hosting build",
  );
  const user = await signedIn(page, origin);
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
  await expect(
    page.getByRole("link", { name: "Privacy Policy" }),
  ).toHaveAttribute("href", "/privacy");
  await expect(
    page.getByRole("checkbox", { name: "Read learning topics and materials" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Русский" }).click();
  await expect(
    page.getByRole("heading", { name: "Разрешить доступ ИИ-приложению" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "English" })).toBeEnabled();
  const write = page.getByRole("checkbox", {
    name: "Request creation of learning topics",
  });
  await expect(write).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Read completed reviews/ }),
  ).not.toBeChecked();
  await capture(page, info, "consent-light-en");
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
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await capture(page, info, "confirmation-dark-en");
    await page.getByRole("button", { name: "Русский" }).click();
    await expect(
      page.getByRole("button", { name: "Применить изменение" }),
    ).toBeVisible();
    await capture(page, info, "confirmation-dark-ru");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "English" })).toBeEnabled();
    await page.getByRole("button", { name: "Apply this change" }).click();
    await expect(page.getByRole("status")).toContainText("Change applied");
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
    await page.getByText("Connection details", { exact: true }).click();
    await page.getByText("Connect Tests", { exact: true }).click();
    await expect(page.getByText("Read and write access").first()).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "MCP server URL" }),
    ).toBeHidden();
    const approval = page.getByRole("combobox", { name: "Action approval" });
    await expect(approval).toHaveValue("ask");
    await approval.selectOption("allow");
    const automaticDialog = page.getByRole("dialog", {
      name: /Allow automatic actions for Connect Tests/,
    });
    await expect(automaticDialog).toContainText(
      "Scheduling warnings will still need your approval",
    );
    await automaticDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(approval).toHaveValue("ask");
    await approval.selectOption("allow");
    await capture(page, info, "approval-dark-en", automaticDialog);
    await automaticDialog
      .getByRole("button", { name: "Always allow authorized actions" })
      .click();
    await expect(approval).toHaveValue("allow");
    expect(
      (
        await client.callTool({
          name: "create_topic",
          arguments: {
            title: "Browser automatic execution",
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).structuredContent,
    ).toMatchObject({ state: "applied" });
    await page.getByRole("button", { name: "Русский" }).click();
    const settings = page.getByRole("region", {
      name: "Подключённые ИИ-приложения",
    });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Русский" })).toHaveCount(
      0,
    );
    const russianApproval = settings.getByRole("combobox", {
      name: "Подтверждение действий",
    });
    await expect(russianApproval).toHaveValue("allow");
    await expect(russianApproval.locator("option:checked")).toHaveText(
      "Всегда разрешать авторизованные действия",
    );
    await russianApproval.selectOption("ask");
    await expect(russianApproval).toHaveValue("ask");
    await expect(
      settings.getByText("Настройка подтверждения действий сохранена."),
    ).toBeVisible();
    expect(
      (
        await client.callTool({
          name: "create_topic",
          arguments: {
            title: "Browser manual again",
            idempotencyKey: crypto.randomUUID(),
          },
        })
      ).structuredContent,
    ).toMatchObject({ state: "confirmation_required" });
    await settings
      .getByText("Расширенные настройки подключения", { exact: true })
      .click();
    await expect(
      settings.getByRole("textbox", { name: "Адрес MCP-сервера" }),
    ).toHaveValue(resource);
    await settings
      .getByText("Расширенные настройки подключения", { exact: true })
      .click();
    await capture(page, info, "settings-dark-ru", settings);

    const replacementVerifier = randomBytes(32).toString("base64url");
    query.set("state", randomBytes(32).toString("base64url"));
    query.set(
      "code_challenge",
      createHash("sha256").update(replacementVerifier).digest("base64url"),
    );
    await page.goto(origin + "/authorize?" + query);
    const previous = page.getByRole("combobox", {
      name: "Предыдущее подключение",
    });
    const allow = page.getByRole("button", {
      name: "Разрешить выбранный доступ",
    });
    await expect(previous).toHaveValue("");
    await expect(allow).toBeDisabled();
    await previous.selectOption({ index: 1 });
    await expect(allow).toBeEnabled();
    await capture(page, info, "replacement-dark-ru");
    await allow.click();
    await expect(page.getByText("OAuth returned to client")).toBeVisible();
    expect((await client.callTool({ name: "list_topics" })).isError).not.toBe(
      true,
    );
    const replacement = await fetch(origin + "/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "connect-test",
        redirect_uri: redirect,
        resource,
        code: new URL(page.url()).searchParams.get("code")!,
        code_verifier: replacementVerifier,
      }),
    });
    expect(replacement.status).toBe(200);
    const replacementTokens = await replacement.json();
    expect(replacementTokens.scope).toBe("topics:read");
    await page.goto(origin + "/?section=Settings");
    await settings
      .getByText("Сведения о подключениях", { exact: true })
      .click();
    await settings.getByText("Connect Tests", { exact: true }).click();

    const revoke = settings.getByRole("button", {
      name: "Отозвать доступ",
      exact: true,
    });
    await revoke.click();
    const confirmation = page.getByRole("dialog", {
      name: /Отозвать доступ для Connect Tests/,
    });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(revoke).toBeFocused();
    await revoke.click();
    await capture(page, info, "revoke-dark-ru", confirmation);
    await confirmation
      .getByRole("button", { name: "Отозвать доступ", exact: true })
      .click();
    await expect(settings.getByText("Доступ отозван.")).toBeVisible();
    expect(
      (
        await fetch(resource, {
          headers: {
            authorization: "Bearer " + replacementTokens.access_token,
          },
        })
      ).status,
    ).toBe(401);
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

test("shows provider states and manual setup with a loading skeleton, retry and clipboard feedback", async ({
  page,
}, info) => {
  test.skip(
    process.env.BLIND_SPOT_CONNECT_ENABLED !== "true",
    "Uses the enabled Hosting build",
  );
  await signedIn(page, origin);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          if (document.documentElement.dataset.clipboardFails)
            throw new Error("Clipboard unavailable");
          document.documentElement.dataset.copiedAddress = value;
        },
      },
    });
  });
  const geminiGrants = [
    {
      clientId: "gemini-reviews",
      grantId: "review-grant",
      name: "Google review workspace",
      host: "oauth-redirect.googleusercontent.com",
      scopes: ["reviews:read", "reviews:write"],
      approvalMode: "allow",
      connectedAt: "2026-11-20T10:15:00.000Z",
    },
    {
      clientId: "gemini-topics",
      grantId: "topic-grant",
      name: "Google topics workspace",
      host: "oauth-redirect-test.googleusercontent.com",
      scopes: ["topics:read"],
      approvalMode: "ask",
      connectedAt: "2026-11-20T10:20:00.000Z",
    },
  ];
  let geminiConnected = false;
  let otherAvailable = false;
  let connectionError = false;
  let first = true;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/connect/applications", async (route) => {
    if (first) {
      first = false;
      await wait;
      return route.fulfill({
        status: 503,
        json: { error: "Test connection error" },
      });
    }
    if (connectionError)
      return route.fulfill({
        status: 503,
        json: { error: "Test connection error" },
      });
    await route.fulfill({
      json: {
        enabled: true,
        writes: true,
        resource,
        platforms: {
          chatgpt: true,
          claude: true,
          gemini: true,
          other: otherAvailable,
        },
        expiredPlatforms: ["claude"],
        applications: [
          {
            clientId: "sample-chatgpt",
            name: "Blind Spot for ChatGPT",
            host: "chatgpt.com",
            scopes: ["topics:read"],
            connectedAt: "2026-11-20T10:00:00.000Z",
          },
          ...(geminiConnected ? geminiGrants : []),
        ],
      },
    });
  });
  await page.goto(origin + "/?section=Settings");
  const section = page.getByRole("region", {
    name: "Connected AI Applications",
  });
  await expect(section.getByRole("status", { name: "Loading…" })).toBeVisible();
  release();
  await expect(section.getByRole("alert")).toContainText("Connection error");
  await section.getByRole("button", { name: "Reload connections" }).click();

  for (const name of ["ChatGPT", "Claude", "Gemini", "Other AI assistants"]) {
    await expect(
      section.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  const platform = (name: string) =>
    section
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(
    platform("ChatGPT").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(
    platform("ChatGPT").getByText("Active connections: 1"),
  ).toBeVisible();
  await expect(
    platform("ChatGPT").getByRole("button", { name: "Set up ChatGPT" }),
  ).toHaveCount(0);
  await expect(platform("Gemini").getByText("Not connected")).toBeVisible();
  await expect(
    platform("Claude").getByText("Connection expired"),
  ).toBeVisible();
  await expect(
    platform("Claude").getByRole("button", { name: "Reconnect Claude" }),
  ).toBeVisible();
  await expect(
    platform("Other AI assistants").getByText("Not connected"),
  ).toBeVisible();
  await expect(section.getByText("Granted permissions")).toBeHidden();
  await platform("ChatGPT")
    .getByText("Connection details", { exact: true })
    .click();
  await platform("ChatGPT")
    .getByText("Blind Spot for ChatGPT", { exact: true })
    .click();
  await expect(
    platform("ChatGPT").getByText("Granted permissions"),
  ).toBeVisible();
  await expect(platform("ChatGPT").locator("time")).toHaveAttribute(
    "datetime",
    "2026-11-20T10:00:00.000Z",
  );
  await expect(
    section.getByRole("textbox", { name: "MCP server URL" }),
  ).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    page.getByRole("heading", { name: "Study preferences" }),
  ).toBeVisible();
  const spacing = await page.locator(".settings-layout").evaluate((layout) => {
    const top = [...layout.children].filter(
      (element) => !element.classList.contains("connect-settings"),
    );
    const connect = layout.querySelector(".connect-settings")!;
    return (
      connect.getBoundingClientRect().top -
      Math.max(...top.map((element) => element.getBoundingClientRect().bottom))
    );
  });
  expect(spacing).toBeGreaterThanOrEqual(20);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, info, "settings-light-en", section);

  await section.getByRole("button", { name: "Set up Gemini" }).click();
  let dialog = page.getByRole("dialog", { name: "Set up Gemini" });
  await expect(dialog.getByRole("listitem")).toHaveText([
    /Settings → Connected Apps/,
    /Paste the URL, select Next, and follow the sign-in prompts/,
  ]);
  await expect(dialog.getByText("Waiting for approval")).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "MCP server URL" }),
  ).toBeHidden();
  await capture(page, info, "setup-light-en", dialog);
  await dialog.getByText("Trouble connecting?", { exact: true }).click();
  await expect(dialog.getByText(/If Connected Apps is missing/)).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Official setup guide" }),
  ).toHaveAttribute(
    "href",
    "https://support.google.com/gemini/answer/17209137",
  );
  await page
    .context()
    .route("https://gemini.google.com/apps", (route) =>
      route.fulfill({ body: "Gemini test tab" }),
    );
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Copy URL & Open Assistant" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("Gemini test tab")).toBeVisible();
  await popup.close();
  await expect(dialog.getByText("URL copied.", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied-address",
    resource,
  );
  await page.locator("html").evaluate((html) => {
    html.dataset.clipboardFails = "true";
  });
  await dialog.getByRole("button", { name: "Copy URL" }).click();
  await expect(
    dialog.getByText("Select and copy the URL manually.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "MCP server URL" }),
  ).toBeFocused();
  await capture(page, info, "setup-copy-fallback-en", dialog);
  await page.keyboard.press("Escape");
  await section
    .getByRole("button", { name: "Other AI assistants requirements" })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Other AI assistants requirements",
  });
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByText(/support remote MCP/)).toBeVisible();
  otherAvailable = true;
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await section
    .getByRole("button", { name: "Set up Other AI assistants" })
    .click();
  dialog = page.getByRole("dialog", { name: "Set up Other AI assistants" });
  await expect(dialog.getByText("Waiting for approval")).toBeVisible();
  await dialog
    .getByText("Advanced connection settings", { exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "MCP server URL" }),
  ).toHaveValue(resource);
  await expect(dialog.getByText(/Streamable HTTP/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Русский" }).click();
  await page.getByRole("button", { name: "Настройка Gemini" }).click();
  dialog = page.getByRole("dialog", { name: "Настройка Gemini" });
  await expect(dialog.getByRole("listitem")).toHaveText([
    /Settings → Connected Apps/,
    /Вставьте адрес, нажмите Next и следуйте подсказкам/,
  ]);
  await capture(page, info, "setup-ru", dialog);
  await dialog
    .getByText("Не получается подключиться?", { exact: true })
    .click();
  await expect(
    dialog.getByText(/Если раздела Connected Apps нет/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Скопировать адрес" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("link", { name: "Официальное руководство" }),
  ).toHaveAttribute(
    "href",
    "https://support.google.com/gemini/answer/17209137",
  );
  await page.locator("html").evaluate((html) => {
    delete html.dataset.clipboardFails;
  });
  connectionError = true;
  await dialog.getByRole("button", { name: "Проверить сейчас" }).click();
  await expect(dialog.getByText("Статус недоступен")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Gemini подключён" }),
  ).toBeHidden();
  connectionError = false;
  geminiConnected = true;
  // The open dialog discovers the grant without a focus event or manual reload.
  const success = page.getByRole("dialog", { name: "Gemini подключён" });
  await expect(
    success.getByText("Blind Spot получил ваше разрешение."),
  ).toBeVisible();
  await expect(
    success.getByRole("textbox", { name: "Пример запроса" }),
  ).toHaveValue("Покажи через Blind Spot мои повторения на сегодня.");
  await success.getByRole("button", { name: "Скопировать запрос" }).click();
  await expect(
    success.getByText("Запрос скопирован.", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "connected-ru", success);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Сменить тему" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const russian = page.getByRole("region", {
    name: "Подключённые ИИ-приложения",
  });
  const groupedGemini = russian.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Gemini", exact: true }),
  });
  await expect(groupedGemini).toHaveCount(1);
  await expect(
    groupedGemini.getByText("Активных подключений: 2"),
  ).toBeVisible();
  await expect(
    groupedGemini.getByRole("button", { name: "Настройка Gemini" }),
  ).toHaveCount(0);
  await groupedGemini
    .getByText("Сведения о подключениях", { exact: true })
    .click();
  const reviews = groupedGemini
    .locator("details.connect-application")
    .filter({ hasText: "Google review workspace" });
  const topics = groupedGemini
    .locator("details.connect-application")
    .filter({ hasText: "Google topics workspace" });
  await expect(reviews.getByRole("combobox")).toBeHidden();
  await reviews.locator("summary").click();
  await topics.locator("summary").click();
  await expect(reviews.getByRole("combobox")).toHaveValue("allow");
  await expect(topics.getByRole("combobox")).toHaveValue("ask");
  await expect(reviews.locator("time")).toHaveAttribute(
    "datetime",
    "2026-11-20T10:15:00.000Z",
  );
  await expect(topics.locator("time")).toHaveAttribute(
    "datetime",
    "2026-11-20T10:20:00.000Z",
  );
  await expect(reviews.locator(".connect-granted li")).toHaveCount(2);
  await expect(topics.locator(".connect-granted li")).toHaveCount(1);
  await expect(reviews.getByRole("button")).toHaveCount(1);
  await expect(topics.getByRole("button")).toHaveCount(1);
  await capture(page, info, "settings-grouped-dark-ru", groupedGemini);
  await groupedGemini
    .getByRole("button", { name: "Заменить подключение Gemini" })
    .click();
  const replaceDialog = page.getByRole("dialog", {
    name: "Заменить подключение Gemini",
  });
  await expect(
    replaceDialog.getByText("Ожидаем подтверждения доступа"),
  ).toBeVisible();
  await capture(page, info, "setup-replace-dark-ru", replaceDialog);
  await replaceDialog
    .getByText("Расширенные настройки подключения", { exact: true })
    .click();
  await expect(
    replaceDialog.getByRole("textbox", { name: "Адрес MCP-сервера" }),
  ).toHaveValue(resource);
  await expect(
    replaceDialog.getByText(/выберите предыдущее подключение/),
  ).toBeVisible();
});

test("hides disabled setup and still revokes existing grants", async ({
  page,
}, info) => {
  test.skip(
    process.env.BLIND_SPOT_CONNECT_ENABLED === "true",
    "Uses the default disabled Functions build",
  );
  const appOrigin = "http://localhost:5174";
  const user = await signedIn(page, appOrigin);
  const settingsUrl = appOrigin + "/?section=Settings";
  const waitForSettings = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/connect/applications" &&
        response.ok(),
    );
  const first = waitForSettings();
  await page.goto(settingsUrl);
  await first;
  const region = page.getByRole("region", {
    name: "Connected AI Applications",
  });
  await expect(region).toBeHidden();

  const grants = db.collection("mcpAccounts").doc(user.uid);
  const clientId = "browser-existing-grant";
  await grants.set({
    grants: {
      [digest(clientId)]: {
        id: randomBytes(32).toString("base64url"),
        clientId,
        name: "Previously authorized app",
        host: "example.invalid",
        scopes: ["topics:read"],
        connectedAt: "2026-11-20T10:00:00.000Z",
        expires: Date.now() + 600_000,
      },
    },
  });
  try {
    const existing = waitForSettings();
    await page.reload();
    await existing;
    await expect(
      region.getByText("Connect disabled", { exact: true }),
    ).toBeVisible();
    await expect(
      region
        .getByText("Access paused", { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: /Set up|requirements/i }),
    ).toHaveCount(0);
    await expect(region.getByText("Advanced connection settings")).toHaveCount(
      0,
    );
    await capture(page, info, "settings-disabled-en", region);
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("button", { name: "Русский" }).click();
    const russian = page.getByRole("region", {
      name: "Подключённые ИИ-приложения",
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      russian.getByText("Connect выключен", { exact: true }),
    ).toBeVisible();
    await capture(page, info, "settings-disabled-dark-ru", russian);
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "English" })).toBeEnabled();
    await region.getByText("Connection details", { exact: true }).click();
    await region
      .getByText("Previously authorized app", { exact: true })
      .click();
    await region
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Revoke access for Previously authorized app?",
    });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).toBeHidden();
    expect((await grants.get()).exists).toBe(true);
    await region
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    await expect(region.getByText("Access revoked.")).toBeVisible();
    expect((await grants.get()).exists).toBe(false);
    const afterRevocation = waitForSettings();
    await page.reload();
    await afterRevocation;
    await expect(region).toBeHidden();

    await page.goto(appOrigin + "/connect/authorize#" + "a".repeat(43));
    await expect(
      page.getByText("Connect disabled", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Allow selected permissions" }),
    ).toHaveCount(0);
  } finally {
    await grants.delete();
  }
});
