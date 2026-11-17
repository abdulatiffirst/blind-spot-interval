import { test, expect, type Page } from "@playwright/test";
import { db, auth } from "../../functions/src/store.ts";
let uid: string;
async function signIn(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Continue with Google/ }),
  ).toBeVisible();
  const sub = crypto.randomUUID();
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
test("Google credential → onboarding → Logarithms → FSRS review → internal calendar", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole("dialog", { name: "Find your learning rhythm." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Let’s begin/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
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
  await expect(page.getByRole("button", { name: /Logarithms/ })).toBeVisible();
  const docs = await db.collection(`users/${uid}/reviewHistory`).get();
  expect(docs.size).toBe(1);
  expect(docs.docs[0].data().original_rating).toBe(4);
  const memory = await db.collection(`users/${uid}/memoryStates`).get();
  expect(memory.docs[0].data().card.reps).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
test("edit, archive, restore, keyboard dismissal and Firebase sign-out", async ({
  page,
}) => {
  await signIn(page);
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Continue with Google/ }),
  ).toBeVisible();
});
