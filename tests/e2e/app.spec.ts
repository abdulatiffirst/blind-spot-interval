import { test, expect } from "@playwright/test";
import { sql } from "../../packages/database/src/index.ts";
import { hash, random } from "../../apps/api/src/security.ts";
import { defaults } from "../../packages/shared/src/index.ts";
let user: string;
test.beforeEach(async ({ context }) => {
  const [u] =
    await sql`INSERT INTO users(google_sub,email,display_name) VALUES(${random()},'e2e@example.invalid','Curious Learner') RETURNING id`;
  user = u.id;
  const token = random();
  await sql`INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(${hash(token)},${user},${random()},now()+interval '1 hour')`;
  await sql`INSERT INTO user_preferences(user_id,settings) VALUES(${user},${sql.json({ ...defaults, onboarded: true })})`;
  await context.addCookies([
    {
      name: "bs_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
test.afterEach(async () => {
  await sql`DELETE FROM review_logs WHERE topic_id IN(SELECT id FROM topics WHERE user_id=${user})`;
  await sql`DELETE FROM users WHERE id=${user}`;
});
test.afterAll(async () => {
  await sql.end();
});
test("create, edit, review, archive and restore a real topic", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Make room for/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add topic", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /Topic name/ }).fill("Logarithms");
  await expect(dialog.getByLabel("Initial knowledge")).toHaveValue("");
  await dialog.getByLabel(/Tags/).fill("Math, Exam");
  await dialog
    .getByRole("textbox", { name: "Material 1", exact: true })
    .fill("Recall the change-of-base formula");
  await dialog
    .getByRole("textbox", { name: "Material 1", exact: true })
    .press("Enter");
  await dialog
    .getByRole("textbox", { name: "Material 2", exact: true })
    .fill("https://example.com");
  await dialog.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: /Logarithms/ }).click();
  await page.getByRole("button", { name: "Edit topic", exact: true }).click();
  await page
    .getByRole("textbox", { name: /Topic name/ })
    .fill("Logarithms and powers");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: /Logarithms and powers/ }).click();
  await page.getByRole("button", { name: /Review now/ }).click();
  await page.getByRole("button", { name: /4 Good recall/ }).click();
  await expect(page.getByRole("status")).toContainText("Next review");
  await page.getByRole("button", { name: /Logarithms and powers/ }).click();
  await expect(page.getByText(/4\/5/)).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page.getByRole("button", { name: /Logarithms and powers/ }),
  ).not.toBeVisible();
  await page.getByLabel("Archived", { exact: true }).check();
  await page.getByRole("button", { name: /Logarithms and powers/ }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.getByRole("status")).toContainText("Topic updated");
});
test("settings, calendar and keyboard dialog interaction", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Timezone", exact: true })
    .fill("Asia/Tashkent");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toContainText("Preferences saved");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Your internal calendar is ready")).toBeVisible();
  await page.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Topic name/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add topic", exact: true }),
  ).toBeFocused();
});
