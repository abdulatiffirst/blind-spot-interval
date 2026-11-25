import type { Preferences } from "./index.ts";

export const defaults: Preferences = {
  timezone: "UTC",
  studyStart: "09:00",
  studyEnd: "21:00",
  duration: 15,
  daysBefore: 1,
  daysAfter: 2,
  retention: [0.85, 0.88, 0.9, 0.93, 0.95],
  onboarded: false,
};

export function safeUrl(text: string) {
  try {
    const u = new URL(text);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
