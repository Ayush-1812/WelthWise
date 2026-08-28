import "server-only";

import { toDecimal } from "../money.js";
import {
  CURRENCY_CODES,
  CurrencyError,
  normalizeCurrency,
} from "./currency.js";

/**
 * Exchange rates (M22).
 *
 * Source: Frankfurter (https://frankfurter.dev) - European Central Bank
 * reference rates, free, no API key, no account. Chosen so multi-currency works
 * out of the box rather than requiring another signup.
 *
 * Rates are cached for a day. ECB publishes once per working day, so polling
 * more often would add latency without adding accuracy.
 *
 * The whole module is best-effort: if the source is unreachable, callers get a
 * clear error and can fall back to entering the converted amount by hand. A
 * currency API being down must never block recording an expense.
 */

const RATES_ENDPOINT = "https://api.frankfurter.dev/v1/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** In-process cache: base currency -> { rates, fetchedAt }. */
const cache = new Map();

/** Exposed for tests and for a manual refresh. */
export function clearRateCache() {
  cache.clear();
}

function isFresh(entry) {
  return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Fetch every rate for a base currency, cached for a day.
 *
 * @returns {{ rates: Record<string, string>, fetchedAt: number, base: string }}
 */
export async function getRates(baseCurrency) {
  const base = normalizeCurrency(baseCurrency);

  const cached = cache.get(base);
  if (isFresh(cached)) return cached;

  // Ask only for what we support, so an upstream change cannot surprise us.
  const symbols = CURRENCY_CODES.filter((c) => c !== base).join(",");
  const url = `${RATES_ENDPOINT}?base=${base}&symbols=${symbols}`;

  let payload;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Next caches fetches aggressively; we do our own TTL.
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`rate service returned ${response.status}`);
    }
    payload = await response.json();
  } catch (error) {
    // Serve a stale cache rather than failing, if we have one.
    if (cached) {
      console.warn("[rates] using stale rates:", error.message);
      return cached;
    }
    throw new CurrencyError(
      `Could not fetch exchange rates (${error.message}). Enter the converted amount manually.`
    );
  }

  if (!payload?.rates || typeof payload.rates !== "object") {
    throw new CurrencyError("Exchange rate service returned an unexpected response");
  }

  const entry = { base, rates: payload.rates, fetchedAt: Date.now() };
  cache.set(base, entry);
  return entry;
}

/**
 * The rate from one currency to another.
 *
 * @returns {{ rate: Decimal, fetchedAt: Date, source: string }}
 */
export async function getRate(from, to) {
  const source = normalizeCurrency(from);
  const target = normalizeCurrency(to);

  if (source === target) {
    return { rate: toDecimal(1), fetchedAt: new Date(), source: "identity" };
  }

  const { rates, fetchedAt } = await getRates(source);
  const raw = rates[target];

  if (raw === undefined || raw === null) {
    throw new CurrencyError(`No exchange rate available for ${source} to ${target}`);
  }

  let rate;
  try {
    rate = toDecimal(raw);
  } catch {
    throw new CurrencyError(`Exchange rate for ${source} to ${target} was unreadable`);
  }

  if (rate.isZero() || rate.isNegative()) {
    throw new CurrencyError(`Exchange rate for ${source} to ${target} is invalid`);
  }

  return { rate, fetchedAt: new Date(fetchedAt), source: "frankfurter" };
}

/** Whether rates are currently available, for the UI to decide what to show. */
export async function ratesAvailable(baseCurrency) {
  try {
    await getRates(baseCurrency);
    return true;
  } catch {
    return false;
  }
}
