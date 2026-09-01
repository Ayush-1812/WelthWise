"use server";

import { db } from "@/lib/prisma";
import { Decimal, toDecimal } from "@/lib/money";
import { getCurrentAppUser, AccessError } from "@/lib/split/auth";
import { pairwiseForUser, summarizeByCounterparty } from "@/lib/split/balances";
import { describeSchedule } from "@/lib/split/recurring";

import { loadUserLedger } from "@/lib/split/ledger";
import { reportLedgerIn } from "@/lib/split/currency";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError) return { success: false, error: error.message };
  console.error("[split/dashboard]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

const EMPTY = {
  totals: { youOwe: 0, owedToYou: 0, net: 0 },
  recentExpenses: [],
  recentSettlements: [],
  activeGroups: [],
  upcomingRecurring: [],
  hasActivity: false,
};

/**
 * The Split Expenses summary shown on the main dashboard (M19).
 *
 * The dashboard already runs several queries, so everything here is issued in
 * ONE parallel batch and each list is capped at 3 rows. This action must never
 * be the reason the dashboard feels slow.
 *
 * Returns an empty summary rather than an error if anything fails - a problem
 * in the shared-expense module must not break the personal dashboard.
 */
export async function getDashboardSplitSummary() {
  try {
    const me = await getCurrentAppUser();

    const [ledger, recentExpenses, recentSettlements, memberships, upcoming] =
      await Promise.all([
        loadUserLedger(me.id),

        db.sharedExpense.findMany({
          where: {
            isDeleted: false,
            OR: [{ paidById: me.id }, { splits: { some: { userId: me.id } } }],
          },
          select: {
            id: true,
            description: true,
            amount: true,
            date: true,
            paidById: true,
            paidBy: { select: USER_FIELDS },
            group: { select: { id: true, name: true, icon: true } },
            splits: { where: { userId: me.id }, select: { shareAmount: true } },
          },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: 3,
        }),

        db.settlement.findMany({
          where: { OR: [{ fromUserId: me.id }, { toUserId: me.id }] },
          select: {
            id: true,
            amount: true,
            settledAt: true,
            fromUserId: true,
            fromUser: { select: USER_FIELDS },
            toUser: { select: USER_FIELDS },
          },
          orderBy: { settledAt: "desc" },
          take: 3,
        }),

        db.groupMember.findMany({
          where: { userId: me.id, leftAt: null, group: { isArchived: false } },
          select: {
            group: {
              select: {
                id: true,
                name: true,
                icon: true,
                _count: { select: { members: true, expenses: true } },
              },
            },
          },
          orderBy: { joinedAt: "desc" },
          take: 3,
        }),

        db.recurringSharedExpense.findMany({
          where: {
            isActive: true,
            OR: [
              { paidById: me.id },
              { createdById: me.id },
              { group: { members: { some: { userId: me.id, leftAt: null } } } },
            ],
          },
          select: {
            id: true,
            description: true,
            amount: true,
            interval: true,
            every: true,
            nextRunDate: true,
            group: { select: { id: true, name: true, icon: true } },
          },
          orderBy: { nextRunDate: "asc" },
          take: 3,
        }),
      ]);

    // Scope before computing: an unscoped mixed ledger would throw.
    const { ledger: scoped, currency } = reportLedgerIn(ledger, {
      preferred: me.preferredCurrency,
    });
    const perPerson = pairwiseForUser(scoped, me.id);
    const summary = summarizeByCounterparty(perPerson);

    const data = {
      currency,
      totals: {
        youOwe: summary.youOwe.toNumber(),
        owedToYou: summary.owedToYou.toNumber(),
        net: summary.net.toNumber(),
      },
      recentExpenses: recentExpenses.map((e) => {
        const myShare = toDecimal(e.splits[0]?.shareAmount ?? 0);
        const paidByMe = e.paidById === me.id;
        // What this one expense did to my balance.
        const myImpact = toDecimal(paidByMe ? e.amount : 0).minus(myShare);

        return {
          id: e.id,
          description: e.description,
          amount: toDecimal(e.amount).toNumber(),
          date: e.date,
          paidByMe,
          paidBy: e.paidBy,
          group: e.group,
          myImpact: myImpact.toNumber(),
        };
      }),
      recentSettlements: recentSettlements.map((s) => ({
        id: s.id,
        amount: toDecimal(s.amount).toNumber(),
        settledAt: s.settledAt,
        sentByMe: s.fromUserId === me.id,
        counterparty: s.fromUserId === me.id ? s.toUser : s.fromUser,
      })),
      activeGroups: memberships.map((m) => ({
        id: m.group.id,
        name: m.group.name,
        icon: m.group.icon,
        memberCount: m.group._count.members,
        expenseCount: m.group._count.expenses,
      })),
      upcomingRecurring: upcoming.map((rec) => ({
        id: rec.id,
        description: rec.description,
        amount: toDecimal(rec.amount).toNumber(),
        nextRunDate: rec.nextRunDate,
        schedule: describeSchedule({ interval: rec.interval, every: rec.every }),
        group: rec.group,
      })),
    };

    data.hasActivity =
      data.recentExpenses.length > 0 ||
      data.recentSettlements.length > 0 ||
      data.activeGroups.length > 0 ||
      !new Decimal(data.totals.net).isZero();

    return { success: true, data };
  } catch (error) {
    const result = fail(error);
    // Degrade to an empty card rather than taking the dashboard down with it.
    return result.success === false && error?.digest !== "DYNAMIC_SERVER_USAGE"
      ? { success: true, data: EMPTY, degraded: true }
      : result;
  }
}
