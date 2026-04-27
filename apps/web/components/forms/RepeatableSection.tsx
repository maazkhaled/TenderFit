"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

export interface RepeatableSectionProps<T> {
  items: T[];
  onChange: (next: T[]) => void;
  newItem: () => T;
  renderItem: (
    item: T,
    update: (patch: Partial<T>) => void,
    index: number,
  ) => React.ReactNode;
  addLabel?: string;
  emptyHint?: string;
}

export function RepeatableSection<T>({
  items,
  onChange,
  newItem,
  renderItem,
  addLabel = "Add another",
  emptyHint,
}: RepeatableSectionProps<T>) {
  function update(idx: number, patch: Partial<T>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && emptyHint && (
        <p className="text-sm text-zinc-500">{emptyHint}</p>
      )}
      {items.map((item, idx) => (
        <Card key={idx} className="bg-zinc-50/40">
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Entry {idx + 1}
              </span>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-zinc-400 hover:text-red-600"
                aria-label="Remove entry"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {renderItem(item, (patch) => update(idx, patch), idx)}
          </CardBody>
        </Card>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, newItem()])}
      >
        <Plus className="h-4 w-4" />
        {addLabel}
      </Button>
    </div>
  );
}
