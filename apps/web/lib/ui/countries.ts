export interface CountryOption {
  code: string;
  name: string;
}

export const COMMON_COUNTRIES: CountryOption[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "SE", name: "Sweden" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "PK", name: "Pakistan" },
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "JP", name: "Japan" },
  { code: "BR", name: "Brazil" },
  { code: "ZA", name: "South Africa" },
  { code: "KE", name: "Kenya" },
  { code: "NG", name: "Nigeria" },
];

export function flagFor(iso2: string) {
  if (iso2.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  const code = iso2.toUpperCase();
  return (
    String.fromCodePoint(A + code.charCodeAt(0) - a) +
    String.fromCodePoint(A + code.charCodeAt(1) - a)
  );
}

export function commonTimezones(): string[] {
  const supported =
    typeof Intl !== "undefined" &&
    typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf === "function"
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] })
          .supportedValuesOf("timeZone")
      : null;
  if (supported && supported.length) return supported;
  return [
    "UTC",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "Asia/Karachi",
    "Asia/Dubai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
}
