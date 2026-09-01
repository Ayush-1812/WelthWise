import "server-only";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import {
  AccessError,
  ACCESS_CODES,
  canEditExpense,
  canManageGroup,
  canViewExpense,
  canonicalPair,
  areFriendsFrom,
  hasRole,
  isActiveMember,
} from "./access.js";

/**
 * Authorization gateway for Split Expenses.
 *
 * Every server action in M4-M23 must resolve the caller and check access
 * through this file. No action should query a group, expense or settlement
 * without one of these asserts first - a group id in a URL is not authorization.
 *
 * The `assert*` functions throw AccessError and return the row they loaded, so
 * callers get the fetch and the check in one round trip.
 */

/**
 * Resolve the signed-in Clerk user to a WealthWise User row.
 *
 * Replaces the auth() -> findUnique block currently copy-pasted into every
 * action in actions/*.js.
 */
export async function getCurrentAppUser() {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw new AccessError(ACCESS_CODES.UNAUTHENTICATED, "Unauthorized");
  }

  const user = await db.user.findUnique({ where: { clerkUserId } });

  if (!user) {
    // checkUser() creates the row on first render, so this means the session
    // outlived the record.
    throw new AccessError(ACCESS_CODES.USER_NOT_FOUND, "User not found");
  }

  return user;
}

/** Non-throwing variant, for read paths that render an empty state instead. */
export async function getCurrentAppUserOrNull() {
  try {
    return await getCurrentAppUser();
  } catch {
    return null;
  }
}

/** The caller's active membership row for a group, or null. */
export async function getMembership(groupId, userId) {
  if (!groupId || !userId) return null;

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });

  return isActiveMember(membership) ? membership : null;
}

/** Throws unless the user is an active member. Returns the membership row. */
export async function assertGroupMember(groupId, userId) {
  const membership = await getMembership(groupId, userId);

  if (!membership) {
    throw new AccessError(
      ACCESS_CODES.NOT_A_MEMBER,
      "You are not a member of this group"
    );
  }

  return membership;
}

/** Throws unless the user holds at least `minRole`. Returns the membership. */
export async function assertGroupRole(groupId, userId, minRole = "ADMIN") {
  const membership = await assertGroupMember(groupId, userId);

  if (!hasRole(membership, minRole)) {
    throw new AccessError(
      ACCESS_CODES.INSUFFICIENT_ROLE,
      `This action requires the ${minRole} role`
    );
  }

  return membership;
}

/** Throws unless the user can change group settings or membership. */
export async function assertCanManageGroup(groupId, userId) {
  const group = await db.expenseGroup.findUnique({ where: { id: groupId } });

  if (!group) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Group not found");
  }

  const membership = await getMembership(groupId, userId);

  if (!canManageGroup({ group, membership })) {
    throw new AccessError(
      ACCESS_CODES.FORBIDDEN,
      group.isArchived
        ? "This group is archived"
        : "You do not have permission to manage this group"
    );
  }

  return { group, membership };
}

/** Active member ids for a group, for building participant pickers. */
export async function getGroupMemberIds(groupId) {
  const members = await db.groupMember.findMany({
    where: { groupId, leftAt: null },
    select: { userId: true },
  });

  return members.map((m) => m.userId);
}

/** Active memberships with the user rows attached. */
export async function getGroupMembers(groupId) {
  return db.groupMember.findMany({
    where: { groupId, leftAt: null },
    include: {
      user: {
        select: { id: true, name: true, email: true, imageUrl: true },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
}

/** The friendship row between two users, in either direction. */
export async function getFriendship(userIdA, userIdB) {
  const [requesterId, addresseeId] = canonicalPair(userIdA, userIdB);

  return db.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId, addresseeId } },
  });
}

export async function areFriends(userIdA, userIdB) {
  try {
    return areFriendsFrom(await getFriendship(userIdA, userIdB));
  } catch {
    return false;
  }
}

/** Throws unless the two users have an accepted friendship. */
export async function assertFriends(userIdA, userIdB) {
  const friendship = await getFriendship(userIdA, userIdB);

  if (!areFriendsFrom(friendship)) {
    throw new AccessError(
      ACCESS_CODES.NOT_FRIENDS,
      "You can only share expenses with your friends"
    );
  }

  return friendship;
}

