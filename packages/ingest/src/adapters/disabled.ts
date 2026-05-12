import type { TenderSourceId } from "@beta/shared";
import type { IngestAdapter } from "../types.ts";

export function disabledAdapter(
  source: TenderSourceId,
  label: string,
  disabledReason: string,
): IngestAdapter {
  return {
    source,
    label,
    requiredEnv: [],
    disabledReason,
    async fetchPage() {
      return { tenders: [], nextPageToken: null };
    },
  };
}
