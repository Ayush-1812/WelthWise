import { notFound } from "next/navigation";
import { Receipt, Activity } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { getGroup } from "@/actions/split/groups";
import { getFriends } from "@/actions/split/friends";
import { getGroupSimplification } from "@/actions/split/balances";

import { GroupHeader } from "./_components/group-header";
import { GroupMembers } from "./_components/group-members";
import { SimplifyDebts } from "./_components/simplify-debts";

export default async function GroupDetailPage({ params }) {
  const { id } = await params;

  const [groupResult, friendsResult, simplifyResult] = await Promise.all([
    getGroup(id),
    getFriends(),
    getGroupSimplification(id),
  ]);

  // getGroup returns an access failure for non-members too, which is what we
  // want: a group id in a URL must not confirm the group exists.
  if (!groupResult.success) notFound();

  const group = groupResult.data;
  const friends = friendsResult.success ? friendsResult.data : [];
  const simplification = simplifyResult.success ? simplifyResult.data : null;

  return (
    <div className="space-y-6">
      <GroupHeader group={group} />

      <GroupMembers group={group} friends={friends} />

      <SimplifyDebts data={simplification} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Receipt className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">
              {group.expenseCount === 0
                ? "No expenses yet"
                : `${group.expenseCount} expenses`}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Adding shared expenses arrives in M7.
            </p>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Activity className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">Activity</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              The group activity feed arrives in M15.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
