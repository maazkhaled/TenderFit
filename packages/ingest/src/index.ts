import type { TenderSourceId } from "@beta/shared";
import type { IngestAdapter } from "./types";
import { samGovAdapter } from "./adapters/sam_gov";
import { tedEuAdapter } from "./adapters/ted_eu";
import { ungmAdapter } from "./adapters/ungm";
import { worldBankAdapter } from "./adapters/world_bank";
import { ppraPkAdapter } from "./adapters/ppra_pk";

export const adapters: Record<TenderSourceId, IngestAdapter> = {
  sam_gov: samGovAdapter,
  ted_eu: tedEuAdapter,
  ungm: ungmAdapter,
  world_bank: worldBankAdapter,
  ppra_pk: ppraPkAdapter,
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
