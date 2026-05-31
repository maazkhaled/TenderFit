/**
 * Digest scheduling logic.
 *
 * Called by the worker's cron tick once every 15 minutes. For each enabled
 * DigestSchedule row, we ask: "should we fire right now?"
 *
 * The contract is:
 *   - `enabled` must be true
 *   - `now` in the tenant's local timezone must fall in [hourLocal, hourLocalEnd]
 *   - The cadence (daily / every_n_days / weekly / monthly) must match the
 *     current local day-of-week / day-of-month / interval-since-last-send
 *   - lastSentAt debounces so we send at most once per cadence period, even
 *     across multiple cron ticks inside the window
 *
 * Times are evaluated in the *schedule's* timezone, not UTC. Two tenants in
 * different zones with identical settings will fire at the local hour each
 * specified, not at the same UTC moment.
 */

export type DigestFrequency = "daily" | "every_n_days" | "weekly" | "monthly";

export interface ScheduleLike {
  frequency: DigestFrequency;
  /** Used only when frequency = every_n_days. Must be >= 1. */
  intervalDays: number;
  /** Start hour of the delivery window, 0..23. */
  hourLocal: number;
  /** End hour of the delivery window, 0..23. Must be >= hourLocal. */
  hourLocalEnd: number;
  /** 0=Sun..6=Sat. Required for weekly. */
  dayOfWeek: number | null;
  /** 1..31. Required for monthly. 31 falls back to the last day of short months. */
  dayOfMonth: number | null;
  timezone: string;
  enabled: boolean;
  lastSentAt: Date | null;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  /** Number of days in the local month for `now` — needed for dayOfMonth=31 clamp. */
  daysInMonth: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function daysInMonth(year: number, month1to12: number): number {
  // JS Date trick: day 0 of next month is the last day of `month1to12`.
  return new Date(year, month1to12, 0).getDate();
}

function localParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";

  const hour = parseInt(get("hour"), 10);
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  return {
    year,
    month,
    day,
    hour: hour === 24 ? 0 : hour,
    minute: parseInt(get("minute"), 10),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    daysInMonth: daysInMonth(year, month),
  };
}

function sameLocalDay(a: LocalParts, b: LocalParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Effective day-of-month for a monthly schedule. If the schedule says "send
 * on the 31st" but the current month only has 28 days, fall back to the
 * last day of the month — otherwise the schedule would never fire in Feb.
 */
function effectiveDayOfMonth(schedule: ScheduleLike, local: LocalParts): number | null {
  if (schedule.dayOfMonth == null) return null;
  return Math.min(schedule.dayOfMonth, local.daysInMonth);
}

/**
 * Minimum elapsed milliseconds since lastSentAt before we may fire again.
 * For daily we additionally guarantee "different local day" so a schedule
 * with a wide window can't double-fire near midnight.
 */
function minElapsedMsFor(schedule: ScheduleLike): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  switch (schedule.frequency) {
    case "daily":
      return 22 * 60 * 60 * 1000; // <1 local day, with sameLocalDay guard below
    case "every_n_days":
      // Allow a 30-min slack to absorb cron jitter so a "every 2 days at 8am"
      // schedule doesn't slip by a day when ticked 7:55 vs 8:25.
      return Math.max(1, schedule.intervalDays) * DAY_MS - 30 * 60 * 1000;
    case "weekly":
      return 6 * DAY_MS;
    case "monthly":
      return 27 * DAY_MS;
  }
}

export function isDueNow(schedule: ScheduleLike, now: Date): boolean {
  if (!schedule.enabled) return false;

  const tz = schedule.timezone || "UTC";
  let local: LocalParts;
  try {
    local = localParts(now, tz);
  } catch {
    return false;
  }

  // ---- 1. Window check ----
  // Note: hourLocalEnd is inclusive — a window of [8, 10] covers 08:00–10:59
  // in local time, giving the cron 3 hours of opportunity to fire.
  if (local.hour < schedule.hourLocal) return false;
  if (local.hour > schedule.hourLocalEnd) return false;

  // ---- 2. Cadence-specific calendar gates ----
  if (schedule.frequency === "weekly") {
    if (schedule.dayOfWeek == null) return false;
    if (local.weekday !== schedule.dayOfWeek) return false;
  }

  if (schedule.frequency === "monthly") {
    const effDay = effectiveDayOfMonth(schedule, local);
    if (effDay == null) return false;
    if (local.day !== effDay) return false;
  }

  // ---- 3. lastSentAt debounce ----
  if (schedule.lastSentAt) {
    const last = schedule.lastSentAt.getTime();
    const diffMs = now.getTime() - last;
    if (diffMs < minElapsedMsFor(schedule)) return false;

    // Daily/window-based: even if 22h have passed, refuse if we already sent
    // today in local time. This catches a schedule whose window spans
    // midnight ('hourLocal=22, hourLocalEnd=23' on day N then '0..1' on N+1
    // would be a different config — we only allow start<=end so this is
    // mostly belt-and-braces).
    if (schedule.frequency === "daily") {
      let lastLocal: LocalParts;
      try {
        lastLocal = localParts(schedule.lastSentAt, tz);
      } catch {
        lastLocal = local;
      }
      if (sameLocalDay(lastLocal, local)) return false;
    }
  }

  return true;
}

function localDateKey(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localDateKeyOf(now: Date, timeZone: string): string {
  return localDateKey(now, timeZone || "UTC");
}
