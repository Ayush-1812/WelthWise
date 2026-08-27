import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_TYPES,
  ACTIVITY_ICONS,
  nameResolver,
  describeActivity,
  isExpenseActivity,
  groupByDay,
} from "./activity.js";

const AYUSH = "ayush-id";
const RAHUL = "rahul-id";
const PRIYA = "priya-id";

const USERS = [
  { id: AYUSH, name: "Ayush" },
  { id: RAHUL, name: "Rahul" },
  { id: PRIYA, name: "Priya" },
];

/** Viewed by a third party, so nobody is "you". */
const asOutsider = { viewerId: "someone-else", nameOf: nameResolver({ viewerId: "someone-else", users: USERS }) };
/** Viewed by Ayush. */
const asAyush = { viewerId: AYUSH, nameOf: nameResolver({ viewerId: AYUSH, users: USERS }) };

const act = (type, metadata = {}, actorId = AYUSH) => ({
  type,
  actorId,
  metadata,
  createdAt: new Date("2026-04-01T10:00:00Z"),
});

describe("the examples from spec #17", () => {
  test("Ayush added a 2000 hotel expense", () => {
    const line = describeActivity(
      act("EXPENSE_ADDED", { amount: "2000", description: "hotel" }),
      asOutsider
    );
    assert.match(line, /^Ayush added ₹2,000\.00 for hotel$/);
  });

  test("Rahul was added to the group", () => {
    const line = describeActivity(
      act("MEMBER_ADDED", { memberIds: [RAHUL] }),
      asOutsider
    );
    assert.equal(line, "Ayush added Rahul");
  });

  test("Priya settled 500 with Ayush", () => {
    const line = describeActivity(
      act("SETTLEMENT_RECORDED", { amount: "500", fromUserId: PRIYA, toUserId: AYUSH }, PRIYA),
      asOutsider
    );
    assert.match(line, /^Priya settled ₹500\.00 with Ayush$/);
  });

  test("dinner expense was edited", () => {
    const line = describeActivity(
      act("EXPENSE_EDITED", { description: "Dinner" }),
      asOutsider
    );
    assert.equal(line, "Ayush edited Dinner");
  });

  test("monthly rent was generated", () => {
    const line = describeActivity(
      act("RECURRING_GENERATED", { description: "Monthly rent", amount: "12000" }),
      asOutsider
    );
    assert.match(line, /Monthly rent of ₹12,000\.00 was added automatically/);
  });
});

describe("the viewer is addressed as 'You'", () => {
  test("their own action", () => {
    assert.match(
      describeActivity(act("EXPENSE_ADDED", { amount: "100", description: "Chai" }), asAyush),
      /^You added/
    );
  });

  test("someone else's action still names them", () => {
    assert.match(
      describeActivity(
        act("EXPENSE_ADDED", { amount: "100", description: "Chai" }, RAHUL),
        asAyush
      ),
      /^Rahul added/
    );
  });

  test("settling with the viewer reads naturally", () => {
    const line = describeActivity(
      act("SETTLEMENT_RECORDED", { amount: "500", fromUserId: RAHUL, toUserId: AYUSH }, RAHUL),
      asAyush
    );
    assert.equal(line, "Rahul settled ₹500.00 with you");
  });

  test("the viewer settling reads as You", () => {
    const line = describeActivity(
      act("SETTLEMENT_RECORDED", { amount: "500", fromUserId: AYUSH, toUserId: RAHUL }, AYUSH),
      asAyush
    );
    assert.equal(line, "You settled ₹500.00 with Rahul");
  });
});

describe("expense edits", () => {
  test("an amount change names both figures", () => {
    const line = describeActivity(
      act("EXPENSE_EDITED", {
        description: "Hotel",
        previousAmount: "4000.00",
        newAmount: "3000.00",
      }),
      asOutsider
    );
    assert.match(line, /changed Hotel from ₹4,000\.00 to ₹3,000\.00/);
  });

  test("an unchanged amount reads as a plain edit", () => {
    const line = describeActivity(
      act("EXPENSE_EDITED", {
        description: "Hotel",
        previousAmount: "4000.00",
        newAmount: "4000.00",
      }),
      asOutsider
    );
    assert.equal(line, "Ayush edited Hotel");
  });

  test("deletion includes the amount", () => {
    const line = describeActivity(
      act("EXPENSE_DELETED", { description: "Hotel", amount: "4000" }),
      asOutsider
    );
    assert.match(line, /deleted Hotel \(₹4,000\.00\)/);
  });
});

