import { readFileSync } from "node:fs";

const { baseline, optimized } = JSON.parse(
  readFileSync(
    new URL("../docs/performance-benchmarks.json", import.meta.url),
    "utf8",
  ),
);
const populations = [100, 1_000, 10_000, 100_000, 1_000_000];
const workloads = [
  {
    name: "Inactive",
    topics: 100,
    visits: 0,
    pages: 0,
    creates: 0,
    completes: 0,
    corrections: 0,
    histories: 0,
    reschedules: 0,
    analytics: 0,
    otherApi: 0,
    calendarViews: 0,
    connected: 0.25,
    watched: 0.95,
    storageGiB: 0.004,
    hostingGiB: 0,
    apiGiB: 0,
  },
  {
    name: "Light",
    topics: 10,
    visits: 8,
    pages: 3,
    creates: 2,
    completes: 8,
    corrections: 1,
    histories: 2,
    reschedules: 1,
    analytics: 0,
    otherApi: 6,
    calendarViews: 2,
    connected: 0.1,
    watched: 0.95,
    storageGiB: 0.001,
    hostingGiB: 0.006,
    apiGiB: 0.001,
  },
  {
    name: "Normal",
    topics: 100,
    visits: 25,
    pages: 8,
    creates: 4,
    completes: 28,
    corrections: 3,
    histories: 6,
    reschedules: 2,
    analytics: 12,
    otherApi: 15,
    calendarViews: 6,
    connected: 0.25,
    watched: 0.95,
    storageGiB: 0.004,
    hostingGiB: 0.018,
    apiGiB: 0.004,
  },
  {
    name: "Heavy",
    topics: 500,
    visits: 90,
    pages: 30,
    creates: 30,
    completes: 120,
    corrections: 12,
    histories: 32,
    reschedules: 12,
    analytics: 60,
    otherApi: 40,
    calendarViews: 20,
    connected: 0.6,
    watched: 0.9,
    storageGiB: 0.025,
    hostingGiB: 0.065,
    apiGiB: 0.04,
  },
];

const gb = 1024 ** 3;
const days = 30;
const schedulerTicks = days * 24 * 60;
const afterFree = (usage, allowance, rate) =>
  Math.max(0, usage - allowance) * rate;
const band = (usage, minimum, maximum, rate) =>
  Math.max(0, Math.min(usage, maximum) - minimum) * rate;
function identityPlatform(n) {
  return band(n, 50_000, 100_000, 0.0055) + band(n, 100_000, 1_000_000, 0.0046);
}
function googleCalendarFuture(calls) {
  const gross = afterFree(calls, days * 1_000_000, 0.25 / 1_000);
  if (gross > 165_000) return gross * 0.6;
  return (
    band(gross, 0, 20_000, 1) +
    band(gross, 20_000, 50_000, 0.83) +
    band(gross, 50_000, 100_000, 0.7) +
    band(gross, 100_000, 165_000, 0.3)
  );
}

