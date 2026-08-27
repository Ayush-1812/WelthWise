import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal } from "../money.js";
import {
  SETTLEMENT_METHODS,
  SettlementError,
  settlementDirection,
  validateSettlement,
  assertValidSettlement,
  fullSettlementAmount,
  describeOutcome,
} from "./settlements.js";

const AYUSH = "ayush";
const RAHUL = "rahul";

const f2 = (d) => d.toFixed(2);

describe("settlementDirection", () => {
  test("a positive balance means they pay me", () => {
    // Rahul owes Ayush 1000.
    const d = settlementDirection("1000.00", AYUSH, RAHUL);
    assert.equal(d.fromUserId, RAHUL);
    assert.equal(d.toUserId, AYUSH);
    assert.equal(f2(d.outstanding), "1000.00");
  });

  test("a negative balance means I pay them", () => {
    const d = settlementDirection("-750.00", AYUSH, RAHUL);
    assert.equal(d.fromUserId, AYUSH);
    assert.equal(d.toUserId, RAHUL);
    assert.equal(f2(d.outstanding), "750.00");
  });

  test("a zero balance has no direction", () => {
    assert.equal(settlementDirection(0, AYUSH, RAHUL), null);
    assert.equal(settlementDirection(null, AYUSH, RAHUL), null);
  });
});

describe("validateSettlement - the task.md example", () => {
  const base = { fromUserId: RAHUL, toUserId: AYUSH, method: "UPI" };

  test("Rahul owes 1000 and pays 600 -> 400 remaining", () => {
    const r = validateSettlement({ ...base, amount: "600", outstanding: "1000" });
    assert.ok(r.ok);
    assert.equal(f2(r.amount), "600.00");
    assert.equal(f2(r.remaining), "400.00");
    assert.equal(r.isFull, false);
  });

  test("paying the full 1000 clears it", () => {
    const r = validateSettlement({ ...base, amount: "1000", outstanding: "1000" });
    assert.ok(r.ok);
    assert.ok(r.remaining.isZero());
    assert.equal(r.isFull, true);
  });

  test("paying the remaining 400 afterwards clears it", () => {
    const r = validateSettlement({ ...base, amount: "400", outstanding: "400" });
    assert.ok(r.ok);
    assert.equal(r.isFull, true);
  });
});

describe("validateSettlement - rejections", () => {
  const base = { fromUserId: RAHUL, toUserId: AYUSH, outstanding: "1000", method: "CASH" };

  test("rejects more than is outstanding", () => {
    const r = validateSettlement({ ...base, amount: "1500" });
    assert.ok(!r.ok);
    assert.match(r.error, /more than the 1000.00 outstanding/);
  });

  test("rejects one paisa over", () => {
    assert.ok(!validateSettlement({ ...base, amount: "1000.01" }).ok);
  });

  test("rejects zero", () => {
    const r = validateSettlement({ ...base, amount: "0" });
    assert.ok(!r.ok);
    assert.match(r.error, /greater than zero/);
  });

  test("rejects a negative amount", () => {
    const r = validateSettlement({ ...base, amount: "-100" });
    assert.ok(!r.ok);
    assert.match(r.error, /cannot be negative/);
  });

  test("rejects settling with yourself", () => {
    const r = validateSettlement({
      ...base,
      fromUserId: AYUSH,
      toUserId: AYUSH,
      amount: "100",
    });
    assert.ok(!r.ok);
    assert.match(r.error, /with yourself/);
  });

  test("rejects a missing party", () => {
    assert.ok(!validateSettlement({ ...base, fromUserId: null, amount: "100" }).ok);
    assert.ok(!validateSettlement({ ...base, toUserId: "", amount: "100" }).ok);
  });

  test("rejects when nothing is outstanding", () => {
    const r = validateSettlement({ ...base, outstanding: "0", amount: "100" });
    assert.ok(!r.ok);
    assert.match(r.error, /nothing outstanding/);
  });

  test("rejects an unknown payment method", () => {
    const r = validateSettlement({ ...base, amount: "100", method: "CRYPTO" });
    assert.ok(!r.ok);
    assert.match(r.error, /how the payment was made/);
  });

  test("accepts every declared method", () => {
    for (const { value } of SETTLEMENT_METHODS) {
      assert.ok(
        validateSettlement({ ...base, amount: "100", method: value }).ok,
        `${value} should be accepted`
      );
    }
  });

  test("rejects unparseable input", () => {
    assert.ok(!validateSettlement({ ...base, amount: "abc" }).ok);
    assert.ok(!validateSettlement({ ...base, amount: null }).ok);
  });
});

