import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal } from "../money.js";
import {
  CURRENCIES,
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  CurrencyError,
  normalizeCurrency,
  isSupportedCurrency,
  currencyMeta,
  convert,
  invertRate,
  buildConversion,
  verifyConversion,
  currenciesIn,
  isSingleCurrency,
  soleCurrencyOf,
  filterLedgerByCurrency,
  assertResolvableCurrency,
} from "./currency.js";
import {
  computeNetBalances,
  computeNetBalancesByCurrency,
  computePairwiseByCurrency,
  balancesSumToZero,
} from "./balances.js";

const A = "ayush";
const R = "rahul";
const f2 = (d) => d.toFixed(2);

const expense = ({ paidById, amount, shares, currency = "INR", isDeleted = false }) => ({
  paidById,
  amount,
  currency,
  isDeleted,
  splits: Object.entries(shares).map(([userId, shareAmount]) => ({
    userId,
    shareAmount,
  })),
});

describe("currency registry", () => {
  test("INR is the default", () => {
    assert.equal(DEFAULT_CURRENCY, "INR");
    assert.equal(normalizeCurrency(null), "INR");
    assert.equal(normalizeCurrency(""), "INR");
  });

  test("normalizes case and whitespace", () => {
    assert.equal(normalizeCurrency(" usd "), "USD");
    assert.equal(normalizeCurrency("eur"), "EUR");
  });

  test("rejects an unsupported currency rather than guessing", () => {
    assert.throws(() => normalizeCurrency("XYZ"), CurrencyError);
    assert.throws(() => normalizeCurrency("BTC"), CurrencyError);
    assert.ok(!isSupportedCurrency("XYZ"));
    assert.ok(isSupportedCurrency("usd"));
  });

  test("every registered currency has a symbol and minor units", () => {
    for (const code of CURRENCY_CODES) {
      const meta = CURRENCIES[code];
      assert.ok(meta.symbol, `${code} needs a symbol`);
      assert.ok(meta.name, `${code} needs a name`);
      assert.equal(typeof meta.minorUnits, "number");
    }
  });

  test("currencyMeta looks one up", () => {
    assert.equal(currencyMeta("inr").symbol, "₹");
    assert.equal(currencyMeta("USD").symbol, "$");
  });
});

describe("convert", () => {
  test("applies the rate and rounds to the minor unit", () => {
    assert.equal(f2(convert("100", "83.25")), "8325.00");
    assert.equal(f2(convert("10", "0.011")), "0.11");
  });

  test("rejects a zero or negative rate", () => {
    assert.throws(() => convert("100", "0"), CurrencyError);
    assert.throws(() => convert("100", "-1"), CurrencyError);
  });

  test("invertRate round-trips", () => {
    const rate = new Decimal("83.25");
    const back = convert(convert("100", rate), invertRate(rate));
    assert.equal(f2(back), "100.00");
  });
});

describe("buildConversion - the original is never overwritten", () => {
  test("keeps the original amount and currency alongside the converted value", () => {
    const r = buildConversion({ amount: "100", from: "USD", to: "INR", rate: "83.25" });

    assert.equal(f2(r.originalAmount), "100.00");
    assert.equal(r.originalCurrency, "USD");
    assert.equal(f2(r.amount), "8325.00");
    assert.equal(r.currency, "INR");
    assert.equal(f2(r.exchangeRate), "83.25");
    assert.ok(r.converted);
  });

  test("records the moment the rate was used", () => {
    const at = new Date("2026-04-01T00:00:00Z");
    assert.equal(buildConversion({ amount: "1", from: "USD", to: "INR", rate: "83", at }).rateAt, at);
  });

  test("same-currency records no rate rather than a fake 1.0", () => {
    const r = buildConversion({ amount: "500", from: "INR", to: "INR", rate: "1" });
    assert.equal(r.exchangeRate, null);
    assert.equal(r.rateAt, null);
    assert.ok(!r.converted);
    assert.equal(f2(r.amount), "500.00");
  });

  test("a later rate change cannot rewrite a stored conversion", () => {
    const stored = buildConversion({ amount: "100", from: "USD", to: "INR", rate: "83.25" });
    // Rates move; the record does not.
    buildConversion({ amount: "100", from: "USD", to: "INR", rate: "90.00" });
    assert.equal(f2(stored.amount), "8325.00");
    assert.equal(f2(stored.exchangeRate), "83.25");
  });

  test("verifyConversion detects drift", () => {
    const good = buildConversion({ amount: "100", from: "USD", to: "INR", rate: "83.25" });
    assert.ok(verifyConversion(good));
    assert.ok(!verifyConversion({ ...good, amount: new Decimal("9999") }));
  });

  test("rejects a bad rate", () => {
    assert.throws(
      () => buildConversion({ amount: "100", from: "USD", to: "INR", rate: "0" }),
      CurrencyError
    );
  });
});

