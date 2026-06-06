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
  /**
   * Opt-in: allow TLS connections to this host even if the server presents
   * an incomplete certificate chain. Use ONLY for known public sites whose
   * intermediate certs are missing — never for anything carrying secrets.
   * Set per-adapter, not globally.
   */
  insecureTls?: boolean;
}

/**
 * Pull a URL using Node's built-in https module with `rejectUnauthorized:false`.
 * Used only when opts.insecureTls is set (e.g. pda.gov.pk, which omits the
 * intermediate cert). Avoids adding a runtime undici dependency.
 */
async function fetchHtmlInsecure(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; statusText: string; body: string }> {
  const https = await import("node:https");
  const { URL: NodeURL } = await import("node:url");
  const u = new NodeURL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        host: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : 443,
        path: `${u.pathname}${u.search}`,
        headers,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
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

  const timeoutMs = opts.timeoutMs ?? 30_000;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (opts.insecureTls) {
        const r = await fetchHtmlInsecure(url, headers, timeoutMs);
        if (r.status === 429 || r.status >= 500) {
          await sleep(2_000 * (attempt + 1));
          continue;
        }
        if (r.status < 200 || r.status >= 300) {
          throw new Error(`fetchHtml ${url} -> ${r.status} ${r.statusText}`);
        }
        return r.body;
      }
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
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

/**
 * POST helper for ASP.NET WebForms pages that require ViewState round-trips.
 *
 * Honours the same per-host rate limit + retry policy as fetchHtml. Body is
 * form-urlencoded (application/x-www-form-urlencoded) — that's what WebForms
 * expects for __VIEWSTATE / __EVENTTARGET callbacks.
 *
 * Returns the raw HTML response body. Cookies sent on a previous GET to the
 * same host are NOT automatically replayed — pass them explicitly via
 * `opts.headers.Cookie` if the server requires session continuity.
 */
export async function postForm(
  url: string,
  formData: Record<string, string>,
  opts: FetchHtmlOpts = {},
): Promise<string> {
  const host = new URL(url).host;
  const interval = Math.max(1_000, opts.minIntervalMs ?? MIN_INTERVAL_MS);

  const last = lastRequestAtPerHost.get(host) ?? 0;
  const wait = last + interval - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAtPerHost.set(host, Date.now());

  const body = new URLSearchParams(formData).toString();
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": String(Buffer.byteLength(body)),
    Origin: new URL(url).origin,
    Referer: url,
    ...opts.headers,
  };

  const timeoutMs = opts.timeoutMs ?? 30_000;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`postForm ${url} -> ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(1_000 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error(`postForm ${url} failed after retries`);
}

/**
 * Extract the three hidden inputs every ASP.NET WebForms page emits.
 * Returns the empty string for any field that's missing so callers can
 * still construct a valid POST body — the server will reject it but
 * we'll get a clean error rather than a JS exception.
 */
export function extractAspNetViewState(html: string): {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
} {
  const grab = (name: string): string => {
    const re = new RegExp(
      `<input[^>]+name="${name}"[^>]+value="([^"]*)"`,
      "i",
    );
    const m = re.exec(html);
    return m && m[1] ? decodeEntities(m[1]) : "";
  };
  return {
    viewState: grab("__VIEWSTATE"),
    viewStateGenerator: grab("__VIEWSTATEGENERATOR"),
    eventValidation: grab("__EVENTVALIDATION"),
  };
}
