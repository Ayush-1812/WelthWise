import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, allocate, sum } from "../money.js";
import {
  totalSpending,
  spendingByCategory,
  spendingByMember,
  spendingOverTime,
  userTotals,
  buildAnalytics,
} from "./analytics.js";

const A = "ayush";
const R = "rahul";
const P = "priya";
const f2 = (d) => d.toFixed(2);

const expense = ({
  paidById,
  amount,
  shares,
  category = "food",
  date = "2026-04-15",
  isDeleted = false,
}) => ({
  paidById,
  amount,
  category,
  date: new Date(date),
  isDeleted,
  splits: Object.entries(shares).map(([userId, shareAmount]) => ({
    userId,
    shareAmount,
  })),
});

describe("totalSpending - never inflated by settlements", () => {
  test("sums expense amounts only", () => {
    const expenses = [
      expense({ paidById: A, amount: "3000.00", shares: { [A]: "1000", [R]: "1000", [P]: "1000" } }),
      expense({ paidById: R, amount: "500.00", shares: { [A]: "500" } }),
    ];
    assert.equal(f2(totalSpending(expenses)), "3500.00");
  });

  test("excludes deleted expenses", () => {
    const expenses = [
      expense({ paidById: A, amount: "1000.00", shares: { [A]: "1000" } }),
      expense({ paidById: A, amount: "5000.00", shares: { [A]: "5000" }, isDeleted: true }),
    ];
    assert.equal(f2(totalSpending(expenses)), "1000.00");
  });

  test("a repayment must never inflate this figure", () => {
    // totalSpending takes no settlements argument at all - the type system
    // itself prevents a settlement from being summed in here.
    const expenses = [expense({ paidById: A, amount: "1000.00", shares: { [A]: "1000" } })];
    assert.equal(f2(totalSpending(expenses)), "1000.00");
  });

  test("empty is zero", () => {
    assert.ok(totalSpending([]).isZero());
    assert.ok(totalSpending().isZero());
  });
});

describe("spendingByCategory", () => {
  test("groups and sums by category", () => {
    const expenses = [
      expense({ paidById: A, amount: "300", shares: { [A]: "300" }, category: "food" }),
      expense({ paidById: A, amount: "200", shares: { [A]: "200" }, category: "food" }),
      expense({ paidById: A, amount: "1000", shares: { [A]: "1000" }, category: "hotel" }),
    ];
    const result = spendingByCategory(expenses);
    assert.equal(result.length, 2);
    assert.equal(result[0].category, "hotel"); // largest first
    assert.equal(f2(result[0].amount), "1000.00");
    assert.equal(f2(result.find((r) => r.category === "food").amount), "500.00");
  });

  test("sorted largest first", () => {
    const expenses = [
      expense({ paidById: A, amount: "10", shares: { [A]: "10" }, category: "small" }),
      expense({ paidById: A, amount: "1000", shares: { [A]: "1000" }, category: "big" }),
    ];
    assert.equal(spendingByCategory(expenses)[0].category, "big");
  });

  test("excludes deleted expenses", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "100" }, category: "food" }),
      expense({ paidById: A, amount: "9999", shares: { [A]: "9999" }, category: "food", isDeleted: true }),
    ];
    assert.equal(f2(spendingByCategory(expenses)[0].amount), "100.00");
  });

  test("empty ledger yields no categories", () => {
    assert.deepEqual(spendingByCategory([]), []);
  });
});

describe("spendingByMember - share, not amount fronted", () => {
  test("a payer who ate a normal portion does not top the list", () => {
    // Ayush fronts 3000 for a group dinner but his own share is only 1000 -
    // the same as everyone else. "Who spent the most" must reflect that.
    const expenses = [
      expense({
        paidById: A,
        amount: "3000.00",
        shares: { [A]: "1000.00", [R]: "1000.00", [P]: "1000.00" },
      }),
    ];
    const result = spendingByMember(expenses);
    const amounts = result.map((r) => f2(r.amount));
    assert.deepEqual(new Set(amounts), new Set(["1000.00"]));
  });

  test("someone who ate more shows up higher", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "70", [R]: "30" } }),
    ];
    const result = spendingByMember(expenses);
    assert.equal(result[0].userId, A);
    assert.equal(f2(result[0].amount), "70.00");
  });

  test("sums across multiple expenses", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "50", [R]: "50" } }),
      expense({ paidById: R, amount: "200", shares: { [A]: "100", [R]: "100" } }),
    ];
    const byId = Object.fromEntries(spendingByMember(expenses).map((r) => [r.userId, f2(r.amount)]));
    assert.equal(byId[A], "150.00");
    assert.equal(byId[R], "150.00");
  });

  test("excludes deleted expenses", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "100" } }),
      expense({ paidById: A, amount: "9999", shares: { [A]: "9999" }, isDeleted: true }),
    ];
    assert.equal(f2(spendingByMember(expenses)[0].amount), "100.00");
  });
});

