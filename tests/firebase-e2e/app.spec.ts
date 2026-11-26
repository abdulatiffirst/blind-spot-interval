import {
  test,
  expect,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { db, auth } from "../../functions/src/store.ts";
let uid: string;
async function signIn(page: Page, sub = crypto.randomUUID()) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }).first(),
  ).toBeVisible();
  const token =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub,
        email: sub + "@example.invalid",
        email_verified: true,
        name: "Emulator Learner",
        iss: "https://accounts.google.com",
        aud: "demo-client",
      }),
    ).toString("base64url") +
    ".";
  uid = await page.evaluate(async (token) => {
    const appPath = "/src/firebase.ts",
      sdkPath = "/node_modules/.vite/deps/firebase_auth.js";
    const appModule = await import(/* @vite-ignore */ appPath);
    const sdk = await import(/* @vite-ignore */ sdkPath);
    const auth = appModule.firebaseAuth();
    if (auth.app.options.projectId !== "demo-blind-spot-interval")
      throw new Error(
        "Never inject emulator Google credentials into production",
      );
    const result = await sdk.signInWithCredential(
      auth,
      sdk.GoogleAuthProvider.credential(token),
    );
    return result.user.uid;
  }, token);
}
test.afterEach(async () => {
  if (uid) {
    await db.recursiveDelete(db.collection("users").doc(uid));
    await auth.deleteUser(uid);
    const jobs = await db.collection("syncJobs").where("uid", "==", uid).get();
    for (const job of jobs.docs) await job.ref.delete();
    uid = "";
  }
});
test("reports failed Google popup initialization and allows a retry", async ({
  page,
}) => {
  await page.route("https://apis.google.com/js/api.js?*", (route) =>
    route.abort(),
  );
  let meRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/me") meRequests++;
  });
  await page.goto("/");
  const login = page
    .getByRole("button", { name: "Continue with Google" })
    .first();
  const error = page.getByRole("alert");
  const logo = login.locator('img[src="/google-g.png"]');
  await expect(logo).toBeVisible();
  expect(
    await logo.evaluate((img) =>
      (img as HTMLImageElement)
        .decode()
        .then(() => img.getBoundingClientRect().width),
    ),
  ).toBe(20);
  await logo.click();
  await expect(error).toHaveText("Google Sign-In did not complete. Try again.");
  await expect(login).toBeEnabled();
  await login.click();
  await expect(error).toHaveText("Google Sign-In did not complete. Try again.");
  await expect(login).toBeEnabled();
  expect(meRequests).toBe(0);
});

test("allows another sign-in attempt if the Google popup never settles", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("https://apis.google.com/js/api.js?*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.goto("/");
  const login = page
    .getByRole("button", { name: "Continue with Google" })
    .first();
  await login.click();
  await expect(
    page.getByRole("button", { name: "Opening Google Sign-In…" }).first(),
  ).toBeDisabled();
  await page.clock.fastForward(120_000);
  await expect(page.getByRole("alert")).toHaveText(
    "Google Sign-In timed out. Close the sign-in window and try again.",
  );
  await expect(login).toBeEnabled();
});

test.use({ timezoneId: "Asia/Tashkent" });

test("loads the workspace with a Firebase token and restores it on reload", async ({
  page,
}) => {
  const meRequests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/me") {
      meRequests.push(request);
    }
  });
  await signIn(page);
  const onboarding = page.getByRole("dialog", {
    name: "Find your learning rhythm.",
  });
  await expect(page.locator("aside").getByRole("navigation")).toBeVisible();
  const saved = (await db.doc(`users/${uid}/preferences/default`).get()).data();
  expect(saved?.timezone).toBe(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  expect(saved?.onboarded).toBe(true);
  await expect(onboarding).not.toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  const topicsUpdated = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/topics" &&
      url.searchParams.get("archived") === "true"
    );
  });
  await page.getByLabel("Archived", { exact: true }).check();
  await topicsUpdated;
  expect(meRequests).toHaveLength(1);
  expect(
    /^Bearer \S+$/.test(
      (await meRequests[0].headerValue("authorization")) ?? "",
    ),
  ).toBe(true);

  const restoredProfile = page.waitForResponse(
    (res) => new URL(res.url()).pathname === "/api/v1/me",
  );
  await page.reload();
  expect((await restoredProfile).status()).toBe(200);
  expect((await (await restoredProfile).json()).preferences.onboarded).toBe(
    true,
  );
  await expect(page.locator("aside").getByRole("navigation")).toBeVisible();
  await expect(onboarding).not.toBeVisible();
  expect(meRequests).toHaveLength(2);
});

test("cancels a pending profile request when Firebase signs out", async ({
  page,
}) => {
  let holdRequest!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => {
    holdRequest = resolve;
  });
  await page.route((url) => url.pathname === "/api/v1/me", holdRequest, {
    times: 1,
  });
  await signIn(page);
  const route = await pending;
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request === route.request(),
  });
  try {
    await page.evaluate(async () => {
      const appPath = "/src/firebase.ts";
      const { logout } = await import(/* @vite-ignore */ appPath);
      await logout();
    });
    await expect(
      page.getByRole("button", { name: "Continue with Google" }).first(),
    ).toBeVisible();
    await aborted;
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await route.abort().catch(() => {});
  }
});

