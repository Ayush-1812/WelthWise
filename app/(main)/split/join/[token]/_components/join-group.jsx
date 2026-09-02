"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import useFetch from "@/hooks/use-fetch";
import { joinGroupViaInvite } from "@/actions/split/invites";

export function JoinGroupButton({ token, groupId, alreadyMember }) {
  const router = useRouter();
  const { loading, fn: runJoin, data: result } = useFetch(joinGroupViaInvite);

  useEffect(() => {
    if (result?.success) {
      toast.success(
        result.data.joined
          ? `You joined ${result.data.groupName}`
          : `You are already in ${result.data.groupName}`
      );
      router.push(`/split/groups/${result.data.groupId}`);
      router.refresh();
    } else if (result && !result.success) {
      toast.error(result.error);
    }
  }, [result, router]);

  if (alreadyMember) {
    return (
      <Button
        className="w-full"
        onClick={() => router.push(`/split/groups/${groupId}`)}
      >
        Open group
      </Button>
    );
  }

  return (
    <Button className="w-full" onClick={() => runJoin(token)} disabled={loading}>
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Joining
        </>
      ) : (
        <>
          <UserPlus className="mr-2 h-4 w-4" />
          Join group
        </>
      )}
    </Button>
  );
}
