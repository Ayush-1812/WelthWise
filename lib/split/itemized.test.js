import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, sum } from "../money.js";
import {
  ItemizedError,
  emptyItem,
  normalizeItems,
  itemsTotal,
  checkItemsTotal,
  computeItemizedSplit,
  itemsForUser,
  draftItemsFromScan,
} from "./itemized.js";

const A = "ayush";
const R = "rahul";
const P = "priya";
const ALL = [A, R, P];

const f2 = (d) => d.toFixed(2);
const byId = (splits) =>
  Object.fromEntries(splits.map((s) => [s.userId, f2(s.shareAmount)]));

describe("the point of itemizing: you pay for what you ate", () => {
  test("each person pays only their own items", () => {
    const splits = computeItemizedSplit({
      total: "600.00",
      participantIds: ALL,
      items: [
        { name: "Biryani", amount: "300.00", assignedTo: [A] },
        { name: "Paneer", amount: "200.00", assignedTo: [R] },
        { name: "Lassi", amount: "100.00", assignedTo: [P] },
      ],
    });

    assert.deepEqual(byId(splits), {
      [A]: "300.00",
      [R]: "200.00",
      [P]: "100.00",
    });
  });

  test("a shared item is divided among only its eaters", () => {
    const splits = computeItemizedSplit({
      total: "300.00",
      participantIds: ALL,
      items: [
        { name: "Pizza", amount: "200.00", assignedTo: [A, R] },
        { name: "Juice", amount: "100.00", assignedTo: [P] },
      ],
    });

    assert.deepEqual(byId(splits), {
      [A]: "100.00",
      [R]: "100.00",
      [P]: "100.00",
    });
  });

  test("a participant who ate nothing pays nothing", () => {
    const splits = computeItemizedSplit({
      total: "200.00",
      participantIds: ALL,
      items: [{ name: "Pizza", amount: "200.00", assignedTo: [A, R] }],
    });

    assert.equal(byId(splits)[P], "0.00");
  });
});

describe("no paisa is lost", () => {
  test("a three-way item splits exactly", () => {
    const splits = computeItemizedSplit({
      total: "10.00",
      participantIds: ALL,
      items: [{ name: "Dish", amount: "10.00", assignedTo: ALL }],
    });

    assert.deepEqual(Object.values(byId(splits)).sort(), ["3.33", "3.33", "3.34"]);
    assert.equal(f2(sum(splits.map((s) => s.shareAmount))), "10.00");
  });

  test("rounding does not accumulate across many awkward items", () => {
    // Ten items of 10.00 split three ways: a naive implementation drifts.
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `Item ${i + 1}`,
      amount: "10.00",
      assignedTo: ALL,
    }));

    const splits = computeItemizedSplit({
      total: "100.00",
      participantIds: ALL,
      items,
    });

    assert.equal(f2(sum(splits.map((s) => s.shareAmount))), "100.00");
  });

  test("property test: 300 random item sets sum exactly", () => {
    let seed = 606060;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 300; i++) {
      const items = [];
      const count = 1 + Math.floor(rand() * 8);

      for (let k = 0; k < count; k++) {
        const paise = 1 + Math.floor(rand() * 50000);
        const eaters = ALL.filter(() => rand() > 0.35);
        items.push({
          name: `i${k}`,
          amount: new Decimal(paise).div(100).toFixed(2),
          assignedTo: eaters.length > 0 ? eaters : [ALL[0]],
        });
      }

      const total = itemsTotal(items);
      const splits = computeItemizedSplit({
        total,
        participantIds: ALL,
        items,
      });

      assert.equal(
        f2(sum(splits.map((s) => s.shareAmount))),
        f2(total),
        `case ${i}: splits must sum to the item total`
      );
      for (const s of splits) {
        assert.ok(!s.shareAmount.isNegative(), `case ${i}: negative share`);
      }
    }
  });
});

describe("items must reconcile with the expense total", () => {
  const items = [{ name: "Pizza", amount: "200.00", assignedTo: [A] }];

  test("rejects an item total under the expense", () => {
    assert.throws(
      () => computeItemizedSplit({ total: "300.00", participantIds: ALL, items }),
      (e) => e instanceof ItemizedError && /100.00 under the total of 300.00/.test(e.message)
    );
  });

  test("rejects an item total over the expense", () => {
    assert.throws(
      () => computeItemizedSplit({ total: "150.00", participantIds: ALL, items }),
      (e) => e instanceof ItemizedError && /50.00 over/.test(e.message)
    );
  });

  test("checkItemsTotal reports the live remainder without throwing", () => {
    const r = checkItemsTotal("300.00", items);
    assert.ok(!r.ok);
    assert.equal(f2(r.difference), "-100.00");
    assert.equal(f2(r.actual), "200.00");
  });

  test("checkItemsTotal is ok when they match", () => {
    assert.ok(checkItemsTotal("200.00", items).ok);
  });

  test("a junk total is reported, not thrown", () => {
    assert.equal(checkItemsTotal("abc", items).ok, false);
  });
});