describe("spendingOverTime", () => {
  test("buckets by month by default", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "100" }, date: "2026-04-05" }),
      expense({ paidById: A, amount: "200", shares: { [A]: "200" }, date: "2026-04-20" }),
      expense({ paidById: A, amount: "50", shares: { [A]: "50" }, date: "2026-05-01" }),
    ];
    const result = spendingOverTime(expenses);
    assert.deepEqual(
      result.map((r) => r.period),
      ["2026-04", "2026-05"]
    );
    assert.equal(f2(result[0].amount), "300.00");
  });

  test("buckets by day", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "100" }, date: "2026-04-05" }),
      expense({ paidById: A, amount: "200", shares: { [A]: "200" }, date: "2026-04-05" }),
    ];
    const result = spendingOverTime(expenses, { bucket: "day" });
    assert.equal(result.length, 1);
    assert.equal(result[0].period, "2026-04-05");
    assert.equal(f2(result[0].amount), "300.00");
  });

  test("buckets by week, starting Sunday", () => {
    // 2026-04-15 is a Wednesday; the week should start 2026-04-12 (Sunday).
    const expenses = [expense({ paidById: A, amount: "100", shares: { [A]: "100" }, date: "2026-04-15" })];
    assert.equal(spendingOverTime(expenses, { bucket: "week" })[0].period, "2026-04-12");
  });

  test("results are chronologically sorted", () => {
    const expenses = [
      expense({ paidById: A, amount: "1", shares: { [A]: "1" }, date: "2026-06-01" }),
      expense({ paidById: A, amount: "1", shares: { [A]: "1" }, date: "2026-01-01" }),
      expense({ paidById: A, amount: "1", shares: { [A]: "1" }, date: "2026-03-01" }),
    ];
    assert.deepEqual(
      spendingOverTime(expenses).map((r) => r.period),
      ["2026-01", "2026-03", "2026-06"]
    );
  });

  test("empty buckets are omitted, not zero-padded", () => {
    const expenses = [expense({ paidById: A, amount: "1", shares: { [A]: "1" }, date: "2026-01-01" })];
    assert.equal(spendingOverTime(expenses).length, 1);
  });

  test("excludes deleted expenses", () => {
    const expenses = [
      expense({ paidById: A, amount: "100", shares: { [A]: "100" }, date: "2026-04-01" }),
      expense({ paidById: A, amount: "9999", shares: { [A]: "9999" }, date: "2026-04-01", isDeleted: true }),
    ];
    assert.equal(f2(spendingOverTime(expenses)[0].amount), "100.00");
  });
});

describe("userTotals - the four figures never conflated", () => {
  test("the M12 worked example: paid 4000, share 1000", () => {
    const ledger = {
      expenses: [
        expense({
          paidById: A,
          amount: "4000.00",
          shares: { [A]: "1000.00", [R]: "1500.00", [P]: "1500.00" },
        }),
      ],
      settlements: [],
    };
    const t = userTotals(A, ledger);

    assert.equal(f2(t.totalPaid), "4000.00", "cash out is the full amount");
    assert.equal(f2(t.totalSpent), "1000.00", "consumption is only their share");
    assert.equal(f2(t.totalOwedToThem), "3000.00", "the other 3000 is a receivable");
  });

  test("totalPaid does NOT shrink when money comes back", () => {
    const ledger = {
      expenses: [expense({ paidById: A, amount: "1000", shares: { [A]: "500", [R]: "500" } })],
      settlements: [{ fromUserId: R, toUserId: A, amount: "500" }],
    };
    const t = userTotals(A, ledger);
    assert.equal(f2(t.totalPaid), "1000.00", "the cash really did go out");
    assert.equal(f2(t.totalRecovered), "500.00");
    assert.ok(t.totalOwedToThem.isZero(), "fully repaid, nothing outstanding");
  });

  test("totalTheyOwe reflects a debtor's position", () => {
    const ledger = {
      expenses: [expense({ paidById: R, amount: "1000", shares: { [A]: "300", [R]: "700" } })],
      settlements: [],
    };
    const t = userTotals(A, ledger);
    assert.ok(t.totalPaid.isZero());
    assert.equal(f2(t.totalSpent), "300.00");
    assert.equal(f2(t.totalTheyOwe), "300.00");
    assert.ok(t.totalOwedToThem.isZero());
  });

  test("delegates owed/owing to the canonical balance functions, not a second formula", () => {
    // If this ever diverges from pairwiseForUser, the two are out of sync.
    const ledger = {
      expenses: [
        expense({ paidById: A, amount: "900", shares: { [A]: "300", [R]: "300", [P]: "300" } }),
        expense({ paidById: P, amount: "300", shares: { [A]: "300" } }),
      ],
      settlements: [{ fromUserId: R, toUserId: A, amount: "100" }],
    };

    const t = userTotals(A, ledger);
    // Rahul: owes 300 - 100 settled = 200. Priya paid 300 for Ayush, Ayush owes
    // her 300 for his dinner share -> nets to 0 between them.
    assert.equal(f2(t.totalOwedToThem), "200.00");
    assert.equal(f2(t.totalTheyOwe), "0.00");
  });

  test("someone with no activity gets all zeros, not undefined", () => {
    const t = userTotals("nobody", { expenses: [], settlements: [] });
    assert.ok(t.totalPaid.isZero());
    assert.ok(t.totalSpent.isZero());
    assert.ok(t.totalRecovered.isZero());
    assert.ok(t.totalOwedToThem.isZero());
    assert.ok(t.totalTheyOwe.isZero());
  });

  test("deleted expenses do not count toward paid or spent", () => {
    const ledger = {
      expenses: [expense({ paidById: A, amount: "5000", shares: { [A]: "5000" }, isDeleted: true })],
      settlements: [],
    };
    const t = userTotals(A, ledger);
    assert.ok(t.totalPaid.isZero());
    assert.ok(t.totalSpent.isZero());
  });

  test("missing ledger fields default safely", () => {
    assert.doesNotThrow(() => userTotals(A, {}));
    assert.doesNotThrow(() => userTotals(A));
  });
});

