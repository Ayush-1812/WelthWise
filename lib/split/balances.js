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

/**
 * Raw pairwise debts: who owes whom, before any simplification.
 *
 * An expense makes every participant owe the payer their own share. A
 * settlement reduces what the payer of that settlement owes the recipient.
 * Opposing debts between the same two people are netted, so a pair appears at
 * most once and always in a single direction.
 *
 * Invariant: for any user, the sum of what they are owed minus what they owe
 * across all pairs equals their net balance from computeNetBalances().
 *
 * @returns {Array<{fromUserId: string, toUserId: string, amount: Decimal}>}
 *          `from` owes `to`. Only strictly positive amounts are returned.
 */
export function computePairwiseBalances({ expenses = [], settlements = [] } = {}) {
  // key `${debtor}|${creditor}` -> Decimal
  const debts = new Map();

  const bump = (debtor, creditor, delta) => {
    if (!debtor || !creditor || debtor === creditor) return;
    const key = `${debtor}|${creditor}`;
    debts.set(key, add(debts.get(key) ?? new Decimal(0), delta));
  };

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    const payer = expense.paidById;
    for (const split of expense.splits ?? []) {
      // The payer does not owe themselves their own share.
      if (split.userId === payer) continue;
      bump(split.userId, payer, toDecimal(split.shareAmount));
    }
  }

  for (const settlement of settlements) {
    // Paying someone reduces what you owe them.
    bump(settlement.fromUserId, settlement.toUserId, toDecimal(settlement.amount).negated());
  }

  // Net opposing directions so a pair is reported once.
  const seen = new Set();
  const result = [];

  for (const key of debts.keys()) {
    const [a, b] = key.split("|");
    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const aOwesB = debts.get(`${a}|${b}`) ?? new Decimal(0);
    const bOwesA = debts.get(`${b}|${a}`) ?? new Decimal(0);
    const netted = sub(aOwesB, bOwesA);

    if (netted.isZero()) continue;

    if (netted.isPositive()) {
      result.push({ fromUserId: a, toUserId: b, amount: netted });
    } else {
      result.push({ fromUserId: b, toUserId: a, amount: netted.abs() });
    }
  }

  // Largest debts first - most useful ordering for a "settle up" screen.
  return result.sort((x, y) => y.amount.comparedTo(x.amount));
}

/**
 * Pairwise debts reduced to one user's point of view.
 * Positive means that counterparty owes the user.
 *
 * @returns {Map<string, Decimal>} keyed by the other user's id
 */
export function pairwiseForUser(ledger, userId) {
  const perCounterparty = new Map();

  for (const { fromUserId, toUserId, amount } of computePairwiseBalances(ledger)) {
    if (fromUserId === userId) {
      perCounterparty.set(toUserId, amount.negated()); // I owe them
    } else if (toUserId === userId) {
      perCounterparty.set(fromUserId, amount); // they owe me
    }
  }

  return perCounterparty;
}

/**
 * Every ledger row that contributes to the balance between two people, with
 * the signed amount each one contributed.
 *
 * Sign convention matches pairwiseForUser: positive means `otherId` owes `meId`.
 *
 *   expense I paid, they have a share    -> +their share
 *   expense they paid, I have a share    -> -my share
 *   settlement they sent me              -> -amount   (they owe less)
 *   settlement I sent them               -> +amount   (I owe less)
 *
 * Invariant: the contributions sum to exactly the pairwise balance. That is
 * what lets the UI claim every rupee is traceable to a specific row.
 *
 * @returns {Array<{kind, id, contribution: Decimal, ...row}>}
 */
export function contributionsBetween({ expenses = [], settlements = [] } = {}, meId, otherId) {
  const rows = [];

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    const payer = expense.paidById;
    if (payer !== meId && payer !== otherId) continue;

    const counterpartyId = payer === meId ? otherId : meId;
    const counterpartySplit = (expense.splits ?? []).find(
      (s) => s.userId === counterpartyId
    );
    if (!counterpartySplit) continue;

    const share = toDecimal(counterpartySplit.shareAmount);
    if (share.isZero()) continue;

    rows.push({
      kind: "EXPENSE",
      id: expense.id,
      date: expense.date,
      description: expense.description,
      amount: toDecimal(expense.amount),
      paidById: payer,
      paidByMe: payer === meId,
      // Their share when I paid; my share when they paid.
      share,
      contribution: payer === meId ? share : share.negated(),
      groupId: expense.groupId ?? null,
    });
  }

  for (const settlement of settlements) {
    const { fromUserId, toUserId } = settlement;

    const involvesBoth =
      (fromUserId === meId && toUserId === otherId) ||
      (fromUserId === otherId && toUserId === meId);
    if (!involvesBoth) continue;

    const amount = toDecimal(settlement.amount);

    rows.push({
      kind: "SETTLEMENT",
      id: settlement.id,
      date: settlement.settledAt ?? settlement.createdAt,
      amount,
      fromUserId,
      toUserId,
      sentByMe: fromUserId === meId,
      contribution: fromUserId === meId ? amount : amount.negated(),
      groupId: settlement.groupId ?? null,
    });
  }

  return rows.sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));
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