describe("precision", () => {
  test("sub-paisa amounts are rounded, not rejected outright", () => {
    const r = validateSettlement({
      fromUserId: RAHUL,
      toUserId: AYUSH,
      amount: "100.004",
      outstanding: "1000",
      method: "UPI",
    });
    assert.ok(r.ok);
    assert.equal(f2(r.amount), "100.00");
  });

  test("an awkward remainder settles exactly", () => {
    const r = validateSettlement({
      fromUserId: RAHUL,
      toUserId: AYUSH,
      amount: "33.33",
      outstanding: "33.33",
      method: "UPI",
    });
    assert.ok(r.ok);
    assert.ok(r.remaining.isZero());
  });
});

describe("assertValidSettlement", () => {
  test("throws on invalid input", () => {
    assert.throws(
      () =>
        assertValidSettlement({
          fromUserId: RAHUL,
          toUserId: AYUSH,
          amount: "5000",
          outstanding: "100",
          method: "UPI",
        }),
      SettlementError
    );
  });

  test("returns the result when valid", () => {
    const r = assertValidSettlement({
      fromUserId: RAHUL,
      toUserId: AYUSH,
      amount: "50",
      outstanding: "100",
      method: "UPI",
    });
    assert.equal(f2(r.remaining), "50.00");
  });
});

describe("fullSettlementAmount", () => {
  test("is the magnitude of the balance in either direction", () => {
    assert.equal(f2(fullSettlementAmount("1000")), "1000.00");
    assert.equal(f2(fullSettlementAmount("-1000")), "1000.00");
    assert.equal(f2(fullSettlementAmount(0)), "0.00");
    assert.equal(f2(fullSettlementAmount(null)), "0.00");
  });
});

describe("describeOutcome", () => {
  test("names the remainder", () => {
    assert.match(describeOutcome({ amount: "600", outstanding: "1000" }), /400.00/);
  });

  test("says when it clears", () => {
    assert.match(
      describeOutcome({ amount: "1000", outstanding: "1000" }),
      /clears the balance/
    );
  });

  test("flags an overpayment", () => {
    assert.match(
      describeOutcome({ amount: "1200", outstanding: "1000" }),
      /more than is outstanding/
    );
  });
});

describe("settling never invents money", () => {
  test("amount + remaining always equals the original outstanding", () => {
    let seed = 5150;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 500; i++) {
      const owedPaise = 1 + Math.floor(rand() * 1_000_00);
      const owed = new Decimal(owedPaise).div(100);
      const payPaise = 1 + Math.floor(rand() * owedPaise);
      const pay = new Decimal(payPaise).div(100);

      const r = validateSettlement({
        fromUserId: RAHUL,
        toUserId: AYUSH,
        amount: pay,
        outstanding: owed,
        method: "UPI",
      });

      assert.ok(r.ok, `case ${i}: ${r.error}`);
      assert.equal(
        r.amount.plus(r.remaining).toFixed(2),
        owed.toFixed(2),
        `case ${i}: paid + remaining must equal the original debt`
      );
      assert.ok(!r.remaining.isNegative(), `case ${i}: remaining went negative`);
    }
  });
});
