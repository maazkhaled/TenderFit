import { simpleHtmlAdapter, firstLink, parseLooseDate, clean } from "./simple_html.ts";
import { stripTags } from "../util/html-scrape.ts";

const URL = "https://urbanunit.gov.pk/procurement";

export const urbanUnitPkAdapter = simpleHtmlAdapter({
  source: "urban_unit_pk",
  label: "The Urban Unit",
  listingUrl: URL,
  buyer: "The Urban Unit",
  country: "PK",
  extractor(html) {
    const chunks = html.split(/<h5[^>]*>|<h4[^>]*>|#####/i).slice(1);
    return chunks
      .map((chunk) => {
        const title = clean(stripTags(chunk.split(/<\/h5>|<\/h4>|\n/i)[0] ?? ""));
        if (!title || /annual procurement plan/i.test(title)) return null;
        const deadlineMatch = /Submission\s+Deadline\s*:?\s*([\s\S]*?)(?:Opening\s+Time|View\s+Document|<\/)/i.exec(chunk);
        const openingMatch = /Opening\s+Time\s*:?\s*([\s\S]*?)(?:View\s+Document|<\/)/i.exec(chunk);
        const url = firstLink(chunk, URL) ?? URL;
        return {
          title,
          description: [title, clean(stripTags(deadlineMatch?.[1] ?? "")), clean(stripTags(openingMatch?.[1] ?? ""))]
            .filter(Boolean)
            .join("\n"),
          url,
          buyer: "The Urban Unit",
          country: "PK",
          sector: "Planning / Data",
          deadlineAt: parseLooseDate(stripTags(deadlineMatch?.[1] ?? "")),
          raw: { title, chunk: stripTags(chunk).slice(0, 1000) },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
