import { clean, firstLink, parseLooseDate, simpleHtmlAdapter } from "./simple_html.ts";
import { stripTags } from "../util/html-scrape.ts";

const URL = "https://pc.gov.pk/web/tender";

// pc.gov.pk renders tender entries inside a <table>: each <tr> has an image+download
// cell, an empty spacer cell, and a description cell whose <h4 class="classic-title1">
// holds the title followed by a "<p>YYYY-MM-DD | Status: Open</p>" line. We scope the
// extractor to those table rows so footer headings ("Planning Commission", "Resources")
// don't leak through as fake tenders.
export const planningCommissionPkAdapter = simpleHtmlAdapter({
  source: "planning_commission_pk",
  label: "Planning Commission",
  listingUrl: URL,
  buyer: "Ministry of Planning, Development & Special Initiatives",
  country: "PK",
  extractor(html) {
    const rows: string[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) rows.push(m[1] ?? "");

    return rows
      .map((row) => {
        const titleMatch = /<h4[^>]*class=["'][^"']*classic-title1[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i.exec(row);
        if (!titleMatch) return null;
        const title = clean(stripTags(titleMatch[1] ?? ""));
        if (!title) return null;

        const text = clean(stripTags(row));
        const dateText = /(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/.exec(text)?.[1] ?? "";
        const status = /Status:\s*(Open|Closed|Archive)/i.exec(text)?.[1] ?? "";
        if (status && !/open/i.test(status)) return null;

        const url = firstLink(row, URL) ?? URL;
        return {
          title,
          description: [title, dateText, status].filter(Boolean).join("\n"),
          url,
          buyer: "Ministry of Planning, Development & Special Initiatives",
          country: "PK",
          sector: "Planning / Data",
          publishedAt: parseLooseDate(dateText),
          raw: { title, dateText, status, url },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
