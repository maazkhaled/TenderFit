"use client";

import { useRef, useState } from "react";
import { FileUp, FileText, Loader2 } from "lucide-react";
import type { CapabilityProfileInput } from "@beta/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";

interface Props {
  /** Called after a successful parse — caller hydrates its form state from this. */
  onParsed: (profile: CapabilityProfileInput) => void;
}

/**
 * Import-from-document panel: paste text OR upload a .txt/.md file, then
 * POST to /api/v1/profile/parse-document. Result is handed back to the
 * parent so the form fields can be pre-filled for review.
 */
export function DocumentImport({ onParsed }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submitText() {
    setError(null);
    setInfo(null);
    if (text.trim().length < 20) {
      setError("Paste at least a paragraph (20+ chars) so the LLM has something to work with.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/profile/parse-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as { profile?: CapabilityProfileInput; error?: string; message?: string };
      if (!res.ok || !json.profile) {
        throw new Error(json.message ?? json.error ?? `Request failed: ${res.status}`);
      }
      onParsed(json.profile);
      setInfo("Profile draft loaded into the form. Review every field before saving.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(file: File) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/profile/parse-document", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { profile?: CapabilityProfileInput; error?: string; message?: string };
      if (!res.ok || !json.profile) {
        throw new Error(json.message ?? json.error ?? `Request failed: ${res.status}`);
      }
      onParsed(json.profile);
      setInfo(`"${file.name}" parsed. Review every field before saving.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "parse failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-600" /> Import from a document
        </CardTitle>
        <CardDescription>
          Paste your About page / capability deck text or upload a .txt / .md file. The LLM
          extracts a draft profile — you review and save. Nothing is invented; fields the
          text doesn't mention stay blank.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Paste a few paragraphs about the company — services, sectors, certifications, clients, team size, geographies…"
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={submitText} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
              </>
            ) : (
              "Parse pasted text"
            )}
          </Button>
          <span className="text-xs text-zinc-500">or</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) submitFile(f);
            }}
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <FileUp className="h-4 w-4" /> Upload .txt / .md
          </Button>
        </div>
        {info && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {info}
          </p>
        )}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
