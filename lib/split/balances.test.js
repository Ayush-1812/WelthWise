import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, allocate, sum } from "../money.js";
import {
  computeNetBalances,
  netBalanceFor,
  balancesSumToZero,
  summarize,
  summarizeByCounterparty,
} from "./balances.js";

const AYUSH = "ayush";
const RAHUL = "rahul";
const PRIYA = "priya";
const AMAN = "aman";

const expense = ({ paidById, amount, shares, isDeleted = false }) => ({
  paidById,
  amount,
  isDeleted,
  splits: Object.entries(shares).map(([userId, shareAmount]) => ({
    userId,
    shareAmount,
  })),
});

const fixed = (d) => d.toFixed(2);

describe("the worked example from task.md", () => {
  const dinner = expense({
    paidById: AYUSH,
    amount: "3000.00",
    shares: { [AYUSH]: "1000.00", [RAHUL]: "1000.00", [PRIYA]: "1000.00" },
  });

  test("payer is owed what they fronted minus their own share", () => {
    const net = computeNetBalances({ expenses: [dinner] });
    assert.equal(fixed(net.get(AYUSH)), "2000.00");
    assert.equal(fixed(net.get(RAHUL)), "-1000.00");
    assert.equal(fixed(net.get(PRIYA)), "-1000.00");
  });

  test("a non-participant has no balance", () => {
    const net = computeNetBalances({ expenses: [dinner] });
    assert.equal(net.get(AMAN), undefined);
    assert.equal(fixed(netBalanceFor({ expenses: [dinner] }, AMAN)), "0.00");
  });

  test("balances sum to zero", () => {
    assert.ok(balancesSumToZero({ expenses: [dinner] }));
  });

  test("Rahul settles 600 -> he owes 400, Ayush is owed 1400", () => {
    const ledger = {
      expenses: [dinner],
      settlements: [{ fromUserId: RAHUL, toUserId: AYUSH, amount: "600.00" }],
    };
    const net = computeNetBalances(ledger);

    assert.equal(fixed(net.get(RAHUL)), "-400.00");
    assert.equal(fixed(net.get(AYUSH)), "1400.00");
    assert.equal(fixed(net.get(PRIYA)), "-1000.00");
    assert.ok(balancesSumToZero(ledger), "still sums to zero after settlement");
  });

  test("full settlement clears the debt exactly", () => {
    const ledger = {
      expenses: [dinner],
      settlements: [
        { fromUserId: RAHUL, toUserId: AYUSH, amount: "1000.00" },
        { fromUserId: PRIYA, toUserId: AYUSH, amount: "1000.00" },
      ],
    };
    const net = computeNetBalances(ledger);

    assert.ok(net.get(RAHUL).isZero());
    assert.ok(net.get(PRIYA).isZero());
    assert.ok(net.get(AYUSH).isZero());
  });
});

describe("deleted expenses", () => {
  const live = expense({
    paidById: AYUSH,
    amount: "100.00",
    shares: { [AYUSH]: "50.00", [RAHUL]: "50.00" },
  });

  test("a deleted expense contributes nothing", () => {
    const deleted = { ...live, isDeleted: true };
    const net = computeNetBalances({ expenses: [deleted] });
    assert.equal(net.size, 0);
  });

  test("deleting fully reverses the effect on every balance", () => {
    const before = computeNetBalances({ expenses: [] });
    const after = computeNetBalances({
      expenses: [{ ...live, isDeleted: true }],
    });
    assert.equal(before.size, after.size);
    assert.ok(balancesSumToZero({ expenses: [{ ...live, isDeleted: true }] }));
  });
});

