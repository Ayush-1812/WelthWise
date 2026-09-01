import { ArrowRight, Sparkles, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

import { FriendAvatar } from "../../../friends/_components/friend-avatar";

/**
 * Simplified settlement plan.
 *
 * Presentation only: this is a recommendation, and recording a payment is
 * still a deliberate act on the Settlements page. Nothing here writes.
 */
export function SimplifyDebts({ data }) {
  if (!data) return null;

  const { current, simplified, comparison, verified, myUserId, currency } = data;

  if (current.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settle up</CardTitle>
          <CardDescription>Everyone in this group is square.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // A plan that changed someone's position would be a bug; say so loudly.
  if (!verified) {
    return (
      <Card className="border-red-200">
        <CardContent className="flex items-start gap-2 pt-6 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          The simplified plan did not preserve everyone&apos;s balance, so it is
          not being shown. The group ledger may be inconsistent.
        </CardContent>
      </Card>
    );
  }

  const rows = comparison.worthwhile ? simplified : current;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {comparison.worthwhile && (
                <Sparkles className="h-4 w-4 text-purple-600" />
              )}
              {comparison.worthwhile ? "Simplified settle up" : "Who pays whom"}
            </CardTitle>
            <CardDescription>
              {comparison.worthwhile ? (
                <>
                  {comparison.before} payments become {comparison.after}.
                  Everyone still ends up exactly where they were.
                </>
              ) : (
                <>This is already the smallest number of payments.</>
              )}
            </CardDescription>
          </div>
          {comparison.worthwhile && (
            <Badge variant="secondary">
              {comparison.saved} fewer{" "}
              {comparison.saved === 1 ? "payment" : "payments"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row, index) => {
          const fromMe = row.from?.id === myUserId;
          const toMe = row.to?.id === myUserId;

          return (
            <div
              key={`${row.from?.id}-${row.to?.id}-${index}`}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                fromMe || toMe ? "border-purple-200 bg-purple-50/50" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <FriendAvatar user={row.from} size={28} />
                <span className="truncate text-sm font-medium">
                  {fromMe ? "You" : row.from?.name || row.from?.email}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <FriendAvatar user={row.to} size={28} />
                <span className="truncate text-sm font-medium">
                  {toMe ? "you" : row.to?.name || row.to?.email}
                </span>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatMoney(row.amount, currency)}
              </span>
            </div>
          );
        })}

        {comparison.worthwhile && (
          <p className="pt-1 text-xs text-muted-foreground">
            A recommendation only — nothing has been recorded. Use Settle up to
            log a payment once it actually happens.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default SimplifyDebts;
