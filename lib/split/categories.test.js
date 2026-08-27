import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  defaultCategories,
  selectableCategories,
  expenseCategories,
  incomeCategories,
  categoryColors,
  getCategory,
  categoryName,
  categoryColor,
  isSystemCategory,
} from "../../data/categories.js";
import {
  RECEIVABLE_CATEGORY,
  SETTLEMENT_SENT_CATEGORY,
  SETTLEMENT_RECEIVED_CATEGORY,
} from "./personal.js";

describe("one shared vocabulary", () => {
  test("shared expenses and personal transactions read the same source", () => {
    // If a parallel list is ever introduced, this file is where it shows up.
    assert.ok(expenseCategories.length > 0);
    assert.ok(
      expenseCategories.every((c) =>
        defaultCategories.some((d) => d.id === c.id)
      ),
      "every selectable category must come from defaultCategories"
    );
  });

  test("every category has a unique id", () => {
    const ids = defaultCategories.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every category has a name, type and colour", () => {
    for (const c of defaultCategories) {
      assert.ok(c.name, `${c.id} needs a name`);
      assert.ok(["INCOME", "EXPENSE"].includes(c.type), `${c.id} bad type`);
      assert.match(c.color, /^#[0-9a-f]{6}$/i, `${c.id} needs a hex colour`);
    }
  });

  test("categoryColors covers every category", () => {
    for (const c of defaultCategories) {
      assert.equal(categoryColors[c.id], c.color);
    }
  });
});

describe("the categories the spec asks for (#12)", () => {
  // Food, Travel, Hotel, Transportation, Shopping, Entertainment,
  // Rent, Utilities, Groceries, Bills, Other
  const required = [
    "food",
    "travel",
    "hotel",
    "transportation",
    "shopping",
    "entertainment",
    "rent",
    "utilities",
    "groceries",
    "bills",
    "other-expense",
  ];

  for (const id of required) {
    test(`${id} exists and is selectable`, () => {
      const category = getCategory(id);
      assert.ok(category, `${id} is missing`);
      assert.equal(category.type, "EXPENSE");
      assert.ok(
        selectableCategories.some((c) => c.id === id),
        `${id} must be pickable`
      );
    });
  }
});

describe("system categories", () => {
  const systemIds = [
    RECEIVABLE_CATEGORY,
    SETTLEMENT_SENT_CATEGORY,
    SETTLEMENT_RECEIVED_CATEGORY,
  ];

  test("the split ledger's buckets exist", () => {
    for (const id of systemIds) {
      assert.ok(getCategory(id), `${id} is missing from the shared source`);
    }
  });

  test("they are flagged as system", () => {
    for (const id of systemIds) {
      assert.ok(isSystemCategory(id), `${id} must be a system category`);
    }
  });

  test("they never appear in a picker", () => {
    for (const id of systemIds) {
      assert.ok(
        !selectableCategories.some((c) => c.id === id),
        `${id} must not be selectable`
      );
      assert.ok(!expenseCategories.some((c) => c.id === id));
      assert.ok(!incomeCategories.some((c) => c.id === id));
    }
  });

  test("ordinary categories are not flagged as system", () => {
    assert.ok(!isSystemCategory("food"));
    assert.ok(!isSystemCategory("hotel"));
    assert.ok(!isSystemCategory("unknown-id"));
  });

  test("they still render with a readable name", () => {
    assert.equal(categoryName(RECEIVABLE_CATEGORY), "Paid for others");
    assert.equal(categoryName(SETTLEMENT_SENT_CATEGORY), "Settlement");
    assert.equal(categoryName(SETTLEMENT_RECEIVED_CATEGORY), "Settlement received");
  });

  test("the receivable bucket is no longer other-expense", () => {
    // It used to borrow other-expense, which mislabelled it in the ledger.
    assert.notEqual(RECEIVABLE_CATEGORY, "other-expense");
  });
});

describe("lookup helpers", () => {
  test("categoryName resolves ids to display names", () => {
    assert.equal(categoryName("food"), "Food");
    assert.equal(categoryName("other-expense"), "Other Expenses");
  });

  test("an unknown id falls back to itself rather than blank", () => {
    assert.equal(categoryName("mystery"), "mystery");
    assert.equal(categoryName(null), "Uncategorised");
    assert.equal(categoryName(undefined), "Uncategorised");
  });

  test("categoryColor always returns a usable colour", () => {
    assert.match(categoryColor("food"), /^#/);
    assert.match(categoryColor("mystery"), /^#/);
    assert.match(categoryColor(undefined), /^#/);
  });

  test("getCategory returns null for unknown ids", () => {
    assert.equal(getCategory("mystery"), null);
  });
});
