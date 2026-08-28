import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  HandCoins,
  Plus,
  Receipt,
  RefreshCw,
  Users,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

/**
 * Split Expenses summary on the personal dashboard (M19).
 *
 * A server component with no data fetching of its own - the page passes in the
 * already-loaded summary, so this adds nothing to the dashboard's query count.
 */
export function SplitSummary({ data }) {
  if (!data) return null;

  const { totals, recentExpenses, recentSettlements, activeGroups, upcomingRecurring, hasActivity } =
    data;

  if (!hasActivity) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Split expenses with friends</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Share a bill, track who owes what, and settle up — kept separate
              from your personal spending.
            </p>
          </div>
          <Link href="/split">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Get started
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Split Expenses</CardTitle>
            <CardDescription>
              Shared balances, kept out of your personal spending totals.
            </CardDescription>
          </div>
          <Link href="/split">
            <Button variant="ghost" size="sm">
              View all
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="You owe" value={totals.youOwe} tone="owe" />
          <Tile label="Owed to you" value={totals.owedToYou} tone="owed" />
          <Tile
            label="Net"
            value={Math.abs(totals.net)}
            tone={totals.net > 0 ? "owed" : totals.net < 0 ? "owe" : "flat"}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Section
            title="Recent shared expenses"
            icon={Receipt}
            href="/split/expenses"
            empty="Nothing shared yet."
            items={recentExpenses}
            render={(e) => (
              <Row
                key={e.id}
                href={`/split/expenses/${e.id}`}
                title={e.description}
                subtitle={`${e.paidByMe ? "You" : e.paidBy?.name || e.paidBy?.email} paid ${formatMoney(e.amount)}${
                  e.group ? ` · ${e.group.icon} ${e.group.name}` : ""
                }`}
                value={
                  e.myImpact === 0
                    ? null
                    : `${e.myImpact > 0 ? "+" : "-"}${formatMoney(Math.abs(e.myImpact))}`
                }
                tone={e.myImpact > 0 ? "owed" : "owe"}
              />
            )}
          />

          <Section
            title="Recent settlements"
            icon={HandCoins}
            href="/split/settlements"
            empty="No payments recorded."
            items={recentSettlements}
            render={(s) => (
              <Row
                key={s.id}
                href="/split/settlements"
                title={
                  s.sentByMe
                    ? `You paid ${s.counterparty?.name || s.counterparty?.email}`
                    : `${s.counterparty?.name || s.counterparty?.email} paid you`
                }
                subtitle={formatDistanceToNow(new Date(s.settledAt), { addSuffix: true })}
                value={formatMoney(s.amount)}
                tone={s.sentByMe ? "owe" : "owed"}
              />
            )}
          />

          <Section
            title="Active groups"
            icon={UsersRound}
            href="/split/groups"
            empty="No groups yet."
            items={activeGroups}
            render={(g) => (
              <Row
                key={g.id}
                href={`/split/groups/${g.id}`}
                title={`${g.icon || "🧾"} ${g.name}`}
                subtitle={`${g.memberCount} ${g.memberCount === 1 ? "member" : "members"} · ${
                  g.expenseCount
                } ${g.expenseCount === 1 ? "expense" : "expenses"}`}
              />
            )}
          />

          <Section
            title="Upcoming recurring"
            icon={RefreshCw}
            href="/split/expenses"
            empty="Nothing scheduled."
            items={upcomingRecurring}
            render={(r) => (
              <Row
                key={r.id}
                title={r.description}
                subtitle={`${r.schedule} · next ${format(new Date(r.nextRunDate), "PP")}`}
                value={formatMoney(r.amount)}
              />
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, tone }) {
  const colour =
    tone === "owe"
      ? "text-red-600"
      : tone === "owed"
        ? "text-green-600"
        : "text-muted-foreground";

  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${value === 0 ? "text-muted-foreground" : colour}`}>
        {formatMoney(value)}
      </p>
    </div>
  );
}

function Section({ title, icon: Icon, href, items, render, empty }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </p>
        {items.length > 0 && href && (
          <Link
            href={href}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">{items.map(render)}</ul>
      )}
    </div>
  );
}

function Row({ href, title, subtitle, value, tone }) {
  const body = (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {value && (
        <span
          className={`shrink-0 text-sm font-semibold ${
            tone === "owe"
              ? "text-red-600"
              : tone === "owed"
                ? "text-green-600"
                : "text-foreground"
          }`}
        >
          {value}
        </span>
      )}
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} className="-mx-2 block rounded px-2 hover:bg-muted/50">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export default SplitSummary;
