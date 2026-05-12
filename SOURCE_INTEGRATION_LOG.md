# Source Integration Log

Date: 2026-05-05

## Scope

Added the requested tender/procurement sources to TenderFit while preserving the existing source policy:

1. Prefer stable public APIs, JSON, RSS, or structured feeds.
2. Use low-rate public listing-page scraping only when the site exposes no feed/API and the listing is publicly intended for tender discovery.
3. Register sources with `disabledReason` when no stable public endpoint is verified, when a portal requires official API subscription, or when scraping would be brittle.

## Parallel Work

Two subagents were used:

- Explorer agent inspected the ingestion architecture, source enum alignment, adapter contract, and best UI placement for source selection.
- Shared-metadata worker added a reusable source catalog in `packages/shared/src/source-catalog.ts` and exported source catalog schemas/types.

The main agent integrated those findings, added source IDs, adapter registrations, active adapters where practical, dashboard filtering, and this log.

## Source Decisions

Active sources added:

- `nitb_pk`: polite scrape of `https://nitb.gov.pk/tender.html`.
- `pitb_pk`: polite scrape of `https://pitb.gov.pk/tendernotices`.
- `planning_commission_pk`: polite scrape of `https://pc.gov.pk/web/tender`.
- `urban_unit_pk`: polite scrape of `https://urbanunit.gov.pk/procurement`.
- `ignite_pk`: polite scrape of `https://ignite.org.pk/rfps/`.
- `undp`: RSS feed from `https://procurement-notices.undp.org/proc_notices_rss_feed.cfm`.

Existing active source retained:

- `ppra_pk`: existing polite EPMS scrape for federal PPRA notices.

Registered but disabled until a stable endpoint is verified:

- `eprocure_pk`: appears covered by EPMS/PPRA public listings; no separate stable public feed verified.
- `ppra_punjab`, `kppra`, `ppra_sindh`, `bppra_balochistan`: no stable public API/RSS/list endpoint verified in this pass.
- `pda_pk`: public page is reachable in browsers/curl, but Node rejects the incomplete TLS certificate chain; disabled rather than bypassing TLS verification.
- `sop_pk`: public URL redirects to a malformed/unresolvable host.
- `pseb_pk`, `nadra_pk`, `ppwd_pk`: no stable public tender API/RSS/list shape verified in this pass.
- `adb`: procurement pages and datasets exist, but no stable open current-notice feed/API was verified.
- `etimad_sa`: public page is a dynamic app; official API access is through Etimad Developer Portal subscription.
- `kuwait_capt`: public tender page is behind a Cloudflare challenge.
- `kuwait_egov_ctc`: live tender-opening service, not a reusable tender list/feed.
- `kuwait_cbk`: no stable public tender API/RSS/list endpoint verified in this pass.

## Application Changes

- Added all requested source IDs to shared `TENDER_SOURCES`.
- Added matching Prisma `TenderSource` enum values and raw SQL enum migration.
- Added catalog metadata for UI labels, categories, URLs, and descriptions.
- Registered every source in the ingest adapter registry; disabled entries remain visible to operators but skipped by scheduled ingest.
- Added `GET /api/v1/matches?sources=a,b` filtering.
- Added dashboard source checkboxes so users can restrict match browsing to selected sources.
- Added `INGEST_SOURCES=source_a,source_b` support for source-limited ingest runs.

## Validation Notes

Run after implementation:

```bash
pnpm --filter @beta/shared typecheck
pnpm --filter @beta/ingest typecheck
pnpm --filter web typecheck
pnpm --filter worker typecheck
```

Apply `packages/db/src/migrations/002_tender_sources.sql` before ingesting any newly added source into an existing database.
