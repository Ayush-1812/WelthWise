import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FilterError,
  EMPTY_FILTERS,
  EXPENSE_ORDER,
  normalizeFilters,
  hasActiveFilters,
  activeFilterCount,
  accessClauseFor,
  buildExpenseWhere,
  describeFilters,
} from "./filters.js";

const ME = "me-id";
const RAHUL = "rahul-id";
const GROUP = "group-id";

/** Pull the clause matching a predicate out of the AND array. */
const clause = (where, pred) => where.AND.find(pred);

describe("normalizeFilters", () => {
  test("trims and nulls empty values", () => {
    const f = normalizeFilters({ q: "  dinner  ", groupId: "  ", category: "" });
    assert.equal(f.q, "dinner");
    assert.equal(f.groupId, null);
    assert.equal(f.category, null);
  });

  test("parses dates and amounts", () => {
    const f = normalizeFilters({
      from: "2026-04-01",
      to: "2026-04-30",
      minAmount: "100",
      maxAmount: "500.5",
    });
    assert.equal(f.from.toISOString().slice(0, 10), "2026-04-01");
    assert.equal(f.minAmount.toFixed(2), "100.00");
    assert.equal(f.maxAmount.toFixed(2), "500.50");
  });

  test("rejects an inverted date range with a clear message", () => {
    assert.throws(
      () => normalizeFilters({ from: "2026-05-01", to: "2026-04-01" }),
      (e) => e instanceof FilterError && /start date is after the end date/.test(e.message)
    );
  });

  test("rejects an inverted amount range", () => {
    assert.throws(
      () => normalizeFilters({ minAmount: "500", maxAmount: "100" }),
      (e) => e instanceof FilterError && /minimum amount is above/.test(e.message)
    );
  });

  test("rejects a negative amount", () => {
    assert.throws(() => normalizeFilters({ minAmount: "-5" }), FilterError);
  });

  test("rejects unparseable input", () => {
    assert.throws(() => normalizeFilters({ from: "not-a-date" }), FilterError);
    assert.throws(() => normalizeFilters({ minAmount: "abc" }), FilterError);
  });

  test("equal bounds are allowed", () => {
    assert.doesNotThrow(() =>
      normalizeFilters({ from: "2026-04-01", to: "2026-04-01", minAmount: "10", maxAmount: "10" })
    );
  });

  test("caps a very long search term", () => {
    assert.equal(normalizeFilters({ q: "x".repeat(500) }).q.length, 100);
  });

  test("empty input yields no filters", () => {
    assert.deepEqual(normalizeFilters({}), EMPTY_FILTERS);
    assert.deepEqual(normalizeFilters(), EMPTY_FILTERS);
  });
});

describe("hasActiveFilters / activeFilterCount", () => {
  test("nothing set", () => {
    assert.ok(!hasActiveFilters({}));
    assert.equal(activeFilterCount({}), 0);
  });

  test("counts each applied filter", () => {
    const f = normalizeFilters({ q: "cab", groupId: GROUP, minAmount: "10" });
    assert.ok(hasActiveFilters(f));
    assert.equal(activeFilterCount(f), 3);
  });
});

describe("access scoping is never optional", () => {
  test("a user is required", () => {
    assert.throws(() => buildExpenseWhere({}, null), FilterError);
    assert.throws(() => buildExpenseWhere({}, ""), FilterError);
  });

  test("the access clause is always present, even with no filters", () => {
    const where = buildExpenseWhere({}, ME);
    assert.deepEqual(where.AND[0], accessClauseFor(ME));
  });

  test("the access clause survives every filter combination", () => {
    const f = normalizeFilters({
      q: "x", groupId: GROUP, personId: RAHUL, category: "food",
      from: "2026-01-01", to: "2026-12-31", minAmount: "1", maxAmount: "9999",
      currency: "INR",
    });
    const where = buildExpenseWhere(f, ME);
    assert.deepEqual(where.AND[0], accessClauseFor(ME));
  });

  test("filtering by another person does not widen visibility", () => {
    // A person filter is ANDed, so it can only narrow the access-scoped set.
    const where = buildExpenseWhere(normalizeFilters({ personId: RAHUL }), ME);
    assert.ok(where.AND.length >= 2);
    assert.deepEqual(where.AND[0], accessClauseFor(ME));
  });

  test("deleted expenses are always excluded", () => {
    assert.equal(buildExpenseWhere({}, ME).isDeleted, false);
    assert.equal(
      buildExpenseWhere(normalizeFilters({ q: "anything" }), ME).isDeleted,
      false
    );
  });
});

