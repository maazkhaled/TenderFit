"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface TenantOption {
  id: string;
  slug: string;
  companyName: string;
  hasProfile: boolean;
  isActive: boolean;
}

interface Props {
  tenants: TenantOption[];
  activeTenantId: string | null;
  /** Called after a switch/create/delete so the parent can refresh. */
  onChanged?: () => void;
}

/**
 * Profile dropdown shown at the top of /profile and (optionally) the layout
 * header. Lets the user:
 *   - see every owned tenant + which one is active
 *   - switch active tenant (POST /api/v1/tenants/[id]/activate)
 *   - create a new empty tenant from a name (POST /api/v1/tenants)
 *   - delete the active tenant with confirmation (DELETE /api/v1/tenants/[id])
 */
export function ProfileSwitcher({ tenants, activeTenantId, onChanged }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = tenants.find((t) => t.id === activeTenantId) ?? null;
  const label = active?.companyName ?? "No profile selected";

  async function refresh() {
    setOpen(false);
    setCreating(false);
    setNewName("");
    onChanged?.();
    router.refresh();
  }

  async function activate(id: string) {
    if (id === activeTenantId) {
      setOpen(false);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tenants/${id}/activate`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "switch failed");
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const name = newName.trim();
    if (!name) {
      setError("Enter a company name.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: name }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteActive() {
    if (!active) return;
    if (!confirm(`Delete "${active.companyName}"? This removes the profile and all its matches. This cannot be undone.`)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tenants/${active.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-ink shadow-sm hover:bg-zinc-50 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="max-w-[16rem] truncate">{label}</span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-30 w-72 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg">
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {tenants.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-500">
                No profiles yet. Create one below.
              </li>
            )}
            {tenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => activate(t.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  <span className="flex flex-1 flex-col items-start">
                    <span className="font-medium">{t.companyName}</span>
                    <span className="text-xs text-zinc-500">
                      {t.hasProfile ? t.slug : `${t.slug} · (empty)`}
                    </span>
                  </span>
                  {t.isActive && <Check className="h-4 w-4 text-indigo-600" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-100 p-2">
            {creating ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New company name"
                  className="block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={createNew} disabled={busy}>
                    {busy ? "Creating…" : "Create"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50"
              >
                <Plus className="h-4 w-4" /> New profile
              </button>
            )}
            {active && (
              <button
                type="button"
                onClick={deleteActive}
                disabled={busy}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete current profile
              </button>
            )}
          </div>
          {error && (
            <p className="border-t border-zinc-100 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
