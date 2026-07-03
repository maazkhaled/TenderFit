"use client";

import { useState } from "react";
import { Handshake, Loader2 } from "lucide-react";
import type { CollaborationSuggestion, WinProbability } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { WinProbBadge } from "@/components/domain/WinProbBadge";

/**
 * Amber "Consider partnering" card on the match detail page.
 *
 * Two modes:
 *   1. `initial` prop is present — render the full suggestion (was
 *      generated when the match was scored).
 *   2. `initial` is null AND fitScore < 70 — render a "Suggest JV
 *      partner" button so the user can backfill matches that were
 *      scored before the JV feature landed. Once generated, the result
 *      is persisted and shown inline without a reload.
 *
 * At fitScore >= 70 we don't render anything — the tender is a solid
 * solo bid and adding a partner suggestion would just be noise.
 */
export function CollaborationSuggestionCard({
  matchId,
  fitScore,
  initial,
}: {
  matchId: string;
  fitScore: number;
  initial: CollaborationSuggestion | null;
}) {
  const [suggestion, setSuggestion] = useState<CollaborationSuggestion | null>(
    initial,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // High-fit tenders don't get a suggestion. Match the scorer's gate so
  // the button doesn't tempt the user for a bid they should just make solo.
  if (!suggestion && fitScore >= 70) return null;

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/matches/${matchId}/rescore-collaboration`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as {
        collaborationSuggestion: CollaborationSuggestion | null;
      };
      setSuggestion(data.collaborationSuggestion);
      if (!data.collaborationSuggestion) {
        setError(
          "The model didn't produce a suggestion this run. Try again — output can vary.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed.");
    } finally {
      setPending(false);
    }
  }

  if (!suggestion) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900">
            <Handshake className="h-4 w-4" />
            Consider partnering
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-soft">
            This tender scored below the "bid solo" threshold. Generate a
            partner suggestion to see the ideal JV profile that would raise
            your win probability.
          </p>
          <Button
            size="md"
            onClick={generate}
            disabled={pending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <Handshake className="h-4 w-4" />
                Suggest JV partner
              </>
            )}
          </Button>
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-900">
          <Handshake className="h-4 w-4" />
          Consider partnering
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-amber-800">
          Could raise win prob to{" "}
          <WinProbBadge
            value={
              suggestion.newWinProbabilityIfPartnered as WinProbability
            }
          />
        </div>
        <p className="text-sm leading-relaxed text-ink-soft">
          {suggestion.partnerProfile}
        </p>
        {suggestion.mustHaveCapabilities.length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
              Must-have capabilities
            </div>
            <ul className="ml-4 list-disc space-y-1 text-sm text-ink-soft">
              {suggestion.mustHaveCapabilities.map((cap) => (
                <li key={cap}>{cap}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {suggestion.geographyHint ? (
          <div className="text-sm text-ink-soft">
            <span className="font-semibold text-amber-800">Where:</span>{" "}
            {suggestion.geographyHint}
          </div>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={generate}
          disabled={pending}
        >
          {pending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Regenerating…
            </>
          ) : (
            "Regenerate suggestion"
          )}
        </Button>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
