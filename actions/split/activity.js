"use server";

import { db } from "@/lib/prisma";
import {
  getCurrentAppUser,
  assertGroupMember,
  AccessError,
} from "@/lib/split/auth";
import { nameResolver, describeActivity } from "@/lib/split/activity";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/activity]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * A group's activity feed, newest first.
 *
 * Sentences are rendered server-side through the shared formatter so every
 * surface phrases the same event identically.
 *
 * Cursor pagination on createdAt+id, which is stable as new rows arrive -
 * offset paging would shift rows under the reader.
 */
export async function getGroupActivity(groupId, { limit = 20, cursor = null } = {}) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const rows = await db.sharedExpenseActivity.findMany({
      where: { groupId },
      include: { actor: { select: USER_FIELDS } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // one extra tells us whether more exist
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Activity metadata references users who may not be the actor - the person
    // added, the counterparty in a settlement - so resolve those names too.
    const referenced = new Set();
    for (const row of page) {
      const meta = row.metadata ?? {};
      for (const id of meta.memberIds ?? []) referenced.add(id);
      for (const key of ["targetUserId", "fromUserId", "toUserId", "newPaidById"]) {
        if (meta[key]) referenced.add(meta[key]);
      }
    }

    const extraUsers = referenced.size
      ? await db.user.findMany({
          where: { id: { in: [...referenced] } },
          select: USER_FIELDS,
        })
      : [];

    const users = [...page.map((r) => r.actor).filter(Boolean), ...extraUsers];
    const nameOf = nameResolver({ viewerId: me.id, users });

    const data = page.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      actor: row.actor,
      expenseId: row.expenseId,
      settlementId: row.settlementId,
      isMine: row.actorId === me.id,
      text: describeActivity(row, { viewerId: me.id, nameOf }),
    }));

    return {
      success: true,
      data: {
        items: data,
        nextCursor: hasMore ? page[page.length - 1].id : null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}
