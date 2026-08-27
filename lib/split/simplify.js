/**
 * Debt simplification - pure functions, no database.
 *
 * Reduces the number of payments needed to settle a group without changing
 * what anyone ends up owing. This is a RECOMMENDATION only: it never mutates
 * the ledger. Users still record real settlements, and those settlements are
 * what actually move balances (task.md section 1).
 *
 *   A owes B 500, B owes C 500   ->   A pays C 500
 *   two payments become one, and every net balance is unchanged.
 */

import { Decimal, toDecimal, sum, sub } from "../money.js";

export class SimplifyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SimplifyError";
  }
}

/** Deterministic ordering: largest amount first, ties broken by id. */
function pickLargest(entries) {
  let best = null;
  for (const entry of entries) {
    if (entry.amount.isZero()) continue;
    if (
      best === null ||
      entry.amount.greaterThan(best.amount) ||
      (entry.amount.equals(best.amount) && entry.userId < best.userId)
    ) {
      best = entry;
    }
  }
  return best;
}

/**
 * Minimum-cash-flow simplification.
 *
 * Repeatedly matches the largest creditor with the largest debtor and settles
 * the smaller of the two. Each step zeroes at least one party, so the result
 * is at most n-1 payments for n people with a non-zero balance.
 *
 * @param {Map<string, Decimal>|Array<[string, any]>} netBalances
 *        positive = owed to them, negative = they owe
 * @returns {Array<{fromUserId: string, toUserId: string, amount: Decimal}>}
 */
export function simplifyDebts(netBalances) {
  const raw = netBalances instanceof Map ? [...netBalances.entries()] : (netBalances ?? []);

  const entries = raw
    .map(([userId, value]) => ({ userId, amount: toDecimal(value) }))
    .filter((e) => !e.amount.isZero());

  if (entries.length === 0) return [];

  // A ledger that does not sum to zero is inconsistent; simplifying it would
  // invent or destroy money, so refuse rather than produce a plausible lie.
  const total = sum(entries.map((e) => e.amount));
  if (!total.isZero()) {
    throw new SimplifyError(
      `Balances do not sum to zero (off by ${total.toFixed(2)}) - the ledger is inconsistent`
    );
  }

  // Work on copies so the caller's data is untouched.
  const creditors = entries
    .filter((e) => e.amount.isPositive())
    .map((e) => ({ userId: e.userId, amount: e.amount }));
  const debtors = entries
    .filter((e) => e.amount.isNegative())
    .map((e) => ({ userId: e.userId, amount: e.amount.abs() }));

  const payments = [];
  // Bounded to guarantee termination even if a rounding bug ever crept in.
  const maxSteps = creditors.length + debtors.length;

  for (let step = 0; step < maxSteps; step++) {
    const creditor = pickLargest(creditors);
    const debtor = pickLargest(debtors);
    if (!creditor || !debtor) break;

    const amount = creditor.amount.lessThan(debtor.amount)
      ? creditor.amount
      : debtor.amount;

    payments.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amount,
    });

    creditor.amount = sub(creditor.amount, amount);
    debtor.amount = sub(debtor.amount, amount);
  }

  return payments;
}

/**
 * Net balances implied by a set of payments, from each person's point of view.
 * Used to prove a simplified plan preserves everyone's position.
 */
export function balancesFromPayments(payments = []) {
  const net = new Map();
  const bump = (userId, delta) =>
    net.set(userId, (net.get(userId) ?? new Decimal(0)).plus(delta));

  for (const { fromUserId, toUserId, amount } of payments) {
    const value = toDecimal(amount);
    // Paying settles what you owe; receiving settles what you are owed.
    bump(fromUserId, value.negated());
    bump(toUserId, value);
  }

  return net;
}

/**
 * Verify a simplified plan against the original balances.
 * Every person must end up in exactly the same position.
 */
export function preservesBalances(netBalances, payments) {
  const original = netBalances instanceof Map ? netBalances : new Map(netBalances);
  const implied = balancesFromPayments(payments);

  const ids = new Set([...original.keys(), ...implied.keys()]);

  for (const id of ids) {
    const before = toDecimal(original.get(id) ?? 0);
    const after = toDecimal(implied.get(id) ?? 0);
    if (!before.equals(after)) return false;
  }

  return true;
}

/**
 * Compare the raw pairwise debts with the simplified plan, so the UI can show
 * what the recommendation actually saves.
 */
export function comparePlans(currentPairs = [], simplified = []) {
  const before = currentPairs.length;
  const after = simplified.length;

  return {
    before,
    after,
    saved: Math.max(0, before - after),
    // Nothing to gain when the plan is already minimal.
    worthwhile: after < before,
  };
}

/**
 * Full recommendation for a scope.
 * `netBalances` must already be derived from the ledger by the caller.
 */
export function buildSettlementPlan(netBalances, currentPairs = []) {
  const payments = simplifyDebts(netBalances);

  return {
    payments,
    comparison: comparePlans(currentPairs, payments),
    // Belt and braces - a plan that changes someone's position is a bug.
    verified: preservesBalances(netBalances, payments),
  };
}
