import type { TenderSourceId } from "@beta/shared";
import type { IngestAdapter } from "./types.ts";
import { samGovAdapter } from "./adapters/sam_gov.ts";
import { tedEuAdapter } from "./adapters/ted_eu.ts";
import { ungmAdapter } from "./adapters/ungm.ts";
import { worldBankAdapter } from "./adapters/world_bank.ts";
import { ppraPkAdapter } from "./adapters/ppra_pk.ts";
import { ukFindATenderAdapter } from "./adapters/uk_find_a_tender.ts";
import { ukContractsFinderAdapter } from "./adapters/uk_contracts_finder.ts";
import { disabledAdapter } from "./adapters/disabled.ts";
import { nitbPkAdapter } from "./adapters/nitb_pk.ts";
import { pitbPkAdapter } from "./adapters/pitb_pk.ts";
import { planningCommissionPkAdapter } from "./adapters/planning_commission_pk.ts";
import { urbanUnitPkAdapter } from "./adapters/urban_unit_pk.ts";
import { ignitePkAdapter } from "./adapters/ignite_pk.ts";
import { undpAdapter } from "./adapters/undp.ts";
import { pdaPkAdapter } from "./adapters/pda_pk.ts";
import { sopPkAdapter } from "./adapters/sop_pk.ts";

export const adapters: Record<TenderSourceId, IngestAdapter> = {
  world_bank: worldBankAdapter,
  uk_find_a_tender: ukFindATenderAdapter,
  uk_contracts_finder: ukContractsFinderAdapter,
  ppra_pk: ppraPkAdapter,        // re-enabled via polite EPMS scrape
  eprocure_pk: disabledAdapter(
    "eprocure_pk",
    "Pakistan e-Procurement",
    "Public tender listings are handled by EPMS/PPRA; no separate stable public API/RSS found.",
  ),
  ppra_punjab: disabledAdapter(
    "ppra_punjab",
    "Punjab PPRA",
    "Public active-tender listing at eproc.punjab.gov.pk/ActiveTenders.aspx exists but is an ASP.NET WebForms SPA — initial HTML is empty, rows are populated via ViewState POSTs. A dedicated adapter that mimics the form post (reading __VIEWSTATE / __EVENTVALIDATION and paging via __doPostBack) would enable ingest. Next-up adapter — high value, ~half a day of work.",
  ),
  kppra: disabledAdapter(
    "kppra",
    "Khyber Pakhtunkhwa PPRA",
    "KP appears to route procurement through kp.eprocure.gov.pk/EPADS; no anonymous stable tender feed/API was verified.",
  ),
  ppra_sindh: disabledAdapter(
    "ppra_sindh",
    "Sindh PPRA",
    "SPPRA exposes old active-tender search pages and links to PPMS, but no clean unified feed/API was verified.",
  ),
  bppra_balochistan: disabledAdapter(
    "bppra_balochistan",
    "Balochistan PPRA",
    "Current BPPRA public site does not expose a stable active-tender feed/API; revisit if its portal publishes structured listings.",
  ),
  pda_pk: pdaPkAdapter, // enabled via per-host insecureTls (server omits intermediate cert)
  nitb_pk: nitbPkAdapter,
  pseb_pk: disabledAdapter(
    "pseb_pk",
    "Pakistan Software Export Board",
    "No official PSEB tender feed/listing verified; search results point to BrightSpyre subdomain content that mixes jobs and third-party tenders.",
  ),
  nadra_pk: disabledAdapter(
    "nadra_pk",
    "NADRA",
    "NADRA links to tenders on the rebuilt site, but no stable public listing/feed shape was verified.",
  ),
  planning_commission_pk: planningCommissionPkAdapter,
  urban_unit_pk: urbanUnitPkAdapter,
  // Re-enabled 2026-05. Adapter is complete; if the upstream URL is still
  // returning a malformed redirect from the office network, runAdapter will
  // log the fetch error and the rest of the ingest run continues — flip back
  // to disabledAdapter() if the URL has not been corrected.
  sop_pk: sopPkAdapter,
  ppwd_pk: disabledAdapter(
    "ppwd_pk",
    "Pakistan Public Works Department",
    "No stable public tender API/RSS/list endpoint verified yet.",
  ),
  pitb_pk: pitbPkAdapter,
  ignite_pk: ignitePkAdapter,
  adb: disabledAdapter(
    "adb",
    "Asian Development Bank",
    "ADB exposes procurement pages and historical award datasets, but no stable open current-opportunity feed/API was verified.",
  ),
  undp: undpAdapter,
  etimad_sa: disabledAdapter(
    "etimad_sa",
    "Etimad Saudi Arabia",
    "Official API access is via Etimad Developer Portal subscription; public tender page is a dynamic app without stable public JSON/RSS.",
  ),
  kuwait_capt: disabledAdapter(
    "kuwait_capt",
    "Kuwait CAPT",
    "Public tender page is behind a Cloudflare challenge; disabled rather than attempting challenge circumvention.",
  ),
  kuwait_egov_ctc: disabledAdapter(
    "kuwait_egov_ctc",
    "Kuwait Government Online CTC",
    "Kuwait Government Online exposes tender opening/search service pages, but not a reusable machine-readable listing/feed.",
  ),
  kuwait_cbk: disabledAdapter(
    "kuwait_cbk",
    "Central Bank of Kuwait Tendering",
    "CBK public tenders service requires company registration at tendering.cbk.gov.kw; no public API/RSS/feed was found.",
  ),
  ungm: ungmAdapter,             // re-enabled via polite UNGM scrape
  sam_gov: samGovAdapter,        // requires free SAM_GOV_API_KEY
  ted_eu: tedEuAdapter,          // disabled — API v3 fields rework needed
};

export { runAdapter } from "./run.ts";
export { httpJson } from "./util/http.ts";
export { toUsd } from "./util/usd.ts";
export { parseRss } from "./util/rss.ts";
export type {
  IngestAdapter,
  FetchPageOpts,
  FetchPageResult,
  HttpJsonFn,
  HttpJsonOpts,
  OnBatchFn,
  OnBatchResult,
  RunAdapterOpts,
} from "./types.ts";
