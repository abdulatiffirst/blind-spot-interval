import { expect, test } from "@playwright/test";

test("public landing page fits the screen and keeps sign-in and contacts reachable", async ({
  page,
  isMobile,
}) => {
  // Exercise a small phone and a short laptop, where the artwork previously overflowed.
  const size = isMobile
    ? { width: 320, height: 568 }
    : { width: 1280, height: 720 };
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page).toHaveTitle("Blind Spot Interval");
  const signIn = page.getByRole("button", { name: "Continue with Google" });
  await expect(signIn).toBeEnabled();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const footer = page.getByRole("contentinfo");
  const telegram = footer.getByRole("link", {
    name: "Telegram: @aabdunazirov",
  });
  const email = footer.getByRole("link", {
    name: "Email: abdulatifabdunazirov@gmail.com",
  });
  await expect(telegram).toHaveAttribute("href", "https://t.me/aabdunazirov");
  await expect(telegram).toHaveAttribute("rel", /noopener/);
  await expect(telegram).toHaveAttribute("target", "_blank");
  await expect(email).toHaveAttribute(
    "href",
    "mailto:abdulatifabdunazirov@gmail.com",
  );
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBe(
    size.width,
  );
  if (!isMobile) {
    expect(await page.locator("html").evaluate((el) => el.scrollHeight)).toBe(
      size.height,
    );
    await expect(signIn).toBeInViewport({ ratio: 1 });
    await expect(footer).toBeInViewport({ ratio: 1 });
  }
  await email.focus();
  await expect(email).toBeFocused();
  await expect(email).toBeInViewport();
});
