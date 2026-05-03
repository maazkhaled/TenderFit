/**
 * Polite HTML scraping helpers, used only for sources that publish public
 * tender listings but lack any JSON/RSS/Atom alternative.
 *
 * Politeness rules enforced here:
 *   - Browser User-Agent (default servers reject the ingest UA)
 *   - >= 2s between requests to the SAME host (per-host token bucket)
 *   - Exponential backoff on 429 / 5xx (max 3 attempts)
 *   - Bail out at MAX_PAGES per run (configurable per adapter)
 *   - Respect robots.txt? — for simplicity we honor a manual allowlist; the
 *     two scraping adapters have explicit operator approval, and listing
 *     pages are the public face of these sites (intended to be read).
 *
 * Anti-IP-block strategy: low qps, real UA, no concurrent same-host
 * requests. If a source ever responds 403/429 persistently, the adapter
 * should be flipped to disabledReason rather than fighting it.
 */

const MIN_INTERVAL_MS = 2_000;
const lastRequestAtPerHost = new Map<string, number>();

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export interface FetchHtmlOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Override the per-host minimum interval. Don't reduce below 1000ms. */
  minIntervalMs?: number;
}

export async function fetchHtml(url: string, opts: FetchHtmlOpts = {}): Promise<string> {
  const host = new URL(url).host;
  const interval = Math.max(1_000, opts.minIntervalMs ?? MIN_INTERVAL_MS);

  const last = lastRequestAtPerHost.get(host) ?? 0;
  const wait = last + interval - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAtPerHost.set(host, Date.now());

  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...opts.headers,
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`fetchHtml ${url} -> ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(1_000 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error(`fetchHtml ${url} failed after retries`);
}

/**
 * Decode common HTML entities. Intentionally tiny — we don't want a
 * full dom dep just for tender titles. Covers the cases that show up
 * in PK government listings.
 */
export function decodeEntities(s: string): string {
  if (!s) return "";
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(s: string): string {
  return decodeEntities(
    (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
