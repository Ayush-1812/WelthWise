import { format } from "date-fns";
import { HandCoins } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_METHODS } from "@/lib/split/settlements";
import {
  getSettlements,
  getSettleUpTargets,
} from "@/actions/split/settlements";

import { FriendAvatar } from "../friends/_components/friend-avatar";
import { SettleUpDrawer } from "./_components/settle-up-drawer";

const METHOD_LABEL = Object.fromEntries(
  SETTLEMENT_METHODS.map((m) => [m.value, m.label])
);

export default async function SplitSettlementsPage() {
  const [historyResult, targetsResult] = await Promise.all([
    getSettlements(),
    getSettleUpTargets(),
  ]);

  const settlements = historyResult.success ? historyResult.data : [];
  const { targets, myUserId } = targetsResult.success
    ? targetsResult.data
    : { targets: [], myUserId: null };

  const outstandingCount = targets.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {outstandingCount === 0
            ? "You are settled up with everyone."
            : `${outstandingCount} ${
                outstandingCount === 1 ? "person" : "people"
              } with an outstanding balance`}
        </p>
        <SettleUpDrawer targets={targets} myUserId={myUserId}>
          <Button disabled={outstandingCount === 0}>
            <HandCoins className="mr-2 h-4 w-4" />
            Settle up
          </Button>
        </SettleUpDrawer>
      </div>

      {targets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outstanding</CardTitle>
            <CardDescription>
              Amounts are derived from the ledger, so they always reflect every
              expense and payment so far.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {targets.map((t) => (
                <li
                  key={t.user.id}
                  className="flex items-center justify-between gap-4 px-6 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <FriendAvatar user={t.user} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {t.user.name || t.user.email}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.iPay ? "you owe them" : "they owe you"}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span
                      className={`text-sm font-semibold ${
                        t.iPay ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {formatMoney(t.outstanding)}
                    </span>
                    <SettleUpDrawer
                      targets={targets}
                      myUserId={myUserId}
                      initialUserId={t.user.id}
                    >
                      <Button size="sm" variant="outline">
                        Settle
                      </Button>
                    </SettleUpDrawer>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Payment history {settlements.length > 0 && `(${settlements.length})`}
          </CardTitle>
          <CardDescription>
            Settlements move money that already exists — they are never counted
            as income or expense.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {settlements.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <HandCoins className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">No payments recorded yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  When someone pays you back — or you pay them — record it here
                  and the balances update.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y">
              {settlements.map((s) => {
                const counterparty = s.sentByMe ? s.toUser : s.fromUser;
                const name = counterparty?.name || counterparty?.email;

                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-4 px-6 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <FriendAvatar user={counterparty} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {s.sentByMe ? `You paid ${name}` : `${name} paid you`}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {format(new Date(s.settledAt), "PP")}
                          {" · "}
                          {METHOD_LABEL[s.method] ?? s.method}
                          {s.group && (
                            <>
                              {" · "}
                              {s.group.icon} {s.group.name}
                            </>
                          )}
                          {s.note && <> · {s.note}</>}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="hidden sm:inline-flex">
                        {s.sentByMe ? "sent" : "received"}
                      </Badge>
                      <span
                        className={`text-sm font-semibold ${
                          s.sentByMe ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatMoney(s.amount)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