describe("sum-to-zero invariant", () => {
  test("holds for an awkward three-way split", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    const ledger = {
      expenses: [
        expense({
          paidById: AYUSH,
          amount: "100.00",
          shares: {
            [AYUSH]: parts[0],
            [RAHUL]: parts[1],
            [PRIYA]: parts[2],
          },
        }),
      ],
    };
    assert.ok(balancesSumToZero(ledger));
  });

  test("holds across many random ledgers", () => {
    let seed = 4242;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [AYUSH, RAHUL, PRIYA, AMAN];

    for (let i = 0; i < 300; i++) {
      const expenses = [];
      const settlements = [];

      const n = 1 + Math.floor(rand() * 4);
      for (let e = 0; e < n; e++) {
        const total = new Decimal(Math.floor(rand() * 100000)).div(100);
        const count = 1 + Math.floor(rand() * people.length);
        const participants = people.slice(0, count);
        const shares = allocate(total, participants.map(() => 1));

        expenses.push(
          expense({
            paidById: people[Math.floor(rand() * people.length)],
            amount: total,
            shares: Object.fromEntries(
              participants.map((p, idx) => [p, shares[idx]])
            ),
          })
        );
      }

      const s = Math.floor(rand() * 3);
      for (let k = 0; k < s; k++) {
        const from = people[Math.floor(rand() * people.length)];
        let to = people[Math.floor(rand() * people.length)];
        if (to === from) to = people[(people.indexOf(from) + 1) % people.length];
        settlements.push({
          fromUserId: from,
          toUserId: to,
          amount: new Decimal(Math.floor(rand() * 10000)).div(100),
        });
      }

      const ledger = { expenses, settlements };
      assert.ok(
        balancesSumToZero(ledger),
        `case ${i}: total was ${sum([...computeNetBalances(ledger).values()])}`
      );
    }
  });

  test("an inconsistent expense is detectable - splits not matching the total", () => {
    const broken = {
      paidById: AYUSH,
      amount: "100.00",
      isDeleted: false,
      splits: [
        { userId: AYUSH, shareAmount: "50.00" },
        { userId: RAHUL, shareAmount: "40.00" }, // 10 short
      ],
    };
    assert.ok(!balancesSumToZero({ expenses: [broken] }));
  });
});

describe("summarize", () => {
  const ledger = {
    expenses: [
      expense({
        paidById: AYUSH,
        amount: "300.00",
        shares: { [AYUSH]: "100.00", [RAHUL]: "100.00", [PRIYA]: "100.00" },
      }),
    ],
  };

  test("a creditor is owed and owes nothing", () => {
    const s = summarize(ledger, AYUSH);
    assert.equal(fixed(s.owedToYou), "200.00");
    assert.equal(fixed(s.youOwe), "0.00");
    assert.ok(!s.isSettled);
  });

  test("a debtor owes and is owed nothing", () => {
    const s = summarize(ledger, RAHUL);
    assert.equal(fixed(s.youOwe), "100.00");
    assert.equal(fixed(s.owedToYou), "0.00");
  });

  test("someone uninvolved is settled", () => {
    assert.ok(summarize(ledger, AMAN).isSettled);
  });
});

describe("summarizeByCounterparty", () => {
  test("does not net opposing balances against each other", () => {
    // Owed 500 by one person, owing 300 to another.
    const perCounterparty = new Map([
      [RAHUL, new Decimal("500.00")],
      [PRIYA, new Decimal("-300.00")],
    ]);
    const s = summarizeByCounterparty(perCounterparty);

    assert.equal(fixed(s.owedToYou), "500.00");
    assert.equal(fixed(s.youOwe), "300.00");
    assert.equal(fixed(s.net), "200.00");
  });

  test("settled counterparties contribute nothing", () => {
    const s = summarizeByCounterparty(new Map([[RAHUL, new Decimal(0)]]));
    assert.equal(fixed(s.owedToYou), "0.00");
    assert.equal(fixed(s.youOwe), "0.00");
  });

  test("empty map is all zeroes", () => {
    const s = summarizeByCounterparty(new Map());
    assert.ok(s.net.isZero());
  });
});

describe("empty and malformed input", () => {
  test("no ledger yields no balances", () => {
    assert.equal(computeNetBalances().size, 0);
    assert.equal(computeNetBalances({}).size, 0);
    assert.ok(balancesSumToZero({}));
  });

  test("an expense with no splits still credits the payer", () => {
    const net = computeNetBalances({
      expenses: [{ paidById: AYUSH, amount: "50.00", isDeleted: false }],
    });
    assert.equal(fixed(net.get(AYUSH)), "50.00");
  });
});
