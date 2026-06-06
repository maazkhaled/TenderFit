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

  // Send one email per recipient so a single bad address doesn't bounce the
  // whole batch. Resend's API accepts a `to` array too, but per-recipient
  // sends give us clean per-address error reporting and avoid "one bad
  // address breaks the whole send" semantics.
  const messageIds: string[] = [];
  const errors: string[] = [];
  for (const to of recipients) {
    try {
      const result = await client.emails.send({ from, to, subject, html });
      if (result.error) {
        const msg = `${to}: ${result.error.name ?? "error"} — ${result.error.message ?? "unknown"}`;
        errors.push(msg);
        console.error(`[notifications] resend error tenant=${payload.tenantId} ${msg}`);
      } else if (result.data?.id) {
        messageIds.push(result.data.id);
      }
    } catch (err) {
      const msg = `${to}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[notifications] resend throw tenant=${payload.tenantId} ${msg}`);
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
