import type { DigestPayload } from "@beta/shared";

export interface SendResult {
  delivered: boolean;
  mode: "resend" | "stub";
  messageId?: string;
}

function recipientFor(payload: DigestPayload): string | null {
  return process.env.DIGEST_TEST_RECIPIENT ?? null;
}

export async function sendDigest(
  payload: DigestPayload,
  html: string,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM_EMAIL ?? "Project Beta <digest@projectbeta.dev>";
  const to = recipientFor(payload);
  const subject = `${payload.matches.length} new match${payload.matches.length === 1 ? "" : "es"} for ${payload.companyName}`;

  if (!apiKey || !to) {
    console.log(
      `[notifications] stub send to=${to ?? "(no recipient)"} subject="${subject}" tenant=${payload.tenantId}`,
    );
    console.log(html);
    return { delivered: false, mode: "stub" };
  }

  // TODO(lead): persist per-user recipient addresses on Tenant/User and resolve here.
  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  const result = await client.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (result.error) {
    console.error(
      `[notifications] resend error tenant=${payload.tenantId}:`,
      result.error,
    );
    return { delivered: false, mode: "resend" };
  }

  return {
    delivered: true,
    mode: "resend",
    messageId: result.data?.id,
  };
}
