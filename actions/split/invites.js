"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import {
  getCurrentAppUser,
  assertGroupMember,
  assertCanManageGroup,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import {
  generateInviteToken,
  isValidTokenFormat,
  inviteStatus,
  inviteStatusMessage,
  resolveJoinAction,
  expiryFrom,
  inviteUrl,
  InviteError,
  INVITE_STATUS,
} from "@/lib/split/invites";
import { queueNotifications, deliverEmailsInBackground } from "./notify";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError || error instanceof InviteError) {
    return { success: false, error: error.message };
  }
  console.error("[split/invites]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/** The app's own origin, so a link works wherever this is deployed. */
async function currentOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Mint a shareable join link for a group.
 *
 * Only an owner or admin may create one: the link is a bearer credential for
 * the group's whole ledger, so handing out that power is a management action.
 */
export async function createGroupInvite(
  groupId,
  { expiresIn = "7", maxUses = null } = {}
) {
  try {
    const me = await getCurrentAppUser();
    await assertCanManageGroup(groupId, me.id);

    const cap = maxUses === null || maxUses === "" ? null : Number(maxUses);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
      throw new InviteError("A use limit must be a whole number of at least 1");
    }

    const invite = await db.groupInvite.create({
      data: {
        groupId,
        token: generateInviteToken(),
        createdById: me.id,
        expiresAt: expiryFrom(expiresIn),
        maxUses: cap,
      },
    });

    revalidatePath(`/split/groups/${groupId}`);

    return {
      success: true,
      data: {
        id: invite.id,
        token: invite.token,
        url: inviteUrl(invite.token, await currentOrigin()),
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Live links for a group, for the share panel. Members may see them. */
export async function getGroupInvites(groupId) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const rows = await db.groupInvite.findMany({
      where: { groupId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: USER_FIELDS } },
    });

    const origin = await currentOrigin();

    return {
      success: true,
      data: rows
        .filter((row) => inviteStatus(row) === INVITE_STATUS.OK)
        .map((row) => ({
          id: row.id,
          token: row.token,
          url: inviteUrl(row.token, origin),
          expiresAt: row.expiresAt,
          maxUses: row.maxUses,
          useCount: row.useCount,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        })),
    };
  } catch (error) {
    return fail(error);
  }
}

/** Turn a link off. Never deleted, so it keeps failing closed with a reason. */
export async function revokeGroupInvite(inviteId) {
  try {
    const me = await getCurrentAppUser();

    const invite = await db.groupInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, groupId: true, revokedAt: true },
    });
    if (!invite) throw new AccessError(ACCESS_CODES.NOT_FOUND, "Invite not found");

    await assertCanManageGroup(invite.groupId, me.id);

    if (!invite.revokedAt) {
      await db.groupInvite.update({
        where: { id: inviteId },
        data: { revokedAt: new Date() },
      });
    }

    revalidatePath(`/split/groups/${invite.groupId}`);
    return { success: true, data: { id: inviteId } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * What a join link points at, for the confirmation screen.
 *
 * Deliberately returns only the group's name, icon and size - never its
 * expenses or balances. Someone holding a link has not joined yet, and a bad
 * link must not become a way to read a group's ledger.
 */
export async function previewGroupInvite(token) {
  try {
    if (!isValidTokenFormat(token)) {
      return {
        success: false,
        error: inviteStatusMessage(INVITE_STATUS.NOT_FOUND),
        status: INVITE_STATUS.NOT_FOUND,
      };
    }

    const invite = await db.groupInvite.findUnique({
      where: { token },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            isArchived: true,
            _count: { select: { members: true } },
          },
        },
      },
    });

    const status = inviteStatus(invite);
    if (status !== INVITE_STATUS.OK) {
      return { success: false, error: inviteStatusMessage(status), status };
    }
    if (invite.group.isArchived) {
      return { success: false, error: "This group has been archived." };
    }

    const me = await getCurrentAppUser();
    const membership = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: invite.groupId, userId: me.id } },
      select: { leftAt: true },
    });

    return {
      success: true,
      data: {
        group: {
          id: invite.group.id,
          name: invite.group.name,
          description: invite.group.description,
          icon: invite.group.icon,
          memberCount: invite.group._count.members,
        },
        alreadyMember: Boolean(membership && !membership.leftAt),
        expiresAt: invite.expiresAt,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Accept an invite.
 *
 * The check and the join run in one transaction, and the use count is claimed
 * with a compare-and-swap whose WHERE clause re-checks the cap. Two people
 * redeeming the last use at the same moment cannot both get in.
 */
export async function joinGroupViaInvite(token) {
  try {
    const me = await getCurrentAppUser();

    if (!isValidTokenFormat(token)) {
      throw new InviteError(inviteStatusMessage(INVITE_STATUS.NOT_FOUND));
    }

    const outcome = await db.$transaction(async (tx) => {
      const invite = await tx.groupInvite.findUnique({
        where: { token },
        include: { group: { select: { id: true, name: true, isArchived: true } } },
      });

      const membership = invite
        ? await tx.groupMember.findUnique({
            where: { groupId_userId: { groupId: invite.groupId, userId: me.id } },
            select: { id: true, leftAt: true },
          })
        : null;

      const decision = resolveJoinAction({ invite, membership });

      if (decision.action === "REJECT") {
        throw new InviteError(decision.message);
      }
      if (invite.group.isArchived) {
        throw new InviteError("This group has been archived.");
      }
      if (decision.action === "ALREADY_MEMBER") {
        return { groupId: invite.groupId, groupName: invite.group.name, joined: false };
      }

      // Claim a use first: if the cap is already taken the join must not happen.
      //
      // The cap is expressed by *omitting* the useCount predicate for an
      // unlimited link rather than comparing against a sentinel maximum -
      // maxUses is an INT4 column, so any JS sentinel large enough to mean
      // "no limit" overflows it and the query fails outright.
      const claimed = await tx.groupInvite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          ...(invite.maxUses === null
            ? {}
            : { useCount: { lt: invite.maxUses } }),
        },
        data: { useCount: { increment: 1 } },
      });

      if (claimed.count === 0) {
        throw new InviteError(inviteStatusMessage(INVITE_STATUS.USED_UP));
      }

      if (decision.action === "REJOIN") {
        await tx.groupMember.update({
          where: { id: membership.id },
          data: { leftAt: null, joinedAt: new Date() },
        });
      } else {
        await tx.groupMember.create({
          data: { groupId: invite.groupId, userId: me.id, role: "MEMBER" },
        });
      }

      await tx.sharedExpenseActivity.create({
        data: {
          groupId: invite.groupId,
          actorId: me.id,
          type: "MEMBER_ADDED",
          metadata: { via: "invite-link", userId: me.id },
        },
      });

      const others = await tx.groupMember.findMany({
        where: { groupId: invite.groupId, leftAt: null, userId: { not: me.id } },
        select: { userId: true },
      });

      const emails = await queueNotifications(tx, {
        type: "GROUP_JOINED",
        recipientIds: others.map((o) => o.userId),
        actorId: me.id,
        context: { actor: me, group: invite.group },
      });

      return {
        groupId: invite.groupId,
        groupName: invite.group.name,
        joined: true,
        emails,
      };
    });

    if (outcome.emails?.length) deliverEmailsInBackground(outcome.emails);

    revalidatePath("/split/groups");
    revalidatePath(`/split/groups/${outcome.groupId}`);

    return {
      success: true,
      data: {
        groupId: outcome.groupId,
        groupName: outcome.groupName,
        joined: outcome.joined,
      },
    };
  } catch (error) {
    return fail(error);
  }
}
