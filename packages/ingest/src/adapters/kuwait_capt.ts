import { simpleHtmlAdapter, parseLooseDate, clean } from "./simple_html.ts";
import { stripTags } from "../util/html-scrape.ts";

const URL = "https://capt.gov.kw/en/tenders/opening-tenders/";

export const kuwaitCaptAdapter = simpleHtmlAdapter({
  source: "kuwait_capt",
  label: "Kuwait CAPT",
  listingUrl: URL,
  buyer: "Kuwait Central Agency for Public Tenders",
  country: "KW",
  extractor(html) {
    const blocks = html.split(/TENDER INFO/i).slice(1);
    return blocks
      .map((block) => {
        const text = clean(stripTags(block));
        const tenderNo = /Tender no\.\s+(.+?)\s+Organisation/i.exec(text)?.[1]?.trim();
        const org = /Organisation\s+(.+?)\s+Tender Subject/i.exec(text)?.[1]?.trim();
        const subject = /Tender Subject\s+(.+?)\s+Request date/i.exec(text)?.[1]?.trim();
        const requestDate = /Request date\s+(.+?)\s+Last date/i.exec(text)?.[1]?.trim();
        const lastDate = /Last date\s+(.+?)\s+Initial meeting date/i.exec(text)?.[1]?.trim();
        if (!subject || !tenderNo) return null;
        return {
          externalId: tenderNo,
          title: subject,
          description: [subject, org, tenderNo, requestDate, lastDate].filter(Boolean).join("\n"),
          url: URL,
          buyer: org ?? "Kuwait Central Agency for Public Tenders",
          country: "KW",
          sector: "Public Tender",
          publishedAt: parseLooseDate(requestDate ?? ""),
          deadlineAt: parseLooseDate(lastDate ?? ""),
          currency: "KWD",
          raw: { tenderNo, org, subject, requestDate, lastDate },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  },
});
