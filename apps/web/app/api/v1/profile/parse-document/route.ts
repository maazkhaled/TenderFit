import { NextResponse } from "next/server";
import { z } from "zod";
import { parseProfileFromText } from "@beta/llm";
import { apiHandler } from "@/lib/api";

/**
 * POST /api/v1/profile/parse-document
 *
 * Two body shapes are accepted:
 *   1. JSON: { "text": "...", "companyNameHint": "..." } — preferred from the paste-box UI.
 *   2. multipart/form-data with a "file" field (.txt / .md) — upload variant.
 *
 * Returns a CapabilityProfile draft that the UI loads into the form for
 * review. We never auto-save; the user must hit Save.
 */

const JsonBodySchema = z.object({
  text: z.string().min(20, "Text too short to extract a profile from."),
  companyNameHint: z.string().optional(),
});

const MAX_INPUT_BYTES = 200_000; // 200 KB cap on uploads

export const POST = apiHandler(async (req) => {
  const contentType = req.headers.get("content-type") ?? "";

  let text = "";
  let companyNameHint: string | undefined;

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "no_file", message: "Form-data body must include a 'file' field." },
        { status: 400 },
      );
    }
    if (file.size > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", message: `Max upload size is ${MAX_INPUT_BYTES} bytes.` },
        { status: 413 },
      );
    }
    text = await file.text();
    companyNameHint = file.name?.replace(/\.[^.]+$/, "") || undefined;
    const hintFromForm = form.get("companyNameHint");
    if (typeof hintFromForm === "string" && hintFromForm.trim()) {
      companyNameHint = hintFromForm.trim();
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const parsed = JsonBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    text = parsed.data.text;
    companyNameHint = parsed.data.companyNameHint;
  }

  try {
    const profile = await parseProfileFromText(text, { companyNameHint });
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse failed";
    return NextResponse.json(
      { error: "parse_failed", message },
      { status: 422 },
    );
  }
});
