"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { getCurrentAppUser, AccessError, ACCESS_CODES } from "@/lib/split/auth";
import {
  FRIEND_STATUS,
  buildFriendshipRow,
  canAccept,
  canCancel,
  canRemove,
  friendStatusFor,
  otherUserId,
  resolveRequestAction,
  toFriendView,
} from "@/lib/split/friends";
import { canonicalPair } from "@/lib/split/access";
import { pairwiseForUser } from "@/lib/split/balances";
import { loadUserLedger } from "./balances";
import { queueNotifications } from "./notify";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

/** Both directions in one filter, since the pair is stored canonically. */
const involving = (userId) => ({
  OR: [{ requesterId: userId }, { addresseeId: userId }],
});

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  // AccessError messages are already user-facing; anything else is unexpected.
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/friends]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Find a user to add as a friend.
 *
 * Exact, case-insensitive email match only. A fuzzy name search over all users
 * would turn the app into a directory of everyone who has ever signed up, so
 * you must already know the address.
 */
export async function searchUsers(rawQuery) {
  try {
    const me = await getCurrentAppUser();
    const query = String(rawQuery ?? "").trim().toLowerCase();

    if (!query || !query.includes("@")) {
      return { success: true, data: [] };
    }

    const found = await db.user.findFirst({
      where: { email: { equals: query, mode: "insensitive" } },
      select: USER_FIELDS,
    });

    // Not found and "it's you" both return empty - no error, per M4 spec.
    if (!found || found.id === me.id) {
      return { success: true, data: [] };
    }

    const [requesterId, addresseeId] = canonicalPair(me.id, found.id);
    const existing = await db.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId, addresseeId } },
    });

    return {
      success: true,
      data: [{ ...found, relationship: friendStatusFor(existing, me.id) }],
    };
  } catch (error) {
    return fail(error);
  }
}

/** Accepted friends, with a net balance placeholder until M8. */
export async function getFriends() {
  try {
    const me = await getCurrentAppUser();

    const rows = await db.friendship.findMany({
      where: { ...involving(me.id), status: "ACCEPTED" },
      include: {
        requester: { select: USER_FIELDS },
        addressee: { select: USER_FIELDS },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Balances are derived from the ledger, never stored (task.md section 1).
    const ledger = await loadUserLedger(me.id);
    const perPerson = pairwiseForUser(ledger, me.id);

    const data = rows.map((row) => {
      const friend =
        row.requesterId === me.id ? row.addressee : row.requester;
      const net = perPerson.get(friend.id);
      return toFriendView(row, me.id, friend, net ? net.toNumber() : 0);
    });

    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Pending requests, split into what I received and what I sent. */
export async function getPendingRequests() {
  try {
    const me = await getCurrentAppUser();

    const rows = await db.friendship.findMany({
      where: { ...involving(me.id), status: "PENDING" },
      include: {
        requester: { select: USER_FIELDS },
        addressee: { select: USER_FIELDS },
      },
      orderBy: { createdAt: "desc" },
    });

    const incoming = [];
    const outgoing = [];

    for (const row of rows) {
      const friend = row.requesterId === me.id ? row.addressee : row.requester;
      const view = toFriendView(row, me.id, friend, 0);

      if (view.status === FRIEND_STATUS.PENDING_INCOMING) incoming.push(view);
      else if (view.status === FRIEND_STATUS.PENDING_OUTGOING) outgoing.push(view);
    }

    return { success: true, data: { incoming, outgoing } };
  } catch (error) {
    return fail(error);
  }
}

/** Send a friend request, or accept one that is already waiting from them. */
export async function sendFriendRequest(targetUserId) {
  try {
    const me = await getCurrentAppUser();

    if (!targetUserId || targetUserId === me.id) {
      throw new AccessError(
        ACCESS_CODES.INVALID,
        "You cannot send a friend request to yourself"
      );
    }

    const target = await db.user.findUnique({
      where: { id: targetUserId },
      select: USER_FIELDS,
    });
    if (!target) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "User not found");
    }

    const [requesterId, addresseeId] = canonicalPair(me.id, target.id);
    const existing = await db.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId, addresseeId } },
    });

    const { action, reason } = resolveRequestAction(existing, me.id);

    if (action === "REJECT") {
      throw new AccessError(ACCESS_CODES.FORBIDDEN, reason);
    }

    if (action === "ACCEPT_EXISTING") {
      // They already asked us - accepting is the correct response to a second
      // request, and avoids a duplicate the unique constraint would reject.
      await db.friendship.update({
        where: { id: existing.id },
        data: { status: "ACCEPTED" },
      });
      revalidatePath("/split/friends");
      return { success: true, data: { status: FRIEND_STATUS.FRIENDS } };
    }

    const row = buildFriendshipRow(me.id, target.id);

    // upsert, not create: a previously removed pair leaves no row, but a
    // concurrent request could. Either way we end up with one PENDING row.
    await db.$transaction(async (tx) => {
      await tx.friendship.upsert({
        where: { requesterId_addresseeId: { requesterId, addresseeId } },
        create: row,
        update: { status: "PENDING", initiatedById: me.id },
      });

      await queueNotifications(tx, {
        type: "FRIEND_REQUEST",
        recipientIds: [target.id],
        actorId: me.id,
        context: { actor: me },
      });
    });

    revalidatePath("/split/friends");
    return { success: true, data: { status: FRIEND_STATUS.PENDING_OUTGOING } };
  } catch (error) {
    return fail(error);
  }
}

/** Accept a pending request addressed to me. */
export async function acceptFriendRequest(friendshipId) {
  try {
    const me = await getCurrentAppUser();
    const friendship = await db.friendship.findUnique({ where: { id: friendshipId } });

    if (!friendship || !canAccept(friendship, me.id)) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Friend request not found");
    }

    // The other party asked; tell them it was accepted.
    const otherId = otherUserId(friendship, me.id);

    await db.$transaction(async (tx) => {
      await tx.friendship.update({
        where: { id: friendship.id },
        data: { status: "ACCEPTED" },
      });

      await queueNotifications(tx, {
        type: "FRIEND_ACCEPTED",
        recipientIds: [otherId],
        actorId: me.id,
        context: { actor: me },
      });
    });

    revalidatePath("/split/friends");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Decline a request sent to me, or cancel one I sent. */
export async function cancelFriendRequest(friendshipId) {
  try {
    const me = await getCurrentAppUser();
    const friendship = await db.friendship.findUnique({ where: { id: friendshipId } });

    if (!friendship || !canCancel(friendship, me.id)) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Friend request not found");
    }

    // A declined request leaves no row, so either party can try again later.
    await db.friendship.delete({ where: { id: friendship.id } });

    revalidatePath("/split/friends");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Remove an accepted friend.
 *
 * Deletes only the friendship row. Shared expenses, splits and settlements are
 * untouched - the ledger is the source of truth and past history must stay
 * explainable (task.md section 1).
 */
export async function removeFriend(friendshipId) {
  try {
    const me = await getCurrentAppUser();
    const friendship = await db.friendship.findUnique({ where: { id: friendshipId } });

    if (!friendship || !canRemove(friendship, me.id)) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Friend not found");
    }

    const friendId = otherUserId(friendship, me.id);

    await db.friendship.delete({ where: { id: friendship.id } });

    revalidatePath("/split/friends");
    return { success: true, data: { friendId } };
  } catch (error) {
    return fail(error);
  }
}