describe("buildExpenseWhere - individual filters", () => {
  test("text search covers description and notes", () => {
    const where = buildExpenseWhere(normalizeFilters({ q: "dinner" }), ME);
    const c = clause(where, (x) => x.OR?.some((o) => o.description));
    assert.ok(c);
    assert.equal(c.OR[0].description.contains, "dinner");
    assert.equal(c.OR[0].description.mode, "insensitive");
    assert.ok(c.OR.some((o) => o.notes));
  });

  test("group filter", () => {
    const where = buildExpenseWhere(normalizeFilters({ groupId: GROUP }), ME);
    assert.ok(clause(where, (x) => x.groupId === GROUP));
  });

  test("person filter matches payer or participant", () => {
    const where = buildExpenseWhere(normalizeFilters({ personId: RAHUL }), ME);
    const c = clause(where, (x) => x.OR?.some((o) => o.paidById === RAHUL));
    assert.ok(c);
    assert.ok(c.OR.some((o) => o.splits?.some?.userId === RAHUL));
  });

  test("category and currency", () => {
    const where = buildExpenseWhere(
      normalizeFilters({ category: "food", currency: "INR" }),
      ME
    );
    assert.ok(clause(where, (x) => x.category === "food"));
    assert.ok(clause(where, (x) => x.currency === "INR"));
  });

  test("date range, and each bound alone", () => {
    const both = buildExpenseWhere(
      normalizeFilters({ from: "2026-04-01", to: "2026-04-30" }), ME);
    const d = clause(both, (x) => x.date);
    assert.ok(d.date.gte && d.date.lte);

    const onlyFrom = clause(
      buildExpenseWhere(normalizeFilters({ from: "2026-04-01" }), ME),
      (x) => x.date
    );
    assert.ok(onlyFrom.date.gte && onlyFrom.date.lte === undefined);
  });

  test("amount range is passed as fixed-precision strings", () => {
    const where = buildExpenseWhere(
      normalizeFilters({ minAmount: "100", maxAmount: "500" }), ME);
    const a = clause(where, (x) => x.amount);
    // Strings, not floats - the column is Decimal.
    assert.equal(a.amount.gte, "100.00");
    assert.equal(a.amount.lte, "500.00");
    assert.equal(typeof a.amount.gte, "string");
  });

  test("no filters means only access scoping and isDeleted", () => {
    const where = buildExpenseWhere({}, ME);
    assert.equal(where.AND.length, 1);
  });
});

describe("EXPENSE_ORDER", () => {
  test("newest first with a stable tiebreak for cursor paging", () => {
    assert.deepEqual(EXPENSE_ORDER, [{ date: "desc" }, { id: "desc" }]);
  });
});

describe("describeFilters", () => {
  const names = { [GROUP]: "Goa Trip", [RAHUL]: "Rahul", food: "Food" };

  test("empty when nothing is filtered", () => {
    assert.equal(describeFilters({}), "");
  });

  test("resolves ids to names rather than showing uuids", () => {
    const s = describeFilters(
      normalizeFilters({ groupId: GROUP, personId: RAHUL, category: "food" }),
      names
    );
    assert.match(s, /in Goa Trip/);
    assert.match(s, /involving Rahul/);
    assert.match(s, /categorised Food/);
    assert.ok(!s.includes(GROUP));
  });

  test("date phrasing adapts to which bounds are set", () => {
    assert.match(
      describeFilters(normalizeFilters({ from: "2026-04-01", to: "2026-04-30" })),
      /between 2026-04-01 and 2026-04-30/
    );
    assert.match(describeFilters(normalizeFilters({ from: "2026-04-01" })), /^from 2026-04-01/);
    assert.match(describeFilters(normalizeFilters({ to: "2026-04-30" })), /^up to 2026-04-30/);
  });

  test("amount phrasing adapts too", () => {
    assert.match(describeFilters(normalizeFilters({ minAmount: "100" })), /over 100.00/);
    assert.match(describeFilters(normalizeFilters({ maxAmount: "500" })), /under 500.00/);
    assert.match(
      describeFilters(normalizeFilters({ minAmount: "100", maxAmount: "500" })),
      /between 100.00 and 500.00/
    );
  });

  test("an unknown id falls back rather than rendering blank", () => {
    const s = describeFilters(normalizeFilters({ personId: "ghost" }), {});
    assert.match(s, /involving someone/);
  });

  test("never leaks a placeholder", () => {
    const s = describeFilters(
      normalizeFilters({
        q: "x", groupId: GROUP, personId: RAHUL, category: "food",
        from: "2026-01-01", to: "2026-12-31", minAmount: "1", maxAmount: "2",
        currency: "INR",
      }),
      names
    );
    assert.ok(!/undefined|null|NaN/.test(s), s);
  });
});
