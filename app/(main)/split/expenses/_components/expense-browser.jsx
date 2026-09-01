"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Loader2, Plus, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { categoryColor, categoryName } from "@/data/categories";
import { getSharedExpenses } from "@/actions/split/expenses";
import { hasActiveFilters } from "@/lib/split/filters";

import { ExpenseFilters } from "./expense-filters";

const EMPTY = {
  q: "",
  groupId: null,
  personId: null,
  category: null,
  from: null,
  to: null,
  minAmount: null,
  maxAmount: null,
};

/**
 * Filtered, paginated shared-expense list.
 *
 * Filtering happens on the server: every change refetches rather than slicing a
 * list held in the browser, so this holds up across many groups (task.md M18).
 */
export function ExpenseBrowser({ initial, options }) {
  const [filters, setFilters] = useState(EMPTY);
  const [items, setItems] = useState(initial?.data ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Debounced so typing in the search box does not fire a query per keystroke.
  const timer = useRef(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);

      const result = await getSharedExpenses({ ...filters, limit: 25 });

      if (result?.success) {
        setItems(result.data);
        setCursor(result.nextCursor);
      } else {
        setError(result?.error ?? "Could not load expenses");
        setItems([]);
        setCursor(null);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer.current);
  }, [filters]);

  const loadMore = async () => {
    setLoading(true);
    const result = await getSharedExpenses({ ...filters, limit: 25, cursor });
    if (result?.success) {
      setItems((current) => [...current, ...result.data]);
      setCursor(result.nextCursor);
    }
    setLoading(false);
  };

  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {loading && items.length === 0
            ? "Searching..."
            : `${items.length}${cursor ? "+" : ""} shared ${
                items.length === 1 ? "expense" : "expenses"
              }`}
        </p>
        <Link href="/split/expenses/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add expense
          </Button>
        </Link>
      </div>

      <ExpenseFilters
        options={options}
        value={filters}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY)}
        busy={loading}
      />

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {items.length === 0 && !loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">
                {filtered ? "No expenses match those filters" : "No shared expenses yet"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {filtered
                  ? "Try widening the date or amount range."
                  : "Add one and it will appear here with everyone's share."}
              </p>
            </div>
            {filtered ? (
              <Button variant="outline" onClick={() => setFilters(EMPTY)}>
                Clear filters
              </Button>
            ) : (
              <Link href="/split/expenses/new">
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first expense
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {items.map((expense) => (
                <li key={expense.id}>
                  <Link
                    href={`/split/expenses/${expense.id}`}
                    className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-xs">
                        <span className="font-semibold leading-none">
                          {format(new Date(expense.date), "dd")}
                        </span>
                        <span className="text-muted-foreground">
                          {format(new Date(expense.date), "MMM")}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{expense.description}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                          <span>
                            {expense.paidByMe
                              ? "You paid"
                              : `${expense.paidBy?.name || expense.paidBy?.email} paid`}{" "}
                            {formatMoney(expense.amount, expense.currency)}
                          </span>
                          {expense.group && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {expense.group.icon} {expense.group.name}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <Badge
                        variant="secondary"
                        className="hidden sm:inline-flex"
                        style={{
                          backgroundColor: `${categoryColor(expense.category)}20`,
                        }}
                      >
                        {categoryName(expense.category)}
                      </Badge>
                      <div className="text-right">
                        <p
                          className={
                            expense.myImpact > 0
                              ? "font-semibold text-green-600"
                              : expense.myImpact < 0
                                ? "font-semibold text-red-600"
                                : "font-semibold text-muted-foreground"
                          }
                        >
                          {expense.myImpact > 0
                            ? `+${formatMoney(expense.myImpact, expense.currency)}`
                            : expense.myImpact < 0
                              ? `-${formatMoney(Math.abs(expense.myImpact), expense.currency)}`
                              : formatMoney(0, expense.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          your share {formatMoney(expense.myShare, expense.currency)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {cursor && (
              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Show more"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ExpenseBrowser;
