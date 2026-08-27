"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  HandCoins,
  Loader2,
  Pencil,
  Receipt,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
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
import useFetch from "@/hooks/use-fetch";
import { getGroupActivity } from "@/actions/split/activity";
import { ACTIVITY_ICONS, isExpenseActivity } from "@/lib/split/activity";

import { FriendAvatar } from "../../../friends/_components/friend-avatar";

/** Icon names come from the shared formatter, resolved to components here. */
const ICONS = {
  UsersRound,
  UserPlus,
  UserMinus,
  Receipt,
  Pencil,
  Trash2,
  HandCoins,
  RefreshCw,
};

export function ActivityFeed({ groupId, initial }) {
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);

  const { loading, fn: loadMore } = useFetch(getGroupActivity);

  const handleLoadMore = async () => {
    const result = await loadMore(groupId, { cursor });
    if (result?.success) {
      setItems((current) => [...current, ...result.data.items]);
      setCursor(result.data.nextCursor);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
        <CardDescription>
          Everything that has changed this group&apos;s ledger.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Activity className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((item) => {
                const Icon = ICONS[ACTIVITY_ICONS[item.type]] ?? Activity;
                const linkable = isExpenseActivity(item.type) && item.expenseId;

                const body = (
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{item.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <FriendAvatar user={item.actor} size={24} />
                  </div>
                );

                return (
                  <li key={item.id}>
                    {linkable ? (
                      <Link
                        href={`/split/expenses/${item.expenseId}`}
                        className="-mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="-mx-2 px-2 py-1">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            {cursor && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-4 w-full"
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Show older activity"
                )}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ActivityFeed;
