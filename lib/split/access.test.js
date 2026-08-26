import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_RANK,
  ACCESS_CODES,
  AccessError,
  isActiveMember,
  hasRole,
  canonicalPair,
  areFriendsFrom,
  canEditExpense,
  canViewExpense,
  canManageGroup,
  canRemoveMember,
  canSettleOutMember,
} from "./access.js";

const ALICE = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARL = "33333333-cccc-4ccc-8ccc-cccccccccccc";
const GROUP = "99999999-9999-4999-8999-999999999999";

const member = (userId, role = "MEMBER", leftAt = null) => ({
  groupId: GROUP,
  userId,
  role,
  leftAt,
});

const expense = (over = {}) => ({
  id: "exp-1",
  groupId: GROUP,
  paidById: ALICE,
  createdById: ALICE,
  isDeleted: false,
  ...over,
});

describe("isActiveMember", () => {
  test("an unended membership is active", () => {
    assert.ok(isActiveMember(member(ALICE)));
    assert.ok(isActiveMember({ ...member(ALICE), leftAt: undefined }));
  });

  test("a departed member is not", () => {
    assert.ok(!isActiveMember(member(ALICE, "MEMBER", new Date())));
  });

  test("null and undefined are not", () => {
    assert.ok(!isActiveMember(null));
    assert.ok(!isActiveMember(undefined));
  });
});

describe("hasRole", () => {
  test("rank ordering", () => {
    assert.ok(ROLE_RANK.OWNER > ROLE_RANK.ADMIN);
    assert.ok(ROLE_RANK.ADMIN > ROLE_RANK.MEMBER);
  });

  test("a role satisfies itself and everything below", () => {
    assert.ok(hasRole(member(ALICE, "OWNER"), "ADMIN"));
    assert.ok(hasRole(member(ALICE, "OWNER"), "OWNER"));
    assert.ok(hasRole(member(ALICE, "ADMIN"), "MEMBER"));
    assert.ok(hasRole(member(ALICE, "MEMBER"), "MEMBER"));
  });

  test("a role does not satisfy anything above it", () => {
    assert.ok(!hasRole(member(ALICE, "MEMBER"), "ADMIN"));
    assert.ok(!hasRole(member(ALICE, "ADMIN"), "OWNER"));
  });

  test("a departed OWNER has no role", () => {
    assert.ok(!hasRole(member(ALICE, "OWNER", new Date()), "MEMBER"));
  });

  test("unknown roles are refused, never assumed", () => {
    assert.ok(!hasRole({ ...member(ALICE), role: "SUPERUSER" }, "MEMBER"));
    assert.ok(!hasRole(member(ALICE, "OWNER"), "GOD_MODE"));
    assert.ok(!hasRole(null, "MEMBER"));
  });
});

describe("canonicalPair", () => {
  test("both orderings collapse to the same pair", () => {
    assert.deepEqual(canonicalPair(ALICE, BOB), canonicalPair(BOB, ALICE));
  });

  test("smaller id comes first", () => {
    const [first, second] = canonicalPair(BOB, ALICE);
    assert.ok(first < second);
    assert.equal(first, ALICE);
  });

  test("rejects self-pairing", () => {
    assert.throws(() => canonicalPair(ALICE, ALICE), AccessError);
  });

  test("rejects missing ids", () => {
    assert.throws(() => canonicalPair(ALICE, null), AccessError);
    assert.throws(() => canonicalPair(undefined, BOB), AccessError);
    assert.throws(() => canonicalPair("", BOB), AccessError);
  });

  test("throws with an INVALID code", () => {
    try {
      canonicalPair(ALICE, ALICE);
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, ACCESS_CODES.INVALID);
      assert.equal(e.name, "AccessError");
      assert.ok(e instanceof Error);
    }
  });
});

describe("areFriendsFrom", () => {
  test("only ACCEPTED counts", () => {
    assert.ok(areFriendsFrom({ status: "ACCEPTED" }));
    assert.ok(!areFriendsFrom({ status: "PENDING" }));
    assert.ok(!areFriendsFrom({ status: "BLOCKED" }));
    assert.ok(!areFriendsFrom(null));
  });
});

describe("canEditExpense", () => {
  test("the payer can edit", () => {
    assert.ok(canEditExpense({ expense: expense(), actorId: ALICE }));
  });

  test("the creator can edit even when someone else paid", () => {
    const e = expense({ paidById: BOB, createdById: ALICE });
    assert.ok(canEditExpense({ expense: e, actorId: ALICE }));
  });

  test("a group admin can edit someone else's expense", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(
      canEditExpense({ expense: e, actorId: ALICE, membership: member(ALICE, "ADMIN") })
    );
  });

  test("a plain member cannot edit someone else's expense", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(
      !canEditExpense({ expense: e, actorId: ALICE, membership: member(ALICE, "MEMBER") })
    );
  });

  test("an unrelated user cannot edit", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(!canEditExpense({ expense: e, actorId: CARL, membership: null }));
  });

  test("a deleted expense is not editable by anyone, including the payer", () => {
    const e = expense({ isDeleted: true });
    assert.ok(!canEditExpense({ expense: e, actorId: ALICE }));
    assert.ok(
      !canEditExpense({ expense: e, actorId: ALICE, membership: member(ALICE, "OWNER") })
    );
  });

  test("there is no admin override on a 1:1 friend expense", () => {
    const e = expense({ groupId: null, paidById: BOB, createdById: BOB });
    assert.ok(
      !canEditExpense({ expense: e, actorId: ALICE, membership: member(ALICE, "OWNER") })
    );
  });

  test("missing inputs deny", () => {
    assert.ok(!canEditExpense({ expense: null, actorId: ALICE }));
    assert.ok(!canEditExpense({ expense: expense(), actorId: null }));
  });
});

