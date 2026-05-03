import type { TenderSourceId } from "@beta/shared";
import type { IngestAdapter } from "./types";
import { samGovAdapter } from "./adapters/sam_gov";
import { tedEuAdapter } from "./adapters/ted_eu";
import { ungmAdapter } from "./adapters/ungm";
import { worldBankAdapter } from "./adapters/world_bank";
import { ppraPkAdapter } from "./adapters/ppra_pk";
import { ukFindATenderAdapter } from "./adapters/uk_find_a_tender";
import { ukContractsFinderAdapter } from "./adapters/uk_contracts_finder";

export const adapters: Record<TenderSourceId, IngestAdapter> = {
  world_bank: worldBankAdapter,
  uk_find_a_tender: ukFindATenderAdapter,
  uk_contracts_finder: ukContractsFinderAdapter,
  ppra_pk: ppraPkAdapter,        // re-enabled via polite EPMS scrape
  ungm: ungmAdapter,             // re-enabled via polite UNGM scrape
  sam_gov: samGovAdapter,        // requires free SAM_GOV_API_KEY
  ted_eu: tedEuAdapter,          // disabled — API v3 fields rework needed
};

export { runAdapter } from "./run";
export { httpJson } from "./util/http";
export { toUsd } from "./util/usd";
export { parseRss } from "./util/rss";
export type {
  IngestAdapter,
  FetchPageOpts,
  FetchPageResult,
  HttpJsonFn,
  HttpJsonOpts,
  OnBatchFn,
  OnBatchResult,
  RunAdapterOpts,
} from "./types";
