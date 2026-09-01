"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { serializeMoney, Decimal } from "@/lib/money";
import {
  getCurrentAppUser,
  assertGroupMember,
  assertCanManageGroup,
  getMembership,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { areFriendsFrom } from "@/lib/split/friends";
import { canonicalPair, canRemoveMember } from "@/lib/split/access";
import {
  validateGroupInput,
  countOwners,
  isSettledForRemoval,
  canTransferOwnership,
  canChangeRole,
  sortMembers,
} from "@/lib/split/groups";
import { computeNetBalances, netBalanceFor } from "@/lib/split/balances";
import { loadGroupLedger } from "@/lib/split/ledger";
import { reportLedgerIn } from "@/lib/split/currency";
import { queueNotifications, deliverEmailsInBackground } from "./notify";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/groups]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Load a group's ledger rows for balance derivation.
 * Balances are never stored - see task.md section 1.
 */
// loadGroupLedger lives in lib/split/ledger.js. A private copy here used to
// drift from it - notably it never selected `currency`, so this file summed
// two currencies together long after the shared loader stopped doing so.

/** Groups the caller is an active member of, with their own net balance. */
export async function getGroups() {
  try {
    const me = await getCurrentAppUser();

    const memberships = await db.groupMember.findMany({
      where: { userId: me.id, leftAt: null },
      include: {
        group: {
          include: {
            _count: { select: { expenses: true } },
            members: {
              where: { leftAt: null },
              include: { user: { select: USER_FIELDS } },
            },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const active = memberships.filter((m) => !m.group.isArchived);
    const archived = memberships.filter((m) => m.group.isArchived);

    const shape = async (membership) => {
      const { ledger, currency } = reportLedgerIn(
        await loadGroupLedger(membership.groupId),
        { preferred: me.preferredCurrency }
      );
      const net = netBalanceFor(ledger, me.id);

      return {
        id: membership.group.id,
        name: membership.group.name,
        description: membership.group.description,
        icon: membership.group.icon,
        isArchived: membership.group.isArchived,
        role: membership.role,
        memberCount: membership.group.members.length,
        expenseCount: membership.group._count.expenses,
        members: membership.group.members.map((m) => m.user),
        netBalance: net.toNumber(),
        currency,
      };
    };

    return {
      success: true,
      data: {
        active: await Promise.all(active.map(shape)),
        archived: await Promise.all(archived.map(shape)),
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** One group with its members and per-member balances. */
export async function getGroup(groupId) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const group = await db.expenseGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { leftAt: null },
          include: { user: { select: USER_FIELDS } },
        },
        _count: { select: { expenses: true, settlements: true } },
      },
    });

    if (!group) throw new AccessError(ACCESS_CODES.NOT_FOUND, "Group not found");

    const { ledger, currency } = reportLedgerIn(await loadGroupLedger(groupId), {
      preferred: me.preferredCurrency,
    });
    const net = computeNetBalances(ledger);

    const members = sortMembers(group.members).map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
      netBalance: (net.get(m.userId) ?? new Decimal(0)).toNumber(),
    }));

    return {
      success: true,
      data: serializeMoney({
        id: group.id,
        name: group.name,
        description: group.description,
        icon: group.icon,
        isArchived: group.isArchived,
        createdAt: group.createdAt,
        expenseCount: group._count.expenses,
        settlementCount: group._count.settlements,
        myRole: members.find((m) => m.userId === me.id)?.role ?? "MEMBER",
        myUserId: me.id,
        currency,
        members,
      }),
    };
  } catch (error) {
    return fail(error);
  }
}

