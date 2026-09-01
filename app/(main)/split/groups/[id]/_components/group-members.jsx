"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinus, UserPlus, Crown, Shield, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import useFetch from "@/hooks/use-fetch";
import {
  addGroupMembers,
  removeGroupMember,
  changeMemberRole,
  transferOwnership,
} from "@/actions/split/groups";

import { FriendAvatar } from "../../../friends/_components/friend-avatar";

const ROLE_BADGE = {
  OWNER: { label: "Owner", icon: Crown },
  ADMIN: { label: "Admin", icon: Shield },
};

function MemberBalance({ netBalance, currency }) {
  if (!netBalance) {
    return <span className="text-sm text-muted-foreground">Settled</span>;
  }
  const isOwed = netBalance > 0;
  return (
    <span
      className={`text-sm font-medium ${isOwed ? "text-green-600" : "text-red-600"}`}
    >
      {isOwed ? "+" : "-"}
      {formatMoney(Math.abs(netBalance), currency)}
    </span>
  );
}

export function GroupMembers({ group, friends = [] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState([]);

  const { loading: addLoading, fn: runAdd } = useFetch(addGroupMembers);
  const { loading: removeLoading, fn: runRemove } = useFetch(removeGroupMember);
  const { loading: roleLoading, fn: runRole } = useFetch(changeMemberRole);
  const { loading: transferLoading, fn: runTransfer } = useFetch(transferOwnership);

  const busy = addLoading || removeLoading || roleLoading || transferLoading;
  const canManage = group.myRole === "OWNER" || group.myRole === "ADMIN";
  const isOwner = group.myRole === "OWNER";

  const memberIds = new Set(group.members.map((m) => m.userId));
  const addable = friends.filter((f) => f.friend && !memberIds.has(f.friend.id));

  const act = async (fn, args, message) => {
    const result = await fn(...args);
    if (result?.success) {
      toast.success(message);
      router.refresh();
      return true;
    }
    if (result?.error) toast.error(result.error);
    return false;
  };

  const handleAdd = async () => {
    if (selected.length === 0) return;
    const ok = await act(runAdd, [group.id, selected], "Members added");
    if (ok) {
      setSelected([]);
      setAdding(false);
    }
  };

  const handleRemove = async (member) => {
    const name = member.user?.name || member.user?.email;
    const isSelf = member.userId === group.myUserId;
    const question = isSelf
      ? "Leave this group? Your past expenses stay in the ledger."
      : `Remove ${name}? Their past expenses stay in the ledger.`;

    if (!window.confirm(question)) return;

    const ok = await act(
      runRemove,
      [group.id, member.userId],
      isSelf ? "You left the group" : `${name} removed`
    );
    if (ok && isSelf) router.push("/split/groups");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">
              Members ({group.members.length})
            </CardTitle>
            <CardDescription>
              Balances are derived from the ledger and always sum to zero.
            </CardDescription>
          </div>
          {canManage && !group.isArchived && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding((v) => !v)}
              disabled={busy}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <div className="space-y-2 rounded-lg border p-3">
            {addable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All of your friends are already in this group. Add more friends
                first.
              </p>
            ) : (
              <>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {addable.map(({ friend }) => {
                    const isSelected = selected.includes(friend.id);
                    return (
                      <li key={friend.id}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() =>
                            setSelected((c) =>
                              c.includes(friend.id)
                                ? c.filter((x) => x !== friend.id)
                                : [...c, friend.id]
                            )
                          }
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md p-2 text-left transition-colors",
                            isSelected ? "bg-purple-50" : "hover:bg-muted"
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FriendAvatar user={friend} size={26} />
                            <span className="truncate text-sm">
                              {friend.name || friend.email}
                            </span>
                          </span>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-purple-600" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAdd}
                    disabled={busy || selected.length === 0}
                  >
                    {addLoading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Add {selected.length > 0 && `(${selected.length})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAdding(false);
                      setSelected([]);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        <ul className="divide-y">
          {group.members.map((member) => {
            const badge = ROLE_BADGE[member.role];
            const BadgeIcon = badge?.icon;
            const name = member.user?.name || member.user?.email;
            const isSelf = member.userId === group.myUserId;
            const canActOnThis =
              !group.isArchived && (canManage || isSelf) && !busy;

            return (
              <li
                key={member.membershipId}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FriendAvatar user={member.user} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {name}
                      {isSelf && (
                        <span className="text-xs text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {member.user?.email}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {badge && (
                    <Badge variant="secondary" className="hidden gap-1 sm:flex">
                      <BadgeIcon className="h-3 w-3" />
                      {badge.label}
                    </Badge>
                  )}
                  <MemberBalance netBalance={member.netBalance} />

                  {canActOnThis && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={`Manage ${name}`}>
                          <UserMinus className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isOwner && !isSelf && member.role !== "OWNER" && (
                          <>
                            <DropdownMenuItem
                              onClick={() =>
                                act(
                                  runRole,
                                  [
                                    group.id,
                                    member.userId,
                                    member.role === "ADMIN" ? "MEMBER" : "ADMIN",
                                  ],
                                  "Role updated"
                                )
                              }
                            >
                              {member.role === "ADMIN"
                                ? "Demote to member"
                                : "Make admin"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Make ${name} the owner? You become an admin.`
                                  )
                                ) {
                                  act(
                                    runTransfer,
                                    [group.id, member.userId],
                                    "Ownership transferred"
                                  );
                                }
                              }}
                            >
                              Transfer ownership
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleRemove(member)}
                        >
                          {isSelf ? "Leave group" : `Remove ${name}`}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default GroupMembers;
