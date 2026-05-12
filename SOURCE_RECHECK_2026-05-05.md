# Disabled Source Recheck

Date: 2026-05-05

## Breakthroughs

- `nitb_pk` is now enabled. The NITB tender page exposes an active tender table with titles, publish dates, status, and download links.
- `planning_commission_pk` is now enabled. The Planning Commission tender page exposes open tender entries with titles, dates, and status.

## Still Disabled

- `eprocure_pk`: Federal eProcure/PPRA public opportunities remain covered through EPMS; no separate stable feed was verified.
- `pda_pk`: Public page returns 200 in curl, but Node fetch fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; disabled rather than bypassing TLS verification.
- `ppra_punjab`: Public procurement page is discoverable, but no stable active-tender API/feed was verified.
- `kppra`: KP procurement appears to be routed through EPADS at `kp.eprocure.gov.pk`; no anonymous feed/API was verified.
- `ppra_sindh`: Old SPPRA active-tender search pages and PPMS are discoverable, but not a clean unified feed/API.
- `bppra_balochistan`: Current BPPRA public site did not expose a stable active-tender feed/API in this pass.
- `pseb_pk`: Search results point mainly to BrightSpyre-hosted mixed jobs/tenders, not a clean official PSEB procurement feed.
- `nadra_pk`: The rebuilt NADRA site links to tenders, but no stable public list/feed shape was verified.
- `sop_pk`: Official URL redirects to malformed `https://surveyofpakistan.gov.pkTenders`, and corrected host did not resolve in this pass.
- `ppwd_pk`: No stable active tender feed/listing was verified.
- `adb`: ADB has procurement pages and historical operational procurement datasets, but no stable current-opportunity feed/API was verified.
- `etimad_sa`: Official public tender page is protected by JavaScript/human verification; official developer portal requires login/subscription.
- `kuwait_capt`: Public tender page returns Cloudflare challenge/403 to the worker; disabled rather than attempting challenge circumvention.
- `kuwait_egov_ctc`: Service pages for tender opening/search exist, but no reusable machine-readable list/feed was verified.
- `kuwait_cbk`: CBK public tendering service requires supplier registration; no public feed/API was verified.

## Evidence Notes

- NITB search result exposed `https://nitb.gov.pk/tender.html` with active rows.
- Planning Commission search result exposed `https://pc.gov.pk/web/tender` with open tender rows.
- Sindh search result exposed old `tendersdepartment.php` and PPMS references, but not a stable unified machine-readable endpoint.
- Kuwait eGov search result exposed Open Tenders/Search pages, but as eService entry points rather than a feed.
- Etimad public tender page currently requires JavaScript/human verification; developer portal documents subscription-based API access.
