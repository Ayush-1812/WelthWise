/**
 * Split engine - pure functions, no database, no UI.
 *
 * Every method returns shares that sum to EXACTLY the expense total. All
 * rounding goes through allocate() from lib/money.js, which distributes
 * leftover minor units by largest remainder, so a rupee is never lost or
 * invented (task.md section 1).
 *
 * Nothing here reads or writes state. This is deliberate: split arithmetic is
 * where the money bugs live, and they should be found by tests rather than
 * through a form.
 */

import {
  Decimal,
  toDecimal,
  round,
  sum,
  add,
  sub,
  allocate,
  checkSum,
} from "../money.js";

export const SPLIT_METHODS = [
  "EQUAL",
  "EXACT",
  "PERCENTAGE",
  "SHARES",
  "CUSTOM",
  "ITEMIZED",
];

export class SplitError extends Error {
  constructor(message, code = "INVALID_SPLIT") {
    super(message);
    this.name = "SplitError";
    this.code = code;
  }
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** A total must be present and strictly positive. */
function assertPositiveTotal(total) {
  let value;
  try {
    value = round(total);
  } catch {
    throw new SplitError("Enter a valid amount");
  }

  if (value.isZero()) throw new SplitError("Amount must be greater than zero");
  if (value.isNegative()) throw new SplitError("Amount cannot be negative");

  return value;
}

/** Participants must be a non-empty list of unique ids. */
function assertParticipants(participantIds) {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    throw new SplitError("Select at least one participant");
  }

  const ids = participantIds.filter(Boolean);
  if (ids.length !== participantIds.length) {
    throw new SplitError("Participant list contains an empty id");
  }

  if (new Set(ids).size !== ids.length) {
    throw new SplitError("The same participant appears twice");
  }

  return ids;
}

/**
 * Read a per-participant value map, in participant order.
 * Missing entries default to zero so a partially filled form still validates
 * against the total rather than throwing an unhelpful error first.
 */
function readValues(participantIds, values, label) {
  if (!values || typeof values !== "object") {
    throw new SplitError(`Enter ${label} for each participant`);
  }

  return participantIds.map((id) => {
    const raw = values[id];
    if (raw === undefined || raw === null || raw === "") return ZERO;

    let value;
    try {
      value = toDecimal(raw);
    } catch {
      throw new SplitError(`Enter a valid ${label} for each participant`);
    }

    if (value.isNegative()) {
      throw new SplitError(`${label} cannot be negative`);
    }
    return value;
  });
}

