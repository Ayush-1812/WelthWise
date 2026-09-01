/**
 * Multi-currency support - pure functions, no I/O (M22).
 *
 * Two rules drive everything here:
 *
 *   1. Never overwrite the original. An expense keeps the amount and currency
 *      it was actually incurred in, plus the rate used at the time. A rate that
 *      moves tomorrow must not silently rewrite what happened yesterday.
 *
 *   2. Never silently sum across currencies. Adding $100 to ₹100 and getting
 *      200 is worse than refusing. Balances are computed per currency, and a
 *      mixed ledger fails loudly rather than producing a plausible lie.
 */

import { toDecimal, round, mul, div } from "../money.js";

export class CurrencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "CurrencyError";
  }
}

/**
 * Supported currencies.
 *
 * Deliberately limited to what the rate source can actually price. Frankfurter
 * serves ECB reference rates, which do NOT include AED, so listing it would
 * offer a currency whose conversions silently fail. Adding one here means
 * checking https://api.frankfurter.dev/v1/currencies first.
 *
 * All eight use 2 minor units. A zero-decimal currency such as JPY would need
 * MONEY_SCALE to become per-currency, which is why none is listed yet.
 */
export const CURRENCIES = {
  INR: { code: "INR", name: "Indian Rupee", symbol: "₹", minorUnits: 2 },
  USD: { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  GBP: { code: "GBP", name: "British Pound", symbol: "£", minorUnits: 2 },
  SGD: { code: "SGD", name: "Singapore Dollar", symbol: "S$", minorUnits: 2 },
  AUD: { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnits: 2 },
  CAD: { code: "CAD", name: "Canadian Dollar", symbol: "C$", minorUnits: 2 },
  CHF: { code: "CHF", name: "Swiss Franc", symbol: "CHF", minorUnits: 2 },
};

export const DEFAULT_CURRENCY = "INR";

export const CURRENCY_CODES = Object.keys(CURRENCIES);

/** Normalize and validate a currency code. */
export function normalizeCurrency(code, { fallback = DEFAULT_CURRENCY } = {}) {
  if (code === null || code === undefined || code === "") return fallback;

  const upper = String(code).trim().toUpperCase();
  if (!CURRENCIES[upper]) {
    throw new CurrencyError(`Unsupported currency: ${code}`);
  }
  return upper;
}

export function isSupportedCurrency(code) {
  try {
    normalizeCurrency(code, { fallback: null });
    return true;
  } catch {
    return false;
  }
}

export function currencyMeta(code) {
  return CURRENCIES[normalizeCurrency(code)] ?? null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert an amount using an explicit rate.
 *
 * The rate is always supplied by the caller rather than looked up here, so a
 * stored historical rate and a freshly fetched one go through identical code.
 *
 * @param {*} amount  in the source currency
 * @param {*} rate    units of target per 1 unit of source
 */
export function convert(amount, rate) {
  const value = toDecimal(amount);
  const r = toDecimal(rate);

  if (r.isZero() || r.isNegative()) {
    throw new CurrencyError("Exchange rate must be greater than zero");
  }

  return round(mul(value, r));
}

/** The inverse rate, for displaying a conversion in the other direction. */
export function invertRate(rate) {
  const r = toDecimal(rate);
  if (r.isZero() || r.isNegative()) {
    throw new CurrencyError("Exchange rate must be greater than zero");
  }
  return div(1, r);
}

/**
 * Build the provenance record for a converted amount.
 *
 * Returns everything needed to explain the number later, and deliberately
 * keeps the original alongside the converted value rather than replacing it.
 */
export function buildConversion({ amount, from, to, rate, at = new Date() }) {
  const source = normalizeCurrency(from);
  const target = normalizeCurrency(to);
  const original = round(toDecimal(amount));

  if (source === target) {
    // No conversion happened; record that plainly rather than storing a 1.0
    // rate that looks like a real lookup.
    return {
      originalAmount: original,
      originalCurrency: source,
      currency: target,
      amount: original,
      exchangeRate: null,
      rateAt: null,
      converted: false,
    };
  }

  const r = toDecimal(rate);
  if (r.isZero() || r.isNegative()) {
    throw new CurrencyError("Exchange rate must be greater than zero");
  }

  return {
    originalAmount: original,
    originalCurrency: source,
    currency: target,
    amount: convert(original, r),
    exchangeRate: r,
    rateAt: at,
    converted: true,
  };
}

/**
 * Re-derive the converted amount from a stored record, to verify it has not
 * drifted. Used in tests and as a data-integrity check.
 */
export function verifyConversion(record) {
  if (!record?.converted) return true;
  return convert(record.originalAmount, record.exchangeRate).equals(
    toDecimal(record.amount)
  );
}

// ---------------------------------------------------------------------------
// Mixed-currency safety
// ---------------------------------------------------------------------------

/** Every currency appearing in a ledger. */
export function currenciesIn({ expenses = [], settlements = [] } = {}) {
  const found = new Set();

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    found.add(normalizeCurrency(expense.currency));
  }
  for (const settlement of settlements) {
    found.add(normalizeCurrency(settlement.currency));
  }

  return found;
}

/** True when everything in the ledger is in one currency. */
export function isSingleCurrency(ledger) {
  return currenciesIn(ledger).size <= 1;
}

/** The single currency of a ledger, or null when it is mixed or empty. */
export function soleCurrencyOf(ledger) {
  const found = currenciesIn(ledger);
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Narrow a ledger to one currency.
 *
 * This is what makes per-currency balances possible without ever adding two
 * different currencies together.
 */
export function filterLedgerByCurrency(ledger, code) {
  const currency = normalizeCurrency(code);

  return {
    expenses: (ledger?.expenses ?? []).filter(
      (e) => normalizeCurrency(e.currency) === currency
    ),
    settlements: (ledger?.settlements ?? []).filter(
      (s) => normalizeCurrency(s.currency) === currency
    ),
  };
}

/**
 * Guard used by the balance functions.
 * Throws when a ledger mixes currencies and no specific one was requested.
 */
export function assertResolvableCurrency(ledger, requested) {
  if (requested) return normalizeCurrency(requested);

  const found = currenciesIn(ledger);
  if (found.size <= 1) return found.size === 1 ? [...found][0] : null;

  throw new CurrencyError(
    `This ledger mixes ${[...found].sort().join(", ")}. Balances must be ` +
      `calculated per currency - pass one explicitly.`
  );
}

/**
 * Pick the one currency a ledger should be reported in.
 *
 * Order: an explicit request, then the ledger's own sole currency, then the
 * viewer's preference, then the app default. Never guesses across a mixed
 * ledger - it only decides which single currency to look at.
 */
export function resolveLedgerCurrency(ledger, requested, preferred = DEFAULT_CURRENCY) {
  if (requested) return normalizeCurrency(requested);

  const sole = soleCurrencyOf(ledger);
  if (sole) return sole;

  return normalizeCurrency(preferred, { fallback: DEFAULT_CURRENCY });
}

/**
 * Narrow a ledger to one currency, but only when it actually mixes.
 *
 * Returning the ledger untouched in the common single-currency case keeps the
 * usual path allocation-free, and means a ledger whose rows predate any
 * currency data behaves exactly as before.
 */
export function scopeLedgerToCurrency(ledger, currency) {
  return currenciesIn(ledger).size > 1
    ? filterLedgerByCurrency(ledger, currency)
    : ledger;
}

/**
 * Resolve and scope in one step - what every action needs before computing a
 * balance. Returns the narrowed ledger, the currency chosen, and everything
 * available so the UI can offer a switch.
 */
export function reportLedgerIn(ledger, { requested = null, preferred = DEFAULT_CURRENCY } = {}) {
  const available = [...currenciesIn(ledger)].sort();
  const currency = resolveLedgerCurrency(ledger, requested, preferred);
  return { ledger: scopeLedgerToCurrency(ledger, currency), currency, available };
}