describe("canViewExpense", () => {
  test("a participant can view", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(
      canViewExpense({ expense: e, actorId: ALICE, participantIds: [ALICE, BOB] })
    );
  });

  test("an active group member can view even without a split", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(
      canViewExpense({
        expense: e,
        actorId: CARL,
        membership: member(CARL, "MEMBER"),
        participantIds: [ALICE, BOB],
      })
    );
  });

  test("a departed group member cannot view", () => {
    const e = expense({ paidById: BOB, createdById: BOB });
    assert.ok(
      !canViewExpense({
        expense: e,
        actorId: CARL,
        membership: member(CARL, "MEMBER", new Date()),
        participantIds: [ALICE, BOB],
      })
    );
  });

  test("an outsider cannot view a friend expense", () => {
    const e = expense({ groupId: null, paidById: ALICE, createdById: ALICE });
    assert.ok(
      !canViewExpense({ expense: e, actorId: CARL, participantIds: [ALICE, BOB] })
    );
  });

  test("a deleted expense stays visible so history is explainable", () => {
    const e = expense({ isDeleted: true });
    assert.ok(canViewExpense({ expense: e, actorId: ALICE, participantIds: [ALICE] }));
  });
});

describe("canManageGroup", () => {
  const group = { id: GROUP, isArchived: false };

  test("admins and owners can", () => {
    assert.ok(canManageGroup({ group, membership: member(ALICE, "ADMIN") }));
    assert.ok(canManageGroup({ group, membership: member(ALICE, "OWNER") }));
  });

  test("plain members and non-members cannot", () => {
    assert.ok(!canManageGroup({ group, membership: member(ALICE, "MEMBER") }));
    assert.ok(!canManageGroup({ group, membership: null }));
  });

  test("nobody can manage an archived group", () => {
    const archived = { id: GROUP, isArchived: true };
    assert.ok(!canManageGroup({ group: archived, membership: member(ALICE, "OWNER") }));
  });
});

describe("canRemoveMember", () => {
  test("an admin can remove a plain member", () => {
    assert.ok(
      canRemoveMember({
        actorMembership: member(ALICE, "ADMIN"),
        targetMembership: member(BOB, "MEMBER"),
        ownerCount: 1,
      })
    );
  });

  test("a plain member cannot remove someone else", () => {
    assert.ok(
      !canRemoveMember({
        actorMembership: member(ALICE, "MEMBER"),
        targetMembership: member(BOB, "MEMBER"),
        ownerCount: 1,
      })
    );
  });

  test("anyone may remove themselves", () => {
    assert.ok(
      canRemoveMember({
        actorMembership: member(BOB, "MEMBER"),
        targetMembership: member(BOB, "MEMBER"),
        ownerCount: 1,
      })
    );
  });

  test("the last owner cannot be removed, even by themselves", () => {
    assert.ok(
      !canRemoveMember({
        actorMembership: member(ALICE, "OWNER"),
        targetMembership: member(ALICE, "OWNER"),
        ownerCount: 1,
      })
    );
  });

  test("an owner can be removed when another owner remains", () => {
    assert.ok(
      canRemoveMember({
        actorMembership: member(ALICE, "OWNER"),
        targetMembership: member(ALICE, "OWNER"),
        ownerCount: 2,
      })
    );
  });

  test("an already-departed member cannot be removed again", () => {
    assert.ok(
      !canRemoveMember({
        actorMembership: member(ALICE, "ADMIN"),
        targetMembership: member(BOB, "MEMBER", new Date()),
        ownerCount: 1,
      })
    );
  });
});

describe("canSettleOutMember", () => {
  test("a zero balance may leave", () => {
    assert.ok(canSettleOutMember({ isZero: () => true }));
    assert.ok(canSettleOutMember(0));
    assert.ok(canSettleOutMember(null));
  });

  test("a non-zero balance may not - it would break the sum-to-zero invariant", () => {
    assert.ok(!canSettleOutMember({ isZero: () => false }));
    assert.ok(!canSettleOutMember(-500));
    assert.ok(!canSettleOutMember(0.01));
  });
});

describe("defaults deny", () => {
  test("every predicate refuses empty input rather than assuming access", () => {
    assert.ok(!canEditExpense({}));
    assert.ok(!canViewExpense({}));
    assert.ok(!canManageGroup({ group: null, membership: null }));
    assert.ok(!hasRole(undefined));
    assert.ok(!isActiveMember(undefined));
  });
});
