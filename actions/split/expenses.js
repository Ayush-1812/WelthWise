"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { serializeMoney, toDecimal, round } from "@/lib/money";
import {
  getCurrentAppUser,
  assertValidParticipants,
  assertCanViewExpense,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { computeSplit, validateSplit, SplitError } from "@/lib/split/engine";
import { sharedExpenseSchema } from "@/app/lib/schema";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  if (error instanceof AccessError || error instanceof SplitError) {
    return { success: false, error: error.message };
  }
  console.error("[split/expenses]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Everything the add-expense form needs: the caller's groups (with members)
 * and friends, so the participant picker can be built without a second call.
 */
export async function getExpenseFormContext() {
  try {
    const me = await getCurrentAppUser();

    const [memberships, friendships] = await Promise.all([
      db.groupMember.findMany({
        where: { userId: me.id, leftAt: null },
        include: {
          group: {
            include: {
              members: {
                where: { leftAt: null },
                include: { user: { select: USER_FIELDS } },
              },
            },
          },
        },
      }),
      db.friendship.findMany({
        where: {
          status: "ACCEPTED",
          OR: [{ requesterId: me.id }, { addresseeId: me.id }],
        },
        include: {
          requester: { select: USER_FIELDS },
          addressee: { select: USER_FIELDS },
        },
      }),
    ]);

    const groups = memberships
      .filter((m) => !m.group.isArchived)
      .map((m) => ({
        id: m.group.id,
        name: m.group.name,
        icon: m.group.icon,
        members: m.group.members.map((gm) => gm.user),
      }));

    const friends = friendships.map((f) =>
      f.requesterId === me.id ? f.addressee : f.requester
    );

    return {
      success: true,
      data: { me: { id: me.id, name: me.name, email: me.email, imageUrl: me.imageUrl }, groups, friends },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Create a shared expense and its splits atomically.
 *
 * The split is recomputed and re-validated server-side. Client-supplied share
 * amounts are never trusted - only the method and the per-participant inputs
 * are taken from the request (task.md section 1, Security).
 */
export async function createSharedExpense(input) {
  try {
    const me = await getCurrentAppUser();

    const parsed = sharedExpenseSchema.safeParse({
      ...input,
      date: input?.date ? new Date(input.date) : undefined,
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AccessError(ACCESS_CODES.INVALID, first?.message ?? "Invalid expense");
    }

    const data = parsed.data;
    const groupId = data.groupId || null;

    // Authorization: group membership, or an accepted friendship for a 1:1.
    const participantIds = await assertValidParticipants({
      groupId,
      actorId: me.id,
      participantIds: data.participantIds,
    });

    if (!participantIds.includes(data.paidById)) {
      throw new AccessError(
        ACCESS_CODES.INVALID,
        "The payer must be one of the participants"
      );
    }

    const amount = round(toDecimal(data.amount));

    // Recompute from the method + inputs. Never accept shareAmount from the
    // client - a tampered payload would otherwise write a bad ledger row.
    const splits = computeSplit({
      method: data.splitMethod,
      total: amount,
      participantIds,
      values: data.splitValues ?? {},
      payerId: data.paidById,
    });

    // The gate. Belt and braces: computeSplit already guarantees this, but
    // every ledger write passes through validateSplit regardless.
    const check = validateSplit(amount, splits);
    if (!check.ok) {
      throw new SplitError(check.errors[0]);
    }

    const expense = await db.$transaction(async (tx) => {
      const created = await tx.sharedExpense.create({
        data: {
          groupId,
          description: data.description.trim(),
          amount,
          date: data.date,
          category: data.category,
          notes: data.notes?.trim() || null,
          splitMethod: data.splitMethod,
          paidById: data.paidById,
          createdById: me.id,
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              shareAmount: s.shareAmount.toFixed(2),
              shareInput: s.shareInput ? s.shareInput.toString() : null,
            })),
          },
        },
        include: { splits: true },
      });

      return created;
    });

    revalidatePath("/split/expenses");
    revalidatePath("/split/overview");
    if (groupId) revalidatePath(`/split/groups/${groupId}`);

    return { success: true, data: serializeMoney({ id: expense.id }) };
  } catch (error) {
    return fail(error);
  }
}

/** Shared expenses the caller is party to. */
export async function getSharedExpenses({ groupId = null, limit = 50 } = {}) {
  try {
    const me = await getCurrentAppUser();

    const expenses = await db.sharedExpense.findMany({
      where: {
        isDeleted: false,
        ...(groupId ? { groupId } : {}),
        OR: [
          { paidById: me.id },
          { splits: { some: { userId: me.id } } },
          {
            group: {
              members: { some: { userId: me.id, leftAt: null } },
            },
          },
        ],
      },
      include: {
        paidBy: { select: USER_FIELDS },
        group: { select: { id: true, name: true, icon: true } },
        splits: {
          include: { user: { select: USER_FIELDS } },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    const data = expenses.map((expense) => {
      const myShare = expense.splits.find((s) => s.userId === me.id);
      const paidByMe = expense.paidById === me.id;

      // What this single expense did to my balance.
      const myImpact = toDecimal(paidByMe ? expense.amount : 0).minus(
        toDecimal(myShare?.shareAmount ?? 0)
      );

      return serializeMoney({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        date: expense.date,
        category: expense.category,
        splitMethod: expense.splitMethod,
        notes: expense.notes,
        group: expense.group,
        paidBy: expense.paidBy,
        paidByMe,
        myShare: myShare?.shareAmount ?? 0,
        myImpact,
        participantCount: expense.splits.length,
        participants: expense.splits.map((s) => ({
          user: s.user,
          shareAmount: s.shareAmount,
        })),
      });
    });

    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** One expense, if the caller may see it. */
export async function getSharedExpense(expenseId) {
  try {
    const me = await getCurrentAppUser();
    await assertCanViewExpense(expenseId, me.id);

    const expense = await db.sharedExpense.findUnique({
      where: { id: expenseId },
      include: {
        paidBy: { select: USER_FIELDS },
        createdBy: { select: USER_FIELDS },
        group: { select: { id: true, name: true, icon: true } },
        splits: { include: { user: { select: USER_FIELDS } } },
      },
    });

    return { success: true, data: serializeMoney(expense) };
  } catch (error) {
    return fail(error);
  }
}
