/**
 * Pure authorization rules for Split Expenses.
 *
 * No database, no Clerk, no I/O - every function here takes already-fetched
 * rows and returns a decision. lib/split/auth.js does the fetching and calls
 * into this file.
 *
 * Keeping the rules pure means they can be exhaustively unit-tested, which is
 * the point: an authorization bug that only shows up against a live database
 * is one nobody finds until it matters.
 */

/** Ordered so a numeric comparison answers "at least this role". */
export const ROLE_RANK = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export const ACCESS_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  INSUFFICIENT_ROLE: "INSUFFICIENT_ROLE",
  NOT_FRIENDS: "NOT_FRIENDS",
  FORBIDDEN: "FORBIDDEN",
  INVALID: "INVALID",
};

/**
 * Authorization failure. Carries a machine-readable `code` so callers can map
 * to an HTTP status; the message stays human-readable because the existing
 * server actions surface `error.message` straight to the client.
 */
export class AccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccessError";
    this.code = code;
  }
}

/** A membership row counts only while the member has not left. */
export function isActiveMember(membership) {
  if (!membership) return false;
  return membership.leftAt === null || membership.leftAt === undefined;
}

/** True when an active membership carries at least `minRole`. */
export function hasRole(membership, minRole = "MEMBER") {
  if (!isActiveMember(membership)) return false;

  const held = ROLE_RANK[membership.role];
  const needed = ROLE_RANK[minRole];
  if (held === undefined || needed === undefined) return false;

  return held >= needed;
}

/**
 * Order a user pair deterministically so a friendship between A and B has
 * exactly one representation. Storing the smaller uuid as `requesterId` lets
 * the @@unique([requesterId, addresseeId]) constraint do the deduplication.
 */
export function canonicalPair(userIdA, userIdB) {
  if (!userIdA || !userIdB) {
    throw new AccessError(ACCESS_CODES.INVALID, "Both user ids are required");
  }
  if (userIdA === userIdB) {
    throw new AccessError(ACCESS_CODES.INVALID, "A user cannot pair with themselves");
  }
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

/** An accepted friendship in either direction. */
export function areFriendsFrom(friendship) {
  return Boolean(friendship) && friendship.status === "ACCEPTED";
}

/**
 * Who may edit or delete an expense.
 *
 * - the payer (their money)
 * - whoever created it
 * - a group ADMIN or OWNER, for group expenses only
 *
 * A soft-deleted expense is not editable by anyone; reversing a deletion is a
 * separate operation, not an edit.
 */
export function canEditExpense({ expense, actorId, membership = null }) {
  if (!expense || !actorId) return false;
  if (expense.isDeleted) return false;

  if (expense.paidById === actorId) return true;
  if (expense.createdById === actorId) return true;

  // Group admins can correct entries for their group. There is no equivalent
  // authority on a 1:1 friend expense, so it stays with payer/creator.
  if (expense.groupId) return hasRole(membership, "ADMIN");

  return false;
}

/**
 * Who may view an expense: anyone it financially concerns.
 *
 * - a participant (has a split row)
 * - the payer or creator
 * - any active member of the owning group
 *
 * Deleted expenses stay visible to those people so history remains explainable.
 */
export function canViewExpense({
  expense,
  actorId,
  membership = null,
  participantIds = [],
}) {
  if (!expense || !actorId) return false;

  if (expense.paidById === actorId) return true;
  if (expense.createdById === actorId) return true;
  if (participantIds.includes(actorId)) return true;
  if (expense.groupId) return isActiveMember(membership);

  return false;
}

/** Who may change group settings, or add and remove members. */
export function canManageGroup({ group, membership }) {
  if (!group || group.isArchived) return false;
  return hasRole(membership, "ADMIN");
}

/**
 * Who may remove a specific member.
 *
 * An admin can remove others; anyone may remove themselves (leaving). The last
 * OWNER can never be removed - ownership must be transferred first, otherwise
 * the group is left with nobody able to administer it.
 */
export function canRemoveMember({ actorMembership, targetMembership, ownerCount }) {
  if (!isActiveMember(targetMembership)) return false;

  if (targetMembership.role === "OWNER" && ownerCount <= 1) return false;

  const isSelf =
    isActiveMember(actorMembership) &&
    actorMembership.userId === targetMembership.userId;
  if (isSelf) return true;

  return hasRole(actorMembership, "ADMIN");
}

/**
 * A member holding a non-zero balance must not be removed - dropping them
 * would break the "group balances sum to zero" invariant (task.md section 1).
 * `netBalance` is expected to be a Decimal-like with isZero().
 */
export function canSettleOutMember(netBalance) {
  if (netBalance === null || netBalance === undefined) return true;
  if (typeof netBalance.isZero === "function") return netBalance.isZero();
  return Number(netBalance) === 0;
}
