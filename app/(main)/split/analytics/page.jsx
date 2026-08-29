import { ChartNoAxesCombined, Info } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { categoryColor, categoryName } from "@/data/categories";
import { getMyAnalytics } from "@/actions/split/analytics";

export default async function SplitAnalyticsPage() {
  const result = await getMyAnalytics();

  if (!result.success) {
    return (
      <Card className="border-red-200">
        <CardContent className="pt-6 text-sm text-red-700">{result.error}</CardContent>
      </Card>
    );
  }

  const a = result.data;
  const hasData = a.expenseCount > 0;

  if (!hasData) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ChartNoAxesCombined className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Nothing to analyse yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a few shared expenses and your spending breakdown will appear
              here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCategory = Math.max(...a.byCategory.map((c) => c.amount), 1);
  const maxPeriod = Math.max(...a.overTime.map((p) => p.amount), 1);

  return (
    <div className="space-y-6">
      {a.availableCurrencies.length > 1 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          These expenses span {a.availableCurrencies.join(", ")}. Showing{" "}
          {a.currency} only — amounts in different currencies are never added
          together.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="You paid"
          value={a.totalPaid}
          currency={a.currency}
          hint="Cash you fronted, in full"
        />
        <Stat
          label="You spent"
          value={a.totalSpent}
          currency={a.currency}
          hint="Your own share — what you consumed"
        />
        <Stat
          label="Recovered"
          value={a.totalRecovered}
          currency={a.currency}
          hint="Paid back to you so far"
          tone="good"
        />
        <Stat
          label="Still owed to you"
          value={a.totalOwedToThem}
          currency={a.currency}
          hint="Outstanding from what you lent"
          tone={a.totalOwedToThem > 0 ? "good" : "flat"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Total shared spending</CardTitle>
          <CardDescription>
            Across {a.expenseCount} {a.expenseCount === 1 ? "expense" : "expenses"}.
            Settlements are transfers and are never counted here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {formatMoney(a.totalSpending, a.currency)}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By category</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {a.byCategory.map((row) => (
                <li key={row.category}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{categoryName(row.category)}</span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(row.amount, a.currency)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (row.amount / maxCategory) * 100)}%`,
                        backgroundColor: categoryColor(row.category),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Over time</CardTitle>
            <CardDescription>Grouped by month.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {a.overTime.map((row) => (
                <li key={row.period}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="tabular-nums">{row.period}</span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(row.amount, a.currency)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-purple-500"
                      style={{
                        width: `${Math.max(2, (row.amount / maxPeriod) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex items-start gap-2 py-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          These figures cover shared expenses only. Your personal spending on
          the dashboard counts just your own share, so the two never
          double-count the same rupee.
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, currency, hint, tone = "flat" }) {
  const colour =
    tone === "good" && value > 0 ? "text-green-600" : "text-foreground";

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${value === 0 ? "text-muted-foreground" : colour}`}>
          {formatMoney(value, currency)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
