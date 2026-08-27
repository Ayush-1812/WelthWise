"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { getCurrentAppUser, AccessError } from "@/lib/split/auth";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/notifications]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/** The caller's notifications, newest first, with an unread count. */
export async function getNotifications({ limit = 20, unreadOnly = false } = {}) {
  try {
    const me = await getCurrentAppUser();

    const [items, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId: me.id, ...(unreadOnly ? { readAt: null } : {}) },
        include: { actor: { select: USER_FIELDS } },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.notification.count({ where: { userId: me.id, readAt: null } }),
    ]);

    return {
      success: true,
      data: {
        unreadCount,
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          linkUrl: n.linkUrl,
          createdAt: n.createdAt,
          isRead: n.readAt !== null,
          actor: n.actor,
        })),
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Unread count only - cheap enough for the header on every render. */
export async function getUnreadCount() {
  try {
    const me = await getCurrentAppUser();
    const count = await db.notification.count({
      where: { userId: me.id, readAt: null },
    });
    return { success: true, data: { count } };
  } catch {
    // The header must never break because notifications are unavailable.
    return { success: true, data: { count: 0 } };
  }
}

/** Mark one notification read. Scoped to the caller so ids cannot be probed. */
export async function markNotificationRead(notificationId) {
  try {
    const me = await getCurrentAppUser();

    await db.notification.updateMany({
      where: { id: notificationId, userId: me.id, readAt: null },
      data: { readAt: new Date() },
    });

    revalidatePath("/split");
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/** Mark everything read. */
export async function markAllNotificationsRead() {
  try {
    const me = await getCurrentAppUser();

    const result = await db.notification.updateMany({
      where: { userId: me.id, readAt: null },
      data: { readAt: new Date() },
    });

    revalidatePath("/split");
    return { success: true, data: { count: result.count } };
  } catch (error) {
    return fail(error);
  }
}
