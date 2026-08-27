import "server-only";

import { db } from "@/lib/prisma";
import { toDecimal, round } from "@/lib/money";
import { computeSplit, validateSplit } from "@/lib/split/engine";
import { duePeriods, nextRunAfter, isExhausted } from "@/lib/split/recurring";
import { buildNotification } from "@/lib/split/notifications";
import { syncExpenseToPersonal } from "@/actions/split/personal-sync";

/**
 * Generation of recurring shared expenses (M17).
 *
 * Idempotency is the whole point. Two independent defences:
 *
 *   1. UNIQUE (recurringId, periodKey) in the database. A duplicate insert
 *      raises P2002 and is treated as "already done" rather than an error.
 *   2. The template's nextRunDate is advanced in the same transaction, so a
 *      concurrent runner sees the new date and finds nothing due.
 *
 * The database constraint is the real guarantee - the date check alone would
 * be racy under concurrent cron delivery, which Inngest can do on retry.
 */

const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Generate one occurrence of a template.
 *
 * @returns {{ created: boolean, reason?: string, expenseId?: string }}
 */
export async function generateOccurrence(template, period) {
  const amount = round(toDecimal(template.amount));

  const frozen = Array.isArray(template.splitTemplate) ? template.splitTemplate : [];
  const participantIds = frozen.map((s) => s.userId).filter(Boolean);

  if (participantIds.length === 0) {
    return { created: false, reason: "no participants in template" };
  }

  const values = {};
  for (const entry of frozen) {
    if (entry.shareInput !== null && entry.shareInput !== undefined) {
      values[entry.userId] = entry.shareInput;
    }
  }

  const splits = computeSplit({
    method: template.splitMethod,
    total: amount,
    participantIds,
    values,
    payerId: template.paidById,
  });

  const check = validateSplit(amount, splits);
  if (!check.ok) {
    return { created: false, reason: `invalid split: ${check.errors[0]}` };
  }

  try {
    return await db.$transaction(async (tx) => {
      const expense = await tx.sharedExpense.create({
        data: {
          groupId: template.groupId,
          description: template.description,
          amount,
          date: period.runDate,
          category: template.category,
          notes: template.notes,
          splitMethod: template.splitMethod,
          paidById: template.paidById,
          createdById: template.createdById,
          // The idempotency key. A retry hits the unique index and aborts.
          recurringId: template.id,
          periodKey: period.periodKey,
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              shareAmount: s.shareAmount.toFixed(2),
              shareInput: s.shareInput ? s.shareInput.toString() : null,
            })),
          },
        },
      });

      // Personal-finance side for the payer (M12).
      const payerAccount = await tx.account.findFirst({
        where: { userId: template.paidById, isDefault: true },
        select: { id: true },
      });

      if (payerAccount) {
        await syncExpenseToPersonal(tx, {
          expenseId: expense.id,
          userId: template.paidById,
          accountId: payerAccount.id,
          paidById: template.paidById,
          amount,
          myShare:
            splits.find((s) => s.userId === template.paidById)?.shareAmount ?? 0,
          description: template.description,
          category: template.category,
          date: period.runDate,
        });
      }

      if (template.groupId) {
        await tx.sharedExpenseActivity.create({
          data: {
            groupId: template.groupId,
            // No actor: the schedule did this, not a person.
            actorId: template.createdById,
            type: "RECURRING_GENERATED",
            expenseId: expense.id,
            metadata: {
              description: template.description,
              amount: amount.toFixed(2),
              periodKey: period.periodKey,
            },
          },
        });
      }

      // Notify every participant, including the payer - nobody triggered this.
      const payload = buildNotification("RECURRING_GENERATED", {
        expense: { id: expense.id, description: template.description, amount },
        group: template.group,
      });

      if (payload) {
        await tx.notification.createMany({
          data: participantIds.map((userId) => ({
            userId,
            actorId: null,
            type: "RECURRING_GENERATED",
            title: payload.title,
            body: payload.body ?? null,
            linkUrl: payload.linkUrl ?? null,
          })),
        });
      }

      return { created: true, expenseId: expense.id };
    });
  } catch (error) {
    if (error?.code === PRISMA_UNIQUE_VIOLATION) {
      // Another runner already generated this exact period. Not an error.
      return { created: false, reason: "already generated" };
    }
    throw error;
  }
}

/**
 * Advance a template past a period.
 *
 * Conditional on nextRunDate not having moved, so two concurrent runners cannot
 * both claim the same period even before the unique index is reached.
 */
export async function advanceTemplate(template, period) {
  const next = nextRunAfter(template, period.runDate);
  const exhausted = isExhausted(template, next);

  const result = await db.recurringSharedExpense.updateMany({
    where: { id: template.id, nextRunDate: template.nextRunDate },
    data: {
      nextRunDate: next,
      lastRunAt: new Date(),
      // A template past its end date stops rather than lingering as due.
      isActive: exhausted ? false : template.isActive,
    },
  });

  return { advanced: result.count === 1, next, exhausted };
}

/**
 * Run every template that is due.
 * Safe to call repeatedly: re-running produces zero new expenses.
 */
export async function processDueRecurringExpenses({ now = new Date(), maxCatchUp = 12 } = {}) {
  const templates = await db.recurringSharedExpense.findMany({
    where: { isActive: true, nextRunDate: { lte: now } },
    include: { group: { select: { id: true, name: true, icon: true } } },
  });

  const summary = { templates: templates.length, created: 0, skipped: 0, failed: 0 };

  for (const template of templates) {
    let current = template;

    for (const period of duePeriods(current, now, { max: maxCatchUp })) {
      try {
        const result = await generateOccurrence(current, period);
        if (result.created) summary.created++;
        else summary.skipped++;

        const { advanced, next } = await advanceTemplate(current, period);
        if (!advanced) break; // another runner moved it; let them continue

        current = { ...current, nextRunDate: next };
      } catch (error) {
        summary.failed++;
        console.error(
          `[recurring] template ${template.id} period ${period.periodKey}:`,
          error.message
        );
        break; // stop this template; the next cron run will retry
      }
    }
  }

  return summary;
}
