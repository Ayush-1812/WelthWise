"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import useFetch from "@/hooks/use-fetch";
import { createSettlement } from "@/actions/split/settlements";
import {
  SETTLEMENT_METHODS,
  validateSettlement,
} from "@/lib/split/settlements";

import { FriendAvatar } from "../../friends/_components/friend-avatar";

export function SettleUpDrawer({ targets = [], myUserId, initialUserId, children }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [otherUserId, setOtherUserId] = useState(
    initialUserId ?? targets[0]?.user?.id ?? ""
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [note, setNote] = useState("");

  const { loading, fn: runSettle } = useFetch(createSettlement);

  const target = targets.find((t) => t.user?.id === otherUserId) ?? null;

  // Same validation the server runs, so the button state matches the outcome.
  const check = useMemo(() => {
    if (!target) return { ok: false, error: "Choose someone to settle with" };
    if (!amount) return { ok: false, error: null };

    return validateSettlement({
      amount,
      outstanding: target.outstanding,
      fromUserId: target.iPay ? myUserId : target.user.id,
      toUserId: target.iPay ? target.user.id : myUserId,
      method,
    });
  }, [target, amount, method, myUserId]);

  const selectTarget = (id) => {
    setOtherUserId(id);
    setAmount("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!check.ok) return;

    const result = await runSettle({
      otherUserId,
      amount,
      method,
      note,
    });

    if (result?.success) {
      const { isFull, remaining } = result.data;
      toast.success(
        isFull
          ? "Settled up in full"
          : `Payment recorded — ${formatMoney(remaining)} still outstanding`
      );
      setAmount("");
      setNote("");
      setOpen(false);
      router.refresh();
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Settle up</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-4">
          {targets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You are settled up with everyone. Nothing to record.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <span className="text-sm font-medium">Who</span>
                <Select value={otherUserId} onValueChange={selectTarget}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a person" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.user.id} value={t.user.id}>
                        {t.user.name || t.user.email} —{" "}
                        {t.iPay ? "you owe " : "owes you "}
                        {formatMoney(t.outstanding)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {target && (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <FriendAvatar user={target.user} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {target.iPay
                          ? `You pay ${target.user.name || target.user.email}`
                          : `${target.user.name || target.user.email} pays you`}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatMoney(target.outstanding)} outstanding
                      </span>
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAmount(String(target.outstanding))}
                  >
                    Pay in full
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="settle-amount" className="text-sm font-medium">
                  Amount
                </label>
                <Input
                  id="settle-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={target?.outstanding}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
                {check.error && (
                  <p className="text-sm text-red-600">{check.error}</p>
                )}
                {check.ok && (
                  <p className="text-sm text-muted-foreground">
                    {check.isFull
                      ? "This clears the balance completely."
                      : `${formatMoney(check.remaining)} will still be outstanding.`}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">How</span>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTLEMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label htmlFor="settle-note" className="text-sm font-medium">
                  Note <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="settle-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. UPI ref 4821"
                  maxLength={200}
                />
              </div>

              <div className="flex gap-4 pt-2">
                <DrawerClose asChild>
                  <Button type="button" variant="outline" className="flex-1">
                    Cancel
                  </Button>
                </DrawerClose>
                <Button type="submit" className="flex-1" disabled={loading || !check.ok}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Recording...
                    </>
                  ) : (
                    <>
                      <HandCoins className="mr-2 h-4 w-4" />
                      Record payment
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default SettleUpDrawer;
