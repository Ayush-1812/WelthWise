"use client";

import Link from "next/link";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

import { FriendAvatar } from "../../friends/_components/friend-avatar";

/** Positive net means the group owes you (task.md section 1). */
function GroupBalance({ netBalance, currency }) {
  if (!netBalance) {
    return <span className="text-sm text-muted-foreground">Settled up</span>;
  }

  const owedToYou = netBalance > 0;
  return (
    <span
      className={`text-sm font-semibold ${
        owedToYou ? "text-green-600" : "text-red-600"
      }`}
    >
      {owedToYou ? "you are owed " : "you owe "}
      {formatMoney(Math.abs(netBalance), currency)}
    </span>
  );
}

export function GroupCard({ group }) {
  return (
    <Link href={`/split/groups/${group.id}`} className="group block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl"
              >
                {group.icon || "🧾"}
              </span>
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{group.name}</CardTitle>
                {group.description && (
                  <p className="truncate text-sm text-muted-foreground">
                    {group.description}
                  </p>
                )}
              </div>
            </div>
            {group.role !== "MEMBER" && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                {group.role === "OWNER" ? "Owner" : "Admin"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {group.members.slice(0, 4).map((member) => (
                <FriendAvatar key={member.id} user={member} size={26} />
              ))}
              {group.memberCount > 4 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  +{group.memberCount - 4}
                </span>
              )}
            </div>
            <GroupBalance netBalance={group.netBalance} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
            {" · "}
            {group.expenseCount}{" "}
            {group.expenseCount === 1 ? "expense" : "expenses"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default GroupCard;
