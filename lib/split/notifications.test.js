import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_TYPES,
  EMAIL_WORTHY,
  shouldEmail,
  buildNotification,
  recipientsFor,
  formatUnreadCount,
} from "./notifications.js";

const AYUSH = { id: "a", name: "Ayush" };
const RAHUL = { id: "r", name: "Rahul" };
const GROUP = { id: "g1", name: "Goa Trip" };
const EXPENSE = { id: "e1", description: "Hotel", amount: "4000" };

describe("every trigger from the spec has content", () => {
  // Spec #16: added to a group, friend request, expense added, expense edited,
  // settled, partially settled, recurring created, recurring generated, reminder.
  const required = [
    "GROUP_ADDED",
    "FRIEND_REQUEST",
    "EXPENSE_ADDED",
    "EXPENSE_EDITED",
    "SETTLEMENT_RECEIVED",
    "SETTLEMENT_PARTIAL",
    "RECURRING_CREATED",
    "RECURRING_GENERATED",
    "PAYMENT_REMINDER",
  ];

  for (const type of required) {
    test(`${type} builds a notification`, () => {
      const n = buildNotification(type, {
        actor: AYUSH,
        group: GROUP,
        expense: EXPENSE,
        amount: "500",
        remaining: "250",
        counterparty: RAHUL,
      });
      assert.ok(n, `${type} produced nothing`);
      assert.ok(n.title.length > 0);
      assert.ok(n.linkUrl.startsWith("/split/"));
    });
  }
});

describe("wording", () => {
  test("group invite names the group and links to it", () => {
    const n = buildNotification("GROUP_ADDED", { actor: AYUSH, group: GROUP });
    assert.equal(n.title, "Ayush added you to Goa Trip");
    assert.equal(n.linkUrl, "/split/groups/g1");
  });

  test("expense notification states your share", () => {
    const n = buildNotification("EXPENSE_ADDED", {
      actor: AYUSH,
      expense: EXPENSE,
      myShare: "1000",
    });
    assert.match(n.title, /Ayush added ₹4,000\.00 for Hotel/);
    assert.match(n.body, /Your share is ₹1,000\.00/);
    assert.equal(n.linkUrl, "/split/expenses/e1");
  });

  test("full settlement says settled up", () => {
    const n = buildNotification("SETTLEMENT_RECEIVED", { actor: RAHUL, amount: "1000" });
    assert.match(n.title, /Rahul paid you ₹1,000\.00/);
    assert.match(n.body, /settled up/);
  });

  test("partial settlement names the remainder", () => {
    const n = buildNotification("SETTLEMENT_PARTIAL", {
      actor: RAHUL,
      amount: "600",
      remaining: "400",
    });
    assert.match(n.title, /Rahul paid you ₹600\.00/);
    assert.match(n.body, /₹400\.00 is still outstanding/);
  });

  test("a generated recurring expense has no actor", () => {
    const n = buildNotification("RECURRING_GENERATED", {
      expense: { id: "e9", description: "Rent", amount: "12000" },
      group: GROUP,
    });
    // The schedule did this, so no name should appear.
    assert.match(n.title, /^Rent of ₹12,000\.00 was added$/);
    assert.ok(!n.title.includes("Someone"));
  });

  test("payment reminder links to the balance breakdown", () => {
    const n = buildNotification("PAYMENT_REMINDER", {
      counterparty: RAHUL,
      amount: "750",
    });
    assert.match(n.title, /You owe Rahul ₹750\.00/);
    assert.equal(n.linkUrl, "/split/balances/r");
  });
});

describe("robustness", () => {
  test("every declared type builds without context", () => {
    for (const type of NOTIFICATION_TYPES) {
      const n = buildNotification(type, {});
      assert.ok(n, `${type} produced nothing`);
      assert.ok(n.title.length > 0, `${type} has an empty title`);
      assert.ok(
        !/undefined|null|NaN/.test(n.title),
        `${type} title leaked a placeholder: ${n.title}`
      );
      if (n.body) {
        assert.ok(
          !/undefined|null|NaN/.test(n.body),
          `${type} body leaked a placeholder: ${n.body}`
        );
      }
    }
  });

  test("an unknown type builds nothing rather than guessing", () => {
    assert.equal(buildNotification("MADE_UP"), null);
  });

  test("a missing actor reads as Someone", () => {
    assert.match(buildNotification("FRIEND_REQUEST", {}).title, /^Someone sent/);
  });

  test("links always fall back to a real page", () => {
    for (const type of NOTIFICATION_TYPES) {
      const n = buildNotification(type, {});
      assert.match(n.linkUrl, /^\/split\//, `${type} has a bad link`);
    }
  });
});

describe("email selection", () => {
  test("money and membership events are email-worthy", () => {
    assert.ok(shouldEmail("SETTLEMENT_RECEIVED"));
    assert.ok(shouldEmail("SETTLEMENT_PARTIAL"));
    assert.ok(shouldEmail("GROUP_ADDED"));
    assert.ok(shouldEmail("PAYMENT_REMINDER"));
  });

  test("routine edits are not, to avoid training people to ignore email", () => {
    assert.ok(!shouldEmail("EXPENSE_EDITED"));
    assert.ok(!shouldEmail("EXPENSE_DELETED"));
    assert.ok(!shouldEmail("EXPENSE_ADDED"));
    assert.ok(!shouldEmail("FRIEND_REQUEST"));
  });

  test("every email-worthy type is a declared type", () => {
    for (const type of EMAIL_WORTHY) {
      assert.ok(NOTIFICATION_TYPES.includes(type), `${type} is not declared`);
    }
  });
});

describe("recipientsFor", () => {
  test("excludes the actor - nobody needs telling about their own action", () => {
    assert.deepEqual(
      recipientsFor({ candidateIds: ["a", "r", "p"], actorId: "a" }),
      ["r", "p"]
    );
  });

  test("deduplicates", () => {
    assert.deepEqual(
      recipientsFor({ candidateIds: ["r", "r", "p"], actorId: "a" }),
      ["r", "p"]
    );
  });

  test("drops falsy ids", () => {
    assert.deepEqual(
      recipientsFor({ candidateIds: ["r", null, undefined, ""], actorId: "a" }),
      ["r"]
    );
  });

  test("empty input is safe", () => {
    assert.deepEqual(recipientsFor({}), []);
    assert.deepEqual(recipientsFor(), []);
  });

  test("a system event with no actor notifies everyone", () => {
    assert.deepEqual(
      recipientsFor({ candidateIds: ["a", "r"], actorId: null }),
      ["a", "r"]
    );
  });
});

describe("formatUnreadCount", () => {
  test("hides zero", () => {
    assert.equal(formatUnreadCount(0), null);
    assert.equal(formatUnreadCount(null), null);
    assert.equal(formatUnreadCount(undefined), null);
  });

  test("shows a plain count", () => {
    assert.equal(formatUnreadCount(1), "1");
    assert.equal(formatUnreadCount(99), "99");
  });

  test("caps at 99+", () => {
    assert.equal(formatUnreadCount(100), "99+");
    assert.equal(formatUnreadCount(5000), "99+");
  });
});