/** Uniform result row matching the ExpenseSplit columns. */
function toSplits(participantIds, amounts, inputs = null) {
  return participantIds.map((userId, index) => ({
    userId,
    shareAmount: amounts[index],
    shareInput: inputs ? inputs[index] : null,
  }));
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Split equally.
 *
 * The payer is ordered first so they absorb the leftover minor unit - task.md
 * section 1. Results come back in the caller's participant order regardless.
 */
export function splitEqual(total, participantIds, { payerId = null } = {}) {
  const ids = assertParticipants(participantIds);
  const value = assertPositiveTotal(total);

  const ordered =
    payerId && ids.includes(payerId)
      ? [payerId, ...ids.filter((id) => id !== payerId)]
      : ids;

  const amounts = allocate(value, ordered.map(() => 1));
  const byId = new Map(ordered.map((id, index) => [id, amounts[index]]));

  return toSplits(ids, ids.map((id) => byId.get(id)));
}

/**
 * Exact amounts, one per participant. The entered amounts must already sum to
 * the total - this method never adjusts them.
 */
export function splitExact(total, participantIds, amounts) {
  const ids = assertParticipants(participantIds);
  const value = assertPositiveTotal(total);
  const entered = readValues(ids, amounts, "amount").map(round);

  const { ok, difference } = checkSum(value, entered);
  if (!ok) {
    const over = difference.isPositive();
    throw new SplitError(
      `Amounts add up to ${sum(entered).toFixed(2)}, which is ${difference
        .abs()
        .toFixed(2)} ${over ? "over" : "under"} the total of ${value.toFixed(2)}`
    );
  }

  return toSplits(ids, entered, entered);
}

/**
 * Percentages, which must sum to exactly 100.
 *
 * 99.99 is rejected rather than quietly corrected: a percentage that does not
 * total 100 means the user has not finished, and guessing their intent would
 * silently move money.
 */
export function splitPercentage(total, participantIds, percentages) {
  const ids = assertParticipants(participantIds);
  const value = assertPositiveTotal(total);
  const entered = readValues(ids, percentages, "percentage");

  const totalPct = sum(entered);
  if (!totalPct.equals(HUNDRED)) {
    const diff = sub(HUNDRED, totalPct);
    throw new SplitError(
      `Percentages add up to ${totalPct.toFixed(2)}% - ${diff
        .abs()
        .toFixed(2)}% ${diff.isPositive() ? "remaining" : "over"}`
    );
  }

  // Weight by percentage; allocate() guarantees the parts sum to the total.
  const amounts = allocate(value, entered);
  return toSplits(ids, amounts, entered);
}

/**
 * Shares - integer or fractional weights. "Rahul counts double" is 2 shares.
 */
export function splitShares(total, participantIds, shares) {
  const ids = assertParticipants(participantIds);
  const value = assertPositiveTotal(total);
  const entered = readValues(ids, shares, "share");

  if (sum(entered).isZero()) {
    throw new SplitError("Give at least one participant a share above zero");
  }

  const amounts = allocate(value, entered);
  return toSplits(ids, amounts, entered);
}

/**
 * Custom / adjustment split, matching Splitwise's "adjustment" mode.
 *
 * Each participant may carry a fixed adjustment - an extra dessert, a single
 * person's baggage fee - and whatever remains after those is split equally.
 *
 *   total 3000, Rahul +200
 *   -> base 2800 split 3 ways = 933.34 / 933.33 / 933.33
 *   -> Ayush 933.34, Rahul 1133.33, Priya 933.33  (sums to 3000)
 *
 * Adjustments may be negative, but no participant may end up owing a negative
 * amount, and the adjustments cannot exceed the total.
 */
export function splitCustom(total, participantIds, adjustments, { payerId = null } = {}) {
  const ids = assertParticipants(participantIds);
  const value = assertPositiveTotal(total);

  // Adjustments are the one input that may legitimately be negative.
  const entered = ids.map((id) => {
    const raw = adjustments?.[id];
    if (raw === undefined || raw === null || raw === "") return ZERO;
    try {
      return round(toDecimal(raw));
    } catch {
      throw new SplitError("Enter a valid adjustment for each participant");
    }
  });

  const adjustmentTotal = sum(entered);
  const base = sub(value, adjustmentTotal);

  if (base.isNegative()) {
    throw new SplitError(
      `Adjustments add up to ${adjustmentTotal.toFixed(
        2
      )}, more than the total of ${value.toFixed(2)}`
    );
  }

  const ordered =
    payerId && ids.includes(payerId)
      ? [payerId, ...ids.filter((id) => id !== payerId)]
      : ids;

  const baseParts = allocate(base, ordered.map(() => 1));
  const baseById = new Map(ordered.map((id, index) => [id, baseParts[index]]));

  const amounts = ids.map((id, index) => add(baseById.get(id), entered[index]));

  const negative = amounts.findIndex((a) => a.isNegative());
  if (negative !== -1) {
    throw new SplitError(
      "An adjustment leaves someone with a negative share - reduce it"
    );
  }

  return toSplits(ids, amounts, entered);
}

/**
 * Itemized split. Wired up in M21 once ExpenseItem rows and the OCR assignment
 * flow exist; the manual itemized path is built there too.
 */
export function splitItemized() {
  throw new SplitError(
    "Itemized splitting is not available yet",
    "NOT_IMPLEMENTED"
  );
}

// ---------------------------------------------------------------------------
// Dispatcher and gate
// ---------------------------------------------------------------------------

/**
 * Compute splits for any method.
 *
 * @param {object} args
 * @param {string} args.method       one of SPLIT_METHODS
 * @param {*}      args.total        expense total
 * @param {string[]} args.participantIds
 * @param {object} [args.values]     per-participant input, keyed by user id
 * @param {string} [args.payerId]    absorbs the leftover minor unit
 */
export function computeSplit({ method, total, participantIds, values, payerId }) {
  switch (method) {
    case "EQUAL":
      return splitEqual(total, participantIds, { payerId });
    case "EXACT":
      return splitExact(total, participantIds, values);
    case "PERCENTAGE":
      return splitPercentage(total, participantIds, values);
    case "SHARES":
      return splitShares(total, participantIds, values);
    case "CUSTOM":
      return splitCustom(total, participantIds, values, { payerId });
    case "ITEMIZED":
      return splitItemized(total, participantIds, values);
    default:
      throw new SplitError(`Unknown split method: ${method}`);
  }
}

/**
 * The single gate every ledger write passes through.
 *
 * Re-validates a computed or client-supplied split before it is persisted.
 * Never trust the client: a tampered payload reaches this function too.
 *
 * @returns {{ ok: boolean, errors: string[], expected: Decimal, actual: Decimal, difference: Decimal }}
 */
export function validateSplit(total, splits) {
  const errors = [];

  let expected;
  try {
    expected = assertPositiveTotal(total);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      expected: ZERO,
      actual: ZERO,
      difference: ZERO,
    };
  }

  if (!Array.isArray(splits) || splits.length === 0) {
    return {
      ok: false,
      errors: ["An expense needs at least one participant"],
      expected,
      actual: ZERO,
      difference: expected.negated(),
    };
  }

  const seen = new Set();
  const amounts = [];

  for (const split of splits) {
    if (!split?.userId) {
      errors.push("A split is missing its participant");
      continue;
    }
    if (seen.has(split.userId)) {
      errors.push("The same participant appears twice");
    }
    seen.add(split.userId);

    let amount;
    try {
      amount = toDecimal(split.shareAmount);
    } catch {
      errors.push("A split has an invalid amount");
      continue;
    }

    if (amount.isNegative()) {
      errors.push("A share cannot be negative");
    }
    if (!amount.equals(round(amount))) {
      errors.push("A share has more precision than the currency allows");
    }

    amounts.push(amount);
  }

  const { ok: sumsMatch, actual, difference } = checkSum(expected, amounts);

  if (!sumsMatch) {
    errors.push(
      `Splits add up to ${actual.toFixed(2)} but the total is ${expected.toFixed(
        2
      )}`
    );
  }

  return { ok: errors.length === 0, errors, expected, actual, difference };
}

/** Convenience: throw instead of returning a result object. */
export function assertValidSplit(total, splits) {
  const result = validateSplit(total, splits);
  if (!result.ok) throw new SplitError(result.errors[0]);
  return result;
}
