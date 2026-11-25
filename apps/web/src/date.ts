import { DateTime } from "luxon";
import { daysAway, getLanguage, translate } from "./i18n";
export function date(
  value: string | null,
  zone: string,
  format = "ccc, d MMM · HH:mm",
) {
  return value
    ? DateTime.fromISO(value)
        .setZone(zone)
        .setLocale(getLanguage())
        .toFormat(format)
    : translate("unscheduled");
}
export function fullDate(value: string | null, zone: string) {
  if (!value) return translate("unscheduled");
  const lang = getLanguage();
  const formatted = new Intl.DateTimeFormat(lang === "en" ? "en-US" : lang, {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return formatted[0].toLocaleUpperCase(lang) + formatted.slice(1);
}
export function relativeDay(
  value: string,
  zone: string,
  now: DateTime = DateTime.now(),
) {
  const diff = Math.round(
    DateTime.fromISO(value)
      .setZone(zone)
      .startOf("day")
      .diff(now.setZone(zone).startOf("day"), "days").days,
  );
  return diff === 0
    ? translate("today")
    : diff === 1
      ? translate("tomorrow")
      : diff > 1
        ? daysAway(diff)
        : new Intl.RelativeTimeFormat(getLanguage(), {
            numeric: "auto",
          }).format(diff, "day");
}
