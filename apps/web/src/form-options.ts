import en from "./i18n/locales/en.json";
// Russian exemplar city names from Unicode CLDR. See i18n/UNICODE-LICENSE.txt.
import cities from "./i18n/ru-cities.json";
import type { Language } from "./i18n";
import regions from "./timezone-regions.json";
// Country codes from IANA zone.tab, including the aliases in tzdata.zi.
const countries: Record<string, string> = regions;
export function initialZone(saved: string, firstSetup: boolean) {
  return firstSetup && saved === "UTC"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || saved
    : saved;
}
export function zoneOption(id: string, now: Date, language: Language = "en") {
  const raw = new Intl.DateTimeFormat("en", {
    timeZone: id,
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")!.value;
  const offset = "UTC" + (raw.replace("GMT", "") || "+00:00");
  const fallback = id.split("/").pop()!.replaceAll("_", " ");
  const city =
    language === "ru"
      ? ((cities as Record<string, string>)[id] ?? fallback)
      : fallback;
  const region = countries[id];
  return {
    id,
    label:
      city + (region ? ", " + names[language].of(region) : "") + " — " + offset,
  };
}
const names = {
  en: new Intl.DisplayNames(["en"], { type: "region" }),
  ru: new Intl.DisplayNames(["ru"], { type: "region" }),
};
export function zoneOptions(saved: string, language: Language = "en") {
  const ids = Intl.supportedValuesOf?.("timeZone") ?? Object.keys(countries);
  const now = new Date();
  return [...new Set(["UTC", saved, ...ids])]
    .flatMap((id) => {
      try {
        return [zoneOption(id, now, language)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, language));
}
export function addWords(existing: string[], text: string) {
  const tags = [...existing],
    problems = new Set<string>();
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (tags.some((t) => t.toLowerCase() === word.toLowerCase()))
      problems.add(en.duplicateTag);
    else if (word.length > 40) problems.add(en.tagTooLong);
    else if (tags.length >= 20) problems.add(en.tooManyTags);
    else tags.push(word);
  }
  return { tags, error: [...problems].join(" ") };
}
