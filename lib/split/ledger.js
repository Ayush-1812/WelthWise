import "server-only";

import { db } from "@/lib/prisma";

/**
 * Ledger loaders shared by the balance, dashboard and settlement actions.
 *
 * These live here rather than in actions/split/balances.js because every export
 * of a "use server" module is registered as a callable endpoint. loadUserLedger
 * takes a userId and performs no authorization of its own - it trusts the
 * caller to have resolved that id - so exposing it as an action would let a
 * request name any user and read their ledger. Internal helpers belong in a
 * server-only module, the same way notify.js and personal-sync.js do it.
 *
 * Callers are responsible for authorization; these functions only fetch.
 */

/** Fields the balance formula needs from an expense. */
const EXPENSE_FIELDS = {
  id: true,
  groupId: true,
  paidById: true,
  amount: true,
  isDeleted: true,
  splits: { select: { userId: true, shareAmount: true } },
};

/** Fields the balance formula needs from a settlement. */
const SETTLEMENT_FIELDS = {
  fromUserId: true,
  toUserId: true,
  amount: true,
  groupId: true,
};

/**
 * Load the ledger rows that affect one user's balances.
 *
 * Only expenses the user paid for or has a share in can move their balance, so
 * loading anything wider would be noise. Deleted expenses are excluded, which
 * is what makes a soft delete fully reverse an expense.
 */
export async function loadUserLedger(userId, { groupId = null } = {}) {
  const scope = groupId ? { groupId } : {};

  const [expenses, settlements] = await Promise.all([
    db.sharedExpense.findMany({
      where: {
        ...scope,
        isDeleted: false,
        OR: [{ paidById: userId }, { splits: { some: { userId } } }],
      },
      select: EXPENSE_FIELDS,
    }),
    db.settlement.findMany({
      where: {
        ...scope,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      select: SETTLEMENT_FIELDS,
    }),
  ]);

  return { expenses, settlements };
}

/** Every ledger row in a group, regardless of who is involved. */
export async function loadGroupLedger(groupId) {
  const [expenses, settlements] = await Promise.all([
    db.sharedExpense.findMany({
      where: { groupId, isDeleted: false },
      select: EXPENSE_FIELDS,
    }),
    db.settlement.findMany({
      where: { groupId },
      select: SETTLEMENT_FIELDS,
    }),
  ]);

  return { expenses, settlements };
}
