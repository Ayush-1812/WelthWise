/**
 * Recurring shared expenses - pure scheduling logic, no database.
 *
 * The hard requirement (task.md M17) is idempotency: a retried or double-fired
 * cron run must never charge a group twice. Two independent defences:
 *
 *   1. periodKey     a stable identifier for each occurrence. Combined with
 *                    recurringId it is UNIQUE in the database, so a duplicate
 *                    insert fails at the constraint rather than relying on
 *                    application logic being correct.
 *   2. due-date CAS  the template's nextRunDate is advanced with a conditional
 *                    update, so only one concurrent runner can claim a period.
 *
 * Belt and braces on purpose: money is involved.
 */

export const RECURRING_INTERVALS = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

const INTERVAL_VALUES = new Set(RECURRING_INTERVALS.map((i) => i.value));

export class RecurringError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecurringError";
  }
}

/** Midnight UTC for a date, so a period boundary never depends on run time. */
export function startOfDayUTC(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new RecurringError("Invalid date");
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * A stable identifier for one occurrence of a template.
 *
 * The scheduled run date is used rather than a coarser bucket like "2026-04",
 * because a custom cadence (every 2 weeks) can produce two occurrences inside
 * one calendar month, and they must be distinguishable.
 */
export function periodKeyFor(runDate) {
  return startOfDayUTC(runDate).toISOString().slice(0, 10);
}

/**
 * Advance a date by one interval.
 *
 * `every` multiplies the step for custom cadences: WEEKLY with every=2 is
 * fortnightly.
 *
 * Month arithmetic clamps to the end of a short month, so a template set up on
 * the 31st does not silently skip February by rolling into March.
 */
export function advance(date, interval, every = 1) {
  if (!INTERVAL_VALUES.has(interval)) {
    throw new RecurringError(`Unknown interval: ${interval}`);
  }
  const step = Number(every);
  if (!Number.isInteger(step) || step < 1) {
    throw new RecurringError("Repeat count must be a positive whole number");
  }

  const d = startOfDayUTC(date);

  switch (interval) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + step);
      return d;

    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7 * step);
      return d;

    case "MONTHLY":
      return addMonthsClamped(d, step);

    case "YEARLY":
      return addMonthsClamped(d, 12 * step);

    default:
      throw new RecurringError(`Unknown interval: ${interval}`);
  }
}

/** Add months, clamping the day to the target month's length. */
function addMonthsClamped(date, months) {
  const day = date.getUTCDate();
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );

  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(day, daysInTarget));
  return target;
}

/** Whether a template should run now. */
export function isDue(template, now = new Date()) {
  if (!template || !template.isActive) return false;

  const due = startOfDayUTC(template.nextRunDate);
  const today = startOfDayUTC(now);

  if (due.getTime() > today.getTime()) return false;

  // An end date is inclusive of the last occurrence on or before it.
  if (template.endDate) {
    const end = startOfDayUTC(template.endDate);
    if (due.getTime() > end.getTime()) return false;
  }

  return true;
}

/**
 * Every occurrence a template owes between its nextRunDate and now.
 *
 * A cron that missed runs - downtime, a paused schedule resumed later - should
 * catch up rather than silently skipping periods. Capped so a template with a
 * date far in the past cannot generate thousands of expenses in one run.
 */
export function duePeriods(template, now = new Date(), { max = 12 } = {}) {
  if (!template?.isActive) return [];

  const periods = [];
  let cursor = startOfDayUTC(template.nextRunDate);
  const today = startOfDayUTC(now);
  const end = template.endDate ? startOfDayUTC(template.endDate) : null;

  while (cursor.getTime() <= today.getTime() && periods.length < max) {
    if (end && cursor.getTime() > end.getTime()) break;

    periods.push({ runDate: new Date(cursor), periodKey: periodKeyFor(cursor) });
    cursor = advance(cursor, template.interval, template.every ?? 1);
  }

  return periods;
}

/** The date a template should next run after the given occurrence. */
export function nextRunAfter(template, runDate) {
  return advance(runDate, template.interval, template.every ?? 1);
}

/**
 * Whether a template has finished: past its end date with nothing left to run.
 */
export function isExhausted(template, nextDate) {
  if (!template?.endDate) return false;
  return startOfDayUTC(nextDate).getTime() > startOfDayUTC(template.endDate).getTime();
}

/** Validate the user-supplied parts of a template. */
export function validateRecurringInput({
  description,
  interval,
  every = 1,
  startDate,
  endDate,
} = {}) {
  const cleanDescription = String(description ?? "").trim();
  if (!cleanDescription) {
    throw new RecurringError("Description is required");
  }
  if (cleanDescription.length > 140) {
    throw new RecurringError("Description must be 140 characters or fewer");
  }

  if (!INTERVAL_VALUES.has(interval)) {
    throw new RecurringError("Choose how often this repeats");
  }

  const step = Number(every);
  if (!Number.isInteger(step) || step < 1 || step > 52) {
    throw new RecurringError("Repeat count must be between 1 and 52");
  }

  const start = startOfDayUTC(startDate ?? new Date());
  const end = endDate ? startOfDayUTC(endDate) : null;

  if (end && end.getTime() < start.getTime()) {
    throw new RecurringError("The end date cannot be before the start date");
  }

  return {
    description: cleanDescription,
    interval,
    every: step,
    nextRunDate: start,
    endDate: end,
  };
}

/** Human summary of a schedule, e.g. "Every 2 weeks". */
export function describeSchedule({ interval, every = 1 } = {}) {
  const n = Number(every) || 1;
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[
    interval
  ];
  if (!unit) return "Unknown schedule";
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}
