import regions from "./timezone-regions.json";
// Country codes from IANA zone.tab, including the aliases in tzdata.zi.
const countries: Record<string, string> = regions;
export function initialZone(saved: string, firstSetup: boolean) {
  return firstSetup && saved === "UTC"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || saved
    : saved;
}
export function zoneOption(id: string, now: Date) {
  const raw = new Intl.DateTimeFormat("en", {
    timeZone: id,
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")!.value;
  const offset = "UTC" + (raw.replace("GMT", "") || "+00:00");
  const city = id.split("/").pop()!.replaceAll("_", " ");
  const region = countries[id];
  return {
    id,
    label: city + (region ? ", " + names.of(region) : "") + " — " + offset,
  };
}
const names = new Intl.DisplayNames(["en"], { type: "region" });
export function zoneOptions(saved: string) {
  const ids = Intl.supportedValuesOf?.("timeZone") ?? Object.keys(countries);
  const now = new Date();
  return [...new Set(["UTC", saved, ...ids])]
    .flatMap((id) => {
      try {
        return [zoneOption(id, now)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
export function addWords(existing: string[], text: string) {
  const tags = [...existing],
    problems = new Set<string>();
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (tags.some((t) => t.toLowerCase() === word.toLowerCase()))
      problems.add("That tag is already selected.");
    else if (word.length > 40)
      problems.add("Use at most 40 characters per tag.");
    else if (tags.length >= 20) problems.add("You can add up to 20 tags.");
    else tags.push(word);
  }
  return { tags, error: [...problems].join(" ") };
}
