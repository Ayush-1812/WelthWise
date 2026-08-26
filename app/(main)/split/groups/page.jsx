import { Plus, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getGroups } from "@/actions/split/groups";
import { getFriends } from "@/actions/split/friends";

import { CreateGroupDrawer } from "./_components/create-group-drawer";
import { GroupCard } from "./_components/group-card";

export default async function SplitGroupsPage() {
  const [groupsResult, friendsResult] = await Promise.all([
    getGroups(),
    getFriends(),
  ]);

  const active = groupsResult.success ? groupsResult.data.active : [];
  const archived = groupsResult.success ? groupsResult.data.archived : [];
  const friends = friendsResult.success ? friendsResult.data : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {active.length} active {active.length === 1 ? "group" : "groups"}
        </p>
        <CreateGroupDrawer friends={friends}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New group
          </Button>
        </CreateGroupDrawer>
      </div>

      {active.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <UsersRound className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No groups yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create one for a trip, your flat, or anything you split
                regularly.
              </p>
            </div>
            <CreateGroupDrawer friends={friends}>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Create your first group
              </Button>
            </CreateGroupDrawer>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
            Archived ({archived.length})
          </h2>
          <div className="grid gap-4 opacity-60 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
