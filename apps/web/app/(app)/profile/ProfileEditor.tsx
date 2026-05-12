"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CapabilityProfileSchema, type CapabilityProfileInput } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Field } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { TagInput } from "@/components/forms/TagInput";
import { RepeatableSection } from "@/components/forms/RepeatableSection";
import { DocumentImport } from "@/components/forms/DocumentImport";
import { ProfileSwitcher, type TenantOption } from "@/components/domain/ProfileSwitcher";
import { COMMON_COUNTRIES, flagFor } from "@/lib/ui/countries";
import { cn } from "@/lib/ui/cn";

interface PastProjectDraft {
  title: string;
  summary: string;
  sector: string;
  valueUsd: string;
}

interface Props {
  tenants: TenantOption[];
  activeTenantId: string;
  hasExistingProfile: boolean;
  initial: Partial<CapabilityProfileInput>;
}

const EMPTY_PROJECT: PastProjectDraft = { title: "", summary: "", sector: "", valueUsd: "" };

function projectsFromInput(input?: CapabilityProfileInput["pastProjects"]): PastProjectDraft[] {
  if (!input || input.length === 0) return [];
  return input.map((p) => ({
    title: p.title,
    summary: p.summary,
    sector: p.sector ?? "",
    valueUsd: p.valueUsd != null ? String(p.valueUsd) : "",
  }));
}

/**
 * Unified profile editor.
 *
 * Replaces the old onboard form. Loaded from the server with the active
 * tenant's saved profile already pre-filled — closing and reopening the
 * app no longer wipes anything. The switcher at the top swaps which
 * tenant's profile we're editing; switching reloads the page (router.refresh).
 *
 * "Import from document" hydrates these same useState fields from the LLM
 * parse, so the user sees a populated form to review before saving.
 */
