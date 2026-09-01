import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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

import { SPLIT_SECTIONS } from "../_components/split-nav";
import { FriendAvatar } from "../friends/_components/friend-avatar";

export default async function SplitOverviewPage() {
  const result = await getMyBalanceSummary();
  const { totals, people, byGroup, currency } = result.success
    ? result.data
    : {
        totals: { youOwe: 0, owedToYou: 0, net: 0 },
        people: [],
        byGroup: [],
        currency: DEFAULT_CURRENCY,
      };

  const summary = [
    {
      label: "You owe",
      value: totals.youOwe,
      hint: "Across all friends and groups",
      className: totals.youOwe > 0 ? "text-red-600" : "text-muted-foreground",
    },
    {
      label: "Owed to you",
      value: totals.owedToYou,
      hint: "What others still need to pay back",
      className:
        totals.owedToYou > 0 ? "text-green-600" : "text-muted-foreground",
    },
    {
      label: "Net balance",
      value: totals.net,
      hint: totals.net === 0 ? "You are all settled up" : "Owed to you minus what you owe",
      className:
        totals.net > 0
          ? "text-green-600"
          : totals.net < 0
            ? "text-red-600"
            : "text-muted-foreground",
    },
  ];

  const shortcuts = SPLIT_SECTIONS.filter(
    (section) => section.href !== "/split/overview"
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-3">
        {summary.map(({ label, value, hint, className }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${className}`}>
                {formatMoney(Math.abs(value), currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Who owes whom</CardTitle>
              <Link
                href="/split/balances"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View all
              </Link>
            </div>
            <CardDescription>
              Netted across every group and direct expense.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {people.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing outstanding. Add a shared expense to get started.
              </p>
            ) : (
              <ul className="divide-y">
                {people.slice(0, 6).map(({ user, netBalance }) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FriendAvatar user={user} size={30} />
                      <span className="truncate text-sm">
                        {user.name || user.email}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-medium ${
                        netBalance > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {netBalance > 0 ? "owes you " : "you owe "}
                      {formatMoney(Math.abs(netBalance), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Active groups</CardTitle>
              <Link
                href="/split/groups"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View all
              </Link>
            </div>
            <CardDescription>Groups where you have a balance.</CardDescription>
          </CardHeader>
          <CardContent>
            {byGroup.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No group balances yet.
                </p>
                <Link href="/split/expenses/new">
                  <Button size="sm" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Add an expense
                  </Button>
                </Link>
              </div>
            ) : (
              <ul className="divide-y">
                {byGroup.slice(0, 6).map(({ group, netBalance }) => (
                  <li key={group.id}>
                    <Link
                      href={`/split/groups/${group.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="text-lg">
                          {group.icon || "🧾"}
                        </span>
                        <span className="truncate text-sm">{group.name}</span>
                      </span>
                      <span
                        className={`shrink-0 text-sm font-medium ${
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
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Jump to a section</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map(({ href, label, icon: Icon, description }) => (
            <Link key={href} href={href} className="group">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-purple-600" />
                      <CardTitle className="text-base">{label}</CardTitle>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
