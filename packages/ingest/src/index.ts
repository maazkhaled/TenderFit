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
import { ppraPunjabAdapter } from "./adapters/ppra_punjab.ts";
import { ebrdAdapter } from "./adapters/ebrd.ts";

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
  // Disabled 2026-06: eproc.punjab.gov.pk geo-blocks non-PK IPs at the
  // firewall, so the Malaysian production VPS can't reach it. The adapter
  // code at adapters/ppra_punjab.ts is complete — to re-enable, configure
  // PK_PROXY_URL in .env and swap the line below back to:
  //   ppra_punjab: ppraPunjabAdapter,
  // (Import retained above so the swap is one line.)
  ppra_punjab: disabledAdapter(
    "ppra_punjab",
    "Punjab PPRA",
    "Geo-blocked from non-PK IPs (Hostinger Malaysia cannot reach eproc.punjab.gov.pk). Configure PK_PROXY_URL in .env and re-enable in index.ts.",
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
  // Disabled 2026-06: nitb.gov.pk geo-blocks non-PK IPs at the firewall.
  // Adapter code complete — to re-enable, configure PK_PROXY_URL and swap
  // this line back to: nitb_pk: nitbPkAdapter,
  nitb_pk: disabledAdapter(
    "nitb_pk",
    "National IT Board (PK)",
    "Geo-blocked from non-PK IPs. Configure PK_PROXY_URL in .env and re-enable in index.ts.",
  ),
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
  // Disabled 2026-06: pc.gov.pk geo-blocks non-PK IPs at the firewall.
  // Adapter code complete — to re-enable, configure PK_PROXY_URL and swap
  // this line back to: planning_commission_pk: planningCommissionPkAdapter,
  planning_commission_pk: disabledAdapter(
    "planning_commission_pk",
    "Planning Commission (PK)",
    "Geo-blocked from non-PK IPs. Configure PK_PROXY_URL in .env and re-enable in index.ts.",
  ),
  urban_unit_pk: urbanUnitPkAdapter,
  // Disabled 2026-06: www.sop.gov.pk geo-blocks non-PK IPs at the firewall.
  // Adapter code complete — to re-enable, configure PK_PROXY_URL and swap
  // this line back to: sop_pk: sopPkAdapter,
  sop_pk: disabledAdapter(
    "sop_pk",
    "Survey of Pakistan",
    "Geo-blocked from non-PK IPs. Configure PK_PROXY_URL in .env and re-enable in index.ts.",
  ),
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

  // --- Tier 1 (added 2026-06-25, catalog-only) ---
  // All five sources are wired into the catalog + UI (with the
  // "Temporarily not available" badge) so users can opt in ahead of time.
  // Adapters live as disabledAdapter stubs until each upstream's feed
  // shape is verified against a live response. Don't ship speculative
  // scrapers — same rule we've applied to etimad_sa, adb, kuwait_*.
  gem_india: disabledAdapter(
    "gem_india",
    "GeM India",
    "Listing pages (gem.gov.in/view_all_bids, bidplus.gem.gov.in/all-bids) are JS-rendered with no static payload. Needs verified public API access or browser-rendered scrape.",
  ),
  austender: disabledAdapter(
    "austender",
    "AusTender",
    "HTML list is fetchable but per-tender detail URL pattern + field shape (deadline, buyer, value) need live verification before shipping an adapter.",
  ),
  gca_uk: disabledAdapter(
    "gca_uk",
    "GCA UK (Government Commercial Agency)",
    "Agreement list is fetchable but pagination + detail links are JS-driven. Note: GCA is the rebranded Crown Commercial Service as of April 2026.",
  ),
  gebiz_sg: disabledAdapter(
    "gebiz_sg",
    "GeBIZ Singapore",
    "Page is JSF/PrimeFaces — entire opportunity listing is JS-rendered with no static HTML payload. Needs browser automation or an undocumented JSON endpoint.",
  ),
  canada_buys: disabledAdapter(
    "canada_buys",
    "CanadaBuys",
    "Drupal frontend requires JS. Open-data CSV/JSON exists per docs but the canonical URL needs manual verification before wiring.",
  ),

  // --- Tier 2 (added 2026-06-25, catalog-only) ---
  // Multilateral development banks. All five returned empty payloads on
  // direct fetch from the production VPS region — same disabledAdapter
  // pattern as Tier 1 until live feed shape is confirmed.
  afdb: disabledAdapter(
    "afdb",
    "African Development Bank",
    "Listing page returned empty payload on direct fetch. Needs verified procurement-notices feed (RSS/JSON) or browser-rendered scrape.",
  ),
  ifc: disabledAdapter(
    "ifc",
    "International Finance Corporation",
    "Procurement page returned empty payload on direct fetch. Needs verified notices feed shape.",
  ),
  // Live as of 2026-06-25 — scrapes ECEPP server-rendered table at
  // ecepp.ebrd.com. Filters to Open notices with biddable types
  // (Invitation For Tenders / Prequalification / EOI / RFP), drops
  // Contract Award / Shortlist rows. Country derived from title prefix.
  ebrd: ebrdAdapter,
  jica: disabledAdapter(
    "jica",
    "Japan International Cooperation Agency",
    "Needs verified procurement-notices feed shape before shipping adapter.",
  ),
  iadb: disabledAdapter(
    "iadb",
    "Inter-American Development Bank",
    "Project-search page returned empty payload on direct fetch. Needs verified procurement-notices feed shape.",
  ),
};

// Keep these imports alive so the geo-blocked adapters can be re-enabled
// with a one-line swap (see disabled entries above). The `void` references
// satisfy TypeScript's no-unused-locals without changing runtime behaviour.
void ppraPunjabAdapter;
void nitbPkAdapter;
void planningCommissionPkAdapter;
void sopPkAdapter;

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
