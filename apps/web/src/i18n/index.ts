import { useSyncExternalStore } from "react";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
export type Language = "en" | "ru";
export type MessageKey = keyof typeof en;
const catalogs: Record<Language, Partial<typeof en>> = { en, ru };
const storageKey = "bsi.language";
export function detectLanguage(
  saved: string | null,
  browser: string,
): Language {
  return saved === "en" || saved === "ru"
    ? saved
    : /^ru(?:-|$)/i.test(browser)
      ? "ru"
      : "en";
}
function initialLanguage() {
  let saved = null;
  try {
    saved = globalThis.localStorage?.getItem(storageKey) ?? null;
  } catch {
    /* Storage may be disabled. */
  }
  return detectLanguage(saved, globalThis.navigator?.language ?? "en");
}
let language = initialLanguage();
const listeners = new Set<() => void>();
export const getLanguage = () => language;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage);
}
export function setLanguage(next: Language) {
  if (next !== "en" && next !== "ru") return;
  try {
    globalThis.localStorage?.setItem(storageKey, next);
  } catch {
    /* In-memory selection still works. */
  }
  if (language === next) return;
  language = next;
  listeners.forEach((notify) => notify());
}
export function translate(
  key: MessageKey,
  values: Record<string, string | number> = {},
) {
  return (catalogs[language][key] ?? en[key]).replace(
    /\{(\w+)\}/g,
    (match, name: string) => String(values[name] ?? match),
  );
}
export function daysAway(count: number) {
  const form = new Intl.PluralRules(language).select(count);
  const key =
    form === "one" || form === "few" || form === "many" ? form : "other";
  return translate(`daysAway_${key}`, { count });
}
// Older saved schedule reasons and API errors use English message strings.
const systemKeys = new Map(
  Object.entries(en).map(([key, text]) => [text, key as MessageKey]),
);
export function systemMessage(message: string) {
  if (!message) return "";
  if (Object.hasOwn(en, message)) return translate(message as MessageKey);
  const google = /^Google Calendar (?:synchronization )?returned (\d{3})$/.exec(
    message,
  );
  if (google) return translate("syncCode", { code: google[1] });
  const key = systemKeys.get(message);
  return key
    ? translate(key)
    : language === "en"
      ? message
      : translate("requestFailed");
}
