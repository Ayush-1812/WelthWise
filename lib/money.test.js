import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  Decimal,
  MoneyError,
  MONEY_SCALE,
  DEFAULT_CURRENCY,
  toDecimal,
  round,
  add,
  sub,
  mul,
  div,
  sum,
  equals,
  isZero,
  isNegative,
  compare,
  abs,
  negate,
  allocate,
  allocateEqual,
  checkSum,
  serializeMoney,
  formatMoney,
} from "./money.js";

const dec = (v) => new Decimal(v);
const strs = (arr) => arr.map((d) => d.toFixed(MONEY_SCALE));

describe("the regression this module exists to prevent", () => {
  test("summing Decimals with + concatenates (documents the original bug)", () => {
    // This is what actions/account.js used to do. Kept as a guard so nobody
    // "simplifies" the helpers back into plain arithmetic.
    const broken = [dec("100.50"), dec("50.25")].reduce((a, b) => (a || 0) + b, 0);
    assert.equal(typeof broken, "string");
    assert.equal(broken, "0100.550.25");
  });

  test("sum() adds them correctly", () => {
    const fixed = sum([dec("100.50"), dec("50.25")]);
    assert.ok(fixed instanceof Decimal);
    assert.equal(fixed.toFixed(2), "150.75");
  });
});

describe("toDecimal", () => {
  test("accepts strings, numbers and Decimals", () => {
    assert.equal(toDecimal("10.25").toFixed(2), "10.25");
    assert.equal(toDecimal(10.25).toFixed(2), "10.25");
    assert.equal(toDecimal(dec("10.25")).toFixed(2), "10.25");
  });

  test("returns the same instance for a Decimal", () => {
    const d = dec("1.00");
    assert.equal(toDecimal(d), d);
  });

  for (const bad of [null, undefined, "", NaN, Infinity, -Infinity, "abc", {}, []]) {
    test(`rejects ${JSON.stringify(bad) ?? String(bad)}`, () => {
      assert.throws(() => toDecimal(bad), MoneyError);
    });
  }
});

describe("arithmetic", () => {
  test("add / sub / mul / div return Decimals", () => {
    assert.equal(add("0.1", "0.2").toFixed(2), "0.30");
    assert.equal(sub("1.00", "0.99").toFixed(2), "0.01");
    assert.equal(mul("3", "1.5").toFixed(2), "4.50");
    assert.equal(div("10", "4").toFixed(2), "2.50");
  });

  test("0.1 + 0.2 is exact, unlike float math", () => {
    assert.notEqual(0.1 + 0.2, 0.3); // JS floats
    assert.ok(equals(add("0.1", "0.2"), "0.3")); // Decimal
  });

  test("div by zero throws", () => {
    assert.throws(() => div("1", "0"), MoneyError);
  });

  test("sum of an empty list is zero", () => {
    assert.ok(isZero(sum([])));
    assert.ok(isZero(sum(undefined)));
  });

  test("comparison helpers", () => {
    assert.ok(equals("1.10", dec("1.10")));
    assert.ok(!equals("1.10", "1.11"));
    assert.ok(isNegative("-0.01"));
    assert.ok(!isNegative("0"));
    assert.equal(compare("2", "1"), 1);
    assert.equal(compare("1", "2"), -1);
    assert.equal(compare("1", "1"), 0);
    assert.equal(abs("-5.25").toFixed(2), "5.25");
    assert.equal(negate("5.25").toFixed(2), "-5.25");
  });
});

describe("round", () => {
  test("half-up at the minor unit", () => {
    assert.equal(round("1.005").toFixed(2), "1.01");
    assert.equal(round("1.004").toFixed(2), "1.00");
    assert.equal(round("2.675").toFixed(2), "2.68"); // the classic float trap
  });
});

