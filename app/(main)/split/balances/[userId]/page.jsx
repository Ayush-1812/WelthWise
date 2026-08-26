import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, HandCoins, Receipt } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { getBalanceDetail } from "@/actions/split/balances";

import { FriendAvatar } from "../../friends/_components/friend-avatar";

export default async function BalanceDetailPage({ params }) {
  const { userId } = await params;

  const result = await getBalanceDetail(userId);
  if (!result.success) notFound();

  const { other, netBalance, rows } = result.data;
  const name = other.name || other.email;

  // Proof for the reader: the rows below add up to the headline number.
  const traced = rows.reduce((acc, row) => acc + row.contribution, 0);
  const reconciles = Math.abs(traced - netBalance) < 0.005;

  return (
    <div className="space-y-6">
      <Link
        href="/split/balances"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All balances
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <FriendAvatar user={other} size={48} />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {other.email}
              </p>
            </div>
          </div>
          <div className="text-right">
            {netBalance === 0 ? (
              <p className="text-2xl font-bold text-muted-foreground">
                Settled up
              </p>
            ) : (
              <>
                <p
                  className={`text-2xl font-bold ${
                    netBalance > 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatMoney(Math.abs(netBalance))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {netBalance > 0 ? `${name} owes you` : `you owe ${name}`}
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What makes up this balance</CardTitle>
          <CardDescription>
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
            {reconciles
              ? " — these add up to exactly the balance above."
              : " — warning: these do not reconcile with the balance above."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              You have no shared expenses with {name} yet.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => (
                <li
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        row.kind === "SETTLEMENT" ? "bg-blue-50" : "bg-muted"
                      }`}
                    >
                      {row.kind === "SETTLEMENT" ? (
                        <HandCoins className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.kind === "SETTLEMENT"
                          ? row.sentByMe
                            ? `You paid ${name}`
                            : `${name} paid you`
                          : row.description}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.date ? format(new Date(row.date), "PP") : "—"}
                        {row.kind === "EXPENSE" && (
                          <>
                            {" · "}
                            {row.paidByMe ? "you paid" : `${name} paid`}{" "}
                            {formatMoney(row.amount)}
                            {row.share !== null && (
                              <>
                                {" · "}
                                {row.paidByMe ? "their" : "your"} share{" "}
                                {formatMoney(row.share)}
                              </>
                            )}
                          </>
                        )}
                        {row.group && (
                          <>
                            {" · "}
                            {row.group.icon} {row.group.name}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      row.contribution > 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {row.contribution > 0 ? "+" : "-"}
                    {formatMoney(Math.abs(row.contribution))}
                  </span>
                </li>
              ))}

              <li className="flex items-center justify-between gap-4 bg-muted/40 px-6 py-3">
                <span className="text-sm font-medium">Total</span>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    netBalance > 0
                      ? "text-green-600"
                      : netBalance < 0
                        ? "text-red-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {netBalance > 0 ? "+" : netBalance < 0 ? "-" : ""}
                  {formatMoney(Math.abs(netBalance))}
                </span>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
