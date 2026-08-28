"use client";

import { AlertCircle, CheckCircle2, Plus, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { checkItemsTotal, emptyItem } from "@/lib/split/itemized";

/**
 * Line-item editor for an ITEMIZED split.
 *
 * Each row is a thing someone bought; tapping a name toggles whether they
 * shared it. The running total against the expense amount is shown live,
 * because the two must reconcile exactly before the expense can be saved.
 */
export function ItemizedEditor({ candidates, participantIds, amount, items, onChange }) {
  const rows = items ?? [];
  const participants = candidates.filter((c) => participantIds.includes(c.id));

  const update = (index, patch) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const toggle = (index, userId) => {
    const current = rows[index].assignedTo ?? [];
    update(index, {
      assignedTo: current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    });
  };

  const assignAll = (index) =>
    update(index, { assignedTo: participants.map((p) => p.id) });

  const status = amount ? checkItemsTotal(amount, rows.filter((r) => r.amount)) : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add each item and tap who shared it. Everyone pays an equal part of the
        items they are on.
      </p>

      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="space-y-2 rounded-lg border p-3">
            <div className="flex gap-2">
              <Input
                value={row.name}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="e.g. Biryani"
                aria-label={`Item ${index + 1} name`}
                className="flex-1"
                maxLength={100}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={row.amount}
                onChange={(e) => update(index, { amount: e.target.value })}
                placeholder="0.00"
                aria-label={`Item ${index + 1} amount`}
                className="w-28 text-right"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove item ${index + 1}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                disabled={rows.length === 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {participants.map((person) => {
                const on = (row.assignedTo ?? []).includes(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(index, person.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-purple-600 bg-purple-50 text-purple-700"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {person.name || person.email}
                  </button>
                );
              })}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => assignAll(index)}
              >
                <Users className="mr-1 h-3 w-3" />
                Everyone
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, emptyItem()])}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add item
      </Button>

      {status && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            status.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          )}
        >
          {status.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {status.ok
            ? `Items add up to ${formatMoney(status.actual)}.`
            : `Items add up to ${formatMoney(status.actual)} — ${formatMoney(
                status.difference.abs()
              )} ${status.difference.isPositive() ? "over" : "left to account for"}.`}
        </p>
      )}
    </div>
  );
}

export default ItemizedEditor;
