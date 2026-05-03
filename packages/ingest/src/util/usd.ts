/**
 * Convert a tender budget into USD. Uses static fallback rates so common
 * currencies (GBP, EUR, etc.) don't drop to null when no live FX service
 * is wired up. Override individual rates with FX_RATE_<CCY> env vars
 * (e.g. FX_RATE_GBP=1.27) for tighter accuracy.
 *
 * The numbers are intentionally rough — fit-scoring only cares about the
 * order of magnitude. A live ECB feed can replace this whole file later.
 */

const FALLBACK_USD_PER: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.13,
  CAD: 0.74,
  AUD: 0.66,
  NZD: 0.61,
  JPY: 0.0067,
  CNY: 0.14,
  INR: 0.012,
  PKR: 0.0036,
  AED: 0.272,
  SAR: 0.266,
  ZAR: 0.054,
  BRL: 0.20,
  MXN: 0.058,
  SEK: 0.094,
  NOK: 0.094,
  DKK: 0.144,
};

const warned = new Set<string>();

// PostgreSQL Int (Int4) max — Tender.budget*Usd are stored as Int. Clamp here
// rather than overflow the column. Real-world tenders over $2.1B are
// either framework-of-frameworks noise or data errors; either way we don't
// want to crash the ingest.
const MAX_INT4 = 2_147_483_647;

export function toUsd(
  amount: number | null | undefined,
  currencyCode: string | null | undefined,
  exchangeRate?: number,
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  if (!currencyCode) return null;

  const code = currencyCode.toUpperCase();
  const clamp = (n: number) => Math.max(-MAX_INT4, Math.min(MAX_INT4, Math.round(n)));

  if (code === "USD") return clamp(amount);

  if (typeof exchangeRate === "number" && Number.isFinite(exchangeRate) && exchangeRate > 0) {
    return clamp(amount * exchangeRate);
  }

  const envOverride = Number.parseFloat(process.env[`FX_RATE_${code}`] ?? "");
  if (Number.isFinite(envOverride) && envOverride > 0) {
    return clamp(amount * envOverride);
  }

  const fallback = FALLBACK_USD_PER[code];
  if (typeof fallback === "number") {
    return clamp(amount * fallback);
  }

  if (!warned.has(code)) {
    warned.add(code);
    console.warn(
      `[toUsd] no FX rate for ${code}; returning null (set FX_RATE_${code}=<usd-per-unit> to override)`,
    );
  }
  return null;
}
