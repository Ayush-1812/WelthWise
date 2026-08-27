import { notFound } from "next/navigation";
import Link from "next/link";
import { Receipt, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getGroup } from "@/actions/split/groups";
import { getFriends } from "@/actions/split/friends";
import { getGroupSimplification } from "@/actions/split/balances";
import { getGroupActivity } from "@/actions/split/activity";

import { GroupHeader } from "./_components/group-header";
import { GroupMembers } from "./_components/group-members";
import { SimplifyDebts } from "./_components/simplify-debts";
import { ActivityFeed } from "./_components/activity-feed";

export default async function GroupDetailPage({ params }) {
  const { id } = await params;

  const [groupResult, friendsResult, simplifyResult, activityResult] =
    await Promise.all([
      getGroup(id),
      getFriends(),
      getGroupSimplification(id),
      getGroupActivity(id),
    ]);

  // getGroup returns an access failure for non-members too, which is what we
  // want: a group id in a URL must not confirm the group exists.
  if (!groupResult.success) notFound();

  const group = groupResult.data;
  const friends = friendsResult.success ? friendsResult.data : [];
  const simplification = simplifyResult.success ? simplifyResult.data : null;
  const activity = activityResult.success ? activityResult.data : null;

  return (
    <div className="space-y-6">
      <GroupHeader group={group} />

      <GroupMembers group={group} friends={friends} />

      <SimplifyDebts data={simplification} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Receipt className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">
              {group.expenseCount === 0
                ? "No expenses yet"
                : `${group.expenseCount} expenses`}
            </p>
            <Link href={`/split/expenses/new`}>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add an expense
              </Button>
            </Link>
          </CardContent>
        </Card>

        <ActivityFeed groupId={id} initial={activity} />
      </div>
    </div>
  );
}
