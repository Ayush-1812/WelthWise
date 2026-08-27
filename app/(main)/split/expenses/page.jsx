import Link from "next/link";
import { format } from "date-fns";
import { Plus, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { categoryColor, categoryName } from "@/data/categories";
import { getSharedExpenses } from "@/actions/split/expenses";

export default async function SplitExpensesPage() {
  const result = await getSharedExpenses();
  const expenses = result.success ? result.data : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {expenses.length} shared{" "}
          {expenses.length === 1 ? "expense" : "expenses"}
        </p>
        <Link href="/split/expenses/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add expense
          </Button>
        </Link>
      </div>

      {expenses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No shared expenses yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add one and it will appear here with everyone&apos;s share.
              </p>
            </div>
            <Link href="/split/expenses/new">
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add your first expense
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {expenses.map((expense) => (
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
                      <p className="truncate font-medium">
                        {expense.description}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        <span>
                          {expense.paidByMe
                            ? "You paid"
                            : `${
                                expense.paidBy?.name || expense.paidBy?.email
                              } paid`}{" "}
                          {formatMoney(expense.amount)}
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
                        backgroundColor: `${
                          categoryColor(expense.category)
                        }20`,
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
                          ? `+${formatMoney(expense.myImpact)}`
                          : expense.myImpact < 0
                            ? `-${formatMoney(Math.abs(expense.myImpact))}`
                            : formatMoney(0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        your share {formatMoney(expense.myShare)}
                      </p>
                    </div>
                  </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
