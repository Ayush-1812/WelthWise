/**
 * Pure friendship helpers - no database, no Clerk.
 *
 * The Friendship row stores its pair canonically (smaller uuid as requesterId)
 * so the unique constraint prevents A->B and B->A both existing. That ordering
 * is positional, not directional, so nothing here may infer "who asked" from
 * requesterId - only `initiatedById` carries that.
 */

import { AccessError, ACCESS_CODES } from "./access.js";

export const FRIEND_STATUS = {
  NONE: "NONE",
  PENDING_INCOMING: "PENDING_INCOMING",
  PENDING_OUTGOING: "PENDING_OUTGOING",
  FRIENDS: "FRIENDS",
  BLOCKED: "BLOCKED",
  SELF: "SELF",
};

/** The user on the other side of a friendship row. */
export function otherUserId(friendship, meId) {
  if (!friendship || !meId) return null;

  if (friendship.requesterId === meId) return friendship.addresseeId;
  if (friendship.addresseeId === meId) return friendship.requesterId;

  return null; // not my friendship
}

/** True when `meId` is one of the two parties. */
export function isParty(friendship, meId) {
  return otherUserId(friendship, meId) !== null;
}

/**
 * Classify a friendship from one user's point of view.
 *
 * Direction comes from initiatedById, never from requesterId - see the file
 * header for why.
 */
export function friendStatusFor(friendship, meId) {
  if (!friendship) return FRIEND_STATUS.NONE;
  if (!isParty(friendship, meId)) return FRIEND_STATUS.NONE;

  if (friendship.status === "ACCEPTED") return FRIEND_STATUS.FRIENDS;
  if (friendship.status === "BLOCKED") return FRIEND_STATUS.BLOCKED;

  if (friendship.status === "PENDING") {
    return friendship.initiatedById === meId
      ? FRIEND_STATUS.PENDING_OUTGOING
      : FRIEND_STATUS.PENDING_INCOMING;
  }

  return FRIEND_STATUS.NONE;
}

/** Only the person who did NOT send a pending request may accept it. */
export function canAccept(friendship, meId) {
  return friendStatusFor(friendship, meId) === FRIEND_STATUS.PENDING_INCOMING;
}

/** Either party may decline or cancel a pending request. */
export function canCancel(friendship, meId) {
  const status = friendStatusFor(friendship, meId);
  return (
    status === FRIEND_STATUS.PENDING_INCOMING ||
    status === FRIEND_STATUS.PENDING_OUTGOING
  );
}

/** Only an accepted friendship can be removed. */
export function canRemove(friendship, meId) {
  return friendStatusFor(friendship, meId) === FRIEND_STATUS.FRIENDS;
}

/**
 * Build the canonical row for a new request.
 * Returns the field values; the caller writes them.
 */
export function buildFriendshipRow(initiatorId, targetId) {
  if (!initiatorId || !targetId) {
    throw new AccessError(ACCESS_CODES.INVALID, "Both user ids are required");
  }
  if (initiatorId === targetId) {
    throw new AccessError(
      ACCESS_CODES.INVALID,
      "You cannot send a friend request to yourself"
    );
  }

  const [requesterId, addresseeId] =
    initiatorId < targetId ? [initiatorId, targetId] : [targetId, initiatorId];

  return { requesterId, addresseeId, initiatedById: initiatorId, status: "PENDING" };
}

/**
 * Decide what sending a request should do given any existing row.
 *
 * - none                -> create
 * - already friends     -> reject
 * - my pending request  -> reject (no spamming)
 * - their pending one   -> accept it, rather than creating a second row
 * - blocked             -> reject, without revealing that a block exists
 */
export function resolveRequestAction(existing, meId) {
  const status = friendStatusFor(existing, meId);

  switch (status) {
    case FRIEND_STATUS.NONE:
      return { action: existing ? "REVIVE" : "CREATE" };
    case FRIEND_STATUS.FRIENDS:
      return { action: "REJECT", reason: "You are already friends" };
    case FRIEND_STATUS.PENDING_OUTGOING:
      return { action: "REJECT", reason: "Friend request already sent" };
    case FRIEND_STATUS.PENDING_INCOMING:
      return { action: "ACCEPT_EXISTING" };
    case FRIEND_STATUS.BLOCKED:
      return { action: "REJECT", reason: "Unable to send a request to this user" };
    default:
      return { action: "REJECT", reason: "Unable to send a request to this user" };
  }
}

/**
 * Shape a friendship row for the UI, from one user's point of view.
 * `netBalance` stays 0 until M8 derives it from the ledger.
 */
export function toFriendView(friendship, meId, friendUser, netBalance = 0) {
  return {
    friendshipId: friendship.id,
    status: friendStatusFor(friendship, meId),
    since: friendship.updatedAt ?? friendship.createdAt,
    friend: friendUser
      ? {
          id: friendUser.id,
          name: friendUser.name,
          email: friendUser.email,
          imageUrl: friendUser.imageUrl,
        }
      : null,
    netBalance,
  };
}
