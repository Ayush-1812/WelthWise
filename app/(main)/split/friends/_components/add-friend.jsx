"use client";

import { useState } from "react";
import { Loader2, Search, UserPlus, Check, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import useFetch from "@/hooks/use-fetch";
import { searchUsers, sendFriendRequest } from "@/actions/split/friends";

import { FriendAvatar } from "./friend-avatar";

/** Label and affordance for each possible existing relationship. */
const RELATIONSHIP_UI = {
  FRIENDS: { label: "Already friends", icon: Check, disabled: true },
  PENDING_OUTGOING: { label: "Request sent", icon: Clock, disabled: true },
  PENDING_INCOMING: { label: "Accept request", icon: Check, disabled: false },
  BLOCKED: { label: "Unavailable", icon: Clock, disabled: true },
  NONE: { label: "Add friend", icon: UserPlus, disabled: false },
};

export function AddFriend({ onChanged }) {
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState(false);

  const { loading: searching, fn: runSearch, data: searchResult, setData } =
    useFetch(searchUsers);
  const { loading: sending, fn: runSend } = useFetch(sendFriendRequest);

  const handleSearch = async (event) => {
    event.preventDefault();
    const query = email.trim();
    if (!query) return;

    setSearched(false);
    await runSearch(query);
    setSearched(true);
  };

  const handleAdd = async (userId) => {
    const result = await runSend(userId);
    if (result?.success) {
      toast.success("Friend request sent");
      setEmail("");
      setData(undefined);
      setSearched(false);
      onChanged?.();
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  const results = searchResult?.success ? searchResult.data : [];
  const showEmpty = searched && !searching && results.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a friend</CardTitle>
        <CardDescription>
          Search by the exact email address they signed up with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className="pl-8"
              aria-label="Friend's email address"
            />
          </div>
          <Button type="submit" disabled={searching || !email.trim()}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </form>

        {showEmpty && (
          <p className="text-sm text-muted-foreground">
            No WealthWise account found for that email. They need to sign up
            first.
          </p>
        )}

        {results.map((user) => {
          const ui = RELATIONSHIP_UI[user.relationship] ?? RELATIONSHIP_UI.NONE;
          const Icon = ui.icon;

          return (
            <div
              key={user.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FriendAvatar user={user} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.name || user.email}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant={ui.disabled ? "outline" : "default"}
                disabled={ui.disabled || sending}
                onClick={() => handleAdd(user.id)}
              >
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="mr-2 h-4 w-4" />
                )}
                {ui.label}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default AddFriend;