describe("mixed-currency detection", () => {
  const inrOnly = {
    expenses: [expense({ paidById: A, amount: "100", shares: { [R]: "100" } })],
    settlements: [],
  };
  const mixed = {
    expenses: [
      expense({ paidById: A, amount: "100", shares: { [R]: "100" }, currency: "INR" }),
      expense({ paidById: A, amount: "100", shares: { [R]: "100" }, currency: "USD" }),
    ],
    settlements: [],
  };

  test("finds the currencies present", () => {
    assert.deepEqual([...currenciesIn(inrOnly)], ["INR"]);
    assert.deepEqual([...currenciesIn(mixed)].sort(), ["INR", "USD"]);
  });

  test("recognises a uniform ledger", () => {
    assert.ok(isSingleCurrency(inrOnly));
    assert.ok(!isSingleCurrency(mixed));
    assert.equal(soleCurrencyOf(inrOnly), "INR");
    assert.equal(soleCurrencyOf(mixed), null);
  });

  test("deleted expenses do not count toward the currency set", () => {
    const withDeleted = {
      expenses: [
        expense({ paidById: A, amount: "100", shares: { [R]: "100" } }),
        expense({ paidById: A, amount: "100", shares: { [R]: "100" }, currency: "USD", isDeleted: true }),
      ],
    };
    assert.ok(isSingleCurrency(withDeleted));
  });

  test("filtering narrows to one currency", () => {
    assert.equal(filterLedgerByCurrency(mixed, "USD").expenses.length, 1);
    assert.equal(filterLedgerByCurrency(mixed, "INR").expenses.length, 1);
  });
});

describe("balances never silently sum across currencies", () => {
  const mixed = {
    expenses: [
      expense({ paidById: A, amount: "100", shares: { [R]: "100" }, currency: "INR" }),
      expense({ paidById: A, amount: "100", shares: { [R]: "100" }, currency: "USD" }),
    ],
    settlements: [],
  };

  test("a mixed ledger throws rather than returning 200", () => {
    // The bug this prevents: ₹100 + $100 reported as 200 of nothing.
    assert.throws(
      () => computeNetBalances(mixed),
      (e) => e instanceof CurrencyError && /mixes INR, USD/.test(e.message)
    );
  });

  test("the error tells you what to do", () => {
    assert.throws(() => computeNetBalances(mixed), /per currency/);
  });

  test("naming a currency computes just that one", () => {
    const inr = computeNetBalances(mixed, { currency: "INR" });
    assert.equal(f2(inr.get(A)), "100.00");

    const usd = computeNetBalances(mixed, { currency: "USD" });
    assert.equal(f2(usd.get(A)), "100.00");
  });

  test("grouping returns one balance set per currency", () => {
    const byCurrency = computeNetBalancesByCurrency(mixed);
    assert.deepEqual([...byCurrency.keys()].sort(), ["INR", "USD"]);
    assert.equal(f2(byCurrency.get("INR").get(R)), "-100.00");
    assert.equal(f2(byCurrency.get("USD").get(R)), "-100.00");
  });

  test("each currency sums to zero independently", () => {
    for (const currency of ["INR", "USD"]) {
      assert.ok(balancesSumToZero(mixed, { currency }), `${currency} must balance`);
    }
  });

  test("pairwise grouping too", () => {
    const pairs = computePairwiseByCurrency(mixed);
    assert.equal(pairs.get("INR").length, 1);
    assert.equal(f2(pairs.get("INR")[0].amount), "100.00");
  });

  test("a uniform ledger still works with no currency argument", () => {
    // Every existing row is INR, so nothing about current behaviour changes.
    const inrOnly = { expenses: [mixed.expenses[0]], settlements: [] };
    assert.doesNotThrow(() => computeNetBalances(inrOnly));
    assert.equal(f2(computeNetBalances(inrOnly).get(A)), "100.00");
  });

  test("an empty ledger is safe", () => {
    assert.equal(computeNetBalances({}).size, 0);
    assert.equal(computeNetBalancesByCurrency({}).size, 0);
  });

  test("settlements in a second currency also trigger the guard", () => {
    const ledger = {
      expenses: [expense({ paidById: A, amount: "100", shares: { [R]: "100" } })],
      settlements: [{ fromUserId: R, toUserId: A, amount: "50", currency: "USD" }],
    };
    assert.throws(() => computeNetBalances(ledger), CurrencyError);
  });
});

describe("assertResolvableCurrency", () => {
  test("an explicit request always wins", () => {
    assert.equal(assertResolvableCurrency({}, "usd"), "USD");
  });

  test("a uniform ledger resolves itself", () => {
    const ledger = { expenses: [expense({ paidById: A, amount: "1", shares: { [R]: "1" } })] };
    assert.equal(assertResolvableCurrency(ledger), "INR");
  });

  test("an empty ledger resolves to null, not an error", () => {
    assert.equal(assertResolvableCurrency({}), null);
  });
});
