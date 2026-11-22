import type { Busy } from "./index.ts";

type FreeBusyRequest = (
  path: string,
  options: { method: string; body: unknown },
) => Promise<any>;

// Cold start can be seven days out. The scheduler searches thirty local days
// from there. Include a margin for DST and query a manual override directly.
export async function primaryAvailability(
  request: FreeBusyRequest,
  manual?: string,
  duration = 15,
): Promise<Busy[]> {
  const start = manual ? Date.parse(manual) : Date.now();
  const end = start + (manual ? duration * 60000 : 39 * 86400000);
  const data = await request("freeBusy", {
    method: "POST",
    body: {
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      items: [{ id: "primary" }],
    },
  });
  const primary = data?.calendars?.primary;
  if (
    primary?.errors?.length ||
    !Array.isArray(primary?.busy) ||
    !primary.busy.every(
      (b: Busy) => b && Date.parse(b.start) < Date.parse(b.end),
    )
  ) {
    throw new Error("Primary calendar availability unavailable");
  }
  return primary.busy.map(({ start, end }: Busy) => ({
    start,
    end,
    external: true,
  }));
}
