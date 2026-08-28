"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { expenseCategories } from "@/data/categories";
import { activeFilterCount } from "@/lib/split/filters";

/** Radix Select cannot hold an empty value, so "any" stands in for null. */
const ANY = "any";
const fromSelect = (v) => (v === ANY ? null : v);
const toSelect = (v) => v ?? ANY;

export function ExpenseFilters({ options, value, onChange, onClear, busy }) {
  const [expanded, setExpanded] = useState(false);
  const count = activeFilterCount(value);

  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={value.q ?? ""}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search description or notes..."
            className="pl-8"
            aria-label="Search shared expenses"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
          {count > 0 && (
            <Badge variant="secondary" className="ml-2">
              {count}
            </Badge>
          )}
        </Button>

        {count > 0 && (
          <Button type="button" variant="ghost" onClick={onClear} disabled={busy}>
            <X className="mr-2 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {expanded && (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Group</span>
            <Select
              value={toSelect(value.groupId)}
              onValueChange={(v) => set({ groupId: fromSelect(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Any group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any group</SelectItem>
                {options.groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.icon} {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Person</span>
            <Select
              value={toSelect(value.personId)}
              onValueChange={(v) => set({ personId: fromSelect(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Anyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Anyone</SelectItem>
                {options.people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Category</span>
            <Select
              value={toSelect(value.category)}
              onValueChange={(v) => set({ category: fromSelect(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Any category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any category</SelectItem>
                {expenseCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <Input
              type="date"
              value={value.from ?? ""}
              onChange={(e) => set({ from: e.target.value || null })}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <Input
              type="date"
              value={value.to ?? ""}
              onChange={(e) => set({ to: e.target.value || null })}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Min ₹</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={value.minAmount ?? ""}
                onChange={(e) => set({ minAmount: e.target.value || null })}
                placeholder="0"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Max ₹</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={value.maxAmount ?? ""}
                onChange={(e) => set({ maxAmount: e.target.value || null })}
                placeholder="Any"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseFilters;
