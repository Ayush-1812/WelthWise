import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, sum, allocate } from "../money.js";
import { computeNetBalances, computePairwiseBalances } from "./balances.js";
import {
  SimplifyError,
  simplifyDebts,
  balancesFromPayments,
  preservesBalances,
  comparePlans,
  buildSettlementPlan,
} from "./simplify.js";

const A = "alice";
const B = "bob";
const C = "carl";
const D = "dana";

const f2 = (d) => d.toFixed(2);
const net = (obj) =>
  new Map(Object.entries(obj).map(([k, v]) => [k, new Decimal(v)]));
const describePayments = (ps) =>
  ps.map((p) => `${p.fromUserId}->${p.toUserId}:${f2(p.amount)}`);

describe("the task.md example", () => {
  test("A owes B 500, B owes C 500 -> one payment A->C 500", () => {
    // Net: A -500, B 0, C +500
    const payments = simplifyDebts(net({ [A]: "-500", [B]: "0", [C]: "500" }));

    assert.equal(payments.length, 1);
    assert.deepEqual(describePayments(payments), [`${A}->${C}:500.00`]);
  });

  test("B drops out entirely - they were only a middleman", () => {
    const payments = simplifyDebts(net({ [A]: "-500", [B]: "0", [C]: "500" }));
    assert.ok(!payments.some((p) => p.fromUserId === B || p.toUserId === B));
  });

  test("two payments become one", () => {
    const before = [
      { fromUserId: A, toUserId: B, amount: new Decimal("500") },
      { fromUserId: B, toUserId: C, amount: new Decimal("500") },
    ];
    const plan = buildSettlementPlan(
      net({ [A]: "-500", [B]: "0", [C]: "500" }),
      before
    );

    assert.equal(plan.comparison.before, 2);
    assert.equal(plan.comparison.after, 1);
    assert.equal(plan.comparison.saved, 1);
    assert.ok(plan.comparison.worthwhile);
    assert.ok(plan.verified);
  });
});

describe("balances are preserved exactly", () => {
  test("the dinner scenario", () => {
    // Ayush paid 3000 split 3 ways.
    const balances = net({ [A]: "2000", [B]: "-1000", [C]: "-1000" });
    const payments = simplifyDebts(balances);

    assert.ok(preservesBalances(balances, payments));
    assert.equal(payments.length, 2, "two debtors, one creditor");
  });

  test("everyone ends in the same position", () => {
    const balances = net({ [A]: "300", [B]: "-100", [C]: "-500", [D]: "300" });
    const payments = simplifyDebts(balances);
    const implied = balancesFromPayments(payments);

    for (const [id, before] of balances) {
      assert.equal(
        f2(implied.get(id) ?? new Decimal(0)),
        f2(before),
        `${id} must end up unchanged`
      );
    }
  });

  test("payments themselves sum to zero", () => {
    const payments = simplifyDebts(
      net({ [A]: "300", [B]: "-100", [C]: "-500", [D]: "300" })
    );
    assert.ok(sum([...balancesFromPayments(payments).values()]).isZero());
  });
});

describe("transaction count never increases", () => {
  test("at most n-1 payments for n involved people", () => {
    const balances = net({ [A]: "300", [B]: "-100", [C]: "-500", [D]: "300" });
    const payments = simplifyDebts(balances);
    assert.ok(payments.length <= 3, `got ${payments.length}`);
  });

  test("a circular debt collapses to nothing", () => {
    // A owes B, B owes C, C owes A - all 100. Everyone nets to zero.
    const payments = simplifyDebts(net({ [A]: "0", [B]: "0", [C]: "0" }));
    assert.deepEqual(payments, []);
  });

  test("an already-minimal plan is not made worse", () => {
    const balances = net({ [A]: "-100", [B]: "100" });
    const payments = simplifyDebts(balances);
    assert.equal(payments.length, 1);
    assert.deepEqual(describePayments(payments), [`${A}->${B}:100.00`]);
  });
});

