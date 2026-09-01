import { AlertTriangle, PiggyBank, Receipt, TrendingUp } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { categoryName, categoryColor } from "@/data/categories";
import { getMyAnalytics } from "@/actions/split/analytics";

const MONTH_LABEL = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

function formatPeriod(period) {
  // "2026-04" (month bucket) -> "Apr 2026"
  if (/^\d{4}-\d{2}$/.test(period)) {
    return MONTH_LABEL.format(new Date(`${period}-01`));
  }
  return period;
}

export default async function SplitAnalyticsPage() {
  const result = await getMyAnalytics();

  if (!result.success) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          <p className="font-medium">Could not load analytics</p>
          <p className="text-sm text-muted-foreground">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  const data = result.data;
  const { currency, availableCurrencies } = data;

  if (data.expenseCount === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <TrendingUp className="h-6 w-6 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">Nothing to analyze yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Once you add shared expenses, spending by category, by month, and
              your paid/owed totals will show up here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxCategory = data.byCategory[0]?.amount ?? 0;
  const maxPeriod = Math.max(...data.overTime.map((p) => p.amount), 0);

  return (
    <div className="space-y-6">
      {availableCurrencies.length > 1 && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your shared expenses span {availableCurrencies.join(", ")}. Showing{" "}
          {currency} only — amounts in different currencies are never added
          together.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Receipt}
          label="Total group spending"
          value={formatMoney(data.totalSpending, currency)}
          hint={`${data.expenseCount} ${data.expenseCount === 1 ? "expense" : "expenses"}`}
        />
        <StatCard
          icon={TrendingUp}
          label="You paid"
          value={formatMoney(data.totalPaid, currency)}
          hint="Cash out, in full"
        />
        <StatCard
          icon={PiggyBank}
          label="You recovered"
          value={formatMoney(data.totalRecovered, currency)}
          hint="Settlements received"
        />
        <StatCard
          icon={TrendingUp}
          label="Still owed to you"
          value={formatMoney(data.totalOwedToThem, currency)}
          hint={
            data.totalTheyOwe > 0
              ? `You owe ${formatMoney(data.totalTheyOwe, currency)} elsewhere`
              : "Outstanding receivable"
          }
          tone={data.totalOwedToThem > 0 ? "green" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By category</CardTitle>
            <CardDescription>Where your shared spending goes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.byCategory.map((row) => (
              <div key={row.category} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{categoryName(row.category)}</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.amount, currency)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${maxCategory ? (row.amount / maxCategory) * 100 : 0}%`,
                      backgroundColor: categoryColor(row.category),
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Over time</CardTitle>
            <CardDescription>Spending by month.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.overTime.map((row) => (
              <div key={row.period} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{formatPeriod(row.period)}</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.amount, currency)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-purple-600"
                    style={{
                      width: `${maxPeriod ? (row.amount / maxPeriod) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint, tone }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <p
          className={`text-xl font-bold ${tone === "green" ? "text-green-600" : ""}`}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
