import { simpleHtmlAdapter, extractTableRows, cellText, firstLink, parseLooseDate } from "./simple_html.ts";

const URL = "https://ignite.org.pk/rfps/";

export const ignitePkAdapter = simpleHtmlAdapter({
  source: "ignite_pk",
  label: "Ignite National Technology Fund",
  listingUrl: URL,
  buyer: "Ignite National Technology Fund",
  country: "PK",
  extractor(html) {
    return extractTableRows(html)
      .map((cells) => {
        const title = cellText(cells[0] ?? "");
        if (!title || /rfp detail/i.test(title)) return null;
        const publishedText = cellText(cells[1] ?? "");
        const deadlineText = cellText(cells[2] ?? "");
        return {
          title,
          description: [title, publishedText, deadlineText].filter(Boolean).join("\n"),
          url: firstLink(cells[3] ?? cells[4] ?? "", URL) ?? URL,
          buyer: "Ignite National Technology Fund",
          country: "PK",
          sector: "IT / Digital",
          publishedAt: parseLooseDate(publishedText),
          deadlineAt: parseLooseDate(deadlineText),
          raw: { title, publishedText, deadlineText },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
