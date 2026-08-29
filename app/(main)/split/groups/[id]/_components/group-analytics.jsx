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

import { FriendAvatar } from "../../../friends/_components/friend-avatar";

/**
 * Group spending breakdown (M23).
 *
 * Reads only the shared ledger - never personal Transaction rows - and never
 * counts a settlement as spending.
 */
export function GroupAnalytics({ data, myUserId }) {
  if (!data || data.expenseCount === 0) return null;

  const maxCategory = Math.max(...data.byCategory.map((c) => c.amount), 1);
  const maxMember = Math.max(...data.byMember.map((m) => m.amount), 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ChartNoAxesCombined className="h-4 w-4 text-purple-600" />
          <CardTitle className="text-base">Group spending</CardTitle>
        </div>
        <CardDescription>
          {formatMoney(data.totalSpending, data.currency)} across{" "}
          {data.expenseCount}{" "}
          {data.expenseCount === 1 ? "expense" : "expenses"}. Settlements move
          money that was already spent, so they are not counted.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {data.availableCurrencies.length > 1 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            This group spans {data.availableCurrencies.join(", ")}. Showing{" "}
            {data.currency} only.
          </p>
        )}

        <div>
          <p className="mb-3 text-sm font-medium">By member</p>
          <ul className="space-y-3">
            {data.byMember.map((row) => (
              <li key={row.userId}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FriendAvatar user={row.user} size={22} />
                    <span className="truncate">
                      {row.userId === myUserId
                        ? "You"
                        : row.user?.name || row.user?.email || "Someone"}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatMoney(row.amount, data.currency)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-purple-500"
                    style={{ width: `${Math.max(2, (row.amount / maxMember) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Each person&apos;s own share, not the amount they fronted.
          </p>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium">By category</p>
          <ul className="space-y-3">
            {data.byCategory.map((row) => (
              <li key={row.category}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{categoryName(row.category)}</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.amount, data.currency)}
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
        </div>
      </CardContent>
    </Card>
  );
}

export default GroupAnalytics;
