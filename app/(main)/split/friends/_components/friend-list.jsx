"use client";

import { UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import useFetch from "@/hooks/use-fetch";
import { removeFriend } from "@/actions/split/friends";

import { FriendAvatar } from "./friend-avatar";

/** Net balance wording. Positive means they owe you (task.md section 1). */
function BalanceLabel({ netBalance }) {
  if (!netBalance) {
    return <span className="text-sm text-muted-foreground">Settled up</span>;
  }

  const owesYou = netBalance > 0;
  return (
    <span
      className={`text-sm font-medium ${
        owesYou ? "text-green-600" : "text-red-600"
      }`}
    >
      {owesYou ? "owes you " : "you owe "}
      {formatMoney(Math.abs(netBalance))}
    </span>
  );
}

export function FriendList({ friends = [], onChanged }) {
  const { loading: removing, fn: runRemove } = useFetch(removeFriend);

  const handleRemove = async (friendshipId, name) => {
    if (
      !window.confirm(
        `Remove ${name} from your friends? Your shared expense history is kept.`
      )
    ) {
      return;
    }

    const result = await runRemove(friendshipId);
    if (result?.success) {
      toast.success("Friend removed");
      onChanged?.();
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Friends {friends.length > 0 && `(${friends.length})`}
        </CardTitle>
        <CardDescription>
          Net balance across every group and direct expense you share.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {friends.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No friends yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add someone by email above to start splitting expenses with them.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {friends.map((entry) => {
              const name = entry.friend?.name || entry.friend?.email || "Unknown";

              return (
                <li
                  key={entry.friendshipId}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FriendAvatar user={entry.friend} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {entry.friend?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <BalanceLabel netBalance={entry.netBalance} />
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`Remove ${name}`}
                      aria-label={`Remove ${name}`}
                      disabled={removing}
                      onClick={() => handleRemove(entry.friendshipId, name)}
                    >
                      <UserMinus className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default FriendList;