/**
 * Throws unless the caller may edit the expense.
 * Returns the expense with its splits, since every caller needs them.
 */
export async function assertCanEditExpense(expenseId, userId) {
  const expense = await db.sharedExpense.findUnique({
    where: { id: expenseId },
    include: { splits: true },
  });

  if (!expense) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Expense not found");
  }

  const membership = expense.groupId
    ? await getMembership(expense.groupId, userId)
    : null;

  if (!canEditExpense({ expense, actorId: userId, membership })) {
    throw new AccessError(
      ACCESS_CODES.FORBIDDEN,
      expense.isDeleted
        ? "This expense has been deleted"
        : "You do not have permission to edit this expense"
    );
  }

  return expense;
}

/** Throws unless the caller may view the expense. Returns it with splits. */
export async function assertCanViewExpense(expenseId, userId) {
  const expense = await db.sharedExpense.findUnique({
    where: { id: expenseId },
    include: { splits: true },
  });

  if (!expense) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Expense not found");
  }

  const membership = expense.groupId
    ? await getMembership(expense.groupId, userId)
    : null;

  const participantIds = expense.splits.map((s) => s.userId);

  if (!canViewExpense({ expense, actorId: userId, membership, participantIds })) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Expense not found");
  }

  return expense;
}

/**
 * Throws unless the caller is party to the settlement, or an active member of
 * its group.
 */
export async function assertCanViewSettlement(settlementId, userId) {
  const settlement = await db.settlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Settlement not found");
  }

  const isParty =
    settlement.fromUserId === userId || settlement.toUserId === userId;

  if (!isParty) {
    const membership = settlement.groupId
      ? await getMembership(settlement.groupId, userId)
      : null;

    if (!isActiveMember(membership)) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Settlement not found");
    }
  }

  return settlement;
}

/**
 * Validate that every proposed participant may actually be part of an expense.
 *
 * Group expense: all participants must be active members.
 * Friend expense: the only valid pair is the caller and one accepted friend.
 */
export async function assertValidParticipants({ groupId, actorId, participantIds }) {
  const unique = [...new Set(participantIds ?? [])];

  if (unique.length === 0) {
    throw new AccessError(ACCESS_CODES.INVALID, "An expense needs at least one participant");
  }

  if (groupId) {
    await assertGroupMember(groupId, actorId);

    const memberIds = new Set(await getGroupMemberIds(groupId));
    const outsiders = unique.filter((id) => !memberIds.has(id));

    if (outsiders.length > 0) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        "Every participant must be an active member of this group"
      );
    }

    return unique;
  }

  // No group: a direct expense between the caller and exactly one friend.
  if (!unique.includes(actorId)) {
    throw new AccessError(
      ACCESS_CODES.FORBIDDEN,
      "You must be a participant in a direct expense"
    );
  }

  const others = unique.filter((id) => id !== actorId);

  if (others.length !== 1) {
    throw new AccessError(
      ACCESS_CODES.INVALID,
      "A direct expense is between exactly two people - create a group instead"
    );
  }

  await assertFriends(actorId, others[0]);

  return unique;
}

/**
 * Confirm an account belongs to the caller before anything is written against it.
 *
 * The optional personal-finance link (M12) takes an accountId straight from the
 * request, and syncing writes Transaction rows against it *and* increments its
 * balance. Without this check a caller could name someone else's account and
 * move their money, so every path that forwards an accountId must pass it
 * through here first.
 *
 * Returns null for an absent id - opting out of personal tracking is allowed.
 */
export async function assertOwnedAccount(accountId, userId) {
  if (!accountId) return null;

  if (!userId) {
    throw new AccessError(ACCESS_CODES.UNAUTHENTICATED, "Unauthorized");
  }

  const account = await db.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });

  // Deliberately the same error for "no such account" and "not yours": the
  // response must not confirm that an account id exists.
  if (!account) {
    throw new AccessError(ACCESS_CODES.NOT_FOUND, "Account not found");
  }

  return account.id;
}

export { AccessError, ACCESS_CODES };