describe("allocate - the cases from task.md", () => {
  test("100 across 3 equal weights", () => {
    const parts = allocate(100, [1, 1, 1]);
    assert.deepEqual(strs(parts), ["33.34", "33.33", "33.33"]);
    assert.equal(sum(parts).toFixed(2), "100.00");
  });

  test("0.03 across 3 equal weights", () => {
    const parts = allocate("0.03", [1, 1, 1]);
    assert.deepEqual(strs(parts), ["0.01", "0.01", "0.01"]);
    assert.equal(sum(parts).toFixed(2), "0.03");
  });

  test("3000 dinner across 3 of 4 members", () => {
    const parts = allocate(3000, [1, 1, 1]);
    assert.deepEqual(strs(parts), ["1000.00", "1000.00", "1000.00"]);
  });

  test("weighted shares", () => {
    const parts = allocate(100, [2, 1, 1]);
    assert.deepEqual(strs(parts), ["50.00", "25.00", "25.00"]);
  });

  test("percentage-style weights", () => {
    const parts = allocate(250, [50, 30, 20]);
    assert.deepEqual(strs(parts), ["125.00", "75.00", "50.00"]);
  });

  test("a zero weight gets a zero share", () => {
    const parts = allocate(100, [1, 1, 0]);
    assert.deepEqual(strs(parts), ["50.00", "50.00", "0.00"]);
  });

  test("single participant takes the whole total", () => {
    assert.deepEqual(strs(allocate("77.77", [1])), ["77.77"]);
  });

  test("negative total (refund) still sums exactly", () => {
    const parts = allocate(-100, [1, 1, 1]);
    assert.deepEqual(strs(parts), ["-33.34", "-33.33", "-33.33"]);
    assert.equal(sum(parts).toFixed(2), "-100.00");
  });

  test("zero total splits into zeros", () => {
    const parts = allocate(0, [1, 1, 1]);
    assert.equal(sum(parts).toFixed(2), "0.00");
  });

  test("deterministic - same input, same output", () => {
    const a = strs(allocate("10.01", [1, 1, 1]));
    const b = strs(allocate("10.01", [1, 1, 1]));
    assert.deepEqual(a, b);
  });

  test("leftover goes to the earliest index on ties", () => {
    assert.deepEqual(strs(allocate("0.01", [1, 1])), ["0.01", "0.00"]);
  });

  test("rejects bad input", () => {
    assert.throws(() => allocate(100, []), MoneyError);
    assert.throws(() => allocate(100, [0, 0]), MoneyError);
    assert.throws(() => allocate(100, [1, -1]), MoneyError);
    assert.throws(() => allocate(100, "nope"), MoneyError);
  });
});

describe("allocateEqual", () => {
  test("splits n ways exactly", () => {
    assert.deepEqual(strs(allocateEqual(100, 3)), ["33.34", "33.33", "33.33"]);
    assert.equal(allocateEqual(100, 7).length, 7);
    assert.equal(sum(allocateEqual(100, 7)).toFixed(2), "100.00");
  });

  test("rejects a non-positive or non-integer count", () => {
    assert.throws(() => allocateEqual(100, 0), MoneyError);
    assert.throws(() => allocateEqual(100, -1), MoneyError);
    assert.throws(() => allocateEqual(100, 2.5), MoneyError);
  });
});

describe("allocate - property test (task.md: 1000 random cases)", () => {
  test("output always sums to the input, exactly", () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 20260826;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 1000; i++) {
      const cents = Math.floor(rand() * 10_000_00); // up to 10 lakh
      const total = dec(cents).div(100);
      const n = 1 + Math.floor(rand() * 12);
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rand() * 20));

      const parts = allocate(total, weights);

      assert.equal(parts.length, n, `case ${i}: wrong part count`);
      assert.equal(
        sum(parts).toFixed(MONEY_SCALE),
        total.toFixed(MONEY_SCALE),
        `case ${i}: total=${total} weights=${weights}`
      );
      for (const p of parts) {
        assert.ok(!p.isNegative(), `case ${i}: negative share from positive total`);
        assert.equal(
          p.toFixed(MONEY_SCALE),
          p.toDecimalPlaces(MONEY_SCALE).toFixed(MONEY_SCALE),
          `case ${i}: share exceeds minor-unit precision`
        );
      }
    }
  });

  test("no share differs from another equal-weight share by more than one minor unit", () => {
    for (let cents = 1; cents <= 200; cents++) {
      const parts = allocateEqual(dec(cents).div(100), 3);
      const max = parts.reduce((a, b) => (a.greaterThan(b) ? a : b));
      const min = parts.reduce((a, b) => (a.lessThan(b) ? a : b));
      assert.ok(
        max.minus(min).lessThanOrEqualTo("0.01"),
        `spread too wide at ${cents} paise: ${strs(parts)}`
      );
    }
  });
});

