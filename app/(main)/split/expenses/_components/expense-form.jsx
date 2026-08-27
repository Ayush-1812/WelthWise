"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { expenseCategories } from "@/data/categories";
import useFetch from "@/hooks/use-fetch";
import {
  createSharedExpense,
  updateSharedExpense,
} from "@/actions/split/expenses";
import { computeSplit, validateSplit } from "@/lib/split/engine";

import { SplitEditor } from "./split-editor";

const SPLIT_METHODS = [
  { value: "EQUAL", label: "Equally" },
  { value: "EXACT", label: "Exact amounts" },
  { value: "PERCENTAGE", label: "Percentages" },
  { value: "SHARES", label: "Shares" },
  { value: "CUSTOM", label: "Adjustments" },
];

export function ExpenseForm({ context, initial = null }) {
  const router = useRouter();
  const { me, groups, friends, accounts = [] } = context;
  const isEdit = Boolean(initial);

  // "g:<id>" for a group, "f:<id>" for a direct friend expense.
  const initialKey = initial
    ? initial.groupId
      ? `g:${initial.groupId}`
      : `f:${initial.participantIds.find((id) => id !== me.id) ?? ""}`
    : groups[0]
      ? `g:${groups[0].id}`
      : friends[0]
        ? `f:${friends[0].id}`
        : "";

  /** Everyone in a context, used to preselect participants. */
  const participantsForKey = (key) => {
    const [k, id] = (key || "").split(":");
    if (k === "g") {
      return (groups.find((g) => g.id === id)?.members ?? []).map((u) => u.id);
    }
    if (k === "f") return [me.id, id];
    return [];
  };

  const [contextKey, setContextKey] = useState(initialKey);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : ""
  );
  const [date, setDate] = useState(
    initial?.date ? new Date(initial.date) : new Date()
  );
  const [category, setCategory] = useState(initial?.category ?? "food");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [method, setMethod] = useState(initial?.splitMethod ?? "EQUAL");
  const [values, setValues] = useState(initial?.splitValues ?? {});
  const [paidById, setPaidById] = useState(initial?.paidById ?? me.id);
  // Optional: record the cash outflow against a personal account (M12).
  const [accountId, setAccountId] = useState(
    initial?.accountId ?? accounts.find((a) => a.isDefault)?.id ?? ""
  );
  const [participantIds, setParticipantIds] = useState(() =>
    initial ? initial.participantIds : participantsForKey(initialKey)
  );

  const { loading, fn: runSave } = useFetch(
    isEdit ? updateSharedExpense : createSharedExpense
  );

  const [kind, contextId] = contextKey ? contextKey.split(":") : ["", ""];
  const group = kind === "g" ? groups.find((g) => g.id === contextId) : null;
  const friend = kind === "f" ? friends.find((f) => f.id === contextId) : null;

  // Who can be part of this expense.
  const candidates = useMemo(() => {
    if (group) return group.members;
    if (friend) return [me, friend];
    return [me];
  }, [group, friend, me]);

  // Reset participants whenever the context changes; default to everyone.
  const applyContext = (nextKey) => {
    setContextKey(nextKey);
    setParticipantIds(participantsForKey(nextKey));
    setValues({});
    setPaidById(me.id);
  };

  const toggleParticipant = (id) => {
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  };

  // Same validation the server will run, so Save is only enabled when the
  // write would actually succeed.
  const readiness = useMemo(() => {
    if (!description.trim()) return { ok: false, reason: "Add a description" };
    if (!amount) return { ok: false, reason: "Enter an amount" };
    if (participantIds.length === 0)
      return { ok: false, reason: "Select participants" };
    if (!participantIds.includes(paidById))
      return { ok: false, reason: "The payer must be a participant" };

    try {
      const splits = computeSplit({
        method,
        total: amount,
        participantIds,
        values,
        payerId: paidById,
      });
      const check = validateSplit(amount, splits);
      return check.ok ? { ok: true } : { ok: false, reason: check.errors[0] };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }, [description, amount, participantIds, paidById, method, values]);

  const submit = async (confirm) => {
    const payload = {
      description,
      amount,
      date,
      category,
      notes,
      groupId: group ? group.id : null,
      paidById,
      participantIds,
      splitMethod: method,
      splitValues: values,
      accountId:
        paidById === me.id && accountId && accountId !== "none" ? accountId : null,
      confirm,
    };

    return isEdit ? runSave(initial.id, payload) : runSave(payload);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!readiness.ok) return;

    let result = await submit(false);

    // The server warns before disturbing someone who had already settled.
    if (result?.needsConfirmation) {
      if (!window.confirm(`${result.warning}\n\nSave anyway?`)) return;
      result = await submit(true);
    }

    if (result?.success) {
      toast.success(isEdit ? "Expense updated" : "Expense added");
      router.refresh();
      router.push(
        isEdit
          ? `/split/expenses/${initial.id}`
          : group
            ? `/split/groups/${group.id}`
            : "/split/expenses"
      );
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  if (groups.length === 0 && friends.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <p className="font-medium">Nobody to split with yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add a friend or create a group first, then come back to add a shared
            expense.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner at Bombay Canteen"
              maxLength={140}
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="amount" className="text-sm font-medium">
                Amount
              </label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Split with</span>
              <Select value={contextKey} onValueChange={applyContext} disabled={isEdit}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a group or friend" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={`g:${g.id}`}>
                      {g.icon} {g.name}
                    </SelectItem>
                  ))}
                  {friends.map((f) => (
                    <SelectItem key={f.id} value={`f:${f.id}`}>
                      {f.name || f.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <span className="text-sm font-medium">Paid by</span>
              <Select value={paidById} onValueChange={setPaidById}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.id === me.id ? "You" : u.name || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Category</span>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Date</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full pl-3 text-left font-normal"
                  >
                    {format(date, "PP")}
                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={(d) => d > new Date() || d < new Date("1900-01-01")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {paidById === me.id && accounts.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium">
                Record cash outflow in{" "}
                <span className="text-muted-foreground">(optional)</span>
              </span>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Do not track personally" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Do not track personally</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                      {acc.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The full amount leaves this account, but only your own share
                counts as personal spending. What others owe you is tracked
                separately and never inflates your analytics.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
              maxLength={500}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Split</CardTitle>
            <Select
              value={method}
              onValueChange={(m) => {
                setMethod(m);
                setValues({});
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPLIT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <SplitEditor
            candidates={candidates}
            participantIds={participantIds}
            onToggleParticipant={toggleParticipant}
            method={method}
            values={values}
            onValueChange={(userId, value) =>
              setValues((current) => ({ ...current, [userId]: value }))
            }
            amount={amount}
            payerId={paidById}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p
          className={cn(
            "text-sm",
            readiness.ok ? "text-muted-foreground" : "text-red-600"
          )}
        >
          {readiness.ok ? "Ready to save" : readiness.reason}
        </p>
        <Button type="submit" disabled={loading || !readiness.ok}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {isEdit ? "Save changes" : "Save expense"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export default ExpenseForm;
