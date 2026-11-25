import { afterEach, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import en from "../apps/web/src/i18n/locales/en.json";
import ru from "../apps/web/src/i18n/locales/ru.json";
import {
  daysAway,
  detectLanguage,
  setLanguage,
  translate,
} from "../apps/web/src/i18n";
import { fullDate, relativeDay } from "../apps/web/src/date";
import { zoneOption } from "../apps/web/src/form-options";
afterEach(() => {
  setLanguage("en");
  vi.unstubAllGlobals();
});
it("translates every message and preserves its interpolation fields", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(ru[key].trim()).not.toBe("");
    expect(ru[key].match(/\{\w+\}/g)?.sort()).toEqual(
      en[key].match(/\{\w+\}/g)?.sort(),
    );
  }
});
it("prefers a saved language, detects Russian, and falls back to English", () => {
  expect(detectLanguage("en", "ru-RU")).toBe("en");
  expect(detectLanguage(null, "ru-KZ")).toBe("ru");
  expect(detectLanguage("unsupported", "de-DE")).toBe("en");
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { setItem });
  setLanguage("ru");
  expect(setItem).toHaveBeenCalledWith("bsi.language", "ru");
  expect(translate("addTopic")).toBe("Добавить тему");
  expect([1, 2, 5, 11, 21].map(daysAway)).toEqual([
    "Через 1 день",
    "Через 2 дня",
    "Через 5 дней",
    "Через 11 дней",
    "Через 21 день",
  ]);
});
it("uses Russian date grammar and calendar days in the study timezone", () => {
  setLanguage("ru");
  expect(fullDate("2026-11-23T13:00:00Z", "Asia/Tashkent")).toMatch(
    /Понедельник, 23 ноября.*18:00/,
  );
  expect(
    relativeDay(
      "2026-03-08T06:00:00Z",
      "America/New_York",
      DateTime.fromISO("2026-03-08T04:30:00Z"),
    ),
  ).toBe("Завтра");
  expect(fullDate(null, "UTC")).toBe("Время не назначено");
  expect(zoneOption("Asia/Tashkent", new Date(), "ru").label).toContain(
    "Ташкент, Узбекистан",
  );
});
