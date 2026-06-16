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

// =============================================================================
//  Per-host HTTP proxy (for geo-blocked Pakistani gov hosts)
// =============================================================================
//
// Several PK gov sites (eproc.punjab.gov.pk, nitb.gov.pk, pc.gov.pk,
// sop.gov.pk) silently drop packets from non-Pakistani IPs at the
// network firewall layer. Hostinger's Malaysian datacenter cannot reach
// them. To route requests for these specific hosts through a Pakistani
// proxy without affecting the rest of the ingest:
//
//   1. Stand up a tiny PK-based VPS (Cyber Internet, Nayatel, etc.)
//      running an HTTP proxy (Squid is the simplest).
//   2. Set PK_PROXY_URL in .env to the proxy URL, e.g.:
//        PK_PROXY_URL="http://username:password@your-pk-proxy.example:3128"
//   3. (Optional) Override the host list via PK_PROXY_HOSTS env (comma-
//      separated). Defaults below cover the known geo-blocked PK gov hosts.
//
// When PK_PROXY_URL is unset, behaviour is unchanged — direct fetch.
// When it's set, only requests to matching hosts route through it; every
// other host (World Bank, UNGM, UK procurement, etc.) still goes direct.

const DEFAULT_PROXY_HOSTS = [
  "eproc.punjab.gov.pk",
  "nitb.gov.pk",
  "www.nitb.gov.pk",
  "pc.gov.pk",
  "www.pc.gov.pk",
  "sop.gov.pk",
  "www.sop.gov.pk",
  "ppra.punjab.gov.pk",
];

function proxyHosts(): Set<string> {
  const fromEnv = process.env.PK_PROXY_HOSTS?.trim();
  if (fromEnv) {
    return new Set(
      fromEnv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return new Set(DEFAULT_PROXY_HOSTS.map((h) => h.toLowerCase()));
}

function shouldUseProxy(url: string): boolean {
  const proxyUrl = process.env.PK_PROXY_URL?.trim();
  if (!proxyUrl) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return proxyHosts().has(host);
  } catch {
    return false;
  }
}

/**
 * Lazy-init a single shared undici ProxyAgent. We can't construct it at
 * module load because PK_PROXY_URL may not be set, and we want a cheap
 * "no proxy" path for production deployments that don't need one.
 */
let _proxyAgent: unknown = null;
let _proxyAgentUrl: string | null = null;

async function getProxyDispatcher(): Promise<unknown | null> {
  const url = process.env.PK_PROXY_URL?.trim();
  if (!url) return null;
  if (_proxyAgent && _proxyAgentUrl === url) return _proxyAgent;
  try {
    // undici is bundled with Node 18+ — we import dynamically so this file
    // stays portable.
    const undici = (await import("undici")) as {
      ProxyAgent: new (url: string) => unknown;
    };
    _proxyAgent = new undici.ProxyAgent(url);
    _proxyAgentUrl = url;
    return _proxyAgent;
  } catch (err) {
    console.error(
      `[html-scrape] failed to construct ProxyAgent for ${url}:`,
      err,
    );
    return null;
  }
}

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
      // Route through the PK proxy when the host is in the geo-block list
      // AND PK_PROXY_URL is configured. Both have to be true — defaults
      // to direct fetch when either is missing.
      let res: Response;
      if (shouldUseProxy(url)) {
        const dispatcher = await getProxyDispatcher();
        if (dispatcher) {
          const undici = (await import("undici")) as {
            fetch: typeof fetch;
          };
          res = await undici.fetch(url, {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
            // @ts-expect-error — undici accepts `dispatcher`, Node's fetch
            // type doesn't yet expose it. Runtime behaviour is correct.
            dispatcher,
          });
        } else {
          res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          });
        }
      } else {
        res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      }
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
      // Same per-host proxy routing as fetchHtml.
      let res: Response;
      if (shouldUseProxy(url)) {
        const dispatcher = await getProxyDispatcher();
        if (dispatcher) {
          const undici = (await import("undici")) as { fetch: typeof fetch };
          res = await undici.fetch(url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
            // @ts-expect-error — see fetchHtml
            dispatcher,
          });
        } else {
          res = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        }
      } else {
        res = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      }
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
