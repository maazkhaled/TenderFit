/**
 * Headless-browser rendering for tender portals whose listings are
 * JavaScript-only (GeBIZ Singapore JSF, GeM India React, GCA UK,
 * CanadaBuys Drupal, AfDB, IADB, JICA project search).
 *
 * Design rules:
 *   - One shared Chromium instance per worker process. Spinning up a
 *     browser is the expensive part (~2s + 100MB resident); reusing it
 *     across the dozens of fetches per ingest run is essential.
 *   - One context per fetch. Contexts are cheap (~50ms) and isolate
 *     cookies/storage so one portal's session can't bleed into another.
 *   - 2s/host throttle, same as fetchHtml — be a polite citizen even
 *     when we're rendering JS.
 *   - 30s default page timeout. Tender portals are slow; bumping above
 *     the default 30s catches real outages without flapping.
 *   - Honour an env opt-out (DISABLE_PLAYWRIGHT=1) so a deploy without
 *     Chromium installed can still boot the worker — adapters that need
 *     it will just throw and get logged as skipped, exactly like a 500
 *     from an upstream.
 *
 * Why not Puppeteer? Playwright bundles its own browser binaries with
 * the npm package, has better wait-for-network-idle semantics, and the
 * official Docker install (`playwright install --with-deps chromium`)
 * is the cleanest "drop into Debian slim" path we have.
 */

// We deliberately don't `import type { Browser } from "playwright"` at the
// top of the file because playwright is an optional runtime dep. The
// import happens dynamically below; locally we narrow to the bits of the
// API we actually use, which also keeps typecheck working in CI/sandbox
// environments where playwright hasn't been installed yet.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAsync = any;

const MIN_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const lastRequestAtPerHost = new Map<string, number>();

let _browserPromise: Promise<AnyAsync | null> | null = null;

/**
 * Lazy-init the singleton browser. Returns null if Playwright isn't
 * available at runtime (DISABLE_PLAYWRIGHT=1, or the npm package failed
 * to install). Callers should treat null the same as a network error
 * for the upstream — log + skip, don't crash the worker.
 */
