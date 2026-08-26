"use server";

import { db } from "@/lib/prisma";
import { Decimal } from "@/lib/money";
import {
  getCurrentAppUser,
  assertGroupMember,
  AccessError,
} from "@/lib/split/auth";
import {
  computeNetBalances,
  computePairwiseBalances,
  pairwiseForUser,
  summarizeByCounterparty,
  netBalanceFor,
} from "@/lib/split/balances";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/balances]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

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
      select: {
        id: true,
        groupId: true,
        paidById: true,
        amount: true,
        isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } },
      },
    }),
    db.settlement.findMany({
      where: {
        ...scope,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      select: {
        fromUserId: true,
        toUserId: true,
        amount: true,
        groupId: true,
      },
    }),
  ]);

  return { expenses, settlements };
}

/** Every ledger row in a group, regardless of who is involved. */
async function loadGroupLedger(groupId) {
  const [expenses, settlements] = await Promise.all([
    db.sharedExpense.findMany({
      where: { groupId, isDeleted: false },
      select: {
        id: true,
        paidById: true,
        amount: true,
        isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } },
      },
    }),
    db.settlement.findMany({
      where: { groupId },
      select: { fromUserId: true, toUserId: true, amount: true },
    }),
  ]);

  return { expenses, settlements };
}

/**
 * The caller's headline balances: totals, per-person, and per-group.
 *
 * Totals count each counterparty separately rather than netting them - being
 * owed 500 by one person while owing 300 to another is not "owed 200".
 */
export async function getMyBalanceSummary() {
  try {
    const me = await getCurrentAppUser();
    const ledger = await loadUserLedger(me.id);

    const perPerson = pairwiseForUser(ledger, me.id);
    const totals = summarizeByCounterparty(perPerson);

    // Attach user rows to the counterparty ids.
    const otherIds = [...perPerson.keys()];
    const users = otherIds.length
      ? await db.user.findMany({
          where: { id: { in: otherIds } },
          select: USER_FIELDS,
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const people = otherIds
      .map((id) => ({
        user: byId.get(id) ?? null,
        netBalance: perPerson.get(id).toNumber(),
      }))
      .filter((entry) => entry.user && entry.netBalance !== 0)
      .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));

    // Per-group net for the caller, from the same ledger rows.
    const groupIds = [
      ...new Set(ledger.expenses.map((e) => e.groupId).filter(Boolean)),
    ];

    const groups = groupIds.length
      ? await db.expenseGroup.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true, icon: true },
        })
      : [];

    const byGroup = groups
      .map((group) => {
        const scoped = {
          expenses: ledger.expenses.filter((e) => e.groupId === group.id),
          settlements: ledger.settlements.filter((s) => s.groupId === group.id),
        };
        return {
          group,
          netBalance: netBalanceFor(scoped, me.id).toNumber(),
        };
      })
      .filter((entry) => entry.netBalance !== 0)
      .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));

    return {
      success: true,
      data: {
        totals: {
          youOwe: totals.youOwe.toNumber(),
          owedToYou: totals.owedToYou.toNumber(),
          net: totals.net.toNumber(),
        },
        people,
        byGroup,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Per-member net balances and raw pairwise debts inside one group. */
export async function getGroupBalances(groupId) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const ledger = await loadGroupLedger(groupId);
    const net = computeNetBalances(ledger);
    const pairs = computePairwiseBalances(ledger);

    const involved = new Set([
      ...net.keys(),
      ...pairs.flatMap((p) => [p.fromUserId, p.toUserId]),
    ]);

    const users = involved.size
      ? await db.user.findMany({
          where: { id: { in: [...involved] } },
          select: USER_FIELDS,
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      success: true,
      data: {
        myUserId: me.id,
        members: [...net.entries()]
          .map(([userId, value]) => ({
            user: byId.get(userId) ?? null,
            netBalance: value.toNumber(),
          }))
          .filter((entry) => entry.user)
          .sort((a, b) => b.netBalance - a.netBalance),
        debts: pairs.map((p) => ({
          from: byId.get(p.fromUserId) ?? null,
          to: byId.get(p.toUserId) ?? null,
          amount: p.amount.toNumber(),
        })),
        // Proof the ledger is internally consistent; surfaced so a bad write
        // is visible rather than silently wrong.
        sumsToZero: [...net.values()]
          .reduce((acc, v) => acc.plus(v), new Decimal(0))
          .isZero(),
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Net balance between the caller and one other person, across everything. */
export async function getBalanceWith(otherUserId) {
  try {
    const me = await getCurrentAppUser();
    const ledger = await loadUserLedger(me.id);
    const perPerson = pairwiseForUser(ledger, me.id);

    return {
      success: true,
      data: { netBalance: (perPerson.get(otherUserId) ?? new Decimal(0)).toNumber() },
    };
  } catch (error) {
    return fail(error);
  }
}
