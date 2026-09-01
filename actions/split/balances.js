"use server";

import { db } from "@/lib/prisma";
import { Decimal } from "@/lib/money";
import {
  getCurrentAppUser,
  assertGroupMember,
  AccessError,
} from "@/lib/split/auth";
import { buildSettlementPlan } from "@/lib/split/simplify";
import {
  computeNetBalances,
  computePairwiseBalances,
  contributionsBetween,
  pairwiseForUser,
  summarizeByCounterparty,
  netBalanceFor,
} from "@/lib/split/balances";
import { loadUserLedger, loadGroupLedger } from "@/lib/split/ledger";
import {
  currenciesIn,
  resolveLedgerCurrency,
  scopeLedgerToCurrency,
  CurrencyError,
} from "@/lib/split/currency";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

/**
 * Narrow a freshly loaded ledger to the single currency it should be reported
 * in. Balances across two currencies cannot be added, so every balance action
 * picks one and says which it picked.
 */
function reportIn(raw, me, requested = null) {
  const available = [...currenciesIn(raw)].sort();
  const currency = resolveLedgerCurrency(raw, requested, me?.preferredCurrency);
  return { ledger: scopeLedgerToCurrency(raw, currency), currency, available };
}

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError || error instanceof CurrencyError) {
    return { success: false, error: error.message };
  }
  console.error("[split/balances]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
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
    const { ledger, currency, available } = reportIn(await loadUserLedger(me.id), me);

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
        currency,
        availableCurrencies: available,
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

    const { ledger, currency, available } = reportIn(await loadGroupLedger(groupId), me);
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
        currency,
        availableCurrencies: available,
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
    const { ledger, currency } = reportIn(await loadUserLedger(me.id), me);
    const perPerson = pairwiseForUser(ledger, me.id);

    return {
      success: true,
      data: {
        netBalance: (perPerson.get(otherUserId) ?? new Decimal(0)).toNumber(),
        currency,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The rows behind one balance, so every rupee traces to a specific expense or
 * settlement. The returned `contribution` values sum to `netBalance`.
 */
export async function getBalanceDetail(otherUserId) {
  try {
    const me = await getCurrentAppUser();

    const other = await db.user.findUnique({
      where: { id: otherUserId },
      select: USER_FIELDS,
    });
    if (!other) {
      return fail(new AccessError("NOT_FOUND", "Person not found"));
    }

    const { ledger, currency } = reportIn(await loadUserLedger(me.id), me);

    // loadUserLedger omits settlement ids and dates, which this view needs.
    const settlements = await db.settlement.findMany({
      where: {
        OR: [
          { fromUserId: me.id, toUserId: otherUserId },
          { fromUserId: otherUserId, toUserId: me.id },
        ],
      },
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        amount: true,
        currency: true,
        settledAt: true,
        groupId: true,
        note: true,
        method: true,
      },
    });

    // Expense descriptions and dates likewise are not in the balance ledger.
    const expenseIds = ledger.expenses.map((e) => e.id);
    const details = expenseIds.length
      ? await db.sharedExpense.findMany({
          where: { id: { in: expenseIds } },
          select: {
            id: true,
            description: true,
            date: true,
            category: true,
            group: { select: { id: true, name: true, icon: true } },
          },
        })
      : [];
    const detailById = new Map(details.map((d) => [d.id, d]));

    const enriched = scopeLedgerToCurrency(
      {
        expenses: ledger.expenses.map((e) => ({
          ...e,
          description: detailById.get(e.id)?.description ?? "Expense",
          date: detailById.get(e.id)?.date ?? null,
        })),
        settlements,
      },
      currency
    );

    const rows = contributionsBetween(enriched, me.id, otherUserId);
    const netBalance = pairwiseForUser(ledger, me.id).get(otherUserId) ?? new Decimal(0);

    return {
      success: true,
      data: {
        other,
        currency,
        netBalance: netBalance.toNumber(),
        rows: rows.map((row) => ({
          kind: row.kind,
          id: row.id,
          date: row.date,
          description: row.description ?? null,
          amount: row.amount.toNumber(),
          share: row.share ? row.share.toNumber() : null,
          contribution: row.contribution.toNumber(),
          paidByMe: row.paidByMe ?? null,
          sentByMe: row.sentByMe ?? null,
          group: row.groupId ? (detailById.get(row.id)?.group ?? null) : null,
        })),
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * A simplified settlement plan for a group.
 *
 * A RECOMMENDATION only - nothing is written. Users still record real
 * settlements, and those are what actually move balances (task.md section 1).
 */
export async function getGroupSimplification(groupId) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const { ledger, currency, available } = reportIn(await loadGroupLedger(groupId), me);
    const balances = computeNetBalances(ledger);
    const pairs = computePairwiseBalances(ledger);

    const plan = buildSettlementPlan(balances, pairs);

    const involved = new Set([
      ...plan.payments.flatMap((x) => [x.fromUserId, x.toUserId]),
      ...pairs.flatMap((x) => [x.fromUserId, x.toUserId]),
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
        currency,
        availableCurrencies: available,
        verified: plan.verified,
        comparison: plan.comparison,
        current: pairs.map((x) => ({
          from: byId.get(x.fromUserId) ?? null,
          to: byId.get(x.toUserId) ?? null,
          amount: x.amount.toNumber(),
        })),
        simplified: plan.payments.map((x) => ({
          from: byId.get(x.fromUserId) ?? null,
          to: byId.get(x.toUserId) ?? null,
          amount: x.amount.toNumber(),
        })),
      },
    };
  } catch (error) {
    return fail(error);
  }
}
