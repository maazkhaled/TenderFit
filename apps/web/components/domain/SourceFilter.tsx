"use client";

import { useMemo, useState } from "react";
import type { TenderSourceCatalogEntry, TenderSourceId } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

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

  const selectedCount = selected.size;

  function toggleSource(source: TenderSourceId, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(source);
      else next.delete(source);
      return next;
    });
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Sources
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {filterApplied
                ? `${selectedCount} selected`
                : "All sources included"}
            </p>
          </div>
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
        </div>

        <form id="source-filter" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input name="sourceFilter" type="hidden" value="1" />
          {sources.map((source) => (
            <label
              key={source.id}
              className="flex min-h-20 cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 hover:bg-zinc-50"
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
                <span className="block text-sm font-medium text-zinc-900">
                  {source.checkboxLabel}
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  {source.description}
                </span>
              </span>
            </label>
          ))}
        </form>
      </CardBody>
    </Card>
  );
}
