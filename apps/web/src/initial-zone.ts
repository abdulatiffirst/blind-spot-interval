export function initialZone(saved: string, firstSetup: boolean) {
  return firstSetup && saved === "UTC"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || saved
    : saved;
}
