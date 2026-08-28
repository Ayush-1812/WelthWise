"use client";

import { useMemo } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { computeSplit } from "@/lib/split/engine";

import { ItemizedEditor } from "./itemized-editor";

import { FriendAvatar } from "../../friends/_components/friend-avatar";

/**
 * Participant picker + per-method inputs + live remainder.
 *
 * The preview calls the SAME computeSplit() the server uses, so what the user
 * sees is exactly what gets written. That is only possible because the engine
 * is pure and Decimal-backed with no Prisma import - see lib/money.js.
 */

const METHOD_HELP = {
  EQUAL: "Split evenly. The payer absorbs any leftover paisa.",
  EXACT: "Enter each person's exact amount. They must add up to the total.",
  PERCENTAGE: "Enter each person's percentage. They must add up to 100%.",
  SHARES: "Weight the split. 2 shares pays twice as much as 1.",
  CUSTOM: "Add or subtract a fixed amount per person; the rest splits evenly.",
  ITEMIZED: "List each item and tap who shared it.",
};

const NEEDS_INPUT = new Set(["EXACT", "PERCENTAGE", "SHARES", "CUSTOM"]);

const INPUT_SUFFIX = {
  EXACT: "₹",
  PERCENTAGE: "%",
  SHARES: "shares",
  CUSTOM: "± ₹",
};

export function SplitEditor({
  candidates,
  participantIds,
  onToggleParticipant,
  method,
  values,
  onValueChange,
  amount,
  payerId,
  items,
  onItemsChange,
}) {
  // Recompute on every keystroke. Errors are expected mid-edit, so a failure
  // becomes the message shown rather than an exception.
  const { splits, error } = useMemo(() => {
    if (!amount || participantIds.length === 0) {
      return { splits: null, error: null };
    }
    try {
      return {
        splits: computeSplit({
          method,
          total: amount,
          participantIds,
          // Itemized carries a list of line items rather than a per-person map.
          values: method === "ITEMIZED" ? { items } : values,
          payerId,
        }),
        error: null,
      };
    } catch (e) {
      return { splits: null, error: e.message };
    }
  }, [amount, participantIds, method, values, payerId, items]);

  const shareFor = (userId) =>
    splits?.find((s) => s.userId === userId)?.shareAmount ?? null;

  // Itemized has its own editor: rows of items rather than a value per person.
  if (method === "ITEMIZED") {
    return (
      <div className="space-y-3">
        <ItemizedEditor
          candidates={candidates}
          participantIds={participantIds}
          amount={amount}
          items={items}
          onChange={onItemsChange}
        />
        <SplitStatus
          error={error}
          splits={splits}
          amount={amount}
          participantCount={participantIds.length}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{METHOD_HELP[method]}</p>

      <ul className="divide-y rounded-lg border">
        {candidates.map((user) => {
          const selected = participantIds.includes(user.id);
          const share = selected ? shareFor(user.id) : null;

          return (
            <li key={user.id} className="p-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`participant-${user.id}`}
                  checked={selected}
                  onChange={() => onToggleParticipant(user.id)}
                  className="h-4 w-4 shrink-0 accent-purple-600"
                />
                <label
                  htmlFor={`participant-${user.id}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                >
                  <FriendAvatar user={user} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {user.name || user.email}
                      {user.id === payerId && (
                        <span className="ml-2 text-xs font-normal text-purple-600">
                          paid
                        </span>
                      )}
                    </span>
                  </span>
                </label>

                {selected && NEEDS_INPUT.has(method) && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={values[user.id] ?? ""}
                      onChange={(e) => onValueChange(user.id, e.target.value)}
                      placeholder="0"
                      aria-label={`${method.toLowerCase()} for ${
                        user.name || user.email
                      }`}
                      className="h-8 w-24 text-right"
                    />
                    <span className="w-12 text-xs text-muted-foreground">
                      {INPUT_SUFFIX[method]}
                    </span>
                  </div>
                )}

                {selected && (
                  <span
                    className={cn(
                      "w-24 shrink-0 text-right text-sm font-medium tabular-nums",
                      share ? "" : "text-muted-foreground"
                    )}
                  >
                    {share ? formatMoney(share) : "—"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <SplitStatus
        error={error}
        splits={splits}
        amount={amount}
        participantCount={participantIds.length}
      />
    </div>
  );
}

/** The remainder indicator. Save stays blocked until this reads balanced. */
function SplitStatus({ error, splits, amount, participantCount }) {
  if (participantCount === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Select who was part of this expense.
      </p>
    );
  }

  if (!amount) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Enter an amount to see the split.
      </p>
    );
  }

  if (error) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        {error}
      </p>
    );
  }

  if (!splits) return null;

  return (
    <p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      Splits add up to {formatMoney(amount)} across {participantCount}{" "}
      {participantCount === 1 ? "person" : "people"}.
    </p>
  );
}

export default SplitEditor;
