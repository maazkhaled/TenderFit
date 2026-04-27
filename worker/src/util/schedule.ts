export interface ScheduleLike {
  frequency: "daily" | "weekly";
  hourLocal: number;
  dayOfWeek: number | null;
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
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: hour === 24 ? 0 : hour,
    minute: parseInt(get("minute"), 10),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function localDateKey(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
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

  if (local.hour !== schedule.hourLocal) return false;
  if (local.minute >= 15) return false;

  if (schedule.frequency === "weekly") {
    if (schedule.dayOfWeek == null) return false;
    if (local.weekday !== schedule.dayOfWeek) return false;
  }

  if (schedule.lastSentAt) {
    const last = schedule.lastSentAt.getTime();
    const diffMs = now.getTime() - last;
    if (schedule.frequency === "daily") {
      if (diffMs < 23 * 60 * 60 * 1000) return false;
    } else {
      if (diffMs < 6 * 24 * 60 * 60 * 1000) return false;
    }

    let lastLocal: LocalParts;
    try {
      lastLocal = localParts(schedule.lastSentAt, tz);
    } catch {
      lastLocal = local;
    }
    const sameLocalDay =
      lastLocal.year === local.year &&
      lastLocal.month === local.month &&
      lastLocal.day === local.day;
    if (schedule.frequency === "daily" && sameLocalDay) return false;
  }

  return true;
}

export function localDateKeyOf(now: Date, timeZone: string): string {
  return localDateKey(now, timeZone || "UTC");
}
