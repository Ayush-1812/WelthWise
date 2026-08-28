/**
 * Shared-expense search and filtering - pure functions, no database.
 *
 * Builds the Prisma `where` clause rather than filtering in the browser. The
 * existing personal transaction table loads everything and filters client-side,
 * which is fine for one account but will not hold for a shared ledger spanning
 * several groups (task.md M18).
 *
 * The where-builder is pure, so the access scoping and every filter combination
 * are testable without a database.
 */

import { toDecimal, round } from "../money.js";

export class FilterError extends Error {
  constructor(message) {
    super(message);
    this.name = "FilterError";
  }
}

export const EMPTY_FILTERS = {
  q: "",
  groupId: null,
  personId: null,
  category: null,
  from: null,
  to: null,
  minAmount: null,
  maxAmount: null,
  currency: null,
};

const parseDate = (value, label) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FilterError(`${label} is not a valid date`);
  return d;
};

const parseAmount = (value, label) => {
  if (value === null || value === undefined || value === "") return null;
  let d;
  try {
    d = round(toDecimal(value));
  } catch {
    throw new FilterError(`${label} must be a number`);
  }
  if (d.isNegative()) throw new FilterError(`${label} cannot be negative`);
  return d;
};

const clean = (value) => {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
};

/**
 * Normalize and validate raw filter input.
 * Ranges are checked here so an impossible query is rejected with a clear
 * message rather than silently returning nothing.
 */
export function normalizeFilters(input = {}) {
  const from = parseDate(input.from, "Start date");
  const to = parseDate(input.to, "End date");

  if (from && to && from.getTime() > to.getTime()) {
    throw new FilterError("The start date is after the end date");
  }

  const minAmount = parseAmount(input.minAmount, "Minimum amount");
  const maxAmount = parseAmount(input.maxAmount, "Maximum amount");

  if (minAmount && maxAmount && minAmount.greaterThan(maxAmount)) {
    throw new FilterError("The minimum amount is above the maximum");
  }

  const q = String(input.q ?? "").trim().slice(0, 100);

  return {
    q,
    groupId: clean(input.groupId),
    personId: clean(input.personId),
    category: clean(input.category),
    from,
    to,
    minAmount,
    maxAmount,
    currency: clean(input.currency),
  };
}

/** Whether anything is actually being filtered. */
export function hasActiveFilters(filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  return Boolean(
    f.q ||
      f.groupId ||
      f.personId ||
      f.category ||
      f.from ||
      f.to ||
      f.minAmount ||
      f.maxAmount ||
      f.currency
  );
}

/** How many filters are applied, for a "clear (3)" affordance. */
export function activeFilterCount(filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  return [
    f.q,
    f.groupId,
    f.personId,
    f.category,
    f.from,
    f.to,
    f.minAmount,
    f.maxAmount,
    f.currency,
  ].filter(Boolean).length;
}

/**
 * The base access clause: only expenses the caller is party to.
 *
 * Kept separate from the user filters and always ANDed, so no combination of
 * filter values can widen visibility beyond what the caller may see.
 */
export function accessClauseFor(userId) {
  return {
    OR: [
      { paidById: userId },
      { splits: { some: { userId } } },
      { group: { members: { some: { userId, leftAt: null } } } },
    ],
  };
}

/**
 * Build the Prisma `where` for a shared-expense query.
 *
 * @param {object} filters  already normalized
 * @param {string} userId   the caller - access scoping is never optional
 */
export function buildExpenseWhere(filters, userId) {
  if (!userId) throw new FilterError("A user is required to scope this query");

  const f = { ...EMPTY_FILTERS, ...(filters ?? {}) };
  const and = [accessClauseFor(userId)];

  if (f.q) {
    and.push({
      OR: [
        { description: { contains: f.q, mode: "insensitive" } },
        { notes: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }

  if (f.groupId) and.push({ groupId: f.groupId });
  if (f.category) and.push({ category: f.category });
  if (f.currency) and.push({ currency: f.currency });

  // "Involving this person" means they paid or they have a share.
  if (f.personId) {
    and.push({
      OR: [{ paidById: f.personId }, { splits: { some: { userId: f.personId } } }],
    });
  }

  if (f.from || f.to) {
    and.push({
      date: {
        ...(f.from ? { gte: f.from } : {}),
        ...(f.to ? { lte: f.to } : {}),
      },
    });
  }

  if (f.minAmount || f.maxAmount) {
    and.push({
      amount: {
        ...(f.minAmount ? { gte: f.minAmount.toFixed(2) } : {}),
        ...(f.maxAmount ? { lte: f.maxAmount.toFixed(2) } : {}),
      },
    });
  }

  return { isDeleted: false, AND: and };
}

/** Stable ordering for cursor pagination: newest first, id as a tiebreak. */
export const EXPENSE_ORDER = [{ date: "desc" }, { id: "desc" }];

/**
 * Human summary of the active filters, for a results header.
 * `names` maps ids to labels so the summary reads in words, not uuids.
 */
export function describeFilters(filters = {}, names = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const parts = [];

  if (f.q) parts.push(`matching "${f.q}"`);
  if (f.groupId) parts.push(`in ${names[f.groupId] ?? "a group"}`);
  if (f.personId) parts.push(`involving ${names[f.personId] ?? "someone"}`);
  if (f.category) parts.push(`categorised ${names[f.category] ?? f.category}`);

  if (f.from && f.to) {
    parts.push(`between ${fmtDate(f.from)} and ${fmtDate(f.to)}`);
  } else if (f.from) {
    parts.push(`from ${fmtDate(f.from)}`);
  } else if (f.to) {
    parts.push(`up to ${fmtDate(f.to)}`);
  }

  if (f.minAmount && f.maxAmount) {
    parts.push(`between ${f.minAmount.toFixed(2)} and ${f.maxAmount.toFixed(2)}`);
  } else if (f.minAmount) {
    parts.push(`over ${f.minAmount.toFixed(2)}`);
  } else if (f.maxAmount) {
    parts.push(`under ${f.maxAmount.toFixed(2)}`);
  }

  if (f.currency) parts.push(`in ${f.currency}`);

  return parts.length === 0 ? "" : parts.join(", ");
}

function fmtDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}
