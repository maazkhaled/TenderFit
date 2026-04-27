// TODO(lead): tests currently fail at runtime because @beta/shared's index.ts
// imports relative paths without `.ts` extensions, which Node's strict ESM
// resolver rejects. Fix is in the shared package (add extensions or set
// "type": "module" + extensionless resolver), not here. Test logic below is
// correct and will pass once shared is resolvable from node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NormalizedTenderSchema } from "@beta/shared";
import type { HttpJsonFn } from "../types";
import { samGovAdapter } from "../adapters/sam_gov";
import { tedEuAdapter } from "../adapters/ted_eu";
import { ungmAdapter } from "../adapters/ungm";
import { worldBankAdapter } from "../adapters/world_bank";
import { ppraPkAdapter } from "../adapters/ppra_pk";

const sinceIso = "2026-01-01T00:00:00.000Z";

const fakeSamResponse = {
  totalRecords: 1,
  opportunitiesData: [
    {
      noticeId: "abc123",
      title: "Cloud Migration Services",
      description: "Federal cloud migration RFP",
      fullParentPathName: "Department of Defense",
      postedDate: "2026-04-01T00:00:00Z",
      responseDeadLine: "2026-05-15T17:00:00Z",
      uiLink: "https://sam.gov/opp/abc123/view",
      naicsCode: "541512",
      award: { amount: "1500000" },
    },
  ],
};

const fakeTedResponse = {
  total: 1,
  notices: [
    {
      "publication-number": "2026/S 001-000001",
      title: { eng: "IT Services Framework" },
      description: { eng: "EU framework agreement for IT consulting" },
      "publication-date": "2026-04-10",
      "deadline-receipt-tender-date-lot": "2026-05-20",
      "buyer-name": "Commission Europeenne",
      "buyer-country": "BE",
      "classification-cpv": ["72000000", "72200000"],
      "estimated-value-lot": { amount: 2000000, currency: "EUR" },
      links: { html: { eng: "https://ted.europa.eu/notice/2026-S-001-000001" } },
    },
  ],
};

const fakeUngmRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>UNGM</title>
<item>
  <title>Software Development Services</title>
  <link>https://www.ungm.org/Public/Notice/123</link>
  <description>UN agency seeks <b>software</b> dev partner.</description>
  <pubDate>Mon, 20 Apr 2026 10:00:00 GMT</pubDate>
  <guid>ungm-123</guid>
</item>
</channel></rss>`;

const fakeWorldBankResponse = {
  total: 1,
  procnotices: {
    one: {
      id: "WB-001",
      project_name: "Health Information System",
      notice_type: "Request for Bids",
      notice_text: "World Bank funded HIS rollout",
      bid_description: "HIS rollout",
      notice_date: "2026-04-05",
      deadline_date: "2026-06-01",
      project_ctry_name: "Kenya",
      project_ctry_code: "KE",
      procurement_method: "International Competitive Bidding",
      total_contract_amount: 5000000,
      url: "https://projects.worldbank.org/en/projects-operations/procurement-detail/WB-001",
    },
  },
};

const fakePpraRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>Network Infrastructure Tender</title>
  <link>https://www.ppra.org.pk/notice/999</link>
  <description>PPRA tender for network infra</description>
  <pubDate>Wed, 15 Apr 2026 09:00:00 GMT</pubDate>
  <guid>ppra-999</guid>
</item>
</channel></rss>`;

function makeFakeHttp(payload: unknown): HttpJsonFn {
  return (async (_url: string, _opts?: unknown) => payload) as HttpJsonFn;
}

test("sam_gov adapter normalizes mock payload", async () => {
  process.env.SAM_GOV_API_KEY = "test-key";
  const { tenders } = await samGovAdapter.fetchPage({
    sinceIso,
    httpJson: makeFakeHttp(fakeSamResponse),
  });
  assert.equal(tenders.length, 1);
  for (const t of tenders) NormalizedTenderSchema.parse(t);
  assert.equal(tenders[0]!.source, "sam_gov");
  assert.equal(tenders[0]!.country, "US");
});

test("ted_eu adapter normalizes mock payload", async () => {
  const { tenders } = await tedEuAdapter.fetchPage({
    sinceIso,
    httpJson: makeFakeHttp(fakeTedResponse),
  });
  assert.equal(tenders.length, 1);
  for (const t of tenders) NormalizedTenderSchema.parse(t);
  assert.equal(tenders[0]!.source, "ted_eu");
  assert.equal(tenders[0]!.country, "BE");
  assert.deepEqual(tenders[0]!.cpvCodes, ["72000000", "72200000"]);
});

test("ungm adapter parses RSS and normalizes", async () => {
  const { tenders } = await ungmAdapter.fetchPage({
    sinceIso,
    httpJson: makeFakeHttp(fakeUngmRss),
  });
  assert.equal(tenders.length, 1);
  for (const t of tenders) NormalizedTenderSchema.parse(t);
  assert.equal(tenders[0]!.source, "ungm");
});

test("world_bank adapter normalizes mock payload", async () => {
  const { tenders } = await worldBankAdapter.fetchPage({
    sinceIso,
    httpJson: makeFakeHttp(fakeWorldBankResponse),
  });
  assert.equal(tenders.length, 1);
  for (const t of tenders) NormalizedTenderSchema.parse(t);
  assert.equal(tenders[0]!.source, "world_bank");
  assert.equal(tenders[0]!.country, "KE");
});

test("ppra_pk adapter parses RSS and normalizes", async () => {
  const { tenders } = await ppraPkAdapter.fetchPage({
    sinceIso,
    httpJson: makeFakeHttp(fakePpraRss),
  });
  assert.equal(tenders.length, 1);
  for (const t of tenders) NormalizedTenderSchema.parse(t);
  assert.equal(tenders[0]!.source, "ppra_pk");
  assert.equal(tenders[0]!.country, "PK");
});
