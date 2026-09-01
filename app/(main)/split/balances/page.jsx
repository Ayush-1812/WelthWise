import Link from "next/link";
import { ChevronRight, Scale } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { DEFAULT_CURRENCY } from "@/lib/split/currency";
import { getMyBalanceSummary } from "@/actions/split/balances";

import { FriendAvatar } from "../friends/_components/friend-avatar";

export default async function SplitBalancesPage() {
  const result = await getMyBalanceSummary();
  const { totals, people, byGroup, currency } = result.success
    ? result.data
    : {
        totals: { youOwe: 0, owedToYou: 0, net: 0 },
        people: [],
        byGroup: [],
        currency: DEFAULT_CURRENCY,
      };

  const owedToYou = people.filter((p) => p.netBalance > 0);
  const youOwe = people.filter((p) => p.netBalance < 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">You owe</p>
            <p className="text-2xl font-bold text-red-600">
              {formatMoney(totals.youOwe, currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Owed to you</p>
            <p className="text-2xl font-bold text-green-600">
              {formatMoney(totals.owedToYou, currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net</p>
            <p
              className={`text-2xl font-bold ${
                totals.net > 0
                  ? "text-green-600"
                  : totals.net < 0
                    ? "text-red-600"
                    : "text-muted-foreground"
              }`}
            >
              {formatMoney(Math.abs(totals.net), currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      {people.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Scale className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Everyone is settled up</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Balances appear here as soon as there is a shared expense that
                someone still owes on.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <BalanceList
            title="Owed to you"
            description="Tap a person to see the expenses behind the number."
            entries={owedToYou}
            emptyText="Nobody owes you right now."
          />
          <BalanceList
            title="You owe"
            description="Tap a person to see what makes up the total."
            entries={youOwe}
            emptyText="You do not owe anyone right now."
          />
        </div>
      )}

      {byGroup.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By group</CardTitle>
            <CardDescription>
              Your net position in each group. Every group also sums to zero
              across all of its members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {byGroup.map(({ group, netBalance }) => (
                <li key={group.id}>
                  <Link
                    href={`/split/groups/${group.id}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className="text-lg">
                        {group.icon || "🧾"}
                      </span>
                      <span className="truncate text-sm font-medium">
                        {group.name}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold ${
                        netBalance > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {netBalance > 0 ? "+" : "-"}
                      {formatMoney(Math.abs(netBalance), currency)}
                    </span>
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

function BalanceList({ title, description, entries, emptyText }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} {entries.length > 0 && `(${entries.length})`}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map(({ user, netBalance }) => (
              <li key={user.id}>
                <Link
                  href={`/split/balances/${user.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <FriendAvatar user={user} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {user.name || user.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {netBalance > 0 ? "owes you" : "you owe"}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className={`text-sm font-semibold ${
                        netBalance > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatMoney(Math.abs(netBalance), currency)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
