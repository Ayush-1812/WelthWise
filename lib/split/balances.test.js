import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, allocate, sum } from "../money.js";
import {
  computeNetBalances,
  computePairwiseBalances,
  pairwiseForUser,
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

describe("computePairwiseBalances", () => {
  const dinner = expense({
    paidById: AYUSH,
    amount: "3000.00",
    shares: { [AYUSH]: "1000.00", [RAHUL]: "1000.00", [PRIYA]: "1000.00" },
  });

  const find = (pairs, from, to) =>
    pairs.find((p) => p.fromUserId === from && p.toUserId === to);

  test("participants owe the payer their own share", () => {
    const pairs = computePairwiseBalances({ expenses: [dinner] });
    assert.equal(pairs.length, 2);
    assert.equal(fixed(find(pairs, RAHUL, AYUSH).amount), "1000.00");
    assert.equal(fixed(find(pairs, PRIYA, AYUSH).amount), "1000.00");
  });

  test("the payer never owes themselves", () => {
    const pairs = computePairwiseBalances({ expenses: [dinner] });
    assert.ok(!pairs.some((p) => p.fromUserId === p.toUserId));
    assert.ok(!find(pairs, AYUSH, AYUSH));
  });

  test("a settlement reduces the pair", () => {
    const pairs = computePairwiseBalances({
      expenses: [dinner],
      settlements: [{ fromUserId: RAHUL, toUserId: AYUSH, amount: "600.00" }],
    });
    assert.equal(fixed(find(pairs, RAHUL, AYUSH).amount), "400.00");
  });

  test("a full settlement removes the pair entirely", () => {
    const pairs = computePairwiseBalances({
      expenses: [dinner],
      settlements: [{ fromUserId: RAHUL, toUserId: AYUSH, amount: "1000.00" }],
    });
    assert.equal(find(pairs, RAHUL, AYUSH), undefined);
    assert.equal(pairs.length, 1);
  });

  test("opposing debts are netted into one direction", () => {
    // Ayush paid for Rahul (Rahul owes 100); Rahul paid for Ayush (Ayush owes 30).
    const pairs = computePairwiseBalances({
      expenses: [
        expense({
          paidById: AYUSH,
          amount: "100.00",
          shares: { [RAHUL]: "100.00" },
        }),
        expense({
          paidById: RAHUL,
          amount: "30.00",
          shares: { [AYUSH]: "30.00" },
        }),
      ],
    });

    assert.equal(pairs.length, 1, "a pair must appear once, not twice");
    assert.equal(fixed(find(pairs, RAHUL, AYUSH).amount), "70.00");
  });

  test("exactly opposing debts cancel to nothing", () => {
    const pairs = computePairwiseBalances({
      expenses: [
        expense({ paidById: AYUSH, amount: "50.00", shares: { [RAHUL]: "50.00" } }),
        expense({ paidById: RAHUL, amount: "50.00", shares: { [AYUSH]: "50.00" } }),
      ],
    });
    assert.equal(pairs.length, 0);
  });

  test("over-settling flips the direction", () => {
    const pairs = computePairwiseBalances({
      expenses: [dinner],
      settlements: [{ fromUserId: RAHUL, toUserId: AYUSH, amount: "1200.00" }],
    });
    // Rahul paid 200 more than he owed, so Ayush now owes him.
    assert.equal(fixed(find(pairs, AYUSH, RAHUL).amount), "200.00");
  });

  test("deleted expenses create no debts", () => {
    const pairs = computePairwiseBalances({
      expenses: [{ ...dinner, isDeleted: true }],
    });
    assert.equal(pairs.length, 0);
  });

  test("sorted largest first", () => {
    const pairs = computePairwiseBalances({
      expenses: [
        expense({ paidById: AYUSH, amount: "100.00", shares: { [RAHUL]: "100.00" } }),
        expense({ paidById: AYUSH, amount: "500.00", shares: { [PRIYA]: "500.00" } }),
      ],
    });
    assert.equal(fixed(pairs[0].amount), "500.00");
  });
});

describe("pairwise reconciles with net balances", () => {
  /** For every user: (owed to them) - (what they owe) across pairs === net. */
  function assertReconciles(ledger, label) {
    const net = computeNetBalances(ledger);
    const pairs = computePairwiseBalances(ledger);

    const fromPairs = new Map();
    const bump = (id, delta) =>
      fromPairs.set(id, (fromPairs.get(id) ?? new Decimal(0)).plus(delta));

    for (const { fromUserId, toUserId, amount } of pairs) {
      bump(fromUserId, amount.negated());
      bump(toUserId, amount);
    }

    for (const [userId, netValue] of net.entries()) {
      const pairValue = fromPairs.get(userId) ?? new Decimal(0);
      assert.equal(
        pairValue.toFixed(2),
        netValue.toFixed(2),
        `${label}: ${userId} net ${netValue} but pairs give ${pairValue}`
      );
    }
  }

  test("the worked example reconciles", () => {
    assertReconciles(
      {
        expenses: [
          expense({
            paidById: AYUSH,
            amount: "3000.00",
            shares: { [AYUSH]: "1000.00", [RAHUL]: "1000.00", [PRIYA]: "1000.00" },
          }),
        ],
        settlements: [{ fromUserId: RAHUL, toUserId: AYUSH, amount: "600.00" }],
      },
      "worked example"
    );
  });

  test("reconciles across 300 random ledgers", () => {
    let seed = 24680;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [AYUSH, RAHUL, PRIYA, AMAN];

    for (let i = 0; i < 300; i++) {
      const expenses = [];
      const settlements = [];

      for (let e = 0; e < 1 + Math.floor(rand() * 4); e++) {
        const totalAmount = new Decimal(1 + Math.floor(rand() * 100000)).div(100);
        const count = 1 + Math.floor(rand() * people.length);
        const participants = people.slice(0, count);
        const shares = allocate(totalAmount, participants.map(() => 1));
        expenses.push(
          expense({
            paidById: people[Math.floor(rand() * people.length)],
            amount: totalAmount,
            shares: Object.fromEntries(participants.map((p, i2) => [p, shares[i2]])),
          })
        );
      }

      for (let k = 0; k < Math.floor(rand() * 3); k++) {
        const from = people[Math.floor(rand() * people.length)];
        let to = people[Math.floor(rand() * people.length)];
        if (to === from) to = people[(people.indexOf(from) + 1) % people.length];
        settlements.push({
          fromUserId: from,
          toUserId: to,
          amount: new Decimal(Math.floor(rand() * 10000)).div(100),
        });
      }

      assertReconciles({ expenses, settlements }, `case ${i}`);
    }
  });
});

describe("pairwiseForUser", () => {
  const ledger = {
    expenses: [
      expense({
        paidById: AYUSH,
        amount: "3000.00",
        shares: { [AYUSH]: "1000.00", [RAHUL]: "1000.00", [PRIYA]: "1000.00" },
      }),
      expense({
        paidById: PRIYA,
        amount: "750.00",
        shares: { [AYUSH]: "750.00" },
      }),
    ],
  };

  test("positive means they owe me", () => {
    const mine = pairwiseForUser(ledger, AYUSH);
    assert.equal(fixed(mine.get(RAHUL)), "1000.00");
  });

  test("negative means I owe them", () => {
    // Priya owes 1000 for dinner but paid 750 for Ayush -> Priya owes 250 net.
    const mine = pairwiseForUser(ledger, AYUSH);
    assert.equal(fixed(mine.get(PRIYA)), "250.00");
  });

  test("the who-owes-whom summary from the spec", () => {
    const mine = pairwiseForUser(
      {
        expenses: [
          expense({ paidById: AYUSH, amount: "500.00", shares: { [RAHUL]: "500.00" } }),
          expense({ paidById: PRIYA, amount: "750.00", shares: { [AYUSH]: "750.00" } }),
          expense({ paidById: AYUSH, amount: "300.00", shares: { [AMAN]: "300.00" } }),
        ],
      },
      AYUSH
    );

    assert.equal(fixed(mine.get(RAHUL)), "500.00", "Rahul owes you 500");
    assert.equal(fixed(mine.get(PRIYA)), "-750.00", "you owe Priya 750");
    assert.equal(fixed(mine.get(AMAN)), "300.00", "Aman owes you 300");
  });

  test("uninvolved users do not appear", () => {
    const mine = pairwiseForUser(ledger, AMAN);
    assert.equal(mine.size, 0);
  });

  test("summarizeByCounterparty over the result gives the headline totals", () => {
    const mine = pairwiseForUser(
      {
        expenses: [
          expense({ paidById: AYUSH, amount: "500.00", shares: { [RAHUL]: "500.00" } }),
          expense({ paidById: PRIYA, amount: "750.00", shares: { [AYUSH]: "750.00" } }),
        ],
      },
      AYUSH
    );
    const s = summarizeByCounterparty(mine);
    assert.equal(fixed(s.owedToYou), "500.00");
    assert.equal(fixed(s.youOwe), "750.00");
    assert.equal(fixed(s.net), "-250.00");
  });
});

describe("deleting an expense restores prior balances", () => {
  const first = expense({
    paidById: AYUSH,
    amount: "300.00",
    shares: { [AYUSH]: "100.00", [RAHUL]: "100.00", [PRIYA]: "100.00" },
  });
  const second = expense({
    paidById: RAHUL,
    amount: "150.00",
    shares: { [AYUSH]: "75.00", [RAHUL]: "75.00" },
  });

  test("net balances match the ledger without the deleted row", () => {
    const before = computeNetBalances({ expenses: [first] });
    const afterDelete = computeNetBalances({
      expenses: [first, { ...second, isDeleted: true }],
    });

    for (const id of [AYUSH, RAHUL, PRIYA]) {
      assert.equal(
        (afterDelete.get(id) ?? new Decimal(0)).toFixed(2),
        (before.get(id) ?? new Decimal(0)).toFixed(2),
        `${id} should be unchanged by the deletion`
      );
    }
  });

  test("pairwise debts match too", () => {
    const before = computePairwiseBalances({ expenses: [first] });
    const afterDelete = computePairwiseBalances({
      expenses: [first, { ...second, isDeleted: true }],
    });
    assert.deepEqual(
      afterDelete.map((p) => `${p.fromUserId}->${p.toUserId}:${p.amount.toFixed(2)}`),
      before.map((p) => `${p.fromUserId}->${p.toUserId}:${p.amount.toFixed(2)}`)
    );
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
