import { DateTime } from "luxon";
export const date = (
  value: string | null,
  zone: string,
  format = "ccc, d LLL · HH:mm",
) =>
  value
    ? DateTime.fromISO(value).setZone(zone).toFormat(format)
    : "Not scheduled";
