import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sum } from "../money.js";
import {
  RECEIVABLE_CATEGORY,
  personalEntriesForExpense,
  personalEntryForSettlement,
  consumptionAmount,
  countsTowardSpending,
  explainPayment,
  balanceDelta,
} from "./personal.js";

const AYUSH = "ayush";
const RAHUL = "rahul";
const f2 = (d) => d.toFixed(2);

/** The worked example from task.md M12 and spec #14. */
const HOTEL = {
  myUserId: AYUSH,
  paidById: AYUSH,
  amount: "4000.00",
  myShare: "1000.00",
  description: "Hotel",
  category: "travel",
  date: new Date("2026-03-01"),
};

describe("the 4000 hotel example", () => {
  test("splits into consumption and receivable", () => {
    const entries = personalEntriesForExpense(HOTEL);
    assert.equal(entries.length, 2);

    const [consumed, lent] = entries;
    assert.equal(f2(consumed.amount), "1000.00");
    assert.equal(consumed.isTransfer, false);
    assert.equal(consumed.category, "travel");

    assert.equal(f2(lent.amount), "3000.00");
    assert.equal(lent.isTransfer, true);
    assert.equal(lent.category, RECEIVABLE_CATEGORY);
  });

  test("account balance moves by the full 4000", () => {
    assert.equal(f2(balanceDelta(personalEntriesForExpense(HOTEL))), "-4000.00");
  });

  test("personal spending counts only 1000", () => {
    const spend = sum(
      personalEntriesForExpense(HOTEL).map((e) => consumptionAmount(e))
    );
    assert.equal(f2(spend), "1000.00");
  });

  test("explainPayment keeps the three figures distinct", () => {
    const x = explainPayment({ amount: "4000", myShare: "1000" });
    assert.equal(f2(x.cashOut), "4000.00");
    assert.equal(f2(x.yourExpense), "1000.00");
    assert.equal(f2(x.recoverable), "3000.00");
  });

  test("counting the paid amount as spending would inflate by 300%", () => {
    // Guards the whole point of this module.
    const naive = 4000;
    const correct = sum(
      personalEntriesForExpense(HOTEL).map((e) => consumptionAmount(e))
    ).toNumber();
    assert.equal(correct, 1000);
    assert.equal(naive / correct, 4);
  });
});

describe("non-payers have no personal transaction", () => {
  test("a participant who did not pay records nothing", () => {
    const entries = personalEntriesForExpense({ ...HOTEL, myUserId: RAHUL });
    assert.deepEqual(entries, []);
  });

  test("no cash moved, so no balance change", () => {
    assert.ok(
      balanceDelta(personalEntriesForExpense({ ...HOTEL, myUserId: RAHUL })).isZero()
    );
  });
});

describe("edge cases", () => {
  test("paying only your own share produces one consumption row", () => {
    const entries = personalEntriesForExpense({
      ...HOTEL,
      amount: "1000.00",
      myShare: "1000.00",
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].isTransfer, false);
    assert.equal(f2(balanceDelta(entries)), "-1000.00");
  });

  test("paying with a zero share is entirely a receivable", () => {
    const entries = personalEntriesForExpense({
      ...HOTEL,
      amount: "500.00",
      myShare: "0",
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].isTransfer, true);
    assert.equal(f2(entries[0].amount), "500.00");
    assert.equal(
      f2(sum(entries.map(consumptionAmount))),
      "0.00",
      "lending money is not spending"
    );
  });

  test("an awkward share still balances to the total", () => {
    const entries = personalEntriesForExpense({
      ...HOTEL,
      amount: "100.00",
      myShare: "33.34",
    });
    assert.equal(f2(balanceDelta(entries)), "-100.00");
    assert.equal(f2(sum(entries.map(consumptionAmount))), "33.34");
  });

  test("the two legs always add back to the amount paid", () => {
    let seed = 31337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 300; i++) {
      const totalPaise = 1 + Math.floor(rand() * 500000);
      const sharePaise = Math.floor(rand() * totalPaise);
      const entries = personalEntriesForExpense({
        ...HOTEL,
        amount: (totalPaise / 100).toFixed(2),
        myShare: (sharePaise / 100).toFixed(2),
      });

      assert.equal(
        f2(sum(entries.map((e) => e.amount))),
        (totalPaise / 100).toFixed(2),
        `case ${i}: legs must add up to the payment`
      );
      assert.equal(
        f2(sum(entries.map(consumptionAmount))),
        (sharePaise / 100).toFixed(2),
        `case ${i}: consumption must equal the share`
      );
    }
  });
});

describe("settlements are never income or expense", () => {
  const base = {
    fromUserId: RAHUL,
    toUserId: AYUSH,
    amount: "3000.00",
    counterpartyName: "Rahul",
    date: new Date("2026-03-05"),
  };

  test("receiving money restores the balance but adds zero income", () => {
    const entry = personalEntryForSettlement({ ...base, myUserId: AYUSH });
    assert.equal(entry.type, "INCOME");
    assert.equal(entry.isTransfer, true);
    assert.equal(f2(balanceDelta([entry])), "3000.00");
    assert.equal(
      f2(consumptionAmount(entry)),
      "0.00",
      "a repayment is not income"
    );
    assert.equal(countsTowardSpending(entry), false);
  });

  test("paying someone back reduces the balance but is not an expense", () => {
    const entry = personalEntryForSettlement({ ...base, myUserId: RAHUL });
    assert.equal(entry.type, "EXPENSE");
    assert.equal(entry.isTransfer, true);
    assert.equal(f2(balanceDelta([entry])), "-3000.00");
    assert.equal(f2(consumptionAmount(entry)), "0.00");
  });

  test("an unrelated user records nothing", () => {
    assert.equal(
      personalEntryForSettlement({ ...base, myUserId: "someone-else" }),
      null
    );
  });

  test("a zero settlement records nothing", () => {
    assert.equal(
      personalEntryForSettlement({ ...base, myUserId: AYUSH, amount: "0" }),
      null
    );
  });
});

describe("the full round trip nets out", () => {
  test("pay 4000, get 3000 back -> balance -1000, spending 1000", () => {
    const paid = personalEntriesForExpense(HOTEL);
    const repaid = personalEntryForSettlement({
      myUserId: AYUSH,
      fromUserId: RAHUL,
      toUserId: AYUSH,
      amount: "3000.00",
      counterpartyName: "Rahul",
      date: new Date("2026-03-05"),
    });

    const all = [...paid, repaid];

    assert.equal(
      f2(balanceDelta(all)),
      "-1000.00",
      "net cash out equals what he actually consumed"
    );
    assert.equal(
      f2(sum(all.map(consumptionAmount))),
      "1000.00",
      "spending is his share, counted exactly once"
    );
  });
});

describe("consumptionAmount / countsTowardSpending", () => {
  test("a normal expense counts in full", () => {
    const t = { amount: "250.00", isTransfer: false };
    assert.equal(f2(consumptionAmount(t)), "250.00");
    assert.ok(countsTowardSpending(t));
  });

  test("a transfer counts for nothing", () => {
    const t = { amount: "250.00", isTransfer: true };
    assert.equal(f2(consumptionAmount(t)), "0.00");
    assert.ok(!countsTowardSpending(t));
  });

  test("missing input is safe", () => {
    assert.equal(f2(consumptionAmount(null)), "0.00");
    assert.ok(!countsTowardSpending(null));
  });
});
