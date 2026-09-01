import "server-only";

import { toDecimal } from "@/lib/money";
import {
  personalEntriesForExpense,
  personalEntryForSettlement,
} from "@/lib/split/personal";

/**
 * Keeps the personal ledger in step with the shared ledger (M12).
 *
 * All of these take a Prisma transaction client so they run inside the same
 * atomic write as the shared-expense change. A personal row must never exist
 * for a shared expense that failed to save.
 *
 * Account balances are updated here because these functions write Transaction
 * rows directly rather than going through actions/transaction.js.
 */

/** Apply a set of entries to an account, updating its balance in step. */
async function writeEntries(tx, { entries, userId, accountId, link }) {
  if (entries.length === 0) return;

  let delta = toDecimal(0);

  for (const entry of entries) {
    await tx.transaction.create({
      data: {
        type: entry.type,
        amount: entry.amount.toFixed(2),
        description: entry.description,
        date: entry.date,
        category: entry.category,
        isTransfer: entry.isTransfer,
        userId,
        accountId,
        ...link,
      },
    });

    delta =
      entry.type === "EXPENSE"
        ? delta.minus(entry.amount)
        : delta.plus(entry.amount);
  }

  await tx.account.update({
    where: { id: accountId },
    // A decimal string, not toNumber(): Prisma stores this column as DECIMAL,
    // and routing money through a binary float is the one thing lib/money.js
    // exists to prevent.
    data: { balance: { increment: delta.toFixed(2) } },
  });
}

/**
 * Remove the personal rows linked to a shared expense (or settlement) for one
 * user, reversing their effect on the account balance.
 */
async function removeLinked(tx, where) {
  const existing = await tx.transaction.findMany({ where });
  if (existing.length === 0) return;

  // Reverse each row's effect before deleting it.
  const byAccount = new Map();
  for (const row of existing) {
    const amount = toDecimal(row.amount);
    const delta = row.type === "EXPENSE" ? amount : amount.negated();
    byAccount.set(
      row.accountId,
      (byAccount.get(row.accountId) ?? toDecimal(0)).plus(delta)
    );
  }

  await tx.transaction.deleteMany({ where });

  for (const [accountId, delta] of byAccount) {
    await tx.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta.toFixed(2) } },
    });
  }
}

/**
 * Record a shared expense in the payer's personal finances.
 *
 * Produces up to two rows: what they consumed, and what they fronted for
 * others. See lib/split/personal.js for why both are needed.
 */
export async function syncExpenseToPersonal(
  tx,
  { expenseId, userId, accountId, paidById, amount, myShare, description, category, date }
) {
  // Always clear first so an edit cannot leave stale rows behind.
  await removeLinked(tx, { sharedExpenseId: expenseId, userId });

  if (!accountId) return; // opted out of personal tracking

  const entries = personalEntriesForExpense({
    myUserId: userId,
    paidById,
    amount,
    myShare,
    description,
    category,
    date,
  });

  await writeEntries(tx, {
    entries,
    userId,
    accountId,
    link: { sharedExpenseId: expenseId },
  });
}

/** Drop the personal rows for a shared expense that was deleted. */
export async function unsyncExpenseFromPersonal(tx, { expenseId, userId }) {
  await removeLinked(tx, { sharedExpenseId: expenseId, userId });
}

/**
 * Record a settlement as a pure transfer: the balance moves, but nothing is
 * counted as income or expense.
 */
export async function syncSettlementToPersonal(
  tx,
  { settlementId, userId, accountId, fromUserId, toUserId, amount, counterpartyName, date }
) {
  await removeLinked(tx, { settlementId, userId });

  if (!accountId) return;

  const entry = personalEntryForSettlement({
    myUserId: userId,
    fromUserId,
    toUserId,
    amount,
    counterpartyName,
    date,
  });

  if (!entry) return;

  await writeEntries(tx, {
    entries: [entry],
    userId,
    accountId,
    link: { settlementId },
  });
}
