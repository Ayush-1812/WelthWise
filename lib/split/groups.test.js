import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal } from "../money.js";
import { AccessError } from "./access.js";
import {
  GROUP_NAME_MAX,
  DEFAULT_GROUP_ICON,
  validateGroupInput,
  countOwners,
  diffMembers,
  isSettledForRemoval,
  canTransferOwnership,
  canChangeRole,
  sortMembers,
} from "./groups.js";

const A = "alice";
const B = "bob";
const C = "carl";

const member = (userId, role = "MEMBER", leftAt = null, joinedAt = "2026-01-01") => ({
  userId,
  role,
  leftAt,
  joinedAt,
});

describe("validateGroupInput", () => {
  test("trims and keeps a valid name", () => {
    assert.equal(validateGroupInput({ name: "  Goa Trip  " }).name, "Goa Trip");
  });

  test("rejects an empty or whitespace name", () => {
    assert.throws(() => validateGroupInput({ name: "" }), AccessError);
    assert.throws(() => validateGroupInput({ name: "   " }), AccessError);
    assert.throws(() => validateGroupInput({}), AccessError);
  });

  test("rejects an over-long name", () => {
    assert.throws(
      () => validateGroupInput({ name: "x".repeat(GROUP_NAME_MAX + 1) }),
      AccessError
    );
    assert.doesNotThrow(() =>
      validateGroupInput({ name: "x".repeat(GROUP_NAME_MAX) })
    );
  });

  test("rejects an over-long description", () => {
    assert.throws(
      () => validateGroupInput({ name: "ok", description: "y".repeat(281) }),
      AccessError
    );
  });

  test("empty description becomes null, not an empty string", () => {
    assert.equal(validateGroupInput({ name: "ok", description: "  " }).description, null);
  });

  test("falls back to a default icon rather than rejecting", () => {
    assert.equal(validateGroupInput({ name: "ok" }).icon, DEFAULT_GROUP_ICON);
    assert.equal(validateGroupInput({ name: "ok", icon: "" }).icon, DEFAULT_GROUP_ICON);
    assert.equal(validateGroupInput({ name: "ok", icon: "✈️" }).icon, "✈️");
  });
});

describe("countOwners", () => {
  test("counts only active owners", () => {
    assert.equal(countOwners([member(A, "OWNER"), member(B, "ADMIN")]), 1);
    assert.equal(countOwners([member(A, "OWNER"), member(B, "OWNER")]), 2);
    assert.equal(
      countOwners([member(A, "OWNER", new Date()), member(B, "MEMBER")]),
      0,
      "a departed owner does not count"
    );
  });
});

describe("diffMembers", () => {
  test("identifies additions and removals", () => {
    const current = [member(A), member(B)];
    const d = diffMembers(current, [A, C]);

    assert.deepEqual(d.toAdd, [C]);
    assert.deepEqual(d.toRemove, [B]);
  });

  test("a previously departed member is reactivated, not re-added", () => {
    // @@unique([groupId, userId]) forbids a second row, so this must not
    // become an insert.
    const current = [member(A), member(B, "MEMBER", new Date())];
    const d = diffMembers(current, [A, B]);

    assert.deepEqual(d.toReactivate, [B]);
    assert.deepEqual(d.toAdd, []);
    assert.deepEqual(d.toRemove, []);
  });

  test("no change produces empty diffs", () => {
    const d = diffMembers([member(A), member(B)], [A, B]);
    assert.deepEqual(d.toAdd, []);
    assert.deepEqual(d.toRemove, []);
    assert.deepEqual(d.toReactivate, []);
  });

  test("departed members are not reported as removals again", () => {
    const d = diffMembers([member(A), member(B, "MEMBER", new Date())], [A]);
    assert.deepEqual(d.toRemove, []);
  });

  test("empty inputs are safe", () => {
    const d = diffMembers();
    assert.deepEqual(d.toAdd, []);
    assert.deepEqual(d.toRemove, []);
  });
});

describe("isSettledForRemoval", () => {
  test("zero balances may be removed", () => {
    assert.ok(isSettledForRemoval(new Decimal(0)));
    assert.ok(isSettledForRemoval(0));
    assert.ok(isSettledForRemoval(null));
  });

  test("a debtor or creditor may not - it would break sum-to-zero", () => {
    assert.ok(!isSettledForRemoval(new Decimal("-0.01")));
    assert.ok(!isSettledForRemoval(new Decimal("1000")));
    assert.ok(!isSettledForRemoval(-500));
  });
});

describe("canTransferOwnership", () => {
  test("an owner may hand over to another active member", () => {
    assert.ok(canTransferOwnership(member(A, "OWNER"), member(B, "MEMBER")));
  });

  test("a non-owner may not", () => {
    assert.ok(!canTransferOwnership(member(A, "ADMIN"), member(B, "MEMBER")));
  });

  test("not to yourself", () => {
    assert.ok(!canTransferOwnership(member(A, "OWNER"), member(A, "OWNER")));
  });

  test("not to a departed member", () => {
    assert.ok(
      !canTransferOwnership(member(A, "OWNER"), member(B, "MEMBER", new Date()))
    );
  });
});

describe("canChangeRole", () => {
  test("an owner may promote and demote", () => {
    assert.ok(canChangeRole(member(A, "OWNER"), member(B, "MEMBER"), "ADMIN"));
    assert.ok(canChangeRole(member(A, "OWNER"), member(B, "ADMIN"), "MEMBER"));
  });

  test("an admin may not change roles", () => {
    assert.ok(!canChangeRole(member(A, "ADMIN"), member(B, "MEMBER"), "ADMIN"));
  });

  test("an owner's role cannot be edited directly - use transfer", () => {
    assert.ok(!canChangeRole(member(A, "OWNER"), member(B, "OWNER"), "MEMBER"));
  });

  test("OWNER cannot be granted through a role change", () => {
    assert.ok(!canChangeRole(member(A, "OWNER"), member(B, "MEMBER"), "OWNER"));
  });

  test("unknown roles are refused", () => {
    assert.ok(!canChangeRole(member(A, "OWNER"), member(B, "MEMBER"), "GOD"));
  });
});

describe("sortMembers", () => {
  test("owners first, then admins, then by join date", () => {
    const sorted = sortMembers([
      member(C, "MEMBER", null, "2026-01-03"),
      member(A, "OWNER", null, "2026-01-02"),
      member(B, "ADMIN", null, "2026-01-01"),
    ]);
    assert.deepEqual(sorted.map((m) => m.userId), [A, B, C]);
  });

  test("same role sorts by join date", () => {
    const sorted = sortMembers([
      member(C, "MEMBER", null, "2026-02-01"),
      member(B, "MEMBER", null, "2026-01-01"),
    ]);
    assert.deepEqual(sorted.map((m) => m.userId), [B, C]);
  });

  test("does not mutate the input", () => {
    const input = [member(C, "MEMBER"), member(A, "OWNER")];
    sortMembers(input);
    assert.equal(input[0].userId, C);
  });
});
