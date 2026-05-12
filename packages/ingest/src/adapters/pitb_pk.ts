import { simpleHtmlAdapter, extractTableRows, cellText, firstLink, parseLooseDate } from "./simple_html.ts";

const URL = "https://pitb.gov.pk/tendernotices";

export const pitbPkAdapter = simpleHtmlAdapter({
  source: "pitb_pk",
  label: "Punjab Information Technology Board",
  listingUrl: URL,
  buyer: "Punjab Information Technology Board",
  country: "PK",
  extractor(html) {
    return extractTableRows(html)
      .map((cells) => {
        const title = cellText(cells[0] ?? "");
        if (!title || /^title$/i.test(title)) return null;
        const publishedText = cellText(cells[2] ?? "");
        const deadlineText = cellText(cells[3] ?? "");
        const fileUrl = firstLink(cells[1] ?? "", URL) ?? URL;
        return {
          title,
          description: [title, publishedText, deadlineText].filter(Boolean).join("\n"),
          url: fileUrl,
          buyer: "Punjab Information Technology Board",
          country: "PK",
          sector: "IT / Digital",
          publishedAt: parseLooseDate(publishedText),
          deadlineAt: parseLooseDate(deadlineText),
          raw: { title, publishedText, deadlineText, fileUrl },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
