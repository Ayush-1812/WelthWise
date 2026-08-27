"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { toDecimal, round, serializeMoney } from "@/lib/money";
import {
  getCurrentAppUser,
  assertValidParticipants,
  assertGroupMember,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { computeSplit, validateSplit, SplitError } from "@/lib/split/engine";
import {
  RecurringError,
  validateRecurringInput,
  describeSchedule,
} from "@/lib/split/recurring";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (
    error instanceof AccessError ||
    error instanceof SplitError ||
    error instanceof RecurringError
  ) {
    return { success: false, error: error.message };
  }
  console.error("[split/recurring]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Create a recurring shared-expense template.
 *
 * The split is validated once at creation so a schedule can never be saved in a
 * state that would fail every time it fires. The participant weights are frozen
 * into splitTemplate; amounts are recomputed at generation time.
 */
export async function createRecurringExpense(input) {
  try {
    const me = await getCurrentAppUser();

    const { description, interval, every, nextRunDate, endDate } =
      validateRecurringInput(input);

    const groupId = input?.groupId || null;
    const amount = round(toDecimal(input?.amount));
    if (amount.isZero() || amount.isNegative()) {
      throw new RecurringError("Amount must be greater than zero");
    }

    const participantIds = await assertValidParticipants({
      groupId,
      actorId: me.id,
      participantIds: input?.participantIds ?? [],
    });

    const paidById = input?.paidById ?? me.id;
    if (!participantIds.includes(paidById)) {
      throw new AccessError(
        ACCESS_CODES.INVALID,
        "The payer must be one of the participants"
      );
    }

    // Prove the split works now rather than discovering it at 00:00.
    const splits = computeSplit({
      method: input?.splitMethod ?? "EQUAL",
      total: amount,
      participantIds,
      values: input?.splitValues ?? {},
      payerId: paidById,
    });
    const check = validateSplit(amount, splits);
    if (!check.ok) throw new SplitError(check.errors[0]);

    const template = await db.$transaction(async (tx) => {
      const created = await tx.recurringSharedExpense.create({
        data: {
          groupId,
          description,
          amount,
          category: input?.category ?? "other-expense",
          notes: input?.notes?.trim() || null,
          splitMethod: input?.splitMethod ?? "EQUAL",
          // Frozen weights - amounts are recomputed each run.
          splitTemplate: splits.map((s) => ({
            userId: s.userId,
            shareInput: s.shareInput ? s.shareInput.toString() : null,
          })),
          paidById,
          createdById: me.id,
          interval,
          every,
          nextRunDate,
          endDate,
        },
      });

      if (groupId) {
        await tx.sharedExpenseActivity.create({
          data: {
            groupId,
            actorId: me.id,
            type: "RECURRING_CREATED",
            metadata: {
              description,
              amount: amount.toFixed(2),
              schedule: describeSchedule({ interval, every }),
            },
          },
        });
      }

      return created;
    });

    revalidatePath("/split/expenses");
    if (groupId) revalidatePath(`/split/groups/${groupId}`);

    return { success: true, data: { id: template.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Templates the caller can see. */
export async function getRecurringExpenses({ groupId = null } = {}) {
  try {
    const me = await getCurrentAppUser();
    if (groupId) await assertGroupMember(groupId, me.id);

    const rows = await db.recurringSharedExpense.findMany({
      where: groupId
        ? { groupId }
        : {
            OR: [
              { createdById: me.id },
              { paidById: me.id },
              { group: { members: { some: { userId: me.id, leftAt: null } } } },
            ],
          },
      include: {
        paidBy: { select: USER_FIELDS },
        group: { select: { id: true, name: true, icon: true } },
        _count: { select: { generated: true } },
      },
      orderBy: [{ isActive: "desc" }, { nextRunDate: "asc" }],
    });

    return {
      success: true,
      data: rows.map((row) =>
        serializeMoney({
          id: row.id,
          description: row.description,
          amount: row.amount,
          category: row.category,
          interval: row.interval,
          every: row.every,
          schedule: describeSchedule({ interval: row.interval, every: row.every }),
          nextRunDate: row.nextRunDate,
          lastRunAt: row.lastRunAt,
          endDate: row.endDate,
          isActive: row.isActive,
          generatedCount: row._count.generated,
          paidBy: row.paidBy,
          group: row.group,
          canManage: row.createdById === me.id || row.paidById === me.id,
        })
      ),
    };
  } catch (error) {
    return fail(error);
  }
}

/** Pause or resume a template. */
export async function setRecurringActive(recurringId, isActive) {
  try {
    const me = await getCurrentAppUser();

    const template = await db.recurringSharedExpense.findUnique({
      where: { id: recurringId },
    });
    if (!template) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Recurring expense not found");
    }
    if (template.createdById !== me.id && template.paidById !== me.id) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        "Only the payer or whoever set this up can change it"
      );
    }

    await db.recurringSharedExpense.update({
      where: { id: recurringId },
      data: { isActive: Boolean(isActive) },
    });

    revalidatePath("/split/expenses");
    if (template.groupId) revalidatePath(`/split/groups/${template.groupId}`);

    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Delete a template.
 *
 * Expenses it already generated are kept - they are real ledger entries. The
 * foreign key is SET NULL, so they simply stop pointing at a template.
 */
export async function deleteRecurringExpense(recurringId) {
  try {
    const me = await getCurrentAppUser();

    const template = await db.recurringSharedExpense.findUnique({
      where: { id: recurringId },
    });
    if (!template) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Recurring expense not found");
    }
    if (template.createdById !== me.id && template.paidById !== me.id) {
      throw new AccessError(
        ACCESS_CODES.FORBIDDEN,
        "Only the payer or whoever set this up can delete it"
      );
    }

    await db.recurringSharedExpense.delete({ where: { id: recurringId } });

    revalidatePath("/split/expenses");
    if (template.groupId) revalidatePath(`/split/groups/${template.groupId}`);

    return { success: true };
  } catch (error) {
    return fail(error);
  }
}