describe("checkSum", () => {
  test("passes when parts match the total", () => {
    const r = checkSum(100, allocate(100, [1, 1, 1]));
    assert.ok(r.ok);
    assert.ok(r.difference.isZero());
  });

  test("fails on a shortfall and reports the difference", () => {
    const r = checkSum(100, ["33.33", "33.33", "33.33"]);
    assert.ok(!r.ok);
    assert.equal(r.difference.toFixed(2), "-0.01");
  });

  test("fails on an overage", () => {
    const r = checkSum(100, ["50.00", "50.01"]);
    assert.ok(!r.ok);
    assert.equal(r.difference.toFixed(2), "0.01");
  });

  test("rejects percentages that sum to 99.99", () => {
    assert.ok(!checkSum(100, ["33.33", "33.33", "33.33"]).ok);
  });

  test("empty parts against a non-zero total fails", () => {
    assert.ok(!checkSum(100, []).ok);
  });
});

describe("serializeMoney", () => {
  test("converts a Decimal to a number", () => {
    assert.equal(serializeMoney(dec("10.50")), 10.5);
  });

  test("walks nested objects and arrays", () => {
    const row = {
      id: "abc",
      amount: dec("1000.00"),
      splits: [{ userId: "u1", shareAmount: dec("333.34") }],
      nested: { balance: dec("-25.00") },
    };
    assert.deepEqual(serializeMoney(row), {
      id: "abc",
      amount: 1000,
      splits: [{ userId: "u1", shareAmount: 333.34 }],
      nested: { balance: -25 },
    });
  });

  test("leaves Dates, null and primitives alone", () => {
    const d = new Date("2026-08-26T00:00:00Z");
    assert.equal(serializeMoney(d), d);
    assert.equal(serializeMoney(null), null);
    assert.equal(serializeMoney(undefined), undefined);
    assert.equal(serializeMoney("text"), "text");
    assert.equal(serializeMoney(42), 42);
    assert.equal(serializeMoney(true), true);
  });

  test("converts a foreign Decimal too (Prisma bundles its own copy)", () => {
    // Shaped like a Prisma Decimal: same duck type, different class identity.
    const foreign = {
      toNumber: () => 42.5,
      toFixed: (n) => (42.5).toFixed(n),
      toString: () => "42.5",
    };
    assert.equal(serializeMoney(foreign), 42.5);
    assert.equal(typeof serializeMoney({ amount: foreign }).amount, "number");
  });

  test("output survives JSON round-tripping (the Client Component boundary)", () => {
    const out = serializeMoney({ amount: dec("99.99") });
    assert.deepEqual(JSON.parse(JSON.stringify(out)), { amount: 99.99 });
  });
});

describe("formatMoney", () => {
  test("defaults to INR", () => {
    assert.equal(DEFAULT_CURRENCY, "INR");
    const s = formatMoney(1000);
    assert.ok(s.includes("1,000.00"), s);
    assert.ok(s.includes("₹"), s);
  });

  test("renders other currencies", () => {
    assert.ok(formatMoney(1000, "USD").includes("1,000.00"));
    assert.ok(formatMoney(1000, "GBP").includes("1,000.00"));
  });

  test("always shows exactly two minor digits", () => {
    assert.ok(formatMoney("5").includes("5.00"));
    assert.ok(formatMoney("5.5").includes("5.50"));
  });

  test("accepts Decimal input", () => {
    assert.ok(formatMoney(dec("1234.56")).includes("1,234.56"));
  });
});
