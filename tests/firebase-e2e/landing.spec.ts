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
        toggle: bounds("header .icon-button").right,
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

test("switches languages, persists on reload and fits Russian text", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Русский" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByText("Что такое тема?", { exact: true }).click();
  await expect(page.getByText(/Это то, что вы изучили/)).toBeVisible();
  await page.getByRole("button", { name: /Совсем не помню/ }).click();
  await expect(page.getByRole("status")).toContainText("повторить");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Запоминайте то, что изучаете." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("public legal pages work directly and persist language and theme", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: "Privacy, terms and support",
  });
  await nav.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Русский" }).click();
  await page.locator("header .icon-button").click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(
    page.getByRole("heading", { name: "Политика конфиденциальности" }),
  ).toBeVisible();
  for (const [path, title] of [
    ["/terms", "Условия использования"],
    ["/support", "Центр поддержки"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator("footer a[aria-current='page']")).toHaveText(
      title,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Support Center" }),
  ).toBeVisible();
});
