import Decimal from "decimal.js";
import {
  MONEY_SCALE,
  DEFAULT_CURRENCY,
  CURRENCY_LOCALES,
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
} from "./format.js";

/**
 * Money primitives for the Split Expenses ledger.
 *
 * Every monetary calculation in the feature MUST go through this module.
 * Nothing else should import Decimal directly.
 *
 * Why this exists: Decimal.prototype.valueOf() returns a *string*, so plain
 * JS arithmetic silently concatenates instead of adding.
 *
 *   0 + new Decimal("100.50") + new Decimal("50.25")  ->  "0100.550.25"
 *
 * That exact bug already shipped in actions/account.js. This module makes it
 * impossible to reintroduce.
 */

// Pinned so results are identical on the server and in the browser, rather
// than depending on whatever default the environment happens to carry.
Decimal.set({ precision: 34, toExpNeg: -18, toExpPos: 30 });

/** Smallest representable amount (one paisa / cent) at MONEY_SCALE. */
export const MINOR_UNIT = new Decimal(1).div(new Decimal(10).pow(MONEY_SCALE));

class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Normalize a string | number | Decimal into a Decimal.
 * Rejects NaN, Infinity, null and unparseable input rather than propagating them.
 */
export function toDecimal(value) {
  if (value instanceof Decimal) return value;

  if (value === null || value === undefined || value === "") {
    throw new MoneyError(`Not a monetary value: ${JSON.stringify(value)}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new MoneyError(`Not a finite number: ${value}`);
  }

  // Prisma bundles its own copy of decimal.js, so a Decimal read from the
  // database is NOT an instanceof ours. Round-trip it through its string form,
  // which is exact and copy-independent.
  if (
    typeof value === "object" &&
    typeof value.toFixed === "function" &&
    typeof value.toString === "function"
  ) {
    try {
      return new Decimal(value.toString());
    } catch {
      throw new MoneyError(`Cannot parse as money: ${String(value)}`);
    }
  }

  try {
    const d = new Decimal(value);
    if (!d.isFinite()) throw new MoneyError(`Not a finite value: ${value}`);
    return d;
  } catch (error) {
    if (error instanceof MoneyError) throw error;
    throw new MoneyError(`Cannot parse as money: ${JSON.stringify(value)}`);
  }
}

/** Round to MONEY_SCALE using half-up, the convention users expect for currency. */
export function round(value) {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function add(a, b) {
  return toDecimal(a).plus(toDecimal(b));
}

export function sub(a, b) {
  return toDecimal(a).minus(toDecimal(b));
}

export function mul(a, b) {
  return toDecimal(a).times(toDecimal(b));
}

export function div(a, b) {
  const divisor = toDecimal(b);
  if (divisor.isZero()) throw new MoneyError("Division by zero");
  return toDecimal(a).div(divisor);
}

/** Sum a list. Returns Decimal(0) for an empty list. */
export function sum(values) {
  return (values ?? []).reduce((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Exact comparison. Never use === on Decimal. */
export function equals(a, b) {
  return toDecimal(a).equals(toDecimal(b));
}

export function isZero(value) {
  return toDecimal(value).isZero();
}

export function isNegative(value) {
  return toDecimal(value).isNegative();
}

export function compare(a, b) {
  return toDecimal(a).comparedTo(toDecimal(b));
}

export function abs(value) {
  return toDecimal(value).abs();
}

export function negate(value) {
  return toDecimal(value).negated();
}

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Uses largest-remainder (Hamilton) allocation: floor every share to the minor
 * unit, then hand the leftover units out one at a time in descending order of
 * fractional remainder, breaking ties by original index so the result is
 * deterministic.
 *
 *   allocate(100, [1, 1, 1])  ->  [33.34, 33.33, 33.33]   (sums to 100)
 *   allocate(0.03, [1, 1, 1]) ->  [0.01, 0.01, 0.01]
 *
 * Handles negative totals (refunds) by allocating the magnitude and flipping
 * the sign, so the exact-sum guarantee holds in both directions.
 *
 * @param {string|number|Decimal} total
 * @param {Array<string|number|Decimal>} weights - non-negative, not all zero
 * @returns {Decimal[]} same length as weights, guaranteed to sum to total
 */
export function allocate(total, weights) {
  const totalDec = round(total);

  if (!Array.isArray(weights) || weights.length === 0) {
    throw new MoneyError("allocate() requires at least one weight");
  }

  const weightDecs = weights.map((w) => {
    const d = toDecimal(w);
    if (d.isNegative()) throw new MoneyError("Weights must be non-negative");
    return d;
  });

  const weightTotal = sum(weightDecs);
  if (weightTotal.isZero()) {
    throw new MoneyError("Weights must not all be zero");
  }

  // Work in positive space so rounding behaves symmetrically for refunds.
  const negative = totalDec.isNegative();
  const magnitude = totalDec.abs();

  // Express everything in whole minor units to keep the arithmetic integral.
  const scale = new Decimal(10).pow(MONEY_SCALE);
  const totalMinor = magnitude.times(scale); // already rounded, so integral

  const exact = weightDecs.map((w) => totalMinor.times(w).div(weightTotal));
  const floors = exact.map((e) => e.floor());

  const distributed = sum(floors);
  let remainder = totalMinor.minus(distributed); // 0 <= remainder < weights.length

  // Hand out leftover minor units to the largest fractional remainders first.
  const order = exact
    .map((e, index) => ({ index, frac: e.minus(e.floor()) }))
    .sort((a, b) => {
      const cmp = b.frac.comparedTo(a.frac);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const resultMinor = [...floors];
  for (const { index } of order) {
    if (remainder.lessThanOrEqualTo(0)) break;
    resultMinor[index] = resultMinor[index].plus(1);
    remainder = remainder.minus(1);
  }

  return resultMinor.map((m) => {
    const value = m.div(scale);
    return negative ? value.negated() : value;
  });
}

/**
 * Split `total` equally `count` ways, summing to exactly `total`.
 * The leftover minor unit goes to the earliest participant - callers that want
 * it to land on the payer should order that participant first.
 */
export function allocateEqual(total, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new MoneyError(`Participant count must be a positive integer, got ${count}`);
  }
  return allocate(total, new Array(count).fill(1));
}

/**
 * Assert that a set of parts sums to the expected total.
 * This is the gate every ledger write passes through - never auto-correct a
 * mismatch, surface it.
 *
 * @returns {{ ok: boolean, expected: Decimal, actual: Decimal, difference: Decimal }}
 */
export function checkSum(expectedTotal, parts) {
  const expected = round(expectedTotal);
  const actual = round(sum(parts));
  const difference = actual.minus(expected);
  return { ok: difference.isZero(), expected, actual, difference };
}

/**
 * Convert Decimal values to Numbers for passing to Client Components.
 * Next.js cannot serialize Decimal across the server/client boundary.
 *
 * Walks plain objects and arrays; leaves Dates and other class instances alone.
 */
export function serializeMoney(input) {
  if (input === null || input === undefined) return input;
  if (input instanceof Decimal) return input.toNumber();
  if (Array.isArray(input)) return input.map(serializeMoney);
  if (input instanceof Date) return input;

  // Prisma's Decimal is a different copy of decimal.js, so instanceof misses
  // it. Without this, database Decimals would reach Client Components and
  // Next.js would refuse to serialize them.
  if (
    typeof input === "object" &&
    typeof input.toNumber === "function" &&
    typeof input.toFixed === "function"
  ) {
    return input.toNumber();
  }

  if (typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype) {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = serializeMoney(value);
    }
    return out;
  }

  // Prisma model rows are plain objects, but be tolerant of null-prototype rows.
  if (typeof input === "object" && Object.getPrototypeOf(input) === null) {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = serializeMoney(value);
    }
    return out;
  }

  return input;
}

// Formatting lives in ./format.js so Client Components can import it without
// dragging the Prisma runtime into the browser bundle. Re-exported here so
// server-side callers have a single import for all money concerns.
export {
  MONEY_SCALE,
  DEFAULT_CURRENCY,
  CURRENCY_LOCALES,
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
};

export { Decimal, MoneyError };
