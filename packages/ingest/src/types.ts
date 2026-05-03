import type { NormalizedTender, TenderSourceId } from "@beta/shared";

export interface FetchPageOpts {
  sinceIso: string;
  pageToken?: string;
  httpJson?: HttpJsonFn;
}

export interface FetchPageResult {
  tenders: NormalizedTender[];
  nextPageToken: string | null;
}

export interface IngestAdapter {
  source: TenderSourceId;
  label: string;
  fetchPage(opts: FetchPageOpts): Promise<FetchPageResult>;
  requiredEnv: string[];
  /**
   * If set, the adapter is registered (so historical rows still resolve their
   * source) but skipped at scheduled run time. Use when the upstream source
   * has dropped its public API/RSS and there's no clean replacement.
   * Provide a short reason for operator visibility.
   */
  disabledReason?: string;
}

export type HttpJsonFn = <T = unknown>(url: string, opts?: HttpJsonOpts) => Promise<T>;

export interface HttpJsonOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  asText?: boolean;
}

export interface OnBatchResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export type OnBatchFn = (tenders: NormalizedTender[]) => Promise<OnBatchResult>;

export interface RunAdapterOpts {
  sinceIso: string;
  maxPages?: number;
  onBatch: OnBatchFn;
  httpJson?: HttpJsonFn;
}
