/**
 * Client-safe money formatting.
 *
 * This file must stay free of any Prisma / Decimal import. Client Components
 * render money, and pulling `@prisma/client/runtime/library` into the browser
 * bundle would ship the whole Prisma runtime to users.
 *
 * lib/money.js re-exports from here, so the currency symbol and precision have
 * exactly one definition shared by server and client.
 */

/** Minor units stored and displayed for every monetary value. */
export const MONEY_SCALE = 2;

export const DEFAULT_CURRENCY = "INR";

/** Locale used to render each supported currency. Extended properly in M22. */
export const CURRENCY_LOCALES = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
};

/**
 * Coerce anything money-shaped to a Number for display.
 * Accepts number | string | Decimal (duck-typed via toNumber) and never throws -
 * a formatter that explodes must not be able to take down a page.
 */
function toDisplayNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The single place that owns currency rendering across the app.
 *
 *   formatMoney(1000)          -> "₹1,000.00"
 *   formatMoney(1000, "USD")   -> "$1,000.00"
 */
export function formatMoney(value, currency = DEFAULT_CURRENCY) {
  const amount = toDisplayNumber(value);
  const locale = CURRENCY_LOCALES[currency] ?? CURRENCY_LOCALES[DEFAULT_CURRENCY];

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
  }).format(amount);
}

/**
 * Compact form for chart axes, where a full currency string is too wide.
 *
 *   formatMoneyCompact(150000) -> "₹1.5L"   (Indian numbering)
 */
export function formatMoneyCompact(value, currency = DEFAULT_CURRENCY) {
  const amount = toDisplayNumber(value);
  const locale = CURRENCY_LOCALES[currency] ?? CURRENCY_LOCALES[DEFAULT_CURRENCY];

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

/** Bare currency symbol, for labels that are not a full amount. */
export function currencySymbol(currency = DEFAULT_CURRENCY) {
  const locale = CURRENCY_LOCALES[currency] ?? CURRENCY_LOCALES[DEFAULT_CURRENCY];
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? "";
}
