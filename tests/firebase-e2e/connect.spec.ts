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
    await expect(page.getByText("Read and write access").first()).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "MCP server URL" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Русский" }).click();
    const settings = page.getByRole("region", {
      name: "Подключённые ИИ-приложения",
    });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Русский" })).toHaveCount(
      0,
    );
    await expect(settings.getByRole("combobox")).toHaveCount(0);
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
    await route.fulfill({
      json: {
        enabled: true,
        writes: false,
        resource,
        platforms: { chatgpt: true, claude: true, gemini: true, other: false },
        applications: [
          {
            clientId: "sample-chatgpt",
            name: "Blind Spot for ChatGPT",
            host: "chatgpt.com",
            scopes: ["topics:read", "topics:write"],
            connectedAt: "2026-11-20T10:00:00.000Z",
          },
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
  await expect(
    section.getByText("Connect is in read-only mode.", { exact: false }),
  ).toBeVisible();

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
  await expect(platform("ChatGPT").getByText("Read-only access")).toBeVisible();
  await expect(platform("Gemini").getByText("Not connected")).toBeVisible();
  await expect(
    platform("Other AI assistants").getByText("Platform unavailable"),
  ).toBeVisible();
  await expect(section.getByText("Granted permissions")).toBeVisible();
  await expect(section.locator("time")).toHaveAttribute(
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
  await expect(dialog.locator("ol li")).toHaveCount(3);
  await expect(
    dialog.getByRole("link", { name: "Official setup guide" }),
  ).toHaveAttribute("href", /developers.google.com/);
  await dialog.getByRole("button", { name: "Copy URL" }).click();
  await expect(dialog.getByRole("status")).toHaveText("URL copied.");
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied-address",
    resource,
  );
  await page.locator("html").evaluate((html) => {
    html.dataset.clipboardFails = "true";
  });
  await dialog.getByRole("button", { name: "Copy URL" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Select and copy the URL manually.",
  );
  await expect(
    dialog.getByRole("textbox", { name: "MCP server URL" }),
  ).toBeFocused();
  await capture(page, info, "setup-light-en", dialog);
  await page.keyboard.press("Escape");
  await section
    .getByRole("button", { name: "Other AI assistants requirements" })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Other AI assistants requirements",
  });
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByText(/supports a remote server/)).toBeVisible();
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
  expect(await (await first).json()).toMatchObject({
    enabled: false,
    applications: [],
  });
  const region = page.getByRole("region", {
    name: "Connected AI Applications",
  });
  await expect(region).toBeHidden();

  const grants = db.collection("mcpAccounts").doc(user.uid);
  const clientId = "browser-existing-grant";
  await grants.set({
    grants: {
      [digest(clientId)]: {
        id: crypto.randomUUID(),
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
      region.getByText("Access paused", { exact: true }),
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
    expect(await (await afterRevocation).json()).toMatchObject({
      enabled: false,
      applications: [],
    });
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
