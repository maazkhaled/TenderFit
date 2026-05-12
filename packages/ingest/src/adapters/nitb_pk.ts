import {
  cellText,
  extractTableRows,
  firstLink,
  parseLooseDate,
  simpleHtmlAdapter,
} from "./simple_html.ts";

const URL = "https://nitb.gov.pk/tender.html";

export const nitbPkAdapter = simpleHtmlAdapter({
  source: "nitb_pk",
  label: "National Information Technology Board",
  listingUrl: URL,
  buyer: "National Information Technology Board",
  country: "PK",
  extractor(html) {
    return extractTableRows(html)
      .map((cells) => {
        const title = cellText(cells[1] ?? "");
        if (!title || /^tender title$/i.test(title)) return null;
        const publishedText = cellText(cells[2] ?? "");
        const status = cellText(cells[3] ?? "");
        if (status && !/active/i.test(status)) return null;
        const url = firstLink(cells[4] ?? cells[5] ?? "", URL) ?? URL;
        return {
          title,
          description: [title, publishedText, status].filter(Boolean).join("\n"),
          url,
          buyer: "National Information Technology Board",
          country: "PK",
          sector: "IT / Digital",
          publishedAt: parseLooseDate(publishedText),
          raw: { title, publishedText, status, url },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
