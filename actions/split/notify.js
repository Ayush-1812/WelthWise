import "server-only";

import { db } from "@/lib/prisma";
import { buildNotification, recipientsFor, shouldEmail } from "@/lib/split/notifications";
import { sendEmail } from "@/actions/send-email";
import NotificationEmail from "@/emails/notification";

/**
 * Notification delivery (M16).
 *
 * Two channels with deliberately different guarantees:
 *
 *   in-app  written inside the caller's transaction, so an event and its
 *           notifications commit together - exactly one row per recipient.
 *   email   sent after the transaction commits, best-effort, wrapped so a
 *           failure can never roll back or block the underlying action.
 *
 * The app has no verified Resend domain yet, so email delivery is expected to
 * fail for most recipients. That must stay invisible to the user.
 */

/**
 * Queue in-app notifications inside an existing transaction.
 *
 * @param {object} tx      Prisma transaction client
 * @param {object} args
 * @param {string} args.type
 * @param {string[]} args.recipientIds  people to notify
 * @param {string} [args.actorId]       excluded automatically
 * @param {object} [args.context]       passed to buildNotification
 * @returns {Array} the payloads written, for the email pass afterwards
 */
export async function queueNotifications(tx, { type, recipientIds, actorId = null, context = {} }) {
  const recipients = recipientsFor({ candidateIds: recipientIds, actorId });
  if (recipients.length === 0) return [];

  const payload = buildNotification(type, { ...context, actor: context.actor });
  if (!payload) return [];

  // createMany is one round trip and cannot partially succeed.
  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      actorId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      linkUrl: payload.linkUrl ?? null,
      metadata: context.metadata ?? undefined,
    })),
  });

  return recipients.map((userId) => ({ userId, ...payload }));
}

/**
 * Per-recipient notifications, for events where the text differs per person -
 * an expense where everyone has a different share, for example.
 */
export async function queuePersonalised(tx, { type, actorId = null, entries = [] }) {
  const rows = [];

  for (const entry of entries) {
    if (!entry.userId || entry.userId === actorId) continue;

    const payload = buildNotification(type, entry.context ?? {});
    if (!payload) continue;

    rows.push({
      userId: entry.userId,
      actorId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      linkUrl: payload.linkUrl ?? null,
      metadata: entry.metadata ?? undefined,
    });
  }

  if (rows.length === 0) return [];

  await tx.notification.createMany({ data: rows });
  return rows;
}

/**
 * Send email for the notifications that warrant it.
 *
 * Call AFTER the transaction has committed. Never throws: a bounced email must
 * not make a saved expense look like it failed.
 */
export async function deliverEmails(payloads = []) {
  const worthy = payloads.filter((p) => shouldEmail(p.type));
  if (worthy.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  try {
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(worthy.map((p) => p.userId))] } },
      select: { id: true, email: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    await Promise.all(
      worthy.map(async (payload) => {
        const user = byId.get(payload.userId);
        if (!user?.email) {
          failed++;
          return;
        }

        try {
          const result = await sendEmail({
            to: user.email,
            subject: payload.title,
            react: NotificationEmail({
              userName: user.name,
              title: payload.title,
              body: payload.body,
              linkUrl: payload.linkUrl,
            }),
          });
          if (result?.success) sent++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );
  } catch (error) {
    // Logged, never surfaced - in-app notifications already landed.
    console.error("[split/notify] email delivery failed:", error.message);
    return { sent, failed: worthy.length - sent };
  }

  return { sent, failed };
}

/**
 * Fire-and-forget email delivery.
 * Used by server actions that must return promptly and must not fail on email.
 */
export function deliverEmailsInBackground(payloads = []) {
  deliverEmails(payloads).catch((error) => {
    console.error("[split/notify] background email failed:", error.message);
  });
}
