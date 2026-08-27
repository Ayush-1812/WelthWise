/**
 * Settlement rules - pure functions, no database.
 *
 * A settlement is a transfer of money that already exists in the ledger. It is
 * NEVER income or expense (task.md section 1), and it may only ever reduce a
 * debt that is already there.
 */

import { Decimal, toDecimal, round, sub } from "../money.js";

export const SETTLEMENT_METHODS = [
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "EXTERNAL", label: "Other app" },
  { value: "OTHER", label: "Other" },
];

const METHOD_VALUES = new Set(SETTLEMENT_METHODS.map((m) => m.value));

export class SettlementError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettlementError";
  }
}

/**
 * Work out who should pay whom, given a pairwise balance from `meId`'s
 * point of view (positive => the other person owes me).
 *
 * @returns {{ fromUserId, toUserId, outstanding: Decimal } | null}
 *          null when nothing is owed in either direction.
 */
export function settlementDirection(netBalance, meId, otherId) {
  const net = toDecimal(netBalance ?? 0);
  if (net.isZero()) return null;

  return net.isPositive()
    ? { fromUserId: otherId, toUserId: meId, outstanding: net }
    : { fromUserId: meId, toUserId: otherId, outstanding: net.abs() };
}

/**
 * Validate a proposed settlement.
 *
 * A settlement may only reduce an existing debt: it must run from the debtor
 * to the creditor, and never exceed what is outstanding. Allowing more would
 * silently create a debt in the opposite direction, which is a confusing way
 * to lose money.
 *
 * @returns {{ ok: boolean, error?: string, amount?: Decimal, remaining?: Decimal, isFull?: boolean }}
 */
export function validateSettlement({
  amount,
  outstanding,
  fromUserId,
  toUserId,
  method = "EXTERNAL",
}) {
  if (!fromUserId || !toUserId) {
    return { ok: false, error: "Both people are required" };
  }
  if (fromUserId === toUserId) {
    return { ok: false, error: "You cannot settle up with yourself" };
  }
  if (!METHOD_VALUES.has(method)) {
    return { ok: false, error: "Choose how the payment was made" };
  }

  let value;
  try {
    value = round(toDecimal(amount));
  } catch {
    return { ok: false, error: "Enter a valid amount" };
  }

  if (value.isZero()) {
    return { ok: false, error: "Amount must be greater than zero" };
  }
  if (value.isNegative()) {
    return { ok: false, error: "Amount cannot be negative" };
  }

  let owed;
  try {
    owed = round(toDecimal(outstanding ?? 0));
  } catch {
    return { ok: false, error: "Could not read the outstanding balance" };
  }

  if (owed.isZero() || owed.isNegative()) {
    return { ok: false, error: "There is nothing outstanding to settle" };
  }

  if (value.greaterThan(owed)) {
    return {
      ok: false,
      error: `That is more than the ${owed.toFixed(2)} outstanding`,
    };
  }

  const remaining = sub(owed, value);

  return {
    ok: true,
    amount: value,
    remaining,
    isFull: remaining.isZero(),
  };
}

/** Throwing variant, for server actions. */
export function assertValidSettlement(input) {
  const result = validateSettlement(input);
  if (!result.ok) throw new SettlementError(result.error);
  return result;
}

/** The amount that would clear a debt entirely. */
export function fullSettlementAmount(netBalance) {
  return toDecimal(netBalance ?? 0).abs();
}

/** Human summary of what a settlement will leave behind. */
export function describeOutcome({ amount, outstanding }) {
  const value = toDecimal(amount ?? 0);
  const owed = toDecimal(outstanding ?? 0);
  const remaining = sub(owed, value);

  if (remaining.isZero()) return "This clears the balance completely.";
  if (remaining.isPositive()) {
    return `${remaining.toFixed(2)} will still be outstanding.`;
  }
  return "This is more than is outstanding.";
}

export { Decimal };
