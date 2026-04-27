"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ThumbsDown, ThumbsUp, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui/cn";

export function MatchActions({
  matchId,
  initialStatement,
}: {
  matchId: string;
  initialStatement: string | null;
}) {
  const [statement, setStatement] = useState<string | null>(initialStatement);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<"interested" | "not_interested" | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/matches/${matchId}/capability-statement`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { capabilityStatement?: string };
      if (!data.capabilityStatement) throw new Error("Empty response.");
      setStatement(data.capabilityStatement);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function sendFeedback(interested: boolean) {
    setFeedbackPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/matches/${matchId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interested }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setFeedback(interested ? "interested" : "not_interested");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback failed.");
    } finally {
      setFeedbackPending(false);
    }
  }

  return (
    <>
      {statement && (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" />
            <h2 className="text-base font-semibold tracking-tight">
              Capability statement draft
            </h2>
          </div>
          <article className="prose prose-zinc max-w-none prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-lg prose-p:text-sm prose-li:text-sm">
            <ReactMarkdown>{statement}</ReactMarkdown>
          </article>
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-12 -mx-6 border-t border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant={feedback === "interested" ? "primary" : "secondary"}
              size="md"
              disabled={feedbackPending}
              onClick={() => sendFeedback(true)}
              className={cn(
                feedback === "interested" && "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              <ThumbsUp className="h-4 w-4" />
              Interested
            </Button>
            <Button
              variant={feedback === "not_interested" ? "primary" : "secondary"}
              size="md"
              disabled={feedbackPending}
              onClick={() => sendFeedback(false)}
              className={cn(
                feedback === "not_interested" && "bg-zinc-700 hover:bg-zinc-800",
              )}
            >
              <ThumbsDown className="h-4 w-4" />
              Not interested
            </Button>
          </div>
          <Button size="md" onClick={generate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                {statement ? "Regenerate capability statement" : "Generate capability statement"}
              </>
            )}
          </Button>
        </div>
        {error && (
          <p className="mx-auto mt-2 max-w-6xl text-xs text-red-600">{error}</p>
        )}
      </div>
    </>
  );
}
