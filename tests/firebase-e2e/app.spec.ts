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
    page.getByRole("button", { name: "Continue with Google" }),
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
  const login = page.getByRole("button", { name: "Continue with Google" });
  const error = page.getByRole("alert");
  await login.click();
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
  const login = page.getByRole("button", { name: "Continue with Google" });
  await login.click();
  await expect(
    page.getByRole("button", { name: "Opening Google Sign-In…" }),
  ).toBeDisabled();
  await page.clock.fastForward(120_000);
  await expect(page.getByRole("alert")).toHaveText(
    "Google Sign-In timed out. Close the sign-in window and try again.",
  );
  await expect(login).toBeEnabled();
});

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
  await expect(onboarding).toBeVisible({ timeout: 40000 });
  await page.getByRole("button", { name: /Let’s begin/ }).click();
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

  const restoredProfile = page.waitForResponse("**/api/v1/me");
  const restoredPreferences = page.waitForResponse("**/api/v1/preferences");
  await page.reload();
  expect((await restoredProfile).status()).toBe(200);
  expect((await restoredPreferences).status()).toBe(200);
  await expect(page.getByRole("navigation")).toBeVisible();
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
  await page.route("**/api/v1/me", holdRequest, {
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
      page.getByRole("button", { name: "Continue with Google" }),
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
      "**/api/v1/me",
      (route) =>
        route.fulfill({
          status,
          json: { error: "Profile unavailable" },
        }),
      { times: 1 },
    );
    await signIn(page);
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry loading workspace" }).click();
    await expect(
      page.getByRole("dialog", { name: "Find your learning rhythm." }),
    ).toBeVisible();
  });
}

test("Google credential → onboarding → Logarithms → FSRS review → internal calendar", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole("dialog", { name: "Find your learning rhythm." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Let’s begin/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Previous period" }).click();
  await page.getByRole("button", { name: "Previous period" }).click();
  await page
    .getByRole("button", { name: "Add topic", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /Topic name/ }).fill("Logarithms");
  await dialog.getByLabel("Initial knowledge").selectOption("3");
  await dialog.getByLabel("Importance").selectOption("5");
  await dialog.getByLabel(/Tags/).fill("Mathematics, Exam");
  await dialog
    .getByLabel("Material 1", { exact: true })
    .fill("Recall logarithm properties");
  await dialog.getByLabel("Material 1", { exact: true }).press("Enter");
  await dialog
    .getByLabel("Material 2", { exact: true })
    .fill("https://example.com");
  await expect(dialog.getByText(/95% target retention/)).toBeVisible();
  await dialog.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: /Logarithms/ }).click();
  await expect(page.getByText("95%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Review now/ }).click();
  await page.getByRole("button", { name: /4 Good recall/ }).click();
  await expect(page.getByRole("status")).toContainText("Next review");
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
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page.getByRole("button", { name: "Return to automatic" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await open.click();
  await page.getByRole("button", { name: /Review now/ }).click();
  await page.getByRole("button", { name: /1 Forgot completely/ }).click();
  await expect(page.getByRole("status")).toContainText("Next review");
  await open.click();
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
  await page.getByRole("button", { name: /Let’s begin/ }).click();
  await page
    .getByRole("button", { name: "Add topic", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: /Topic name/ })
    .fill("Python functions");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add topic", exact: true })
    .click();
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
      .filter({ hasText: "ACTIVE TOPICS" })
      .locator("strong"),
  ).toHaveText("01");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const login = page.getByRole("button", { name: "Continue with Google" });
  await expect(login).toBeVisible();
  await page.reload();
  await expect(login).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
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
  await page.getByRole("button", { name: /Let’s begin/ }).click();
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
