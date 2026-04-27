"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { DigestScheduleInputSchema, type DigestScheduleInput } from "@beta/shared";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { Field } from "@/components/ui/Input";
import { commonTimezones } from "@/lib/ui/countries";
import { cn } from "@/lib/ui/cn";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT: DigestScheduleInput = {
  frequency: "daily",
  hourLocal: 8,
  dayOfWeek: null,
  timezone: "UTC",
  enabled: true,
  minFitScore: 60,
};

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
          const parsed = DigestScheduleInputSchema.safeParse(schedule);
          if (!cancelled && parsed.success) setState(parsed.data);
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

  async function save() {
    setSaving(true);
    setError(null);
    const parsed = DigestScheduleInputSchema.safeParse(state);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid schedule.");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Digest schedule</h1>
        <p className="text-sm text-zinc-600">
          Choose when to receive your tender digest. Always scheduled, never always-on.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Cadence</CardTitle>
          <CardDescription>How often to deliver the digest.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="flex items-center gap-2">
            {(["daily", "weekly"] as const).map((freq) => (
              <button
                key={freq}
                type="button"
                onClick={() =>
                  setState((p) => ({
                    ...p,
                    frequency: freq,
                    dayOfWeek: freq === "weekly" ? (p.dayOfWeek ?? 1) : null,
                  }))
                }
                className={cn(
                  "rounded-md border px-4 py-2 text-sm font-medium capitalize transition-colors",
                  state.frequency === freq
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-zinc-200 bg-white text-ink-soft hover:bg-zinc-50",
                )}
              >
                {freq}
              </button>
            ))}
          </div>

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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Hour of day (local)">
              <Select
                value={String(state.hourLocal)}
                onChange={(e) => patch("hourLocal", Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            </Field>
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
          </div>
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
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
