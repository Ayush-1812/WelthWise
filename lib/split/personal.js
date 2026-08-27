/**
 * Personal-finance integration - pure functions, no database.
 *
 * The problem this solves (task.md M12, spec #14):
 *
 *   Ayush pays a 4,000 hotel bill; his own share is 1,000.
 *
 *     cash actually out of his account   4,000   -> account balance
 *     what he actually consumed          1,000   -> personal spending analytics
 *     recoverable from the others        3,000   -> a receivable, NOT an expense
 *
 * Counting the whole 4,000 as personal spending would inflate his analytics by
 * 300%. Counting only 1,000 would leave his account balance wrong by 3,000.
 * Both numbers are needed, so one payment becomes TWO linked personal rows:
 *
 *   EXPENSE 1,000  isTransfer=false  -> real consumption, counts everywhere
 *   EXPENSE 3,000  isTransfer=true   -> money lent out, excluded from analytics
 *
 * Together they move the balance by the full 4,000. When the 3,000 comes back,
 * a settlement row (INCOME, isTransfer=true) restores the balance and adds
 * exactly zero income.
 *
 * `isTransfer` is the single flag every analytics query filters on.
 */

import { toDecimal, sub, isZero, isNegative } from "../money.js";

/** Category used for the receivable leg, so it is obvious in the ledger. */
export const RECEIVABLE_CATEGORY = "other-expense";

/**
 * The personal transaction rows a shared expense should produce for one user.
 *
 * Only the payer has any cash movement - a participant who did not pay has no
 * personal transaction at all, because no money left their account. Their debt
 * lives in the shared ledger until they settle it.
 *
 * @param {object} args
 * @param {string} args.myUserId
 * @param {string} args.paidById
 * @param {*}      args.amount     full expense total
 * @param {*}      args.myShare    this user's share of it
 * @param {string} args.description
 * @param {string} args.category
 * @param {Date}   args.date
 * @returns {Array<{type, amount, category, description, isTransfer}>}
 */
export function personalEntriesForExpense({
  myUserId,
  paidById,
  amount,
  myShare,
  description,
  category,
  date,
}) {
  // Not the payer: no cash moved, so nothing to record personally.
  if (myUserId !== paidById) return [];

  const total = toDecimal(amount);
  const share = toDecimal(myShare ?? 0);
  const lent = sub(total, share);

  const entries = [];

  // What the payer actually consumed.
  if (!isZero(share)) {
    entries.push({
      type: "EXPENSE",
      amount: share,
      category,
      description,
      date,
      isTransfer: false,
    });
  }

  // What the payer fronted for other people. Real cash out, but not spending.
  if (!isZero(lent) && !isNegative(lent)) {
    entries.push({
      type: "EXPENSE",
      amount: lent,
      category: RECEIVABLE_CATEGORY,
      description: `${description} — paid for others`,
      date,
      isTransfer: true,
    });
  }

  return entries;
}

/**
 * The personal transaction row a settlement should produce for one user.
 *
 * Always a transfer: money changes hands but nothing is consumed. Paying
 * someone back is not an expense, and being paid back is definitely not income.
 */
export function personalEntryForSettlement({
  myUserId,
  fromUserId,
  toUserId,
  amount,
  counterpartyName,
  date,
}) {
  const value = toDecimal(amount);
  if (isZero(value)) return null;

  if (myUserId === fromUserId) {
    return {
      type: "EXPENSE", // cash out
      amount: value,
      category: RECEIVABLE_CATEGORY,
      description: `Settled up with ${counterpartyName}`,
      date,
      isTransfer: true,
    };
  }

  if (myUserId === toUserId) {
    return {
      type: "INCOME", // cash in - balance only, never counted as income
      amount: value,
      category: "other-income",
      description: `${counterpartyName} settled up with you`,
      date,
      isTransfer: true,
    };
  }

  return null;
}

/**
 * How much a personal transaction counts toward spending analytics.
 * A transfer contributes nothing; everything else contributes its amount.
 */
export function consumptionAmount(transaction) {
  if (!transaction || transaction.isTransfer) return toDecimal(0);
  return toDecimal(transaction.amount ?? 0);
}

/** True when a transaction should appear in personal spending analytics. */
export function countsTowardSpending(transaction) {
  return Boolean(transaction) && !transaction.isTransfer;
}

/**
 * The three figures the spec asks to keep distinct, for one shared expense.
 * Useful for explaining a payment in the UI.
 */
export function explainPayment({ amount, myShare }) {
  const total = toDecimal(amount);
  const share = toDecimal(myShare ?? 0);

  return {
    cashOut: total,
    yourExpense: share,
    recoverable: sub(total, share),
  };
}

/**
 * Net effect on an account balance, for verification.
 * Expenses reduce it, income increases it - transfers included, because the
 * cash genuinely moved.
 */
export function balanceDelta(entries = []) {
  return entries.reduce((acc, entry) => {
    const value = toDecimal(entry.amount);
    return entry.type === "EXPENSE" ? sub(acc, value) : acc.plus(value);
  }, toDecimal(0));
}