/** Create a group. The creator becomes its OWNER. */
export async function createGroup(input) {
  try {
    const me = await getCurrentAppUser();
    const { name, description, icon } = validateGroupInput(input);

    const memberIds = [...new Set(input?.memberIds ?? [])].filter(
      (id) => id !== me.id
    );

    // Every invitee must already be an accepted friend.
    for (const id of memberIds) {
      const [requesterId, addresseeId] = canonicalPair(me.id, id);
      const friendship = await db.friendship.findUnique({
        where: { requesterId_addresseeId: { requesterId, addresseeId } },
      });
      if (!areFriendsFrom(friendship)) {
        throw new AccessError(
          ACCESS_CODES.FORBIDDEN,
          "You can only add friends to a group"
        );
      }
    }

    const emails = [];

    const group = await db.$transaction(async (tx) => {
      const created = await tx.expenseGroup.create({
        data: {
          name,
          description,
          icon,
          createdById: me.id,
          members: {
            create: [
              { userId: me.id, role: "OWNER" },
              ...memberIds.map((userId) => ({ userId, role: "MEMBER" })),
            ],
          },
        },
      });

      await tx.sharedExpenseActivity.create({
        data: {
          groupId: created.id,
          actorId: me.id,
          type: "GROUP_CREATED",
          metadata: { name: created.name },
        },
      });

      // Members added at creation are part of the same story.
      if (memberIds.length > 0) {
        await tx.sharedExpenseActivity.create({
          data: {
            groupId: created.id,
            actorId: me.id,
            type: "MEMBER_ADDED",
            metadata: { memberIds },
          },
        });

        emails.push(
          ...(await queueNotifications(tx, {
            type: "GROUP_ADDED",
            recipientIds: memberIds,
            actorId: me.id,
            context: { actor: me, group: created },
          }))
        );
      }

      return created;
    });

    // Email after the transaction commits, so a bounce cannot roll it back.
    deliverEmailsInBackground(emails);

    revalidatePath("/split/groups");
    return { success: true, data: { id: group.id, name: group.name } };
  } catch (error) {
    return fail(error);
  }
}

/** Rename a group or change its icon/description. */
export async function updateGroup(groupId, input) {
  try {
    const me = await getCurrentAppUser();
    await assertCanManageGroup(groupId, me.id);

    const { name, description, icon } = validateGroupInput(input);

    await db.expenseGroup.update({
      where: { id: groupId },
      data: { name, description, icon },
    });

    revalidatePath("/split/groups");
    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Add friends to an existing group. */
export async function addGroupMembers(groupId, userIds) {
  try {
    const me = await getCurrentAppUser();
    await assertCanManageGroup(groupId, me.id);

    const wanted = [...new Set(userIds ?? [])];
    if (wanted.length === 0) {
      throw new AccessError(ACCESS_CODES.INVALID, "Select at least one friend");
    }

    for (const id of wanted) {
      const [requesterId, addresseeId] = canonicalPair(me.id, id);
      const friendship = await db.friendship.findUnique({
        where: { requesterId_addresseeId: { requesterId, addresseeId } },
      });
      if (!areFriendsFrom(friendship)) {
        throw new AccessError(
          ACCESS_CODES.FORBIDDEN,
          "You can only add friends to a group"
        );
      }
    }

    const addedEmails = [];

    // upsert handles the rejoin case: @@unique([groupId, userId]) means a
    // member who previously left must be reactivated, not inserted again.
    await db.$transaction(async (tx) => {
      for (const userId of wanted) {
        await tx.groupMember.upsert({
          where: { groupId_userId: { groupId, userId } },
          create: { groupId, userId, role: "MEMBER" },
          update: { leftAt: null },
        });
      }

      await tx.sharedExpenseActivity.create({
        data: {
          groupId,
          actorId: me.id,
          type: "MEMBER_ADDED",
          metadata: { memberIds: wanted },
        },
      });

      const group = await tx.expenseGroup.findUnique({
        where: { id: groupId },
        select: { id: true, name: true },
      });

      addedEmails.push(
        ...(await queueNotifications(tx, {
          type: "GROUP_ADDED",
          recipientIds: wanted,
          actorId: me.id,
          context: { actor: me, group },
        }))
      );
    });

    deliverEmailsInBackground(addedEmails);

    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Remove a member, or leave the group yourself.
 *
 * Refuses while the member holds a non-zero balance - dropping them would
 * break the "group balances sum to zero" invariant.
 */
export async function removeGroupMember(groupId, targetUserId) {
  try {
    const me = await getCurrentAppUser();

    const actorMembership = await assertGroupMember(groupId, me.id);
    const targetMembership = await getMembership(groupId, targetUserId);

    if (!targetMembership) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "That member is not in this group");
    }

    const members = await db.groupMember.findMany({
      where: { groupId, leftAt: null },
    });

    if (
      !canRemoveMember({
        actorMembership,
        targetMembership,
        ownerCount: countOwners(members),
      })
    ) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        targetMembership.role === "OWNER"
          ? "Transfer ownership before removing the last owner"
          : "You do not have permission to remove this member"
      );
    }

    const { ledger } = reportLedgerIn(await loadGroupLedger(groupId), {
      preferred: me.preferredCurrency,
    });
    const net = netBalanceFor(ledger, targetUserId);

    if (!isSettledForRemoval(net)) {
      const owed = net.isNegative() ? "owes" : "is owed";
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        `Cannot remove someone who still ${owed} money - settle up first`
      );
    }

    // Soft removal: the row and their past splits stay, so history and any
    // settlement that referenced them remain explainable.
    await db.$transaction(async (tx) => {
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { leftAt: new Date() },
      });

      await tx.sharedExpenseActivity.create({
        data: {
          groupId,
          actorId: me.id,
          type: "MEMBER_REMOVED",
          metadata: {
            targetUserId,
            // Leaving and being removed read very differently in the feed.
            self: targetUserId === me.id,
          },
        },
      });
    });

    revalidatePath("/split/groups");
    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Promote or demote a member. OWNER is only reachable via transferOwnership. */
