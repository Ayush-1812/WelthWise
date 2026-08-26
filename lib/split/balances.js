/**
 * Balance derivation - pure functions over ledger rows.
 *
 * Balances are NEVER stored. Every number here is derived from
 * SharedExpense + ExpenseSplit + Settlement, which are the source of truth
 * (task.md section 1).
 *
 * M5 uses this for the "cannot remove a member who still owes money" guard.
 * M8 builds the pairwise view and the UI on top of the same functions - there
 * must only ever be one implementation of this formula.
 */

import { add, sub, sum, toDecimal, Decimal } from "../money.js";

/**
 * Net balance per user:
 *
 *   net(u) = Σ paid(u) − Σ share(u) + Σ settlementsSent(u) − Σ settlementsReceived(u)
 *
 * Positive => the user should receive money.
 * Negative => the user owes money.
 *
 * Deleted expenses are skipped, which is what makes a soft delete fully
 * reverse an expense's effect.
 *
 * @param {object} ledger
 * @param {Array} ledger.expenses   rows with { paidById, amount, isDeleted, splits[] }
 * @param {Array} ledger.settlements rows with { fromUserId, toUserId, amount }
 * @returns {Map<string, Decimal>}
 */
export function computeNetBalances({ expenses = [], settlements = [] } = {}) {
  const net = new Map();

  const bump = (userId, delta) => {
    if (!userId) return;
    net.set(userId, add(net.get(userId) ?? new Decimal(0), delta));
  };

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    // The payer fronted the whole amount.
    bump(expense.paidById, toDecimal(expense.amount));

    // Each participant consumed their share.
    for (const split of expense.splits ?? []) {
      bump(split.userId, toDecimal(split.shareAmount).negated());
    }
  }

  for (const settlement of settlements) {
    // Paying someone back moves your balance toward zero.
    bump(settlement.fromUserId, toDecimal(settlement.amount));
    bump(settlement.toUserId, toDecimal(settlement.amount).negated());
  }

  return net;
}

/** One user's net balance, or Decimal(0) when they have no ledger activity. */
export function netBalanceFor(ledger, userId) {
  return computeNetBalances(ledger).get(userId) ?? new Decimal(0);
}

/**
 * Every closed ledger must sum to zero: the money one person is owed is exactly
 * the money others owe. A non-zero total means an expense, split or settlement
 * has been written inconsistently.
 */
export function balancesSumToZero(ledger) {
  return sum([...computeNetBalances(ledger).values()]).isZero();
}

/** Split a net-balance map into what is owed to you vs. what you owe. */
export function summarize(ledger, userId) {
  const net = netBalanceFor(ledger, userId);

  return {
    net,
    owedToYou: net.isPositive() ? net : new Decimal(0),
    youOwe: net.isNegative() ? net.abs() : new Decimal(0),
    isSettled: net.isZero(),
  };
}

/**
 * Totals across a whole ledger from one user's point of view, counting each
 * counterparty separately rather than netting them against each other.
 *
 * A user owed ₹500 by one person and owing ₹300 to another has a net of ₹200,
 * but should still see "owed to you ₹500" and "you owe ₹300".
 */
export function summarizeByCounterparty(perCounterpartyNet) {
  let owedToYou = new Decimal(0);
  let youOwe = new Decimal(0);

  for (const balance of perCounterpartyNet.values()) {
    const value = toDecimal(balance);
    if (value.isPositive()) owedToYou = add(owedToYou, value);
    else if (value.isNegative()) youOwe = add(youOwe, value.abs());
  }

  return { owedToYou, youOwe, net: sub(owedToYou, youOwe) };
}
