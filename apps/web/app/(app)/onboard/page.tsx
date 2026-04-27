"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CapabilityProfileSchema, type CapabilityProfileInput } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input, Field } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { TagInput } from "@/components/forms/TagInput";
import { RepeatableSection } from "@/components/forms/RepeatableSection";
import { COMMON_COUNTRIES, flagFor } from "@/lib/ui/countries";
import { cn } from "@/lib/ui/cn";

interface PastProjectDraft {
  title: string;
  summary: string;
  sector: string;
  valueUsd: string;
}

const EMPTY_PROJECT: PastProjectDraft = {
  title: "",
  summary: "",
  sector: "",
  valueUsd: "",
};

export default function OnboardPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [techStack, setTechStack] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [pastClients, setPastClients] = useState<string[]>([]);
  const [geographies, setGeographies] = useState<string[]>([]);
  const [teamSize, setTeamSize] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [pastProjects, setPastProjects] = useState<PastProjectDraft[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      budgetRangeUsd: {
        min: Number(budgetMin) || 0,
        max: Number(budgetMax) || 0,
      },
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!payload) {
      setError("Please complete all required fields before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/tenants/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Capability profile</h1>
        <p className="max-w-2xl text-sm text-zinc-600">
          Describe what your company does, where, and at what scale. The matcher uses this to score tenders and surface gaps. You can edit it later.
        </p>
      </header>

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
            <TagInput
              value={languages}
              onChange={setLanguages}
              placeholder="en, fr…"
              maxLength={5}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Geographies</CardTitle>
          <CardDescription>
            Where you can deliver. Leave empty for global.
          </CardDescription>
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

      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-6">
        <p className="text-xs text-zinc-500">
          {payload
            ? "Profile is valid and ready to submit."
            : "Fill required fields (company, one-liner, team size, budget range)."}
        </p>
        <Button type="submit" size="lg" disabled={!payload || submitting}>
          {submitting ? "Saving…" : "Save profile and continue"}
        </Button>
      </div>
    </form>
  );
}
