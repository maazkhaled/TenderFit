import { simpleHtmlAdapter, extractTableRows, cellText, firstLink, parseLooseDate } from "./simple_html.ts";

const URL = "https://www.pda.gov.pk/procurement.php";

// pda.gov.pk renders the procurement listing fine but its server omits the
// TLS intermediate cert, so Node fetch fails strict-chain validation. We
// allow-list this single host via simpleHtmlAdapter's insecureTls escape
// hatch — the listing page is purely public tender notices.
export const pdaPkAdapter = simpleHtmlAdapter({
  source: "pda_pk",
  label: "Pakistan Digital Authority",
  listingUrl: URL,
  buyer: "Pakistan Digital Authority",
  country: "PK",
  insecureTls: true,
  extractor(html) {
    return extractTableRows(html)
      .map((cells) => {
        const ref = cellText(cells[0] ?? "");
        const title = cellText(cells[1] ?? "");
        if (!ref || !title || /tender description/i.test(title)) return null;
        const deadlineText = cellText(cells[2] ?? "");
        const status = cellText(cells[3] ?? "");
        if (status && !/open|active/i.test(status)) return null;
        return {
          externalId: ref,
          title,
          description: [title, ref, deadlineText, status].filter(Boolean).join("\n"),
          url: firstLink(cells[4] ?? cells[5] ?? "", URL) ?? URL,
          buyer: "Pakistan Digital Authority",
          country: "PK",
          sector: "IT / Digital",
          publishedAt: new Date(),
          deadlineAt: parseLooseDate(deadlineText),
          raw: { ref, title, deadlineText, status },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