for (const [status, message] of [
  [401, "Your session expired. Sign in with Google again."],
  [503, "Could not load your workspace. Try again."],
] as const) {
  test(`leaves the loading screen and recovers when /me returns ${status}`, async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/v1/me",
      (route) =>
        route.fulfill({
          status,
          json: { error: "Profile unavailable" },
        }),
      { times: 1 },
    );
    await signIn(page);
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(page.locator("aside").getByRole("navigation")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry loading workspace" }).click();
    await expect(page.locator("aside").getByRole("navigation")).toBeVisible();
  });
}

test("Google credential → first topic by name → first review date → review and calendar", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("textbox", { name: "Topic name" }).fill("Logarithms");
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add topic", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Added\. First review: .+ · \d{2}:\d{2}/,
  );
  await page.getByRole("button", { name: "View topic" }).click();
  await page.getByRole("button", { name: /Review now/ }).click();
  await page.getByRole("button", { name: /4 Good recall/ }).click();
  await expect(page.getByRole("status")).toContainText("Next review");
  const tip = page
    .locator(".banner")
    .filter({ hasText: "Want reviews at different times?" });
  await expect(tip.getByRole("link", { name: "Settings" })).toBeVisible();
  await tip.getByRole("button", { name: "Dismiss" }).click();
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Your internal calendar is ready")).toBeVisible();
  const pending = await db
    .collection(`users/${uid}/reviewSchedules`)
    .where("status", "==", "pending")
    .get();
  expect(pending.size).toBe(1);
  const nextAt = new Date(pending.docs[0].get("scheduled_at"));
  await expect(page.getByRole("button", { name: /Logarithms/ })).toBeVisible();
  const docs = await db.collection(`users/${uid}/reviewHistory`).get();
  expect(docs.size).toBe(1);
  expect(docs.docs[0].data().original_rating).toBe(4);
  const memory = await db.collection(`users/${uid}/memoryStates`).get();
  expect(memory.docs[0].data().card.reps).toBe(1);
  await page.getByRole("button", { name: /Logarithms/ }).click();
  await page
    .getByLabel("Review time")
    .fill(new Date(nextAt.getTime() + 86400000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Save time" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  const open = page.getByRole("button", { name: /Logarithms/ });
  await open.click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page.getByRole("button", { name: "Return to automatic" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await open.click();
  await page.getByRole("button", { name: /Review now/ }).click();
  await page.getByRole("button", { name: /1 Forgot completely/ }).click();
  await expect(page.getByRole("status")).toContainText("Next review");
  let holdHistory!: (route: Route) => void;
  const historyRefresh = new Promise<Route>((resolve) => {
    holdHistory = resolve;
  });
  await page.route((url) => url.pathname.endsWith("/history"), holdHistory, {
    times: 1,
  });
  await open.click();
  const historyRoute = await historyRefresh;
  try {
    await expect(page.locator(".history-row")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Correct rating" }),
    ).toHaveCount(0);
  } finally {
    await historyRoute.continue();
  }
  await expect(page.locator(".history-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Correct rating" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Correct rating" }).click();
  await page.getByRole("button", { name: "3 / 5" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const corrected = await db.collection(`users/${uid}/reviewHistory`).get();
  expect(corrected.size).toBe(2);
  expect(
    corrected.docs.some(
      (d) => d.get("corrected_at") && d.get("original_rating") === 3,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
test("edit, archive, restore, keyboard dismissal and Firebase sign-out", async ({
  page,
}) => {
  const account = crypto.randomUUID();
  await signIn(page, account);
  await page
    .getByRole("textbox", { name: "Topic name" })
    .fill("Python functions");
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add topic", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("First review:");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: /Python functions/ }).click();
  await page.getByRole("button", { name: "Edit topic" }).click();
  await page
    .getByRole("textbox", { name: /Topic name/ })
    .fill("Python closures");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: /Python closures/ }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Archived", { exact: true }).check();
  await page.getByRole("button", { name: /Python closures/ }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page
      .locator(".stats > div")
      .filter({ hasText: "Active topics" })
      .locator("strong"),
  ).toHaveText("01");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const login = page
    .getByRole("button", { name: "Continue with Google" })
    .first();
  await expect(login).toBeVisible();
  await page.reload();
  await expect(login).toBeVisible();
  await expect(page.locator("aside").getByRole("navigation")).toHaveCount(0);
  await signIn(page, account);
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Python closures/ }),
  ).toBeVisible();
});

test("month navigation works from January 1 and failed previews resolve visibly", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.clock.setFixedTime(new Date("2027-01-01T12:00:00Z"));
  await page.getByRole("button", { name: "month", exact: true }).click();
  await page
    .locator(".calendar-toolbar")
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(page.locator(".calendar-toolbar strong")).toHaveText(
    "February 2027",
  );
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(page.locator(".calendar-toolbar strong")).toHaveText(
    "January 2027",
  );
  await page.route("**/schedule/preview?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(page.getByText("Schedule preview unavailable")).toBeVisible();
});

test("numeric fields support direct editing, validation and fractional retention", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const setup = page.locator("form.settings-card");
  const minutes = setup.getByRole("textbox", { name: /Default duration/ });
  await expect(minutes).toBeVisible({ timeout: 40000 });
  await expect(minutes).toHaveAttribute("inputmode", "numeric");
  await minutes.fill("");
  await expect(minutes).toHaveValue("");
  const submit = setup.getByRole("button", { name: "Save preferences" });
  for (const invalid of ["", "4", "181", "8.5", "abc"]) {
    await minutes.fill(invalid);
    await submit.click();
    await expect(minutes).toHaveAttribute("aria-invalid", "true");
    await expect(minutes).toHaveValue(invalid);
  }
  await minutes.fill("005");
  await minutes.hover();
  await minutes.focus();
  await page.mouse.wheel(0, 120);
  await expect(minutes).toBeFocused();
  await expect(minutes).toHaveValue("005");
  await minutes.press("Tab");
  await expect(minutes).toHaveValue("5");
  await minutes.fill("180");
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Preferences saved");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel(/Default duration/)).toHaveValue("180");
  await page.getByText("Advanced memory preferences", { exact: true }).click();
  const retention = page.getByLabel(/Importance 1 retention/);
  await expect(retention).toHaveAttribute("inputmode", "decimal");
  await retention.fill("85,5");
  await retention.press("Enter");
  await expect
    .poll(
      async () =>
        (
          await db.collection(`users/${uid}/preferences`).doc("default").get()
        ).get("retention")[0],
    )
    .toBeCloseTo(0.855, 8);
});

test("optional topic details and manual date on a short viewport", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByRole("textbox", { name: /Topic name/ });
  await expect(name).toBeFocused();
  await name.fill("Chain rule");
  await page.setViewportSize({ width: 390, height: 390 });
  const submit = dialog.getByRole("button", { name: "Add topic", exact: true });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await dialog
    .locator(".level-choices")
    .first()
    .getByRole("button", { name: "3" })
    .click();
  await dialog
    .locator(".level-choices")
    .last()
    .getByRole("button", { name: "5" })
    .click();
  await dialog
    .getByLabel("Material 1", { exact: true })
    .fill("Differentiate the outer function first.");
  await dialog.getByRole("button", { name: "Change", exact: true }).click();
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(dialog.locator(".schedule-summary")).toContainText("Automatic");
  await dialog.getByRole("button", { name: "Change", exact: true }).click();
  await dialog.getByLabel(/Change date/).fill("2031-04-10T18:25");
  await expect(dialog.locator(".preview strong")).toContainText(
    /April 10.*18:25/,
  );
  await expect(dialog.locator(".schedule-summary")).toContainText(
    "95% recall goal",
  );
  await expect(submit).toBeInViewport({ ratio: 1 });
  await submit.click();
  await expect(page.getByRole("status")).toContainText("10 Apr · 18:25");
  await page.getByRole("button", { name: "View topic" }).click();
  await page.getByRole("button", { name: "Review now" }).click();
  await expect(
    dialog.getByText("Differentiate the outer function first."),
  ).toBeHidden();
  await dialog.getByText("Show notes", { exact: true }).click();
  await expect(
    dialog.getByText("Differentiate the outer function first."),
  ).toBeVisible();
});

test("Russian account preference, pending archived filter, empty state and cancel", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator("aside").getByRole("navigation")).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/preferences/language") &&
      response.request().postDataJSON()?.language === "ru",
  );
  await page.getByRole("button", { name: "Русский" }).click();
  expect((await saved).ok()).toBe(true);
  await page.evaluate(() => localStorage.removeItem("bsi.language"));
  await page.reload();
  await page.getByRole("button", { name: "Темы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Пока нет тем" }),
  ).toBeVisible();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/topics.*limit=100.*archived=true/, async (route) => {
    await hold;
    await route.continue();
  });
  await page.getByRole("switch", { name: "Архивные" }).check();
  try {
    await expect(page.getByRole("status")).toHaveText("Загружаем темы…");
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "В архиве пока нет тем" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Добавить тему", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Название темы/).fill("Тест");
  await expect(dialog.locator(".schedule-summary")).toContainText(
    "Автоматически",
  );
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.collection(`users/${uid}/topics`).get()).empty).toBe(true);
});

test("account settings links to public policies and requires deletion confirmation", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Privacy Policy" }),
  ).toHaveAttribute("href", "/privacy");
  let deleteRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/account/delete")
      deleteRequests++;
  });
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await expect(dialog).toContainText("review history");
  await expect(dialog).toContainText("Calendar events may remain");
  await expect(
    dialog.getByRole("button", { name: "Confirm deletion with Google" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(deleteRequests).toBe(0);
});