export async function changeMemberRole(groupId, targetUserId, nextRole) {
  try {
    const me = await getCurrentAppUser();
    const actorMembership = await assertGroupMember(groupId, me.id);
    const targetMembership = await getMembership(groupId, targetUserId);

    if (!targetMembership) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "That member is not in this group");
    }

    if (!canChangeRole(actorMembership, targetMembership, nextRole)) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        "Only the group owner can change roles"
      );
    }

    await db.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { role: nextRole },
    });

    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Hand ownership to another active member; the old owner becomes ADMIN. */
export async function transferOwnership(groupId, targetUserId) {
  try {
    const me = await getCurrentAppUser();
    const actorMembership = await assertGroupMember(groupId, me.id);
    const targetMembership = await getMembership(groupId, targetUserId);

    if (!targetMembership) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "That member is not in this group");
    }

    if (!canTransferOwnership(actorMembership, targetMembership)) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        "Only the group owner can transfer ownership"
      );
    }

    await db.$transaction([
      db.groupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { role: "OWNER" },
      }),
      db.groupMember.update({
        where: { groupId_userId: { groupId, userId: me.id } },
        data: { role: "ADMIN" },
      }),
    ]);

    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Archive or restore a group.
 * Archiving hides it and blocks management; it never deletes ledger rows.
 */
export async function setGroupArchived(groupId, isArchived) {
  try {
    const me = await getCurrentAppUser();

    // assertCanManageGroup refuses archived groups, so check the role directly
    // in order to allow un-archiving.
    const membership = await assertGroupMember(groupId, me.id);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new AccessError(
        ACCESS_CODES.INSUFFICIENT_ROLE,
        "Only an owner or admin can archive this group"
      );
    }

    if (isArchived) {
      const { ledger } = reportLedgerIn(await loadGroupLedger(groupId), {
        preferred: me.preferredCurrency,
      });
      const net = computeNetBalances(ledger);
      const unsettled = [...net.values()].some((v) => !v.isZero());

      if (unsettled) {
        throw new AccessError(
          ACCESS_CODES.FORBIDDEN,
          "Settle all balances before archiving this group"
        );
      }
    }

    await db.expenseGroup.update({
      where: { id: groupId },
      data: { isArchived: Boolean(isArchived) },
    });

    revalidatePath("/split/groups");
    revalidatePath(`/split/groups/${groupId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}