async function getBrowser(): Promise<AnyAsync | null> {
  if (process.env.DISABLE_PLAYWRIGHT === "1") return null;
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    try {
      // Dynamic + soft import — playwright is listed as a dep but we never
      // want to crash the worker if the install or browser binary is
      // missing. The cron will keep running fetchHtml-based adapters and
      // just skip the rendered ones.
      // Soft import — even with playwright in package.json the install
      // can fail in restricted environments (no Chromium binary, etc).
      // Returning null here causes adapters to log "playwright
      // unavailable" + yield zero tenders rather than crash the worker.
      const mod = (await import("playwright").catch(() => null)) as AnyAsync;
      if (!mod || !mod.chromium) {
        console.warn(`[playwright] module not available, rendered adapters will be skipped`);
        return null;
      }
      const browser = await mod.chromium.launch({
        headless: true,
        // --no-sandbox is required on Debian slim because we don't bring
        // in the kernel namespacing support full Chrome relies on. Safe
        // inside the container because we only ever load public pages.
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      // Graceful shutdown — closing the browser on signal also flushes
      // any pending pages. Without this, the container hangs on SIGTERM.
      const close = async () => {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      };
      process.once("SIGTERM", () => void close());
      process.once("SIGINT", () => void close());
      return browser;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[playwright] failed to launch chromium: ${msg}`);
      _browserPromise = null;
      return null;
    }
  })();
  return _browserPromise;
}

export interface FetchRenderedOpts {
  timeoutMs?: number;
  /**
   * Wait condition before we extract HTML. "networkidle" suits most
   * portals (the listing is fetched via XHR after initial load).
   * "domcontentloaded" is a faster alternative when the portal renders
   * server-side and only sprinkles in JS for filters.
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /**
   * Extra CSS selector to wait for after waitUntil resolves. Use this
   * when the portal does multiple XHR loads — wait for the actual
   * row/item to appear before scraping.
   */
  waitForSelector?: string;
  /**
   * Visibility state for waitForSelector. Default "attached" — we
   * only care that the element exists in the DOM. Many portal cards
   * are offscreen / in collapsed sections / behind absolute-positioned
   * layouts that Playwright's default "visible" check rejects, even
   * though the HTML is fully there and scrapeable.
   */
  waitForSelectorState?: "attached" | "visible";
  /** Extra HTTP headers. Browser-emulating UA is set automatically. */
  headers?: Record<string, string>;
  /**
   * Optional in-page script to execute after the page is ready. Useful
   * to scroll-trigger lazy-load lists, click cookie banners, etc.
   * Must be a string (it's passed to page.evaluate via Function.
   */
  postLoadScript?: string;
  /**
   * Warmup URL hit before the real URL — helps bypass bot walls
   * (Cloudflare turnstile, Drupal access control) that fingerprint
   * the first request. Cookies + storage from the warmup carry over.
   */
  warmupUrl?: string;
}

/**
 * Fetch a JS-rendered URL and return the final DOM as HTML. Apply the
 * same per-host throttle as fetchHtml.
 *
 * Throws on:
 *   - Playwright launch failure (browser missing)
 *   - Navigation timeout
 *   - Non-2xx HTTP from the upstream
 */
export async function fetchRendered(
  url: string,
  opts: FetchRenderedOpts = {},
): Promise<string> {
  const browser = await getBrowser();
  if (!browser) {
    throw new Error("playwright unavailable (DISABLE_PLAYWRIGHT or launch failed)");
  }

  // Per-host throttle.
  const host = safeHost(url);
  if (host) {
    const last = lastRequestAtPerHost.get(host) ?? 0;
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAtPerHost.set(host, Date.now());
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const waitUntil = opts.waitUntil ?? "networkidle";

  let context: AnyAsync = null;
  let page: AnyAsync = null;
  try {
    context = await browser.newContext({
      // Use a realistic, recent Chrome UA without our "TenderFit-Ingest"
      // suffix. Some bot walls (Drupal access control, Cloudflare) flag
      // unknown UA tokens as automation. We're still polite — 2s
      // throttle per host stays in place.
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 1024 },
      extraHTTPHeaders: {
        // The full set of headers a real Chrome sends on a top-level
        // navigation. Matters for Drupal CSP / CF Bot Management.
        "Accept-Language": "en-US,en;q=0.9",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Ch-Ua":
          '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Linux"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        ...(opts.headers ?? {}),
      },
    });

    // Hide the `navigator.webdriver` flag — it's the single most-
    // checked signal by anti-bot tools. Real Chrome sets it false;
    // headless Chromium sets it true by default. Override before any
    // page script runs.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    // Drop images, fonts, media — saves bandwidth + ~30% load time. Keep
    // stylesheets because some portals render layout-conditional content
    // via :hover or :empty selectors.
    await context.route("**/*", (route: AnyAsync) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
    page = await context.newPage();

    // Optional warmup — visit a related URL first so cookies / CF
    // tokens get set before we hit the actual listing. Helps with
    // Drupal access control and lightweight Cloudflare challenges
    // that fingerprint the cold first request.
    if (opts.warmupUrl) {
      try {
        await page.goto(opts.warmupUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(timeoutMs, 15_000),
        });
        await sleep(800);
      } catch {
        /* warmup is best-effort; ignore failures */
      }
    }

    const response = await page.goto(url, {
      waitUntil,
      timeout: timeoutMs,
    });
    if (response && !response.ok()) {
      throw new Error(
        `${url} → ${response.status()} ${response.statusText()}`,
      );
    }
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, {
        timeout: timeoutMs,
        state: opts.waitForSelectorState ?? "attached",
      });
    }
    if (opts.postLoadScript) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate(opts.postLoadScript as any);
      // Tiny settle delay after scrolling or clicking.
      await sleep(500);
    }
    return await page.content();
  } finally {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
