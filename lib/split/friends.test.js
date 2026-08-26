import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AccessError } from "./access.js";
import {
  FRIEND_STATUS,
  otherUserId,
  isParty,
  friendStatusFor,
  canAccept,
  canCancel,
  canRemove,
  buildFriendshipRow,
  resolveRequestAction,
  toFriendView,
} from "./friends.js";

// LOW sorts before HIGH, so canonical ordering puts LOW in requesterId.
const LOW = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIGH = "99999999-zzzz-4zzz-8zzz-zzzzzzzzzzzz";
const OUTSIDER = "55555555-mmmm-4mmm-8mmm-mmmmmmmmmmmm";

/** Row as it would exist after `initiator` sent a request to the other party. */
const row = (initiatedById, status = "PENDING") => ({
  id: "fs-1",
  requesterId: LOW,
  addresseeId: HIGH,
  initiatedById,
  status,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
});

describe("canonical ordering does not imply direction", () => {
  test("HIGH initiating still stores LOW as requesterId", () => {
    const built = buildFriendshipRow(HIGH, LOW);
    assert.equal(built.requesterId, LOW);
    assert.equal(built.addresseeId, HIGH);
    assert.equal(built.initiatedById, HIGH);
  });

  test("both initiation directions produce the same canonical pair", () => {
    const a = buildFriendshipRow(LOW, HIGH);
    const b = buildFriendshipRow(HIGH, LOW);
    assert.equal(a.requesterId, b.requesterId);
    assert.equal(a.addresseeId, b.addresseeId);
    assert.notEqual(a.initiatedById, b.initiatedById);
  });

  test("the regression this field exists to prevent", () => {
    // HIGH sent the request. Reading direction off requesterId would tell LOW
    // it was theirs. initiatedById keeps it straight.
    const r = row(HIGH);
    assert.equal(friendStatusFor(r, LOW), FRIEND_STATUS.PENDING_INCOMING);
    assert.equal(friendStatusFor(r, HIGH), FRIEND_STATUS.PENDING_OUTGOING);
  });
});

describe("buildFriendshipRow", () => {
  test("starts PENDING", () => {
    assert.equal(buildFriendshipRow(LOW, HIGH).status, "PENDING");
  });

  test("rejects self-requests", () => {
    assert.throws(() => buildFriendshipRow(LOW, LOW), AccessError);
  });

  test("rejects missing ids", () => {
    assert.throws(() => buildFriendshipRow(LOW, null), AccessError);
    assert.throws(() => buildFriendshipRow(null, HIGH), AccessError);
  });
});

describe("otherUserId / isParty", () => {
  test("returns the opposite party", () => {
    assert.equal(otherUserId(row(LOW), LOW), HIGH);
    assert.equal(otherUserId(row(LOW), HIGH), LOW);
  });

  test("an outsider is not a party", () => {
    assert.equal(otherUserId(row(LOW), OUTSIDER), null);
    assert.ok(!isParty(row(LOW), OUTSIDER));
    assert.ok(isParty(row(LOW), LOW));
  });

  test("missing inputs return null", () => {
    assert.equal(otherUserId(null, LOW), null);
    assert.equal(otherUserId(row(LOW), null), null);
  });
});

describe("friendStatusFor", () => {
  test("no row means no relationship", () => {
    assert.equal(friendStatusFor(null, LOW), FRIEND_STATUS.NONE);
  });

  test("accepted is FRIENDS for both parties", () => {
    const r = row(LOW, "ACCEPTED");
    assert.equal(friendStatusFor(r, LOW), FRIEND_STATUS.FRIENDS);
    assert.equal(friendStatusFor(r, HIGH), FRIEND_STATUS.FRIENDS);
  });

  test("blocked is BLOCKED", () => {
    assert.equal(friendStatusFor(row(LOW, "BLOCKED"), HIGH), FRIEND_STATUS.BLOCKED);
  });

  test("an outsider sees NONE even on an accepted row", () => {
    assert.equal(friendStatusFor(row(LOW, "ACCEPTED"), OUTSIDER), FRIEND_STATUS.NONE);
  });
});

describe("permission predicates", () => {
  test("only the recipient can accept", () => {
    const r = row(HIGH); // HIGH asked
    assert.ok(canAccept(r, LOW));
    assert.ok(!canAccept(r, HIGH));
  });

  test("nobody can accept an already-accepted request", () => {
    const r = row(HIGH, "ACCEPTED");
    assert.ok(!canAccept(r, LOW));
    assert.ok(!canAccept(r, HIGH));
  });

  test("either party can cancel or decline a pending request", () => {
    const r = row(HIGH);
    assert.ok(canCancel(r, LOW));
    assert.ok(canCancel(r, HIGH));
  });

  test("cancel does not apply once accepted", () => {
    assert.ok(!canCancel(row(HIGH, "ACCEPTED"), LOW));
  });

  test("only an accepted friendship can be removed", () => {
    assert.ok(canRemove(row(HIGH, "ACCEPTED"), LOW));
    assert.ok(!canRemove(row(HIGH), LOW));
  });

  test("outsiders can do nothing", () => {
    const r = row(HIGH, "ACCEPTED");
    assert.ok(!canAccept(r, OUTSIDER));
    assert.ok(!canCancel(r, OUTSIDER));
    assert.ok(!canRemove(r, OUTSIDER));
  });
});

describe("resolveRequestAction", () => {
  test("no existing row means create", () => {
    assert.equal(resolveRequestAction(null, LOW).action, "CREATE");
  });

  test("already friends is rejected", () => {
    const r = resolveRequestAction(row(LOW, "ACCEPTED"), LOW);
    assert.equal(r.action, "REJECT");
    assert.match(r.reason, /already friends/i);
  });

  test("resending my own pending request is rejected", () => {
    const r = resolveRequestAction(row(LOW), LOW);
    assert.equal(r.action, "REJECT");
    assert.match(r.reason, /already sent/i);
  });

  test("requesting someone who already asked me accepts theirs", () => {
    // Avoids creating a second row that the unique constraint would reject.
    assert.equal(resolveRequestAction(row(HIGH), LOW).action, "ACCEPT_EXISTING");
  });

  test("blocked is refused without confirming a block exists", () => {
    const r = resolveRequestAction(row(LOW, "BLOCKED"), HIGH);
    assert.equal(r.action, "REJECT");
    assert.doesNotMatch(r.reason, /block/i);
  });

  test("a stale row for an outsider is revived, not duplicated", () => {
    assert.equal(resolveRequestAction(row(LOW), OUTSIDER).action, "REVIVE");
  });
});

describe("toFriendView", () => {
  const friendUser = {
    id: HIGH,
    name: "Rahul",
    email: "rahul@example.com",
    imageUrl: null,
    clerkUserId: "should-not-leak",
  };

  test("shapes a row for the UI", () => {
    const v = toFriendView(row(LOW, "ACCEPTED"), LOW, friendUser);
    assert.equal(v.friendshipId, "fs-1");
    assert.equal(v.status, FRIEND_STATUS.FRIENDS);
    assert.equal(v.friend.name, "Rahul");
    assert.equal(v.netBalance, 0);
  });

  test("exposes only whitelisted user fields", () => {
    const v = toFriendView(row(LOW, "ACCEPTED"), LOW, friendUser);
    assert.deepEqual(Object.keys(v.friend).sort(), [
      "email",
      "id",
      "imageUrl",
      "name",
    ]);
    assert.ok(!("clerkUserId" in v.friend));
  });

  test("tolerates a missing user row", () => {
    assert.equal(toFriendView(row(LOW, "ACCEPTED"), LOW, null).friend, null);
  });
});
