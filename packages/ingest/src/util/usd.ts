export function toUsd(
  amount: number | null | undefined,
  currencyCode: string | null | undefined,
  exchangeRate?: number,
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  if (!currencyCode) return null;

  const code = currencyCode.toUpperCase();
  if (code === "USD") return Math.round(amount);

  if (typeof exchangeRate === "number" && Number.isFinite(exchangeRate) && exchangeRate > 0) {
    return Math.round(amount * exchangeRate);
  }

  // TODO(lead): wire a real FX service (e.g. ECB / openexchangerates) and pass live rates here.
  console.warn(`[toUsd] no FX rate for ${code}; returning null`);
  return null;
}
