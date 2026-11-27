import { expect, it } from "vitest";
import { materialParts } from "../apps/web/src/material-links";

it("preserves notes, line breaks, bullets, symbols and surrounding punctuation", () => {
  expect(
    materialParts(
      "• Дисконтирование ∑\n• See (HTTPS://example.edu/NPV_(finance)).",
    ),
  ).toEqual([
    "• Дисконтирование ∑\n• See (",
    {
      text: "HTTPS://example.edu/NPV_(finance)",
      href: "https://example.edu/NPV_(finance)",
    },
    ").",
  ]);
});

it("uses a descriptive label and keeps IPv6 and Unicode links valid", () => {
  expect(
    materialParts("[Учебник](https://example.edu/финансы) and http://[::1]."),
  ).toEqual([
    {
      text: "Учебник",
      href: "https://example.edu/%D1%84%D0%B8%D0%BD%D0%B0%D0%BD%D1%81%D1%8B",
    },
    " and ",
    { text: "http://[::1]", href: "http://[::1]/" },
    ".",
  ]);
});

it("leaves invalid URLs, dangerous schemes and HTML markup as text", () => {
  const text =
    "<img src=x onerror=alert(1)> javascript:alert(1) [open](data:text/html,abc) file:///tmp/x javascript:https://example.edu https://";
  expect(materialParts(text)).toEqual([text]);
});

it("keeps significant URL punctuation in standalone materials", () => {
  const url = "https://example.edu/?answer=yes!";
  expect(materialParts(url)).toEqual([{ text: url, href: url }]);
});
