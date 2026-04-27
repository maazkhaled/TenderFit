# Ingestion Agent Notes

`@beta/ingest` — five source adapters, all using public API/RSS endpoints (no scraping). Each adapter validates output via `NormalizedTenderSchema.parse()` before returning. `runAdapter` accepts an `onBatch` callback so DB writes stay in the worker.

## Adapters

| Source | Endpoint | Auth |
|---|---|---|
| `sam_gov` | `https://api.sam.gov/opportunities/v2/search` (GET, paginated `limit`/`offset`) | `SAM_GOV_API_KEY` |
| `ted_eu` | `https://api.ted.europa.eu/v3/notices/search` (POST JSON body) | none |
| `ungm` | `https://www.ungm.org/Public/Notice?rss=1` (RSS via `fast-xml-parser`) | none |
| `world_bank` | `https://search.worldbank.org/api/v2/procnotices?format=json` | none |
| `ppra_pk` | `https://www.ppra.org.pk/rss.asp` (RSS) | none |

## TODOs

- `sam_gov`: verify `MM/dd/yyyy` postedFrom format and field names against live response.
- `ted_eu`: verify multilingual key shape (`title.eng` vs `title.en`) and date format (`yyyymmdd`).
- `world_bank`: verify field names (`procnotices` shape varies).
- `util/usd.ts`: wire real FX service; currently returns `null` for non-USD with a warning.
- `__tests__/normalize.test.ts`: smoke tests written with DI but fail at runtime due to `@beta/shared` ESM resolution (no `.ts` extensions in shared/index.ts) — fix lives in shared package.

## Constraints respected

No HTML scraping. Default `maxPages = 5`. Consistent UA `ProjectBeta/0.1`. 30s timeout, 1 retry on 5xx. Did not touch `apps/`, `worker/`, `packages/db/`, `packages/llm/`, `prisma/`, or `packages/shared/`.
