"use server";

import { db } from "@/lib/prisma";
import { serializeMoney } from "@/lib/money";
import {
  getCurrentAppUser,
  assertGroupMember,
  AccessError,
} from "@/lib/split/auth";
import { buildAnalytics, userTotals } from "@/lib/split/analytics";
import {
  currenciesIn,
  soleCurrencyOf,
  filterLedgerByCurrency,
  DEFAULT_CURRENCY,
} from "@/lib/split/currency";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/analytics]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Fields analytics needs that the balance loaders do not select.
 *
 * The settlement filter is passed in rather than derived from the expense
 * filter: inferring it meant the non-group path fell through to an empty
 * where clause, reading every settlement row in the database.
 */
async function loadAnalyticsLedger(where, settlementWhere) {
  const [expenses, settlements] = await Promise.all([
    db.sharedExpense.findMany({
      where,
      select: {
        id: true,
        paidById: true,
        amount: true,
        currency: true,
        category: true,
        date: true,
        isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } },
      },
    }),
    db.settlement.findMany({
      where: settlementWhere,
      select: { fromUserId: true, toUserId: true, amount: true, currency: true },
    }),
  ]);

  return { expenses, settlements };
}

/**
 * Pick which currency to report on.
 *
 * A mixed ledger must never be summed together (task.md M22/M23), so this
 * resolves to one currency: the one requested, or the ledger's sole currency,
 * or the user's preference, or the app default - in that order.
 */
function resolveCurrency(ledger, requested, preferred) {
  if (requested) return requested;
  const sole = soleCurrencyOf(ledger);
  if (sole) return sole;
  return preferred || DEFAULT_CURRENCY;
}

/**
 * Analytics for one group.
 *
 * Kept entirely separate from personal-finance analytics: this reads only
 * SharedExpense/Settlement, never Transaction (task.md M23).
 */
export async function getGroupAnalytics(groupId, { currency = null } = {}) {
  try {
    const me = await getCurrentAppUser();
    await assertGroupMember(groupId, me.id);

    const ledger = await loadAnalyticsLedger(
      { groupId, isDeleted: false },
      { groupId }
    );
    const currencies = [...currenciesIn(ledger)].sort();
    const resolved = resolveCurrency(ledger, currency, me.preferredCurrency);
    const scoped = currencies.length > 1 ? filterLedgerByCurrency(ledger, resolved) : ledger;

    const analytics = buildAnalytics(scoped);
    const userIds = analytics.byMember.map((m) => m.userId);

    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: USER_FIELDS })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      success: true,
      data: serializeMoney({
        currency: resolved,
        availableCurrencies: currencies,
        totalSpending: analytics.totalSpending,
        expenseCount: analytics.expenseCount,
        byCategory: analytics.byCategory,
        byMember: analytics.byMember.map((m) => ({ ...m, user: byId.get(m.userId) ?? null })),
        overTime: analytics.overTime,
      }),
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The caller's own analytics across every shared expense they are part of -
 * not scoped to one group.
 */
export async function getMyAnalytics({ currency = null } = {}) {
  try {
    const me = await getCurrentAppUser();

    const ledger = await loadAnalyticsLedger(
      {
        isDeleted: false,
        OR: [
          { paidById: me.id },
          { splits: { some: { userId: me.id } } },
          { group: { members: { some: { userId: me.id, leftAt: null } } } },
        ],
      },
      // Only settlements the caller is party to - never the whole table.
      { OR: [{ fromUserId: me.id }, { toUserId: me.id }] }
    );

    const currencies = [...currenciesIn(ledger)].sort();
    const resolved = resolveCurrency(ledger, currency, me.preferredCurrency);
    const scoped = currencies.length > 1 ? filterLedgerByCurrency(ledger, resolved) : ledger;

    const analytics = buildAnalytics(scoped);
    const totals = userTotals(me.id, scoped);

    return {
      success: true,
      data: serializeMoney({
        currency: resolved,
        availableCurrencies: currencies,
        totalSpending: analytics.totalSpending,
        expenseCount: analytics.expenseCount,
        byCategory: analytics.byCategory,
        overTime: analytics.overTime,
        totalPaid: totals.totalPaid,
        totalSpent: totals.totalSpent,
        totalRecovered: totals.totalRecovered,
        totalOwedToThem: totals.totalOwedToThem,
        totalTheyOwe: totals.totalTheyOwe,
      }),
    };
  } catch (error) {
    return fail(error);
  }
}