export function ProfileEditor({ tenants, activeTenantId, hasExistingProfile, initial }: Props) {
  const router = useRouter();

  const [companyName, setCompanyName] = useState(initial.companyName ?? "");
  const [oneLiner, setOneLiner] = useState(initial.oneLiner ?? "");
  const [industries, setIndustries] = useState<string[]>(initial.industries ?? []);
  const [services, setServices] = useState<string[]>(initial.services ?? []);
  const [techStack, setTechStack] = useState<string[]>(initial.techStack ?? []);
  const [certifications, setCertifications] = useState<string[]>(initial.certifications ?? []);
  const [pastClients, setPastClients] = useState<string[]>(initial.pastClients ?? []);
  const [geographies, setGeographies] = useState<string[]>(initial.geographies ?? []);
  const [teamSize, setTeamSize] = useState<string>(
    initial.teamSize != null ? String(initial.teamSize) : "",
  );
  const [budgetMin, setBudgetMin] = useState<string>(
    initial.budgetRangeUsd?.min != null ? String(initial.budgetRangeUsd.min) : "",
  );
  const [budgetMax, setBudgetMax] = useState<string>(
    initial.budgetRangeUsd?.max != null ? String(initial.budgetRangeUsd.max) : "",
  );
  const [languages, setLanguages] = useState<string[]>(
    initial.languages && initial.languages.length > 0 ? initial.languages : ["en"],
  );
  const [pastProjects, setPastProjects] = useState<PastProjectDraft[]>(
    projectsFromInput(initial.pastProjects),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const oneLinerRemaining = 280 - oneLiner.length;

  const payload: CapabilityProfileInput | null = useMemo(() => {
    const candidate = {
      companyName,
      oneLiner,
      industries,
      services,
      techStack,
      certifications,
      pastClients,
      geographies,
      teamSize: Number(teamSize) || 0,
      budgetRangeUsd: { min: Number(budgetMin) || 0, max: Number(budgetMax) || 0 },
      languages,
      pastProjects: pastProjects
        .filter((p) => p.title.trim() && p.summary.trim())
        .map((p) => ({
          title: p.title.trim(),
          summary: p.summary.trim(),
          sector: p.sector.trim() || undefined,
          valueUsd: p.valueUsd ? Number(p.valueUsd) : undefined,
        })),
    };
    const parsed = CapabilityProfileSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }, [
    companyName,
    oneLiner,
    industries,
    services,
    techStack,
    certifications,
    pastClients,
    geographies,
    teamSize,
    budgetMin,
    budgetMax,
    languages,
    pastProjects,
  ]);

  function toggleGeography(code: string) {
    setGeographies((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  /** Hydrates every field from a parsed-from-document draft. */
  function applyImportedProfile(p: CapabilityProfileInput) {
    setCompanyName(p.companyName);
    setOneLiner(p.oneLiner);
    setIndustries(p.industries);
    setServices(p.services);
    setTechStack(p.techStack);
    setCertifications(p.certifications);
    setPastClients(p.pastClients);
    setGeographies(p.geographies);
    setTeamSize(String(p.teamSize ?? 0));
    setBudgetMin(String(p.budgetRangeUsd?.min ?? 0));
    setBudgetMax(String(p.budgetRangeUsd?.max ?? 0));
    setLanguages(p.languages.length ? p.languages : ["en"]);
    setPastProjects(projectsFromInput(p.pastProjects));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!payload) {
      setError("Please complete all required fields (company, one-liner, team size, budget range).");
      return;
    }
    setSubmitting(true);
    try {
      // For an already-saved profile, PUT updates in place. For a brand-new
      // tenant created via the switcher's "+ New profile" we still PUT —
      // /api/v1/profile upserts on tenantId.
      const res = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      setSavedAt(Date.now());
      // Refresh so the switcher's "hasProfile" status is fresh.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Capability profile</h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            {hasExistingProfile
              ? "Editing the saved profile for the active company. Changes re-embed automatically on save."
              : "This company has no profile yet — fill it in and save. Or import from a document below."}
          </p>
        </div>
        <ProfileSwitcher tenants={tenants} activeTenantId={activeTenantId} />
      </header>

      <DocumentImport onParsed={applyImportedProfile} />

      <Card>
        <CardHeader>
          <CardTitle>Company basics</CardTitle>
          <CardDescription>The 30-second pitch.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Company name" htmlFor="companyName">
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Software Pvt Ltd"
            />
          </Field>
          <Field
            label="One-liner"
            htmlFor="oneLiner"
            hint={`${oneLinerRemaining} characters remaining`}
          >
            <Textarea
              id="oneLiner"
              value={oneLiner}
              onChange={(e) => setOneLiner(e.target.value.slice(0, 280))}
              maxLength={280}
              rows={3}
              placeholder="Custom software development for regulated industries — banking, health, gov."
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>
            Press Enter or comma to add a chip. Backspace on empty input deletes the last one.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Industries" hint="Sectors you serve.">
            <TagInput value={industries} onChange={setIndustries} placeholder="banking, healthcare…" />
          </Field>
          <Field label="Services" hint="What you sell.">
            <TagInput value={services} onChange={setServices} placeholder="custom software dev, cloud migration…" />
          </Field>
          <Field label="Tech stack">
            <TagInput value={techStack} onChange={setTechStack} placeholder="Node.js, AWS, Postgres…" />
          </Field>
          <Field label="Certifications">
            <TagInput value={certifications} onChange={setCertifications} placeholder="ISO 27001, SOC2…" />
          </Field>
          <Field label="Past clients" hint="Optional — used for matching context only.">
            <TagInput value={pastClients} onChange={setPastClients} placeholder="World Bank, Acme Corp…" />
          </Field>
          <Field label="Languages" hint="ISO 639-1 codes.">
            <TagInput value={languages} onChange={setLanguages} placeholder="en, fr…" maxLength={5} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Geographies</CardTitle>
          <CardDescription>Where you can deliver. Leave empty for global.</CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {COMMON_COUNTRIES.map((c) => {
              const active = geographies.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleGeography(c.code)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                      : "border-zinc-200 bg-white text-ink-soft hover:bg-zinc-50",
                  )}
                >
                  <span aria-hidden>{flagFor(c.code)}</span>
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scale & budget</CardTitle>
          <CardDescription>USD bands you typically operate in.</CardDescription>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Team size">
            <Input
              type="number"
              min={0}
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              placeholder="35"
            />
          </Field>
          <Field label="Budget min (USD)">
            <Input
              type="number"
              min={0}
              value={budgetMin}
              onChange={(e) => setBudgetMin(e.target.value)}
              placeholder="50000"
            />
          </Field>
          <Field label="Budget max (USD)">
            <Input
              type="number"
              min={0}
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              placeholder="500000"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past projects</CardTitle>
          <CardDescription>
            A few representative wins — used as evidence in the win-probability heuristic.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <RepeatableSection<PastProjectDraft>
            items={pastProjects}
            onChange={setPastProjects}
            newItem={() => ({ ...EMPTY_PROJECT })}
            addLabel="Add a project"
            emptyHint="No past projects yet — add at least one for better matching."
            renderItem={(item, update) => (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Title">
                  <Input
                    value={item.title}
                    onChange={(e) => update({ title: e.target.value })}
                    placeholder="Core banking modernization"
                  />
                </Field>
                <Field label="Sector">
                  <Input
                    value={item.sector}
                    onChange={(e) => update({ sector: e.target.value })}
                    placeholder="Banking"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Summary">
                    <Textarea
                      value={item.summary}
                      onChange={(e) => update({ summary: e.target.value })}
                      rows={2}
                      placeholder="What you built, the team size, the outcome."
                    />
                  </Field>
                </div>
                <Field label="Value (USD)">
                  <Input
                    type="number"
                    min={0}
                    value={item.valueUsd}
                    onChange={(e) => update({ valueUsd: e.target.value })}
                    placeholder="250000"
                  />
                </Field>
              </div>
            )}
          />
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Saved. The match worker will re-embed on its next tick.
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-6">
        <p className="text-xs text-zinc-500">
          {payload ? "Profile is valid and ready to save." : "Fill required fields to enable Save."}
        </p>
        <Button type="submit" size="lg" disabled={!payload || submitting}>
          {submitting ? "Saving…" : hasExistingProfile ? "Save changes" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
