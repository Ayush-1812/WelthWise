/**
 * Itemized splitting - pure functions, no database, no OCR.
 *
 * Each line item is assigned to the people who actually consumed it, and each
 * assignee pays an equal share of that item. A person's total is the sum of
 * their per-item shares.
 *
 * The guarantee that matters: the resulting splits sum to EXACTLY the expense
 * total. Every per-item division goes through allocate(), so a three-way split
 * of a 10.00 dish is 3.34/3.33/3.33 and no paisa is lost across dozens of items.
 *
 * Deliberately independent of OCR. Receipt scanning only ever produces a draft
 * list of items for a human to correct - it is never the source of truth.
 */

import { toDecimal, round, sum, add, allocate, equals } from "../money.js";

export class ItemizedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ItemizedError";
  }
}

/** A blank line item, for the "add row" affordance. */
export function emptyItem() {
  return { name: "", amount: "", assignedTo: [] };
}

/**
 * Normalize and validate a list of line items.
 * Throws on anything that would make the split unsound.
 */
export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ItemizedError("Add at least one item");
  }

  return items.map((item, index) => {
    const position = index + 1;

    const name = String(item?.name ?? "").trim();
    if (!name) throw new ItemizedError(`Item ${position} needs a name`);
    if (name.length > 100) {
      throw new ItemizedError(`Item ${position}: name is too long`);
    }

    let amount;
    try {
      amount = round(toDecimal(item?.amount));
    } catch {
      throw new ItemizedError(`Item ${position} ("${name}") needs a valid amount`);
    }
    if (amount.isNegative()) {
      throw new ItemizedError(`Item ${position} ("${name}") cannot be negative`);
    }
    if (amount.isZero()) {
      throw new ItemizedError(`Item ${position} ("${name}") must be more than zero`);
    }

    const assignedTo = [...new Set(item?.assignedTo ?? [])].filter(Boolean);
    if (assignedTo.length === 0) {
      throw new ItemizedError(`Nobody is assigned to "${name}"`);
    }

    return { name, amount, assignedTo, quantity: Number(item?.quantity) || 1 };
  });
}

/** The sum of every line item. */
export function itemsTotal(items) {
  return sum((items ?? []).map((i) => toDecimal(i.amount ?? 0)));
}

/**
 * Check the items add up to the expense total.
 * Returns a result rather than throwing, so the UI can show a live remainder.
 */
export function checkItemsTotal(expenseTotal, items) {
  let expected;
  try {
    expected = round(toDecimal(expenseTotal));
  } catch {
    return { ok: false, expected: null, actual: null, difference: null };
  }

  const actual = round(itemsTotal(items));
  const difference = actual.minus(expected);

  return { ok: difference.isZero(), expected, actual, difference };
}

/**
 * Split an itemized expense.
 *
 * @param {object} args
 * @param {*} args.total          the expense total
 * @param {Array} args.items      normalized line items
 * @param {string[]} args.participantIds  everyone on the expense
 * @returns {Array<{userId, shareAmount, shareInput}>}
 */
export function computeItemizedSplit({ total, items, participantIds }) {
  const normalized = normalizeItems(items);

  const check = checkItemsTotal(total, normalized);
  if (!check.ok) {
    const over = check.difference.isPositive();
    throw new ItemizedError(
      `Items add up to ${check.actual.toFixed(2)}, which is ${check.difference
        .abs()
        .toFixed(2)} ${over ? "over" : "under"} the total of ${check.expected.toFixed(2)}`
    );
  }

  const participants = [...new Set(participantIds ?? [])].filter(Boolean);
  if (participants.length === 0) {
    throw new ItemizedError("Select at least one participant");
  }

  // Nobody can be assigned an item unless they are on the expense.
  const allowed = new Set(participants);
  for (const item of normalized) {
    const outsider = item.assignedTo.find((id) => !allowed.has(id));
    if (outsider) {
      throw new ItemizedError(
        `"${item.name}" is assigned to someone who is not part of this expense`
      );
    }
  }

  // Per-item allocation, so each item is divided exactly among its eaters.
  const totals = new Map(participants.map((id) => [id, toDecimal(0)]));

  for (const item of normalized) {
    const shares = allocate(item.amount, item.assignedTo.map(() => 1));
    item.assignedTo.forEach((userId, index) => {
      totals.set(userId, add(totals.get(userId), shares[index]));
    });
  }

  const splits = participants.map((userId) => ({
    userId,
    shareAmount: totals.get(userId),
    shareInput: null,
  }));

  // The per-item allocations are each exact, so the sum must be too. Assert it
  // rather than trust it - this is the whole point of the module.
  const computed = sum(splits.map((s) => s.shareAmount));
  if (!equals(computed, check.expected)) {
    throw new ItemizedError(
      `Itemized split produced ${computed.toFixed(2)} but the total is ${check.expected.toFixed(2)}`
    );
  }

  return splits;
}

/**
 * Which items a given person is paying for, and how much of each.
 * Used to explain a share on the expense detail page.
 */
export function itemsForUser(items, userId) {
  return normalizeItems(items)
    .filter((item) => item.assignedTo.includes(userId))
    .map((item) => {
      const shares = allocate(item.amount, item.assignedTo.map(() => 1));
      const index = item.assignedTo.indexOf(userId);
      return {
        name: item.name,
        amount: item.amount,
        sharedWith: item.assignedTo.length,
        yourShare: shares[index],
      };
    });
}

/**
 * Convert a receipt-scan result into draft line items (M21, OCR half).
 *
 * The scanner is unreliable, so this only ever produces a draft: nothing is
 * assigned, and the caller must review before it can be saved.
 */
export function draftItemsFromScan(scanned) {
  const lines = Array.isArray(scanned?.items) ? scanned.items : [];

  return lines
    .map((line) => {
      const name = String(line?.name ?? line?.description ?? "").trim();
      let amount;
      try {
        amount = round(toDecimal(line?.amount ?? line?.price));
      } catch {
        return null;
      }
      if (!name || amount.isZero() || amount.isNegative()) return null;

      // Deliberately unassigned - a human decides who ate what.
      return { name, amount: amount.toFixed(2), assignedTo: [] };
    })
    .filter(Boolean);
}
