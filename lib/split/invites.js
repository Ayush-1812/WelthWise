/**
 * Group invite links (pure logic - no I/O).
 *
 * A link is a bearer credential: whoever holds it can join the group and see
 * its ledger. So the token is random rather than derived, and every reason a
 * link might not work is explicit data - expiry, a use cap, revocation - so the
 * join page can say *why* instead of a bare "invalid link".
 */

export class InviteError extends Error {
  constructor(message, code = "INVALID") {
    super(message);
    this.name = "InviteError";
    this.code = code;
  }
}

/** Why an invite cannot be used. Ordered most-specific first. */
export const INVITE_STATUS = {
  OK: "OK",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  USED_UP: "USED_UP",
  NOT_FOUND: "NOT_FOUND",
};

const MESSAGES = {
  [INVITE_STATUS.REVOKED]: "This invite link has been turned off.",
  [INVITE_STATUS.EXPIRED]: "This invite link has expired.",
  [INVITE_STATUS.USED_UP]: "This invite link has already been used its maximum number of times.",
  [INVITE_STATUS.NOT_FOUND]: "This invite link is not valid.",
};

export function inviteStatusMessage(status) {
  return MESSAGES[status] ?? null;
}

/**
 * 32 hex characters from a CSPRNG.
 *
 * Not a uuid: a uuid carries a version and layout that leak structure, and
 * v1/v4 mixing has bitten people before. This is 128 bits of pure randomness,
 * short enough to paste and far too large to guess.
 */
export function generateInviteToken() {
  // Web Crypto rather than node:crypto: this module is also imported by a
  // Client Component, and a "node:" import breaks the browser bundle.
  // globalThis.crypto is standard in Node 18+ and every browser.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens only ever come from generateInviteToken, so the shape is exact. */
export function isValidTokenFormat(token) {
  return typeof token === "string" && /^[0-9a-f]{32}$/.test(token);
}

/**
 * Whether an invite row may still be used.
 * Pure: takes the row and "now", returns a status - never reads the clock
 * itself, so expiry is testable.
 */
export function inviteStatus(invite, now = new Date()) {
  if (!invite) return INVITE_STATUS.NOT_FOUND;
  if (invite.revokedAt) return INVITE_STATUS.REVOKED;
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= now.getTime()) {
    return INVITE_STATUS.EXPIRED;
  }
  if (
    invite.maxUses !== null &&
    invite.maxUses !== undefined &&
    (invite.useCount ?? 0) >= invite.maxUses
  ) {
    return INVITE_STATUS.USED_UP;
  }
  return INVITE_STATUS.OK;
}

export function isUsable(invite, now = new Date()) {
  return inviteStatus(invite, now) === INVITE_STATUS.OK;
}

/** Expiry presets offered in the UI, in days. Null means "never". */
export const EXPIRY_PRESETS = [
  { value: "1", label: "1 day", days: 1 },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "never", label: "Never", days: null },
];

export const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Turn an expiry choice into a concrete timestamp.
 * Defaults to 7 days rather than "never": a link that leaks should stop
 * working on its own, without anyone having to remember it exists.
 */
export function expiryFrom(choice, now = new Date()) {
  if (choice === "never" || choice === null) return null;

  const days = choice === undefined ? DEFAULT_EXPIRY_DAYS : Number(choice);
  if (!Number.isFinite(days) || days <= 0) {
    throw new InviteError("Pick how long the link should last");
  }
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Absolute URL for a token, given the app's origin. */
export function inviteUrl(token, origin) {
  const base = String(origin ?? "").replace(/\/+$/, "");
  return `${base}/split/join/${token}`;
}

/**
 * What happens when a signed-in user opens an invite.
 * Pure decision, so the action only has to carry it out.
 */
export function resolveJoinAction({ invite, membership, now = new Date() }) {
  const status = inviteStatus(invite, now);
  if (status !== INVITE_STATUS.OK) {
    return { action: "REJECT", status, message: inviteStatusMessage(status) };
  }
  // Already in the group: send them there rather than erroring or double-adding.
  if (membership && !membership.leftAt) {
    return { action: "ALREADY_MEMBER", status };
  }
  // Previously left: reactivate the existing row so their history survives.
  if (membership && membership.leftAt) {
    return { action: "REJOIN", status };
  }
  return { action: "JOIN", status };
}
