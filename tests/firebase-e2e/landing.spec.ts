import { expect, test } from "@playwright/test";

test("landing explains the product and fits a phone", async ({
  page,
  isMobile,
}) => {
  const width = isMobile ? 390 : 1350;
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
  if (!isMobile) {
    const edges = await page.locator(".landing").evaluate((landing) => {
      const bounds = (selector: string) =>
        landing.querySelector(selector)!.getBoundingClientRect();
      return {
        logo: bounds("header .logo").left,
        heading: bounds("h1").left,
        toggle: bounds("header button").right,
        demo: bounds(".product-example").right,
      };
    });
    expect(edges.logo).toBe(edges.heading);
    expect(edges.toggle).toBe(edges.demo);
    expect(edges.logo).toBe(width - edges.demo);
  }
  await page.getByText("What is a topic?", { exact: true }).click();
  await expect(
    page.getByText("Something you studied", { exact: false }),
  ).toBeVisible();
});
