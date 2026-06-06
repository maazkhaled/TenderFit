"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, CheckCircle2, Loader2 } from "lucide-react";
import { DigestScheduleInputSchema, type DigestScheduleInput } from "@beta/shared";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Slider } from "@/components/ui/Slider";

/**
 * Single knob that controls both the dashboard's display floor AND the
 * digest's email threshold — they're the same field on DigestSchedule so
 * the user only has to set it once.
 *
 * Reads the current value from /api/v1/schedule on mount, debounces user
 * edits, and PUTs the updated schedule back. After a successful save it
 * router.refresh()es the dashboard so the new floor applies immediately
 * to the visible match list.
 */
export function MinFitScoreControl({ initialValue }: { initialValue: number }) {
  const router = useRouter();
  const [value, setValue] = useState<number>(initialValue);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<DigestScheduleInput | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from the actual saved schedule so we PUT the whole shape back
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/schedule", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const incoming = data.schedule ?? data;
        if (!incoming) return;
        const parsed = DigestScheduleInputSchema.safeParse({
          ...incoming,
          hourLocalEnd:
            incoming.hourLocalEnd ?? Math.min(23, (incoming.hourLocal ?? 8) + 2),
          intervalDays: incoming.intervalDays ?? 2,
          dayOfMonth: incoming.dayOfMonth ?? null,
        });
        if (cancelled) return;
        if (parsed.success) {
          setSchedule(parsed.data);
          setValue(parsed.data.minFitScore);
        }
      } catch {
        // silently fall back to initialValue
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced auto-save (500ms after the user stops sliding)
  useEffect(() => {
    if (!schedule) return;
    if (value === schedule.minFitScore) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        const next: DigestScheduleInput = { ...schedule, minFitScore: value };
        const res = await fetch("/api/v1/schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        setSchedule(next);
        setSavedAt(Date.now());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [value, schedule, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-indigo-600" />
          Minimum fit score
        </CardTitle>
        <CardDescription>
          Hide matches below this score from the dashboard. Digest emails use
          the same threshold.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums text-zinc-900">
            {value}
          </span>
          <span className="text-xs text-zinc-500">
            {saving ? (
              <span className="inline-flex items-center gap-1 text-indigo-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                Saved
              </span>
            ) : null}
          </span>
        </div>

        <Slider
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label="Minimum fit score"
        />

        <div className="flex justify-between text-[11px] uppercase tracking-wider text-zinc-400">
          <span>Show everything</span>
          <span>Only excellent matches</span>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
