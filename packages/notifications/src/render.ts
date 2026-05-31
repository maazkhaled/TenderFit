import { type DigestPayload } from "@beta/shared";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDeadline(d: Date | null): string {
  if (!d) return "No deadline listed";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

function winProbBadge(value: "low" | "medium" | "high"): string {
  const colors: Record<string, { bg: string; fg: string }> = {
    low: { bg: "#fee2e2", fg: "#991b1b" },
    medium: { bg: "#fef3c7", fg: "#92400e" },
    high: { bg: "#dcfce7", fg: "#166534" },
  };
  const c = colors[value] ?? colors.medium!;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${c.bg};color:${c.fg};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;font-family:${FONT_STACK};">Win ${escapeHtml(value)}</span>`;
}

function fitScoreBadge(score: number): string {
  let bg = "#e5e7eb";
  let fg = "#111827";
  if (score >= 80) {
    bg = "#dcfce7";
    fg = "#166534";
  } else if (score >= 60) {
    bg = "#dbeafe";
    fg = "#1e40af";
  } else if (score >= 40) {
    bg = "#fef3c7";
    fg = "#92400e";
  }
  return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;background:${bg};color:${fg};font-size:12px;font-weight:700;font-family:${FONT_STACK};">Fit ${score}</span>`;
}

export function renderDigestHtml(payload: DigestPayload): string {
  const base = appUrl();
  // Min-fit threshold comes from the payload (set by buildDigestForTenant from
  // the tenant's DigestSchedule.minFitScore). We avoid hardcoding the constant
  // here so the summary line always reflects the *actual* threshold used to
  // filter the matches included in this email.
  const minScore = payload.minFitScore;
  const summary = `${payload.matches.length} new match${payload.matches.length === 1 ? "" : "es"} above your ${minScore}+ fit threshold`;

  const blocks = payload.matches
    .map((m) => {
      const matchUrl = `${base}/matches/${m.matchId}`;
      const rationale = m.rationale
        .map((r) => `<li style="margin:0 0 4px 0;">${escapeHtml(r)}</li>`)
        .join("");
      return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;">
  <tr>
    <td style="padding:16px 18px;font-family:${FONT_STACK};color:#111827;">
      <div style="font-size:16px;font-weight:700;line-height:1.3;margin:0 0 4px 0;">
        ${escapeHtml(m.tenderTitle)}
      </div>
      <div style="font-size:13px;color:#4b5563;margin:0 0 10px 0;">
        ${escapeHtml(m.buyer)} &middot; Deadline: ${escapeHtml(formatDeadline(m.deadlineAt))}
      </div>
      <div style="margin:0 0 12px 0;">
        ${fitScoreBadge(m.fitScore)} &nbsp; ${winProbBadge(m.winProbability)}
      </div>
      <ul style="font-size:13px;color:#1f2937;line-height:1.5;margin:0 0 14px 18px;padding:0;">
        ${rationale}
      </ul>
      <a href="${escapeHtml(matchUrl)}" style="display:inline-block;padding:8px 14px;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:6px;font-family:${FONT_STACK};">View match</a>
    </td>
  </tr>
</table>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>TenderFit Digest</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT_STACK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#f3f4f6;">
          <tr>
            <td style="padding:0 4px 16px 4px;font-family:${FONT_STACK};">
              <div style="font-size:18px;font-weight:700;color:#111827;margin:0 0 4px 0;">
                Hello ${escapeHtml(payload.companyName)},
              </div>
              <div style="font-size:14px;color:#374151;margin:0;">
                ${escapeHtml(summary)}.
              </div>
            </td>
          </tr>
          <tr>
            <td>
              ${blocks}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 4px 0 4px;font-family:${FONT_STACK};font-size:12px;color:#6b7280;line-height:1.5;">
              You're receiving this because you enabled scheduled digests for ${escapeHtml(payload.companyName)}.
              <br />
              <a href="${escapeHtml(`${base}/schedule`)}" style="color:#2563eb;text-decoration:underline;">Change frequency or unsubscribe</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
