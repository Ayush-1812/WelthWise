import Link from "next/link";
import { LinkIcon, UsersRound, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { previewGroupInvite } from "@/actions/split/invites";

import { JoinGroupButton } from "./_components/join-group";

export default async function JoinGroupPage({ params }) {
  const { token } = await params;
  const result = await previewGroupInvite(token);

  if (!result.success) {
    return (
      <div className="mx-auto max-w-md py-10">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">This link does not work</p>
              <p className="text-sm text-muted-foreground">{result.error}</p>
            </div>
            <p className="max-w-xs text-xs text-muted-foreground">
              Ask whoever shared it to send you a new one.
            </p>
            <Link href="/split/groups">
              <Button variant="outline" size="sm">
                Go to your groups
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { group, alreadyMember } = result.data;

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100 text-2xl">
            {group.icon || <UsersRound className="h-6 w-6 text-purple-600" />}
          </div>

          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {alreadyMember ? "You are already in" : "You have been invited to join"}
            </p>
            <h1 className="text-xl font-semibold">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {group.memberCount}{" "}
              {group.memberCount === 1 ? "member" : "members"}
            </p>
          </div>

          <div className="w-full space-y-2 pt-2">
            <JoinGroupButton
              token={token}
              groupId={group.id}
              alreadyMember={alreadyMember}
            />
            <Link href="/split/groups" className="block">
              <Button variant="ghost" size="sm" className="w-full">
                Not now
              </Button>
            </Link>
          </div>

          {!alreadyMember && (
            <p className="flex items-start gap-1.5 text-left text-xs text-muted-foreground">
              <LinkIcon className="mt-0.5 h-3 w-3 shrink-0" />
              Joining lets you see this group&apos;s expenses and balances, and
              lets its members see yours within the group.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
