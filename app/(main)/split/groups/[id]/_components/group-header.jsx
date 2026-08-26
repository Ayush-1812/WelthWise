"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useFetch from "@/hooks/use-fetch";
import { setGroupArchived } from "@/actions/split/groups";

export function GroupHeader({ group }) {
  const router = useRouter();
  const { loading, fn: runArchive } = useFetch(setGroupArchived);

  const canManage = group.myRole === "OWNER" || group.myRole === "ADMIN";

  const handleArchive = async () => {
    const next = !group.isArchived;
    if (
      next &&
      !window.confirm(
        "Archive this group? All balances must be settled. Nothing is deleted."
      )
    ) {
      return;
    }

    const result = await runArchive(group.id, next);
    if (result?.success) {
      toast.success(next ? "Group archived" : "Group restored");
      router.refresh();
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  return (
    <div className="space-y-4">
      <Link
        href="/split/groups"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All groups
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl"
          >
            {group.icon || "🧾"}
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <span className="truncate">{group.name}</span>
              {group.isArchived && <Badge variant="secondary">Archived</Badge>}
            </h2>
            {group.description && (
              <p className="truncate text-sm text-muted-foreground">
                {group.description}
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <Button variant="outline" size="sm" onClick={handleArchive} disabled={loading}>
            {group.isArchived ? (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" />
                Restore
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export default GroupHeader;
