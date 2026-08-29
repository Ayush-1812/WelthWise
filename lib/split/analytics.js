/**
 * Shared-expense analytics - pure functions, no database.
 *
 * Two rules carried over from M12/M22, because analytics is where violating
 * either becomes most visible:
 *
 *   1. Settlements are transfers, never income or expense. A repayment must
 *      not inflate "total group spending".
 *   2. Never silently sum across currencies. Every aggregate here operates on
 *      an already-single-currency ledger; the caller (the server action) is
 *      responsible for splitting a mixed ledger before calling in.
 *
 * Kept entirely separate from personal-finance analytics (actions/dashboard.js,
 * lib/inngest getMonthlyStats) - this module never reads Transaction rows.
 */

import { toDecimal, add, sum } from "../money.js";
import { summarizeByCounterparty, pairwiseForUser } from "./balances.js";

/**
 * Total group spending: the sum of expense amounts, i.e. what was actually
 * spent by the group. Deleted expenses are excluded; settlements never enter
 * this figure at all, because they move money that was already spent.
 */
export function totalSpending(expenses = []) {
  return sum(expenses.filter((e) => !e.isDeleted).map((e) => e.amount));
}

/** Spending grouped by category, sorted largest first. */
export function spendingByCategory(expenses = []) {
  const totals = new Map();

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    const category = expense.category ?? "other-expense";
    totals.set(category, add(totals.get(category) ?? toDecimal(0), expense.amount));
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

/**
 * Spending by member: each participant's SHARE of every expense, not the
 * amount they paid. This is what "who spent the most" should mean - someone
 * who fronted a big group dinner but ate a normal portion did not spend more
 * than everyone else; they lent more.
 */
export function spendingByMember(expenses = []) {
  const totals = new Map();

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    for (const split of expense.splits ?? []) {
      totals.set(
        split.userId,
        add(totals.get(split.userId) ?? toDecimal(0), split.shareAmount)
      );
    }
  }

  return [...totals.entries()]
    .map(([userId, amount]) => ({ userId, amount }))
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

/**
 * Spending over time, bucketed by day/week/month.
 * Buckets with zero expenses are omitted rather than padded with zeros - the
 * caller decides whether to fill gaps for a chart axis.
 */
export function spendingOverTime(expenses = [], { bucket = "month" } = {}) {
  const key = (date) => {
    const d = new Date(date);
    if (bucket === "day") return d.toISOString().slice(0, 10);
    if (bucket === "week") return startOfWeekKey(d);
    return d.toISOString().slice(0, 7); // month
  };

  const totals = new Map();
  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    const k = key(expense.date);
    totals.set(k, add(totals.get(k) ?? toDecimal(0), expense.amount));
  }

  return [...totals.entries()]
    .map(([period, amount]) => ({ period, amount }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

function startOfWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * One user's headline figures for a scope (spec #22: total paid, total
 * recovered, total owed).
 *
 *   totalPaid       what they fronted, in full - real cash out. Does not
 *                   shrink when money comes back, because the cash really
 *                   did go out (mirrors the M12 cash-out/share/recoverable
 *                   split).
 *   totalSpent      their own consumption - never the amount they fronted.
 *   totalRecovered  settlements they have received so far.
 *   totalOwedToThem what is still outstanding from what they lent out.
 *   totalTheyOwe    what they still owe others, right now.
 *
 * totalOwedToThem/totalTheyOwe are NOT recomputed here - they delegate to
 * summarizeByCounterparty(pairwiseForUser(...)) from balances.js, the one
 * canonical implementation of "who owes whom" (task.md section 1). A second,
 * slightly different formula living in this file would be a bug waiting to
 * happen the day the two drift apart.
 */
export function userTotals(userId, ledger = {}) {
  const { expenses = [] } = ledger;

  let totalPaid = toDecimal(0);
  let totalSpent = toDecimal(0);

  for (const expense of expenses) {
    if (expense.isDeleted) continue;
    if (expense.paidById === userId) totalPaid = add(totalPaid, expense.amount);

    const mine = (expense.splits ?? []).find((s) => s.userId === userId);
    if (mine) totalSpent = add(totalSpent, mine.shareAmount);
  }

  let totalRecovered = toDecimal(0);
  for (const settlement of ledger.settlements ?? []) {
    if (settlement.toUserId === userId) {
      totalRecovered = add(totalRecovered, settlement.amount);
    }
  }

  const owed = summarizeByCounterparty(pairwiseForUser(ledger, userId));

  return {
    totalPaid,
    totalSpent,
    totalRecovered,
    totalOwedToThem: owed.owedToYou,
    totalTheyOwe: owed.youOwe,
  };
}

/**
 * Full analytics for a scope (a group, or a user's whole shared-expense life).
 * The caller supplies an already-single-currency ledger.
 */
export function buildAnalytics(ledger = {}, { bucket = "month" } = {}) {
  const expenses = ledger.expenses ?? [];

  return {
    totalSpending: totalSpending(expenses),
    byCategory: spendingByCategory(expenses),
    byMember: spendingByMember(expenses),
    overTime: spendingOverTime(expenses, { bucket }),
    expenseCount: expenses.filter((e) => !e.isDeleted).length,
  };
}
