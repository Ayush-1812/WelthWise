"use client";

import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import useFetch from "@/hooks/use-fetch";
import { acceptFriendRequest, cancelFriendRequest } from "@/actions/split/friends";

import { FriendAvatar } from "./friend-avatar";

export function PendingRequests({ incoming = [], outgoing = [], onChanged }) {
  const { loading: accepting, fn: runAccept } = useFetch(acceptFriendRequest);
  const { loading: cancelling, fn: runCancel } = useFetch(cancelFriendRequest);

  const busy = accepting || cancelling;

  const handle = async (fn, id, successMessage) => {
    const result = await fn(id);
    if (result?.success) {
      toast.success(successMessage);
      onChanged?.();
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending requests</CardTitle>
        <CardDescription>
          {incoming.length} waiting on you &middot; {outgoing.length} waiting on
          them
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {incoming.map((request) => (
          <div
            key={request.friendshipId}
            className="flex items-center justify-between gap-4 rounded-lg border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FriendAvatar user={request.friend} />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {request.friend?.name || request.friend?.email}
                </p>
                <p className="text-sm text-muted-foreground">
                  wants to split expenses with you
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  handle(runAccept, request.friendshipId, "Friend added")
                }
              >
                {accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span className="ml-1 hidden sm:inline">Accept</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  handle(runCancel, request.friendshipId, "Request declined")
                }
              >
                <X className="h-4 w-4" />
                <span className="ml-1 hidden sm:inline">Decline</span>
              </Button>
            </div>
          </div>
        ))}

        {outgoing.map((request) => (
          <div
            key={request.friendshipId}
            className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FriendAvatar user={request.friend} />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {request.friend?.name || request.friend?.email}
                </p>
                <p className="text-sm text-muted-foreground">Request sent</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                handle(runCancel, request.friendshipId, "Request cancelled")
              }
            >
              Cancel
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default PendingRequests;