describe("membership", () => {
  test("leaving and being removed read differently", () => {
    assert.equal(
      describeActivity(act("MEMBER_REMOVED", { self: true }, RAHUL), asOutsider),
      "Rahul left the group"
    );
    assert.equal(
      describeActivity(act("MEMBER_REMOVED", { targetUserId: RAHUL }), asOutsider),
      "Ayush removed Rahul"
    );
  });

  test("multiple members are listed naturally", () => {
    assert.equal(
      describeActivity(act("MEMBER_ADDED", { memberIds: [RAHUL, PRIYA] }), asOutsider),
      "Ayush added Rahul and Priya"
    );
    assert.equal(
      describeActivity(
        act("MEMBER_ADDED", { memberIds: [RAHUL, PRIYA, "x"] }),
        asOutsider
      ),
      "Ayush added Rahul, Priya and Someone"
    );
  });

  test("group creation names the group", () => {
    assert.equal(
      describeActivity(act("GROUP_CREATED", { name: "Goa Trip" }), asOutsider),
      'Ayush created the group "Goa Trip"'
    );
  });
});

describe("robustness", () => {
  test("every declared type produces a non-empty sentence", () => {
    for (const type of ACTIVITY_TYPES) {
      const line = describeActivity(act(type, { amount: "1", description: "x" }), asOutsider);
      assert.ok(line.length > 0, `${type} produced nothing`);
      assert.ok(!line.includes("undefined"), `${type} leaked undefined: ${line}`);
      assert.ok(!line.includes("null"), `${type} leaked null: ${line}`);
    }
  });

  test("every declared type has an icon", () => {
    for (const type of ACTIVITY_TYPES) {
      assert.ok(ACTIVITY_ICONS[type], `${type} has no icon`);
    }
  });

  test("an unknown type is visible rather than dropped", () => {
    assert.equal(describeActivity(act("SOMETHING_NEW"), asOutsider), "Ayush made a change");
  });

  test("missing metadata never crashes", () => {
    for (const type of ACTIVITY_TYPES) {
      assert.doesNotThrow(() =>
        describeActivity({ type, actorId: AYUSH }, asOutsider)
      );
    }
  });

  test("null activity returns an empty string", () => {
    assert.equal(describeActivity(null, asOutsider), "");
  });

  test("an unknown actor is 'Someone', never blank", () => {
    const line = describeActivity(act("EXPENSE_ADDED", { amount: "5" }, "ghost"), asOutsider);
    assert.match(line, /^Someone added/);
  });
});

describe("nameResolver", () => {
  const resolve = nameResolver({ viewerId: AYUSH, users: USERS });

  test("capitalises the viewer at the start of a sentence", () => {
    assert.equal(resolve(AYUSH, { capitalise: true }), "You");
    assert.equal(resolve(AYUSH), "you");
  });

  test("falls back to email then Someone", () => {
    const r = nameResolver({ viewerId: "v", users: [{ id: "a", email: "a@x.test" }] });
    assert.equal(r("a"), "a@x.test");
    assert.equal(r("missing"), "Someone");
    assert.equal(r(null), "Someone");
  });
});

describe("helpers", () => {
  test("isExpenseActivity", () => {
    assert.ok(isExpenseActivity("EXPENSE_ADDED"));
    assert.ok(isExpenseActivity("EXPENSE_DELETED"));
    assert.ok(!isExpenseActivity("SETTLEMENT_RECORDED"));
    assert.ok(!isExpenseActivity("MEMBER_ADDED"));
  });

  test("groupByDay buckets by calendar day, preserving order", () => {
    const rows = [
      { id: 1, createdAt: "2026-04-02T10:00:00Z" },
      { id: 2, createdAt: "2026-04-02T08:00:00Z" },
      { id: 3, createdAt: "2026-04-01T22:00:00Z" },
    ];
    const days = groupByDay(rows);

    assert.equal(days.length, 2);
    assert.equal(days[0].day, "2026-04-02");
    assert.equal(days[0].items.length, 2);
    assert.equal(days[1].items[0].id, 3);
  });

  test("groupByDay tolerates a bad date", () => {
    const days = groupByDay([{ id: 1, createdAt: "not-a-date" }]);
    assert.equal(days[0].day, "unknown");
  });

  test("groupByDay on an empty list", () => {
    assert.deepEqual(groupByDay([]), []);
    assert.deepEqual(groupByDay(), []);
  });
});
