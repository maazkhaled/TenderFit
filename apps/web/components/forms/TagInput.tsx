"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  uppercase?: boolean;
  maxLength?: number;
}

export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter…",
  id,
  uppercase,
  maxLength,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const raw = draft.trim();
    if (!raw) return;
    const next = uppercase ? raw.toUpperCase() : raw;
    if (maxLength && next.length > maxLength) return;
    if (value.includes(next)) {
      setDraft("");
      return;
    }
    onChange([...value, next]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div
      className={cn(
        "flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-200",
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(i)}
            className="rounded p-0.5 hover:bg-indigo-100"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={placeholder}
        className="flex-1 min-w-[8rem] bg-transparent px-1 text-sm outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}
