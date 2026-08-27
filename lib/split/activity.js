/**
 * Activity feed formatting - pure functions, no database.
 *
 * Turns a SharedExpenseActivity row into a human sentence. Kept pure so the
 * wording is testable without a database, and so every surface (group feed,
 * notifications in M16) phrases the same event identically.
 */

import { formatMoney } from "../format.js";

export const ACTIVITY_TYPES = [
  "GROUP_CREATED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "EXPENSE_ADDED",
  "EXPENSE_EDITED",
  "EXPENSE_DELETED",
  "SETTLEMENT_RECORDED",
  "RECURRING_CREATED",
  "RECURRING_GENERATED",
];

/** Icon hint per type, so the UI does not hold a second switch statement. */
export const ACTIVITY_ICONS = {
  GROUP_CREATED: "UsersRound",
  MEMBER_ADDED: "UserPlus",
  MEMBER_REMOVED: "UserMinus",
  EXPENSE_ADDED: "Receipt",
  EXPENSE_EDITED: "Pencil",
  EXPENSE_DELETED: "Trash2",
  SETTLEMENT_RECORDED: "HandCoins",
  RECURRING_CREATED: "RefreshCw",
  RECURRING_GENERATED: "RefreshCw",
};

/**
 * Build a name resolver that says "You" for the viewer.
 * Falls back to "Someone" rather than rendering an empty string.
 */
export function nameResolver({ viewerId, users = [] } = {}) {
  const byId = new Map(users.map((u) => [u.id, u]));

  return (userId, { capitalise = false } = {}) => {
    if (!userId) return "Someone";
    if (userId === viewerId) return capitalise ? "You" : "you";
    const user = byId.get(userId);
    return user?.name || user?.email || "Someone";
  };
}

/** Past-tense verb agreeing with "you" vs a third party. */
function verb(isViewer, youForm, otherForm) {
  return isViewer ? youForm : otherForm;
}

/**
 * A one-line description of an activity row.
 *
 * @param {object} activity  { type, actorId, metadata }
 * @param {object} options   { viewerId, nameOf, currency }
 * @returns {string}
 */
export function describeActivity(activity, { viewerId, nameOf, currency } = {}) {
  if (!activity) return "";

  const resolve = nameOf ?? ((id) => (id === viewerId ? "you" : "Someone"));
  const meta = activity.metadata ?? {};
  const actor = resolve(activity.actorId, { capitalise: true });
  const isViewer = activity.actorId === viewerId;
  const money = (value) => formatMoney(value ?? 0, currency);

  switch (activity.type) {
    case "GROUP_CREATED":
      return `${actor} ${verb(isViewer, "created", "created")} the group${
        meta.name ? ` "${meta.name}"` : ""
      }`;

    case "MEMBER_ADDED": {
      const names = (meta.memberIds ?? [])
        .map((id) => resolve(id))
        .filter(Boolean);
      if (names.length === 0) return `${actor} added a member`;
      return `${actor} added ${listNames(names)}`;
    }

    case "MEMBER_REMOVED": {
      // Leaving and being removed read very differently.
      if (meta.self) {
        return `${actor} left the group`;
      }
      return `${actor} removed ${resolve(meta.targetUserId)}`;
    }

    case "EXPENSE_ADDED":
      return `${actor} added ${money(meta.amount)}${
        meta.description ? ` for ${meta.description}` : ""
      }`;

    case "EXPENSE_EDITED": {
      const changedAmount =
        meta.previousAmount != null &&
        meta.newAmount != null &&
        String(meta.previousAmount) !== String(meta.newAmount);

      if (changedAmount) {
        return `${actor} changed ${meta.description ?? "an expense"} from ${money(
          meta.previousAmount
        )} to ${money(meta.newAmount)}`;
      }
      return `${actor} edited ${meta.description ?? "an expense"}`;
    }

    case "EXPENSE_DELETED":
      return `${actor} deleted ${meta.description ?? "an expense"}${
        meta.amount != null ? ` (${money(meta.amount)})` : ""
      }`;

    case "SETTLEMENT_RECORDED": {
      const from = resolve(meta.fromUserId, { capitalise: true });
      const to = resolve(meta.toUserId);
      return `${from} settled ${money(meta.amount)} with ${to}`;
    }

    case "RECURRING_CREATED":
      return `${actor} set up a recurring expense${
        meta.description ? ` for ${meta.description}` : ""
      }`;

    case "RECURRING_GENERATED":
      return `${meta.description ?? "A recurring expense"} of ${money(
        meta.amount
      )} was added automatically`;

    default:
      // An unknown type should be visible, not silently dropped.
      return `${actor} made a change`;
  }
}

/** "a", "a and b", "a, b and c" */
function listNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Whether an activity type refers to an expense that can be linked to. */
export function isExpenseActivity(type) {
  return (
    type === "EXPENSE_ADDED" ||
    type === "EXPENSE_EDITED" ||
    type === "EXPENSE_DELETED"
  );
}

/** Group rows by calendar day for a sectioned feed. */
export function groupByDay(activities = []) {
  const days = new Map();

  for (const activity of activities) {
    const date = new Date(activity.createdAt);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : date.toISOString().slice(0, 10);

    if (!days.has(key)) days.set(key, []);
    days.get(key).push(activity);
  }

  return [...days.entries()].map(([day, items]) => ({ day, items }));
}