describe("validation", () => {
  test("rejects an empty item list", () => {
    assert.throws(() => normalizeItems([]), ItemizedError);
    assert.throws(() => normalizeItems(null), ItemizedError);
  });

  test("rejects an unnamed item", () => {
    assert.throws(
      () => normalizeItems([{ name: "  ", amount: "10", assignedTo: [A] }]),
      (e) => /Item 1 needs a name/.test(e.message)
    );
  });

  test("rejects a zero or negative amount", () => {
    for (const amount of ["0", "-5"]) {
      assert.throws(
        () => normalizeItems([{ name: "x", amount, assignedTo: [A] }]),
        ItemizedError
      );
    }
  });

  test("rejects an unparseable amount, naming the item", () => {
    assert.throws(
      () => normalizeItems([{ name: "Pizza", amount: "abc", assignedTo: [A] }]),
      (e) => /Item 1 \("Pizza"\) needs a valid amount/.test(e.message)
    );
  });

  test("rejects an unassigned item, naming it", () => {
    assert.throws(
      () => normalizeItems([{ name: "Pizza", amount: "10", assignedTo: [] }]),
      (e) => /Nobody is assigned to "Pizza"/.test(e.message)
    );
  });

  test("deduplicates assignees", () => {
    const [item] = normalizeItems([{ name: "x", amount: "10", assignedTo: [A, A, R] }]);
    assert.deepEqual(item.assignedTo, [A, R]);
  });

  test("rejects assigning someone who is not on the expense", () => {
    assert.throws(
      () =>
        computeItemizedSplit({
          total: "10.00",
          participantIds: [A, R],
          items: [{ name: "Pizza", amount: "10.00", assignedTo: ["stranger"] }],
        }),
      (e) => /not part of this expense/.test(e.message)
    );
  });

  test("rejects an empty participant list", () => {
    assert.throws(
      () =>
        computeItemizedSplit({
          total: "10.00",
          participantIds: [],
          items: [{ name: "x", amount: "10.00", assignedTo: [A] }],
        }),
      ItemizedError
    );
  });

  test("emptyItem is a blank row", () => {
    assert.deepEqual(emptyItem(), { name: "", amount: "", assignedTo: [] });
  });
});

describe("itemsForUser", () => {
  const items = [
    { name: "Pizza", amount: "200.00", assignedTo: [A, R] },
    { name: "Juice", amount: "90.00", assignedTo: [P] },
  ];

  test("lists only the items that person is paying for", () => {
    const mine = itemsForUser(items, A);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "Pizza");
    assert.equal(f2(mine[0].yourShare), "100.00");
    assert.equal(mine[0].sharedWith, 2);
  });

  test("returns nothing for someone who ate nothing", () => {
    assert.deepEqual(itemsForUser(items, "nobody"), []);
  });
});

describe("draftItemsFromScan (OCR half)", () => {
  test("turns scanned lines into unassigned drafts", () => {
    const draft = draftItemsFromScan({
      items: [
        { name: "Biryani", amount: 300 },
        { description: "Lassi", price: "80.50" },
      ],
    });

    assert.equal(draft.length, 2);
    assert.equal(draft[0].name, "Biryani");
    assert.equal(draft[1].amount, "80.50");
  });

  test("nothing is auto-assigned - a human decides who ate what", () => {
    const draft = draftItemsFromScan({ items: [{ name: "x", amount: 10 }] });
    assert.deepEqual(draft[0].assignedTo, []);
  });

  test("drops unusable lines instead of producing junk items", () => {
    const draft = draftItemsFromScan({
      items: [
        { name: "", amount: 10 },
        { name: "Valid", amount: 10 },
        { name: "Bad", amount: "not-a-number" },
        { name: "Zero", amount: 0 },
        { name: "Negative", amount: -5 },
      ],
    });
    assert.equal(draft.length, 1);
    assert.equal(draft[0].name, "Valid");
  });

  test("a scan with no items yields an empty draft, never throws", () => {
    assert.deepEqual(draftItemsFromScan({}), []);
    assert.deepEqual(draftItemsFromScan(null), []);
    assert.deepEqual(draftItemsFromScan({ items: "nonsense" }), []);
  });
});
