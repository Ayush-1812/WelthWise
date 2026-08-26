/**
 * Pure group helpers - no database, no Clerk.
 * Membership authorization lives in ./access.js; this file covers validation
 * and the role/membership transitions around it.
 */

import { AccessError, ACCESS_CODES, isActiveMember } from "./access.js";

export const GROUP_NAME_MAX = 60;
export const GROUP_DESCRIPTION_MAX = 280;

/** Presets matching the group kinds in the spec. Users may type any emoji. */
export const GROUP_ICON_PRESETS = [
  "✈️", // trips
  "🏠", // roommates / household
  "🎓", // college friends
  "👨‍👩‍👧", // family
  "💼", // office
  "🍽️", // food
  "🎉", // events
  "🧾", // general
];

export const DEFAULT_GROUP_ICON = "🧾";

/**
 * Validate and normalize group input.
 * Throws AccessError(INVALID) so server actions surface one error shape.
 */
export function validateGroupInput({ name, description, icon } = {}) {
  const cleanName = String(name ?? "").trim();

  if (!cleanName) {
    throw new AccessError(ACCESS_CODES.INVALID, "Group name is required");
  }
  if (cleanName.length > GROUP_NAME_MAX) {
    throw new AccessError(
      ACCESS_CODES.INVALID,
      `Group name must be ${GROUP_NAME_MAX} characters or fewer`
    );
  }

  const cleanDescription = String(description ?? "").trim();
  if (cleanDescription.length > GROUP_DESCRIPTION_MAX) {
    throw new AccessError(
      ACCESS_CODES.INVALID,
      `Description must be ${GROUP_DESCRIPTION_MAX} characters or fewer`
    );
  }

  // An icon is decorative; fall back rather than rejecting an unusual emoji.
  const cleanIcon = String(icon ?? "").trim().slice(0, 8) || DEFAULT_GROUP_ICON;

  return {
    name: cleanName,
    description: cleanDescription || null,
    icon: cleanIcon,
  };
}

/** Active members holding OWNER. */
export function countOwners(members = []) {
  return members.filter((m) => isActiveMember(m) && m.role === "OWNER").length;
}

/** Which ids to add and which memberships to end, given a desired roster. */
export function diffMembers(currentMembers = [], desiredUserIds = []) {
  const desired = new Set(desiredUserIds);
  const activeIds = new Set(
    currentMembers.filter(isActiveMember).map((m) => m.userId)
  );

  const toAdd = [...desired].filter((id) => !activeIds.has(id));
  const toRemove = currentMembers
    .filter((m) => isActiveMember(m) && !desired.has(m.userId))
    .map((m) => m.userId);

  // A member who previously left and is being re-added needs reactivating
  // rather than a second row - the @@unique([groupId, userId]) forbids one.
  const rejoining = new Set(
    currentMembers.filter((m) => !isActiveMember(m)).map((m) => m.userId)
  );

  return {
    toAdd: toAdd.filter((id) => !rejoining.has(id)),
    toReactivate: toAdd.filter((id) => rejoining.has(id)),
    toRemove,
  };
}

/**
 * Whether a member may be removed on balance grounds.
 * Non-zero means unsettled debt; removing them would break the sum-to-zero
 * invariant, so they must settle first.
 */
export function isSettledForRemoval(netBalance) {
  if (netBalance === null || netBalance === undefined) return true;
  if (typeof netBalance.isZero === "function") return netBalance.isZero();
  return Number(netBalance) === 0;
}

/**
 * Ownership transfer rules. Only an owner may hand over, only to another
 * active member, and never to themselves.
 */
export function canTransferOwnership(actorMembership, targetMembership) {
  if (!isActiveMember(actorMembership) || actorMembership.role !== "OWNER") {
    return false;
  }
  if (!isActiveMember(targetMembership)) return false;
  return actorMembership.userId !== targetMembership.userId;
}

/**
 * Whether a role change is permitted.
 * Only an OWNER may grant or revoke ADMIN, and OWNER is set through transfer,
 * never by editing a role directly.
 */
export function canChangeRole(actorMembership, targetMembership, nextRole) {
  if (!isActiveMember(actorMembership) || !isActiveMember(targetMembership)) {
    return false;
  }
  if (actorMembership.role !== "OWNER") return false;
  if (targetMembership.role === "OWNER") return false;
  return nextRole === "ADMIN" || nextRole === "MEMBER";
}

/** Sort members for display: owners first, then admins, then by join date. */
export function sortMembers(members = []) {
  const rank = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
  return [...members].sort((a, b) => {
    const byRole = (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
    if (byRole !== 0) return byRole;
    return new Date(a.joinedAt) - new Date(b.joinedAt);
  });
}
