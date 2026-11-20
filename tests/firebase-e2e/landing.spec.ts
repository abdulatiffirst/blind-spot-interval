import { expect, test } from "@playwright/test";

test("landing explains the product and fits a phone", async ({
  page,
  isMobile,
}) => {
  const width = isMobile ? 390 : 1280;
  await page.setViewportSize({ width, height: isMobile ? 844 : 720 });
  await page.goto("/");
  await expect(page).toHaveTitle(
    "Blind Spot Interval: spaced review reminders for students",
  );
  const ctas = page.getByRole("button", {
    name: "Continue with Google and add a topic",
  });
  await expect(ctas).toHaveCount(2);
  await expect(ctas.first()).toBeInViewport({ ratio: 1 });
  await expect(ctas.first()).toBeEnabled();
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBe(
    width,
  );
  await page.getByText("What is a topic?", { exact: true }).click();
  await expect(
    page.getByText("Something you studied", { exact: false }),
  ).toBeVisible();
});
