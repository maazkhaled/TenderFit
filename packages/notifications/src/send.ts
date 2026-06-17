import type { DigestPayload } from "@beta/shared";

export interface SendResult {
  delivered: boolean;
  mode: "resend" | "stub";
  /** Number of recipients we attempted delivery to. */
  recipients: number;
  /** Resend message IDs for each successful send. */
  messageIds: string[];
  /** Error messages for any failed sends; empty when fully successful. */
  errors: string[];
}

/**
 * Resolve the recipient list for this digest.
 *
 * Preference order:
 *   1. payload.recipients (the per-tenant array from DigestSchedule.recipients
 *      — set via the /schedule UI). Once non-empty this is the canonical list.
 *   2. DIGEST_TEST_RECIPIENT env (legacy single-recipient fallback for dev /
 *      brand-new tenants who haven't configured anything yet).
 */
function resolveRecipients(payload: DigestPayload): string[] {
  if (payload.recipients && payload.recipients.length > 0) {
    return payload.recipients;
  }
  const envFallback = process.env.DIGEST_TEST_RECIPIENT?.trim();
  return envFallback ? [envFallback] : [];
}

export async function sendDigest(
  payload: DigestPayload,
  html: string,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM_EMAIL ?? "TenderFit <digest@tenderfit.dev>";
  const recipients = resolveRecipients(payload);
  const subject = `${payload.matches.length} new match${payload.matches.length === 1 ? "" : "es"} for ${payload.companyName}`;

  if (!apiKey || recipients.length === 0) {
    console.log(
      `[notifications] stub send recipients=${recipients.length} subject="${subject}" tenant=${payload.tenantId}`,
    );
    console.log(html);
    return {
      delivered: false,
      mode: "stub",
      recipients: recipients.length,
      messageIds: [],
      errors: apiKey
        ? ["no recipients configured (DigestSchedule.recipients empty and DIGEST_TEST_RECIPIENT unset)"]
        : ["RESEND_API_KEY unset"],
    };
  }

  const { Resend } = await import("resend");
  const client = new Resend(apiKey);

  // Per-recipient sends with two guardrails:
  //   1. 600 ms throttle between sends — Resend free tier is 2 req/sec, so
  //      firing 3+ sends in rapid succession 429s the third. With this gap
  //      we stay comfortably under the rate limit.
  //   2. Single retry with 1.5 s backoff when a 429 / rate-limit error
  //      comes back. Stops one-off rate-limit hiccups from silently
  //      dropping recipients.
  const messageIds: string[] = [];
  const errors: string[] = [];
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const isRateLimit = (m: string) =>
    /429|rate.?limit|too.?many.?requests/i.test(m);

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i]!;
    if (i > 0) await sleep(600);

    const attemptSend = async (): Promise<
      { id: string } | { error: string }
    > => {
      try {
        const result = await client.emails.send({ from, to, subject, html });
        if (result.error) {
          return {
            error: `${result.error.name ?? "error"}: ${result.error.message ?? "unknown"}`,
          };
        }
        if (result.data?.id) return { id: result.data.id };
        return { error: "no id returned and no error reported" };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };

    let result = await attemptSend();
    // One retry for rate-limit / 429 — sleep a beat then try again.
    if ("error" in result && isRateLimit(result.error)) {
      console.warn(
        `[notifications] resend rate-limit on ${to}; retrying in 1500ms`,
      );
      await sleep(1500);
      result = await attemptSend();
    }

    if ("id" in result) {
      messageIds.push(result.id);
    } else {
      const msg = `${to}: ${result.error}`;
      errors.push(msg);
      console.error(
        `[notifications] resend FINAL FAIL tenant=${payload.tenantId} ${msg}`,
      );
    }
  }

  return {
    delivered: messageIds.length > 0,
    mode: "resend",
    recipients: recipients.length,
    messageIds,
    errors,
  };
}