function estimate(workload, n, before = false) {
  const source = before ? baseline : optimized;
  const fixture = source.find((row) => row.topics === workload.topics);
  if (!fixture) throw new Error("Missing benchmark fixture");
  const find = (label) => {
    const row = fixture.measurements.find((row) => row.label === label);
    if (!row) throw new Error("Missing benchmark measurement " + label);
    return row;
  };
  const weights = {
    dashboard: workload.visits,
    "first topic page": workload.pages,
    "create topic": workload.creates,
    "concurrent completion": workload.completes,
    "correct rating": workload.corrections,
    "topic history": workload.histories,
    reschedule: workload.reschedules,
    "AI statistics handler": workload.analytics,
  };
  const periodic = find("connected fallback job");
  const periods =
    workload.connected *
    (before ? 8_640 : workload.watched * 780 + (1 - workload.watched) * 8_640);
  const changes =
    workload.connected *
    (workload.creates +
      workload.completes +
      workload.corrections +
      workload.reschedules);
  let reads =
    workload.otherApi * 4 + workload.calendarViews * (2 * workload.topics + 2);
  let writes = workload.otherApi + workload.calendarViews;
  let requests = workload.otherApi + workload.calendarViews;
  const ttlDeletes = requests + workload.analytics * 2;
  for (const [label, count] of Object.entries(weights)) {
    const r = find(label);
    reads += count * (r.reads + (r.aggregateQueries ?? 0));
    writes += count * r.writes;
    requests += count * r.invocations;
  }
  // OAuth access/grant verification, two distributed MCP limits and token issuance reserve.
  reads += workload.analytics * 5;
  writes += workload.analytics * 2;
  const jobs = periods + changes * 2;
  const hooks = changes * 2;
  const calendarCalls = periods * periodic.calendar + changes * 5;
  const cronReads = schedulerTicks * 3;
  const documentReads =
    (reads + periods * (periodic.reads + 2) + changes * 35) * n + cronReads;
  const documentWrites =
    (writes + periods * (periodic.writes + 2) + changes * 14) * n;
  const regularDeletes = (periods * periodic.deletes + changes * 2) * n;
  const billedTtlDeletes = (ttlDeletes + requests + jobs) * n;
  const firestore =
    afterFree(documentReads, days * 50_000, 0.06 / 100_000) +
    afterFree(documentWrites, days * 20_000, 0.18 / 100_000) +
    afterFree(regularDeletes, days * 20_000, 0.02 / 100_000) +
    (billedTtlDeletes * 0.02) / 100_000 +
    afterFree(n * workload.storageGiB, 1, 0.18);
  const runRequests = (requests + hooks + jobs) * n + schedulerTicks;
  const seconds =
    (requests * 0.3 + hooks * 0.1 + jobs * 0.4 + periods * 0.05) * n +
    schedulerTicks * 0.1;
  const functions =
    afterFree(runRequests, 2_000_000, 0.4 / 1_000_000) +
    afterFree(seconds, 180_000, 0.000024) +
    afterFree(seconds * 0.5, 360_000, 0.0000025);
  const hosting = afterFree(n * workload.hostingGiB, 10, 0.15);
  // European Premium Tier internet egress and Eventarc Standard Pub/Sub transport.
  const egress = n * workload.apiGiB;
  const networking =
    band(egress, 0, 1_024, 0.12) +
    band(egress, 1_024, 10_240, 0.11) +
    afterFree(egress, 10_240, 0.085);
  const eventTransport = afterFree((jobs * n * 2_048) / gb, 10, 40 / 1_024);
  const logging = afterFree((runRequests * 1024) / gb, 50, 0.5);
  const fixedGross = 0.1 + 0.1 + 0.12; // One scheduler job, 1 GiB of image storage, two secret versions.
  const fixedAfterAllowances = 0.05; // Unused project allowances for scheduler and secrets, half of registry GiB.
  const current =
    firestore +
    functions +
    hosting +
    networking +
    eventTransport +
    logging +
    fixedAfterAllowances;
  const futureCalendar = googleCalendarFuture(calendarCalls * n);
  return {
    workload: workload.name,
    population: n,
    firestore,
    functions,
    hosting,
    networking,
    logging,
    eventTransport,
    fixedGross,
    fixedAfterAllowances,
    firestoreReads: documentReads,
    firestoreWrites: documentWrites,
    cloudInvocations: runRequests,
    calendarCallsPerDay: (calendarCalls * n) / days,
    mcpRequests: workload.analytics * n,
    identityPlatform: workload.name === "Inactive" ? 0 : identityPlatform(n),
    current,
    futureCalendar,
    future: current + futureCalendar,
  };
}
const estimates = populations.flatMap((n) =>
  workloads.map((w) => estimate(w, n)),
);
const previous = populations.map((n) => estimate(workloads[2], n, true));
if (process.argv.includes("--json"))
  console.log(JSON.stringify({ estimates, previous }, null, 2));
else
  console.table(
    estimates.map((row) => ({
      workload: row.workload,
      accounts: row.population,
      monthlyUSD: row.current.toFixed(2),
      perAccountUSD: (row.current / row.population).toFixed(4),
      futureScaledCalendarUSD: row.future.toFixed(2),
      calendarCallsPerDay: Math.round(row.calendarCallsPerDay),
    })),
  );
