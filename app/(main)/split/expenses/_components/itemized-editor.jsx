"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { checkItemsTotal, emptyItem } from "@/lib/split/itemized";
import { RECEIPT_ACCEPT_ATTR } from "@/lib/split/receipts";
import { scanReceiptItems } from "@/actions/split/receipts";

/**
 * Line-item editor for an ITEMIZED split.
 *
 * Each row is a thing someone bought; tapping a name toggles whether they
 * shared it. The running total against the expense amount is shown live,
 * because the two must reconcile exactly before the expense can be saved.
 */
export function ItemizedEditor({
  candidates,
  participantIds,
  amount,
  currency,
  items,
  onChange,
}) {
  const rows = items ?? [];
  const participants = candidates.filter((c) => participantIds.includes(c.id));

  const fileInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);

  /**
   * Scan a receipt into draft rows.
   *
   * Scanned items are APPENDED to whatever the user has already typed, and only
   * the untouched starter row is dropped. Replacing the list outright would
   * throw away manual rows the scanner was never going to find - the tip line
   * someone added, or a dish the OCR misread and the user already fixed.
   *
   * Nothing is auto-assigned: draftItemsFromScan() returns every item with an
   * empty assignedTo, so the user still decides who shared what.
   */
  const handleScan = async (file) => {
    setScanning(true);
    try {
      const result = await scanReceiptItems(file);

      if (!result?.success) {
        toast.error(result?.error ?? "Could not read that receipt");
        return;
      }

      const { items: scanned, scannedTotal } = result.data;
      const typed = rows.filter(
        (r) => String(r.name ?? "").trim() || String(r.amount ?? "").trim()
      );

      onChange([...typed, ...scanned]);

      toast.success(
        `Added ${scanned.length} item${scanned.length === 1 ? "" : "s"}` +
          (scannedTotal
            ? ` - the receipt totals ${formatMoney(scannedTotal, currency)}.`
            : ". Tap who shared each one.")
      );
    } catch (error) {
      toast.error(error?.message ?? "Could not read that receipt");
    } finally {
      setScanning(false);
      // Clear the input so picking the same file twice still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={RECEIPT_ACCEPT_ATTR}
        capture="environment"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) handleScan(picked);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={scanning}
        onClick={() => fileInputRef.current?.click()}
      >
        {scanning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Reading receipt...
          </>
        ) : (
          <>
            <Camera className="mr-2 h-4 w-4" />
            Scan receipt for items
          </>
        )}
      </Button>

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
            ? `Items add up to ${formatMoney(status.actual, currency)}.`
            : `Items add up to ${formatMoney(status.actual, currency)} — ${formatMoney(
                status.difference.abs(),
                currency
              )} ${status.difference.isPositive() ? "over" : "left to account for"}.`}
        </p>
      )}
    </div>
  );
}

export default ItemizedEditor;
