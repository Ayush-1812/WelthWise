import test from "node:test";
import assert from "node:assert/strict";

import {
  generateInviteToken,
  isValidTokenFormat,
  inviteStatus,
  isUsable,
  expiryFrom,
  inviteUrl,
  resolveJoinAction,
  inviteStatusMessage,
  INVITE_STATUS,
  InviteError,
} from "./invites.js";

const NOW = new Date("2026-09-02T10:00:00.000Z");
const live = (over = {}) => ({ revokedAt: null, expiresAt: null, maxUses: null, useCount: 0, ...over });

test("generateInviteToken", async (t) => {
  await t.test("is 32 hex characters", () => {
    assert.match(generateInviteToken(), /^[0-9a-f]{32}$/);
  });

  await t.test("never repeats across many draws", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(generateInviteToken());
    assert.equal(seen.size, 5000);
  });

  await t.test("accepts its own output", () => {
    for (let i = 0; i < 100; i++) {
      assert.ok(isValidTokenFormat(generateInviteToken()));
    }
  });

  await t.test("rejects anything else", () => {
    for (const bad of ["", null, undefined, 123, "short", "g".repeat(32), `${"a".repeat(33)}`, "A".repeat(32)]) {
      assert.equal(isValidTokenFormat(bad), false, String(bad));
    }
  });
});

test("inviteStatus", async (t) => {
  await t.test("a fresh open invite is usable", () => {
    assert.equal(inviteStatus(live(), NOW), INVITE_STATUS.OK);
    assert.ok(isUsable(live(), NOW));
  });

  await t.test("a missing invite is NOT_FOUND", () => {
    assert.equal(inviteStatus(null, NOW), INVITE_STATUS.NOT_FOUND);
    assert.equal(inviteStatus(undefined, NOW), INVITE_STATUS.NOT_FOUND);
  });

  await t.test("revocation wins over everything", () => {
    const invite = live({ revokedAt: new Date("2026-01-01"), expiresAt: new Date("2030-01-01") });
    assert.equal(inviteStatus(invite, NOW), INVITE_STATUS.REVOKED);
  });

  await t.test("expiry is exclusive at the boundary", () => {
    assert.equal(inviteStatus(live({ expiresAt: NOW }), NOW), INVITE_STATUS.EXPIRED);
    assert.equal(
      inviteStatus(live({ expiresAt: new Date(NOW.getTime() + 1) }), NOW),
      INVITE_STATUS.OK
    );
  });

  await t.test("a use cap is reached, not merely exceeded", () => {
    assert.equal(inviteStatus(live({ maxUses: 3, useCount: 2 }), NOW), INVITE_STATUS.OK);
    assert.equal(inviteStatus(live({ maxUses: 3, useCount: 3 }), NOW), INVITE_STATUS.USED_UP);
    assert.equal(inviteStatus(live({ maxUses: 3, useCount: 9 }), NOW), INVITE_STATUS.USED_UP);
  });

  await t.test("null maxUses means unlimited", () => {
    assert.equal(inviteStatus(live({ maxUses: null, useCount: 9999 }), NOW), INVITE_STATUS.OK);
  });

  await t.test("every failure explains itself", () => {
    for (const s of [INVITE_STATUS.REVOKED, INVITE_STATUS.EXPIRED, INVITE_STATUS.USED_UP, INVITE_STATUS.NOT_FOUND]) {
      assert.ok(inviteStatusMessage(s), s);
    }
    assert.equal(inviteStatusMessage(INVITE_STATUS.OK), null);
  });
});

test("expiryFrom", async (t) => {
  await t.test("defaults to 7 days, not never", () => {
    const at = expiryFrom(undefined, NOW);
    assert.equal(at.toISOString(), "2026-09-09T10:00:00.000Z");
  });

  await t.test("'never' really is null", () => {
    assert.equal(expiryFrom("never", NOW), null);
    assert.equal(expiryFrom(null, NOW), null);
  });

  await t.test("numeric days work as strings or numbers", () => {
    assert.equal(expiryFrom("1", NOW).toISOString(), "2026-09-03T10:00:00.000Z");
    assert.equal(expiryFrom(30, NOW).toISOString(), "2026-10-02T10:00:00.000Z");
  });

  await t.test("rejects nonsense rather than silently defaulting", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      assert.throws(() => expiryFrom(bad, NOW), InviteError, String(bad));
    }
  });

  await t.test("a link made now is usable now", () => {
    assert.ok(isUsable(live({ expiresAt: expiryFrom("7", NOW) }), NOW));
  });
});

test("inviteUrl", async (t) => {
  await t.test("builds a join URL", () => {
    assert.equal(inviteUrl("abc", "https://app.test"), "https://app.test/split/join/abc");
  });

  await t.test("does not double up slashes", () => {
    assert.equal(inviteUrl("abc", "https://app.test/"), "https://app.test/split/join/abc");
    assert.equal(inviteUrl("abc", "https://app.test///"), "https://app.test/split/join/abc");
  });
});

test("resolveJoinAction", async (t) => {
  await t.test("a stranger joins", () => {
    const r = resolveJoinAction({ invite: live(), membership: null, now: NOW });
    assert.equal(r.action, "JOIN");
  });

  await t.test("an existing member is not added twice", () => {
    const r = resolveJoinAction({ invite: live(), membership: { leftAt: null }, now: NOW });
    assert.equal(r.action, "ALREADY_MEMBER");
  });

  await t.test("someone who left rejoins their existing row", () => {
    const r = resolveJoinAction({ invite: live(), membership: { leftAt: new Date("2026-01-01") }, now: NOW });
    assert.equal(r.action, "REJOIN");
  });

  await t.test("an unusable invite is rejected even for a member", () => {
    const r = resolveJoinAction({
      invite: live({ revokedAt: NOW }),
      membership: { leftAt: null },
      now: NOW,
    });
    assert.equal(r.action, "REJECT");
    assert.equal(r.status, INVITE_STATUS.REVOKED);
    assert.ok(r.message);
  });

  await t.test("an expired link never lets anyone in", () => {
    const r = resolveJoinAction({
      invite: live({ expiresAt: new Date(NOW.getTime() - 1) }),
      membership: null,
      now: NOW,
    });
    assert.equal(r.action, "REJECT");
    assert.equal(r.status, INVITE_STATUS.EXPIRED);
  });
});
