"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TenderSourceCatalogEntry, TenderSourceId } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/ui/cn";

export function SourceFilter({
  sources,
  selectedSources,
  filterApplied,
}: {
  sources: readonly TenderSourceCatalogEntry[];
  selectedSources: TenderSourceId[];
  filterApplied: boolean;
}) {
  const allIds = useMemo(() => sources.map((source) => source.id), [sources]);
  const [selected, setSelected] = useState<Set<TenderSourceId>>(
    () => new Set(selectedSources),
  );
  // Collapsed by default — the source list is long, and most users won't
  // touch it day-to-day. Show only the header summary; clicking expands.
  // When a non-default filter is already applied, default to expanded so
  // the user can see what's selected.
  const [expanded, setExpanded] = useState(filterApplied);

  const selectedCount = selected.size;

  function toggleSource(source: TenderSourceId, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(source);
      else next.delete(source);
      return next;
    });
  }

  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 text-left group"
            aria-expanded={expanded}
            aria-controls="source-filter"
          >
            <ChevronIcon className="h-4 w-4 text-zinc-500 transition-transform group-hover:text-zinc-700" />
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
                Sources
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                {filterApplied
                  ? `${selectedCount} of ${allIds.length} selected`
                  : `All ${allIds.length} sources included`}
                <span className="ml-2 text-xs text-zinc-400">
                  {expanded ? "(click to hide)" : "(click to customise)"}
                </span>
              </p>
            </div>
          </button>
          {expanded ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelected(new Set(allIds))}
              >
                Select all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelected(new Set())}
              >
                Deselect all
              </Button>
              <Button form="source-filter" size="sm" type="submit">
                Apply
              </Button>
              <a
                className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-zinc-50"
                href="/dashboard"
              >
                Clear
              </a>
            </div>
          ) : null}
        </div>

        <form
          id="source-filter"
          className={cn(
            "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
            expanded ? "" : "hidden",
          )}
        >
          <input name="sourceFilter" type="hidden" value="1" />
          {sources.map((source) => {
            // Sources marked "unavailable" in the catalog are wired in but
            // turned off in the runtime adapter registry (see
            // packages/ingest/src/index.ts). They stay visible/checkable so
            // tenants can opt in ahead of re-enable, but a small grey badge
            // makes it clear no tenders will arrive from them right now.
            const isUnavailable = source.availability === "unavailable";
            return (
              <label
                key={source.id}
                className={cn(
                  "flex min-h-20 cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 hover:bg-zinc-50",
                  isUnavailable && "opacity-70",
                )}
              >
                <input
                  checked={selected.has(source.id)}
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900"
                  name="sources"
                  onChange={(event) => toggleSource(source.id, event.target.checked)}
                  type="checkbox"
                  value={source.id}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900">
                      {source.checkboxLabel}
                    </span>
                    {isUnavailable ? (
                      <span
                        className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600"
                        title={source.unavailableReason ?? undefined}
                      >
                        Temporarily not available
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">
                    {source.description}
                    {isUnavailable && source.unavailableReason ? (
                      <span className="mt-1 block text-zinc-400">
                        {source.unavailableReason}
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
        </form>
      </CardBody>
    </Card>
  );
}
