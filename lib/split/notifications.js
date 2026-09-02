/**
 * Notification content - pure functions, no database.
 *
 * Builds the title, body and link for every notification the Split Expenses
 * module raises. Kept pure so the wording is testable, and so the in-app feed
 * and the email template can never phrase the same event differently.
 *
 * Nothing here sends anything; see actions/split/notify.js for delivery.
 */

import { formatMoney } from "../format.js";

export const NOTIFICATION_TYPES = [
  "FRIEND_REQUEST",
  "FRIEND_ACCEPTED",
  "GROUP_ADDED",
  "GROUP_REMOVED",
  "EXPENSE_ADDED",
  "EXPENSE_EDITED",
  "EXPENSE_DELETED",
  "SETTLEMENT_RECEIVED",
  "SETTLEMENT_PARTIAL",
  "RECURRING_CREATED",
  "RECURRING_GENERATED",
  "PAYMENT_REMINDER",
];

/**
 * Types worth an email as well as an in-app notification.
 *
 * Deliberately narrow: money arriving, or being added to something. Every
 * expense edit emailing everyone would train people to ignore the emails.
 */
export const EMAIL_WORTHY = new Set([
  "SETTLEMENT_RECEIVED",
  "SETTLEMENT_PARTIAL",
  "GROUP_ADDED",
  "PAYMENT_REMINDER",
  "RECURRING_GENERATED",
]);

export function shouldEmail(type) {
  return EMAIL_WORTHY.has(type);
}

const name = (user) => user?.name || user?.email || "Someone";

/**
 * Build a notification payload.
 *
 * @param {string} type    one of NOTIFICATION_TYPES
 * @param {object} context event details
 * @returns {{type, title, body, linkUrl, metadata}|null}
 *          null when the event does not warrant notifying this person.
 */
export function buildNotification(type, context = {}) {
  const {
    actor,
    group,
    expense,
    amount,
    remaining,
    counterparty,
    currency,
    dueLabel,
  } = context;

  const money = (value) => formatMoney(value ?? 0, currency);
  const actorName = name(actor);
  const groupName = group?.name;

  switch (type) {
    case "FRIEND_REQUEST":
      return {
        type,
        title: `${actorName} sent you a friend request`,
        body: "Accept to start splitting expenses together.",
        linkUrl: "/split/friends",
      };

    case "FRIEND_ACCEPTED":
      return {
        type,
        title: `${actorName} accepted your friend request`,
        body: "You can now share expenses.",
        linkUrl: "/split/friends",
      };

    case "GROUP_ADDED":
      return {
        type,
        title: `${actorName} added you to ${groupName ?? "a group"}`,
        body: "Open the group to see its expenses and balances.",
        linkUrl: group?.id ? `/split/groups/${group.id}` : "/split/groups",
      };

    case "GROUP_JOINED":
      return {
        type,
        // Distinct from GROUP_ADDED: nobody added them, they followed a link.
        title: `${actorName} joined ${groupName ?? "a group"}`,
        body: "They used an invite link to join.",
        linkUrl: group?.id ? `/split/groups/${group.id}` : "/split/groups",
      };

    case "GROUP_REMOVED":
      return {
        type,
        title: `${actorName} removed you from ${groupName ?? "a group"}`,
        body: "Your past expenses in that group are kept.",
        linkUrl: "/split/groups",
      };

    case "EXPENSE_ADDED":
      return {
        type,
        title: `${actorName} added ${money(expense?.amount)} for ${
          expense?.description ?? "an expense"
        }`,
        body:
          context.myShare != null
            ? `Your share is ${money(context.myShare)}.`
            : groupName
              ? `In ${groupName}.`
              : null,
        linkUrl: expense?.id ? `/split/expenses/${expense.id}` : "/split/expenses",
      };

    case "EXPENSE_EDITED":
      return {
        type,
        title: `${actorName} edited ${expense?.description ?? "an expense"}`,
        body:
          context.myShare != null
            ? `Your share is now ${money(context.myShare)}.`
            : "The amounts may have changed.",
        linkUrl: expense?.id ? `/split/expenses/${expense.id}` : "/split/expenses",
      };

    case "EXPENSE_DELETED":
      return {
        type,
        title: `${actorName} deleted ${expense?.description ?? "an expense"}`,
        body: "Balances have been recalculated.",
        linkUrl: "/split/expenses",
      };

    case "SETTLEMENT_RECEIVED":
      return {
        type,
        title: `${actorName} paid you ${money(amount)}`,
        body: "You are now settled up.",
        linkUrl: "/split/settlements",
      };

    case "SETTLEMENT_PARTIAL":
      return {
        type,
        title: `${actorName} paid you ${money(amount)}`,
        body: `${money(remaining)} is still outstanding.`,
        linkUrl: "/split/settlements",
      };

    case "RECURRING_CREATED":
      return {
        type,
        title: `${actorName} set up a recurring expense`,
        body: expense?.description
          ? `${expense.description}, ${money(expense.amount)} each time.`
          : null,
        linkUrl: group?.id ? `/split/groups/${group.id}` : "/split/expenses",
      };

    case "RECURRING_GENERATED":
      return {
        type,
        // No actor: the schedule did this, not a person.
        title: `${expense?.description ?? "A recurring expense"} of ${money(
          expense?.amount
        )} was added`,
        body: groupName ? `In ${groupName}.` : null,
        linkUrl: expense?.id ? `/split/expenses/${expense.id}` : "/split/expenses",
      };

    case "PAYMENT_REMINDER":
      return {
        type,
        title: `You owe ${name(counterparty)} ${money(amount)}`,
        body: dueLabel ?? "A friendly nudge to settle up.",
        linkUrl: counterparty?.id
          ? `/split/balances/${counterparty.id}`
          : "/split/balances",
      };

    default:
      return null;
  }
}

/**
 * Everyone who should hear about an event, excluding whoever caused it.
 * Nobody needs telling about their own action.
 */
export function recipientsFor({ candidateIds = [], actorId = null } = {}) {
  return [...new Set(candidateIds)].filter((id) => id && id !== actorId);
}

/** Unread count capped for display. */
export function formatUnreadCount(count) {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}
