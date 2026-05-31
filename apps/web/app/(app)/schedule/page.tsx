"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { DigestScheduleInputSchema, type DigestScheduleInput } from "@beta/shared";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { Field } from "@/components/ui/Input";
import { commonTimezones } from "@/lib/ui/countries";
import { cn } from "@/lib/ui/cn";

type Frequency = DigestScheduleInput["frequency"];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FREQUENCIES: Array<{ id: Frequency; label: string; hint: string }> = [
  { id: "daily", label: "Daily", hint: "Once per day, inside your time window." },
  { id: "every_n_days", label: "Every N days", hint: "Custom interval — e.g. every 2, 3, or 7 days." },
  { id: "weekly", label: "Weekly", hint: "Once a week on the day you choose." },
  { id: "monthly", label: "Monthly", hint: "Once a month on the calendar day you choose." },
];

const DEFAULT: DigestScheduleInput = {
  frequency: "daily",
  intervalDays: 2,
  hourLocal: 8,
  hourLocalEnd: 10,
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: "UTC",
  enabled: true,
  minFitScore: 60,
};

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export default function SchedulePage() {
  const [state, setState] = useState<DigestScheduleInput>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timezones, setTimezones] = useState<string[]>(["UTC"]);

  useEffect(() => {
    setTimezones(commonTimezones());
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/schedule", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const schedule = data.schedule ?? data;
          if (schedule) {
            // Coerce legacy rows missing the new fields so the form doesn't
            // explode if the API returns a pre-migration shape.
            const filled = {
              ...DEFAULT,
              ...schedule,
              hourLocalEnd:
                schedule.hourLocalEnd ?? Math.min(23, (schedule.hourLocal ?? 8) + 2),
              intervalDays: schedule.intervalDays ?? 2,
              dayOfMonth: schedule.dayOfMonth ?? null,
            };
            const parsed = DigestScheduleInputSchema.safeParse(filled);
            if (!cancelled && parsed.success) setState(parsed.data);
          }
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validation = useMemo(
    () => DigestScheduleInputSchema.safeParse(state),
    [state],
  );

  async function save() {
    setSaving(true);
    setError(null);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Invalid schedule.");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof DigestScheduleInput>(
    key: K,
    value: DigestScheduleInput[K],
  ) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function setFrequency(freq: Frequency) {
    setState((p) => ({
      ...p,
      frequency: freq,
      // Backfill required-for-mode fields with sensible defaults whenever the
      // user switches; lets them flip back and forth without losing context.
      dayOfWeek: freq === "weekly" ? (p.dayOfWeek ?? 1) : p.dayOfWeek,
      dayOfMonth: freq === "monthly" ? (p.dayOfMonth ?? 1) : p.dayOfMonth,
      intervalDays: freq === "every_n_days" ? (p.intervalDays || 2) : p.intervalDays,
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const windowHours = Math.max(0, state.hourLocalEnd - state.hourLocal) + 1;
  const windowLabel = `${hourLabel(state.hourLocal)} – ${hourLabel(state.hourLocalEnd)} (${windowHours}h window)`;

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Digest schedule</h1>
        <p className="text-sm text-zinc-600">
          Choose how often, and inside what time window, you want digest emails.
          Always scheduled, never always-on.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Cadence</CardTitle>
          <CardDescription>How often to deliver the digest.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FREQUENCIES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFrequency(id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  state.frequency === id
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-zinc-200 bg-white text-ink-soft hover:bg-zinc-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="text-xs text-zinc-500">
            {FREQUENCIES.find((f) => f.id === state.frequency)?.hint}
          </p>

          {state.frequency === "every_n_days" && (
            <Field
              label={`Send every ${state.intervalDays} ${state.intervalDays === 1 ? "day" : "days"}`}
              hint="1 = daily, 2 = every other day, 7 = weekly, …"
            >
              <Slider
                min={1}
                max={30}
                step={1}
                value={state.intervalDays}
                onChange={(e) => patch("intervalDays", Number(e.target.value))}
              />
            </Field>
          )}

          {state.frequency === "weekly" && (
            <Field label="Day of week">
              <Select
                value={String(state.dayOfWeek ?? 1)}
                onChange={(e) => patch("dayOfWeek", Number(e.target.value))}
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {state.frequency === "monthly" && (
            <Field
              label="Day of month"
              hint="Choosing 31 means 'last day of month' in short months."
            >
              <Select
                value={String(state.dayOfMonth ?? 1)}
                onChange={(e) => patch("dayOfMonth", Number(e.target.value))}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery time window</CardTitle>
          <CardDescription>
            The digest will be sent any time inside this local window. Pick a
            range you're happy receiving emails in — anywhere from a 1-hour
            slot to a full workday.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm font-medium text-zinc-700">{windowLabel}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Window start (local)">
              <Select
                value={String(state.hourLocal)}
                onChange={(e) => {
                  const start = Number(e.target.value);
                  setState((p) => ({
                    ...p,
                    hourLocal: start,
                    // Auto-bump the end if it'd otherwise be invalid.
                    hourLocalEnd: Math.max(start, p.hourLocalEnd),
                  }));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Window end (local)">
              <Select
                value={String(state.hourLocalEnd)}
                onChange={(e) => {
                  const end = Number(e.target.value);
                  setState((p) => ({
                    ...p,
                    hourLocalEnd: end,
                    hourLocal: Math.min(end, p.hourLocal),
                  }));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Timezone">
            <Select
              value={state.timezone}
              onChange={(e) => patch("timezone", e.target.value)}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Only include matches above the threshold.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          <Field
            label={`Minimum fit score: ${state.minFitScore}`}
            hint="Below this score, the match is dropped from the digest."
          >
            <Slider
              min={0}
              max={100}
              step={5}
              value={state.minFitScore}
              onChange={(e) => patch("minFitScore", Number(e.target.value))}
            />
          </Field>

          <label className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Digest enabled</p>
              <p className="text-xs text-zinc-500">
                Turn off to pause delivery without losing your settings.
              </p>
            </div>
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={(e) => patch("enabled", e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-indigo-600"
            />
          </label>
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 pt-6">
        {savedAt && !error ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved
          </span>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={saving || !validation.success}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