describe("edge cases", () => {
  test("empty input", () => {
    assert.deepEqual(simplifyDebts(new Map()), []);
    assert.deepEqual(simplifyDebts([]), []);
    assert.deepEqual(simplifyDebts(null), []);
  });

  test("everyone settled", () => {
    assert.deepEqual(simplifyDebts(net({ [A]: "0", [B]: "0" })), []);
  });

  test("accepts an array of entries as well as a Map", () => {
    const payments = simplifyDebts([
      [A, "-250"],
      [B, "250"],
    ]);
    assert.deepEqual(describePayments(payments), [`${A}->${B}:250.00`]);
  });

  test("rejects balances that do not sum to zero", () => {
    assert.throws(
      () => simplifyDebts(net({ [A]: "-500", [B]: "400" })),
      (e) => e instanceof SimplifyError && /do not sum to zero/.test(e.message)
    );
  });

  test("the error names the discrepancy", () => {
    assert.throws(
      () => simplifyDebts(net({ [A]: "-500", [B]: "400" })),
      /off by -100.00/
    );
  });

  test("does not mutate the input", () => {
    const balances = net({ [A]: "-500", [B]: "500" });
    simplifyDebts(balances);
    assert.equal(f2(balances.get(A)), "-500.00");
    assert.equal(f2(balances.get(B)), "500.00");
  });

  test("awkward amounts settle exactly", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    // A paid 100, split 3 ways: A is owed the other two shares.
    const balances = net({
      [A]: parts[1].plus(parts[2]).toFixed(2),
      [B]: parts[1].negated().toFixed(2),
      [C]: parts[2].negated().toFixed(2),
    });
    const payments = simplifyDebts(balances);
    assert.ok(preservesBalances(balances, payments));
    assert.ok(sum(payments.map((p) => p.amount)).equals(parts[1].plus(parts[2])));
  });

  test("is deterministic", () => {
    const balances = net({ [A]: "300", [B]: "-100", [C]: "-500", [D]: "300" });
    assert.deepEqual(
      describePayments(simplifyDebts(balances)),
      describePayments(simplifyDebts(balances))
    );
  });
});

describe("comparePlans", () => {
  test("reports the saving", () => {
    const c = comparePlans([1, 2, 3, 4], [1, 2]);
    assert.equal(c.before, 4);
    assert.equal(c.after, 2);
    assert.equal(c.saved, 2);
    assert.ok(c.worthwhile);
  });

  test("not worthwhile when nothing is saved", () => {
    assert.ok(!comparePlans([1], [1]).worthwhile);
    assert.equal(comparePlans([1], [1]).saved, 0);
  });

  test("never reports a negative saving", () => {
    assert.equal(comparePlans([1], [1, 2]).saved, 0);
  });
});

describe("property test: 500 random ledgers", () => {
  test("balances preserved, count never increases, sums exact", () => {
    let seed = 8675309;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [A, B, C, D, "e", "f"];

    for (let i = 0; i < 500; i++) {
      // Build a real ledger so the balances are guaranteed to sum to zero.
      const expenses = [];
      for (let e = 0; e < 1 + Math.floor(rand() * 5); e++) {
        const amount = new Decimal(1 + Math.floor(rand() * 200000)).div(100);
        const count = 1 + Math.floor(rand() * people.length);
        const participants = people.slice(0, count);
        const shares = allocate(amount, participants.map(() => 1));
        expenses.push({
          id: `e${e}`,
          paidById: people[Math.floor(rand() * people.length)],
          amount,
          isDeleted: false,
          splits: participants.map((p, idx) => ({
            userId: p,
            shareAmount: shares[idx],
          })),
        });
      }

      const ledger = { expenses, settlements: [] };
      const balances = computeNetBalances(ledger);
      const pairs = computePairwiseBalances(ledger);

      const plan = buildSettlementPlan(balances, pairs);

      assert.ok(
        plan.verified,
        `case ${i}: simplified plan changed someone's balance`
      );
      assert.ok(
        preservesBalances(balances, plan.payments),
        `case ${i}: balances not preserved`
      );
      assert.ok(
        plan.payments.length <= pairs.length || pairs.length === 0,
        `case ${i}: ${plan.payments.length} payments vs ${pairs.length} pairs`
      );

      const involved = [...balances.values()].filter((v) => !v.isZero()).length;
      assert.ok(
        plan.payments.length <= Math.max(0, involved - 1),
        `case ${i}: expected at most ${involved - 1} payments, got ${plan.payments.length}`
      );

      for (const p of plan.payments) {
        assert.ok(!p.amount.isNegative(), `case ${i}: negative payment`);
        assert.ok(!p.amount.isZero(), `case ${i}: zero payment`);
        assert.notEqual(p.fromUserId, p.toUserId, `case ${i}: self-payment`);
      }
    }
  });
});
