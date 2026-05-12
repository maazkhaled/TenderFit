import { simpleHtmlAdapter, extractTableRows, cellText, firstLink, parseLooseDate } from "./simple_html.ts";

const URL = "https://www.sop.gov.pk/Tenders";

export const sopPkAdapter = simpleHtmlAdapter({
  source: "sop_pk",
  label: "Survey of Pakistan",
  listingUrl: URL,
  buyer: "Survey of Pakistan",
  country: "PK",
  extractor(html) {
    return extractTableRows(html)
      .map((cells) => {
        const title = cellText(cells[1] ?? "");
        if (!title || /^title$/i.test(title)) return null;
        const startText = cellText(cells[2] ?? "");
        const endText = cellText(cells[3] ?? "");
        return {
          title,
          description: [title, startText, endText].filter(Boolean).join("\n"),
          url: firstLink(cells[4] ?? "", URL) ?? URL,
          buyer: "Survey of Pakistan",
          country: "PK",
          sector: "Planning / Data",
          publishedAt: parseLooseDate(startText),
          deadlineAt: parseLooseDate(endText),
          raw: { title, startText, endText },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
