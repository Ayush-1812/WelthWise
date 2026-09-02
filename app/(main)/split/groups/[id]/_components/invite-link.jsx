"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useFetch from "@/hooks/use-fetch";
import { createGroupInvite, revokeGroupInvite } from "@/actions/split/invites";
import { EXPIRY_PRESETS } from "@/lib/split/invites";

function expiryLabel(expiresAt) {
  if (!expiresAt) return "Never expires";

  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";

  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Expires in ${days} day${days === 1 ? "" : "s"}`;

  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

function usesLabel({ useCount, maxUses }) {
  if (maxUses === null || maxUses === undefined) {
    return useCount === 1 ? "Used once" : `Used ${useCount} times`;
  }
  return `${useCount} of ${maxUses} uses`;
}

/** One link, with the copy button people actually came for. */
function InviteRow({ invite, canManage }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const { loading, fn: runRevoke, data: result } = useFetch(revokeGroupInvite);

  useEffect(() => {
    if (result?.success) {
      toast.success("Link turned off");
      router.refresh();
    } else if (result && !result.success) {
      toast.error(result.error);
    }
  }, [result, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context and permission; neither is guaranteed.
      toast.error("Could not copy — select the link and copy it manually");
    }
  };

  const share = async () => {
    // Only present on mobile/PWA contexts, so fall back to copying.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Join my group", url: invite.url });
      } catch {
        // The user dismissed the share sheet; nothing to report.
      }
      return;
    }
    copy();
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input readOnly value={invite.url} className="font-mono text-xs" />
        <Button size="icon" variant="outline" onClick={copy} title="Copy link">
          {copied ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button size="icon" variant="outline" onClick={share} title="Share link">
          <Share2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {expiryLabel(invite.expiresAt)} · {usesLabel(invite)}
        </span>
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-red-600 hover:text-red-700"
            onClick={() => runRevoke(invite.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <X className="mr-1 h-3 w-3" />
            )}
            Turn off
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Invite-by-link panel (M19).
 *
 * Anyone with the link can join, so creating one is restricted to owners and
 * admins and the panel says so plainly rather than hiding the consequence.
 *
 * The list is never mirrored into local state: the actions revalidate the
 * group page, so a refresh re-renders from the server and there is only ever
 * one copy of the truth.
 */
export function InviteLink({ groupId, invites = [], canManage }) {
  const router = useRouter();
  const [expiresIn, setExpiresIn] = useState("7");
  const { loading, fn: runCreate, data: result } = useFetch(createGroupInvite);

  useEffect(() => {
    if (result?.success) {
      toast.success("Invite link ready to share");
      router.refresh();
    } else if (result && !result.success) {
      toast.error(result.error);
    }
  }, [result, router]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-purple-600" />
          <CardTitle className="text-base">Invite by link</CardTitle>
        </div>
        <CardDescription>
          Anyone with the link can join this group and see its expenses and
          balances. Share it only with people you trust, and turn it off when
          you are done.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Link expires
              </span>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => runCreate(groupId, { expiresIn })}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Create link
            </Button>
          </div>
        )}

        {invites.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {canManage
              ? "No active invite links. Create one to share this group."
              : "No active invite links. Ask an admin to create one."}
          </p>
        ) : (
          <div className="space-y-2">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} canManage={canManage} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
