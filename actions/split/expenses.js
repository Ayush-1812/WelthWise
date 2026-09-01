"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { serializeMoney, toDecimal, round, Decimal } from "@/lib/money";
import {
  getCurrentAppUser,
  assertValidParticipants,
  assertCanViewExpense,
  assertCanEditExpense,
  assertOwnedAccount,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { computeSplit, validateSplit, SplitError } from "@/lib/split/engine";
import { normalizeItems, ItemizedError } from "@/lib/split/itemized";
import { computeNetBalances } from "@/lib/split/balances";
import {
  normalizeFilters,
  buildExpenseWhere,
  EXPENSE_ORDER,
  FilterError,
} from "@/lib/split/filters";
import {
  syncExpenseToPersonal,
  unsyncExpenseFromPersonal,
} from "./personal-sync";
import { queuePersonalised, deliverEmailsInBackground } from "./notify";
import { sharedExpenseSchema } from "@/app/lib/schema";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (
    error instanceof AccessError ||
    error instanceof SplitError ||
    error instanceof FilterError ||
    error instanceof ItemizedError
  ) {
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

    // Personal accounts, so the payer can optionally record the cash outflow
    // against one of them (M12).
    const accounts = await db.account.findMany({
      where: { userId: me.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: {
        me: { id: me.id, name: me.name, email: me.email, imageUrl: me.imageUrl },
        groups,
        friends,
        accounts,
      },
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

    // An accountId arrives straight from the request and is written against
    // below, so prove it is the caller's before opening the transaction.
    const accountId = await assertOwnedAccount(data.accountId, me.id);

    const notifyEmails = [];

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

      // Itemized expenses keep their line items so the breakdown can be
      // reopened and corrected later (M21).
      if (data.splitMethod === "ITEMIZED") {
        await tx.expenseItem.createMany({
          data: normalizeItems(data.splitValues?.items ?? []).map((item) => ({
            expenseId: created.id,
            name: item.name,
            amount: item.amount.toFixed(2),
            quantity: item.quantity,
            assignedTo: item.assignedTo,
          })),
        });
      }

      // Personal-finance side (M12): only the payer moved any cash, and only
      // their own share counts as spending.
      if (me.id === data.paidById) {
        await syncExpenseToPersonal(tx, {
          expenseId: created.id,
          userId: me.id,
          accountId,
          paidById: data.paidById,
          amount,
          myShare:
            splits.find((s2) => s2.userId === me.id)?.shareAmount ?? 0,
          description: data.description.trim(),
          category: data.category,
          date: data.date,
        });
      }

      await tx.sharedExpenseActivity.create({
        data: {
          groupId,
          actorId: me.id,
          type: "EXPENSE_ADDED",
          expenseId: created.id,
          metadata: {
            description: data.description.trim(),
            amount: amount.toFixed(2),
            participantCount: participantIds.length,
          },
        },
      });

      // Each participant gets their own share in the message, so the
      // notification is built per recipient rather than once for everyone.
      notifyEmails.push(
        ...(await queuePersonalised(tx, {
          type: "EXPENSE_ADDED",
          actorId: me.id,
          entries: splits.map((s) => ({
            userId: s.userId,
            context: {
              actor: me,
              expense: {
                id: created.id,
                description: created.description,
                amount,
              },
              myShare: s.shareAmount,
            },
          })),
        }))
      );

      return created;
    });

    deliverEmailsInBackground(notifyEmails);

    revalidatePath("/split/expenses");
    revalidatePath("/split/overview");
    if (groupId) revalidatePath(`/split/groups/${groupId}`);

    return { success: true, data: serializeMoney({ id: expense.id }) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Ledger rows for a scope, used to preview what an edit would do to balances.
 * A group expense affects that group; a direct expense affects only the pair.
 */
async function loadScopeLedger({ groupId, userIds }) {
  const where = groupId
    ? { groupId, isDeleted: false }
    : {
        groupId: null,
        isDeleted: false,
        OR: [
          { paidById: { in: userIds } },
          { splits: { some: { userId: { in: userIds } } } },
        ],
      };

  const [expenses, settlements] = await Promise.all([
    db.sharedExpense.findMany({
      where,
      select: {
        id: true,
        paidById: true,
        amount: true,
        isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } },
      },
    }),
    db.settlement.findMany({
      where: groupId
        ? { groupId }
        : {
            groupId: null,
            OR: [
              { fromUserId: { in: userIds } },
              { toUserId: { in: userIds } },
            ],
          },
      select: { fromUserId: true, toUserId: true, amount: true },
    }),
  ]);

  return { expenses, settlements };
}

/**
 * Warn when an edit or delete would disturb someone who has already settled.
 *
 * Balances stay mathematically consistent either way - they are derived. But
 * silently turning "settled up" into "you owe 300" after money has changed
 * hands is a surprise worth confirming, so this returns a human warning that
 * the caller must acknowledge.
 */
function describeBalanceImpact({ ledger, expenseId, replacement, affectedIds, nameOf }) {
  const withoutOld = ledger.expenses.filter((e) => e.id !== expenseId);
  const before = computeNetBalances(ledger);
  const after = computeNetBalances({
    expenses: replacement ? [...withoutOld, replacement] : withoutOld,
    settlements: ledger.settlements,
  });

  const disturbed = [];

  for (const userId of affectedIds) {
    const b = before.get(userId) ?? new Decimal(0);
    const a = after.get(userId) ?? new Decimal(0);
    if (b.equals(a)) continue;

    // Someone who was square is no longer, or their side of the debt flips.
    const wasSettled = b.isZero();
    const flipped = !b.isZero() && !a.isZero() && b.isNegative() !== a.isNegative();

    if (wasSettled || flipped) {
      disturbed.push(nameOf(userId));
    }
  }

  if (disturbed.length === 0) return null;

  return `This changes the balance for ${disturbed.join(", ")}, who ${
    disturbed.length === 1 ? "was" : "were"
  } already settled or owed money the other way. Their balance will move.`;
}

/** Shared expenses the caller is party to. */
export async function getSharedExpenses({
  groupId = null,
  limit = 25,
  cursor = null,
  ...rawFilters
} = {}) {
  try {
    const me = await getCurrentAppUser();

    // Filtering and paging happen in the database. Loading the whole ledger
    // and filtering in the browser would not hold across several groups.
    const filters = normalizeFilters({ ...rawFilters, groupId: groupId ?? rawFilters?.groupId });
    const where = buildExpenseWhere(filters, me.id);

    const rows = await db.sharedExpense.findMany({
      where,
      include: {
        paidBy: { select: USER_FIELDS },
        group: { select: { id: true, name: true, icon: true } },
        splits: {
          include: { user: { select: USER_FIELDS } },
        },
      },
      orderBy: EXPENSE_ORDER,
      take: limit + 1, // one extra tells us whether another page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const expenses = hasMore ? rows.slice(0, limit) : rows;

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

    return {
      success: true,
      data,
      nextCursor: hasMore ? expenses[expenses.length - 1].id : null,
      filters: {
        ...filters,
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null,
        minAmount: filters.minAmount ? filters.minAmount.toNumber() : null,
        maxAmount: filters.maxAmount ? filters.maxAmount.toNumber() : null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Everything the filter bar needs to render its dropdowns: the caller's groups
 * and the people they actually share expenses with.
 */
export async function getFilterOptions() {
  try {
    const me = await getCurrentAppUser();

    const [memberships, friendships] = await Promise.all([
      db.groupMember.findMany({
        where: { userId: me.id, leftAt: null },
        include: { group: { select: { id: true, name: true, icon: true } } },
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

    const people = new Map();
    for (const f of friendships) {
      const other = f.requesterId === me.id ? f.addressee : f.requester;
      people.set(other.id, other);
    }

    return {
      success: true,
      data: {
        myUserId: me.id,
        groups: memberships.map((m) => m.group),
        people: [...people.values()],
      },
    };
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
        items: { orderBy: { createdAt: "asc" } },
      },
    });

    return { success: true, data: serializeMoney(expense) };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Edit a shared expense.
 *
 * Splits are always recomputed server-side and rewritten wholesale inside one
 * transaction, so the expense and its splits can never disagree. Because
 * balances are derived, correcting them is automatic once the splits change.
 *
 * Pass `confirm: true` to accept a warning about disturbing settled balances.
 */
export async function updateSharedExpense(expenseId, input) {
  try {
    const me = await getCurrentAppUser();

    // Authorization: payer, creator, or group admin. Throws otherwise.
    const existing = await assertCanEditExpense(expenseId, me.id);

    const parsed = sharedExpenseSchema.safeParse({
      ...input,
      date: input?.date ? new Date(input.date) : undefined,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AccessError(ACCESS_CODES.INVALID, first?.message ?? "Invalid expense");
    }

    const data = parsed.data;

    // The group an expense belongs to is fixed - moving it between groups
    // would silently move debt between unrelated people.
    if ((data.groupId || null) !== (existing.groupId || null)) {
      throw new AccessError(
        ACCESS_CODES.INVALID,
        "An expense cannot be moved to a different group. Delete it and add it again."
      );
    }

    const participantIds = await assertValidParticipants({
      groupId: existing.groupId,
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

    const splits = computeSplit({
      method: data.splitMethod,
      total: amount,
      participantIds,
      values: data.splitValues ?? {},
      payerId: data.paidById,
    });

    const check = validateSplit(amount, splits);
    if (!check.ok) throw new SplitError(check.errors[0]);

    // Everyone touched by the edit: old participants and new ones.
    const affectedIds = [
      ...new Set([
        ...existing.splits.map((s) => s.userId),
        ...participantIds,
        existing.paidById,
        data.paidById,
      ]),
    ];

    if (!input?.confirm) {
      const ledger = await loadScopeLedger({
        groupId: existing.groupId,
        userIds: affectedIds,
      });
      const users = await db.user.findMany({
        where: { id: { in: affectedIds } },
        select: { id: true, name: true, email: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.name || u.email]));

      const warning = describeBalanceImpact({
        ledger,
        expenseId,
        replacement: {
          id: expenseId,
          paidById: data.paidById,
          amount,
          isDeleted: false,
          splits: splits.map((s) => ({
            userId: s.userId,
            shareAmount: s.shareAmount,
          })),
        },
        affectedIds,
        nameOf: (id) => nameById.get(id) ?? "someone",
      });

      if (warning) {
        return { success: false, needsConfirmation: true, warning };
      }
    }

    // Same as create: never write against an account the caller does not own.
    const requestedAccountId = await assertOwnedAccount(data.accountId, me.id);

    await db.$transaction(async (tx) => {
      // Rewrite splits wholesale - a diff would risk leaving a stale row that
      // makes the splits stop summing to the total.
      await tx.expenseSplit.deleteMany({ where: { expenseId } });

      await tx.sharedExpense.update({
        where: { id: expenseId },
        data: {
          description: data.description.trim(),
          amount,
          date: data.date,
          category: data.category,
          notes: data.notes?.trim() || null,
          splitMethod: data.splitMethod,
          paidById: data.paidById,
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              shareAmount: s.shareAmount.toFixed(2),
              shareInput: s.shareInput ? s.shareInput.toString() : null,
            })),
          },
        },
      });

      // Line items are rewritten wholesale, like the splits, so an edit can
      // never leave a stale item that stops the breakdown adding up (M21).
      await tx.expenseItem.deleteMany({ where: { expenseId } });
      if (data.splitMethod === "ITEMIZED") {
        await tx.expenseItem.createMany({
          data: normalizeItems(data.splitValues?.items ?? []).map((item) => ({
            expenseId,
            name: item.name,
            amount: item.amount.toFixed(2),
            quantity: item.quantity,
            assignedTo: item.assignedTo,
          })),
        });
      }

      // Personal-finance side (M12). Re-synced from scratch so a changed
      // amount, payer or share cannot leave a stale personal row behind.
      const previousAccountId =
        (await tx.transaction.findFirst({
          where: { sharedExpenseId: expenseId, userId: me.id },
          select: { accountId: true },
        }))?.accountId ?? null;

      await syncExpenseToPersonal(tx, {
        expenseId,
        userId: me.id,
        // previousAccountId came from the caller's own Transaction row, so it
        // needs no re-check; only the requested one is untrusted.
        accountId: requestedAccountId || previousAccountId,
        paidById: data.paidById,
        amount,
        myShare: splits.find((s2) => s2.userId === me.id)?.shareAmount ?? 0,
        description: data.description.trim(),
        category: data.category,
        date: data.date,
      });

      await queuePersonalised(tx, {
        type: "EXPENSE_EDITED",
        actorId: me.id,
        entries: splits.map((s) => ({
          userId: s.userId,
          context: {
            actor: me,
            expense: { id: expenseId, description: data.description.trim(), amount },
            myShare: s.shareAmount,
          },
        })),
      });

      await tx.sharedExpenseActivity.create({
        data: {
          groupId: existing.groupId,
          actorId: me.id,
          type: "EXPENSE_EDITED",
          expenseId,
          metadata: {
            description: data.description.trim(),
            previousAmount: existing.amount.toString(),
            newAmount: amount.toFixed(2),
            previousPaidById: existing.paidById,
            newPaidById: data.paidById,
            participantCount: participantIds.length,
          },
        },
      });
    });

    revalidatePath("/split/expenses");
    revalidatePath(`/split/expenses/${expenseId}`);
    revalidatePath("/split/balances");
    revalidatePath("/split/overview");
    revalidatePath("/split/friends");
    if (existing.groupId) revalidatePath(`/split/groups/${existing.groupId}`);

    return { success: true, data: { id: expenseId } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Soft-delete a shared expense.
 *
 * The row and its splits stay so history and any settlement that referenced
 * them remain explainable; every balance calculation skips isDeleted rows, so
 * the effect is fully reversed (task.md section 1).
 */
export async function deleteSharedExpense(expenseId, { confirm = false } = {}) {
  try {
    const me = await getCurrentAppUser();
    const existing = await assertCanEditExpense(expenseId, me.id);

    const affectedIds = [
      ...new Set([...existing.splits.map((s) => s.userId), existing.paidById]),
    ];

    if (!confirm) {
      const ledger = await loadScopeLedger({
        groupId: existing.groupId,
        userIds: affectedIds,
      });
      const users = await db.user.findMany({
        where: { id: { in: affectedIds } },
        select: { id: true, name: true, email: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.name || u.email]));

      const warning = describeBalanceImpact({
        ledger,
        expenseId,
        replacement: null, // removing it entirely
        affectedIds,
        nameOf: (id) => nameById.get(id) ?? "someone",
      });

      if (warning) {
        return { success: false, needsConfirmation: true, warning };
      }
    }

    await db.$transaction(async (tx) => {
      await tx.sharedExpense.update({
        where: { id: expenseId },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      // The cash never really left, so reverse the personal rows too (M12).
      await unsyncExpenseFromPersonal(tx, { expenseId, userId: me.id });

      await queuePersonalised(tx, {
        type: "EXPENSE_DELETED",
        actorId: me.id,
        entries: existing.splits.map((s) => ({
          userId: s.userId,
          context: {
            actor: me,
            expense: { id: expenseId, description: existing.description },
          },
        })),
      });

      await tx.sharedExpenseActivity.create({
        data: {
          groupId: existing.groupId,
          actorId: me.id,
          type: "EXPENSE_DELETED",
          expenseId,
          metadata: {
            description: existing.description,
            amount: existing.amount.toString(),
          },
        },
      });
    });

    revalidatePath("/split/expenses");
    revalidatePath(`/split/expenses/${expenseId}`);
    revalidatePath("/split/balances");
    revalidatePath("/split/overview");
    revalidatePath("/split/friends");
    if (existing.groupId) revalidatePath(`/split/groups/${existing.groupId}`);

    return { success: true, data: { groupId: existing.groupId } };
  } catch (error) {
    return fail(error);
  }
}