describe("buildAnalytics", () => {
  test("assembles every aggregate for a scope", () => {
    const ledger = {
      expenses: [
        expense({ paidById: A, amount: "1000", shares: { [A]: "500", [R]: "500" }, category: "food", date: "2026-04-01" }),
        expense({ paidById: R, amount: "2000", shares: { [A]: "1000", [R]: "1000" }, category: "hotel", date: "2026-05-01" }),
      ],
    };

    const result = buildAnalytics(ledger);

    assert.equal(f2(result.totalSpending), "3000.00");
    assert.equal(result.byCategory.length, 2);
    assert.equal(result.byMember.length, 2);
    assert.equal(result.overTime.length, 2);
    assert.equal(result.expenseCount, 2);
  });

  test("an empty ledger produces a well-formed empty result", () => {
    const result = buildAnalytics({});
    assert.ok(result.totalSpending.isZero());
    assert.deepEqual(result.byCategory, []);
    assert.deepEqual(result.byMember, []);
    assert.deepEqual(result.overTime, []);
    assert.equal(result.expenseCount, 0);
  });

  test("expenseCount excludes deleted rows", () => {
    const ledger = {
      expenses: [
        expense({ paidById: A, amount: "1", shares: { [A]: "1" } }),
        expense({ paidById: A, amount: "1", shares: { [A]: "1" }, isDeleted: true }),
      ],
    };
    assert.equal(buildAnalytics(ledger).expenseCount, 1);
  });
});

describe("property test: category + member totals both reconcile with totalSpending", () => {
  test("across 200 random ledgers", () => {
    let seed = 909090;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [A, R, P];
    const categories = ["food", "hotel", "travel"];

    for (let i = 0; i < 200; i++) {
      const expenses = [];
      const n = 1 + Math.floor(rand() * 6);

      for (let e = 0; e < n; e++) {
        const total = new Decimal(1 + Math.floor(rand() * 500000)).div(100);
        const count = 1 + Math.floor(rand() * people.length);
        const participants = people.slice(0, count);
        const shares = allocate(total, participants.map(() => 1));

        expenses.push(
          expense({
            paidById: people[Math.floor(rand() * people.length)],
            amount: total,
            shares: Object.fromEntries(participants.map((p, idx) => [p, shares[idx]])),
            category: categories[Math.floor(rand() * categories.length)],
          })
        );
      }

      const spending = totalSpending(expenses);
      const byCategory = sum(spendingByCategory(expenses).map((r) => r.amount));
      const byMember = sum(spendingByMember(expenses).map((r) => r.amount));

      assert.equal(
        byCategory.toFixed(2),
        spending.toFixed(2),
        `case ${i}: category totals must reconcile with total spending`
      );
      assert.equal(
        byMember.toFixed(2),
        spending.toFixed(2),
        `case ${i}: member shares must reconcile with total spending`
      );
    }
  });
});
