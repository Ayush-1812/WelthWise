"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import useFetch from "@/hooks/use-fetch";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/split/notifications";
import { formatUnreadCount } from "@/lib/split/notifications";

/**
 * Header notification bell.
 *
 * The unread count is rendered on the server so the badge is correct on first
 * paint; the list is fetched when the menu is opened, to keep the header cheap.
 */
export function NotificationBell({ initialUnread = 0 }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(initialUnread);

  const { loading, fn: load } = useFetch(getNotifications);
  const { fn: markAll } = useFetch(markAllNotificationsRead);
  const { fn: markOne } = useFetch(markNotificationRead);

  const handleOpen = async (isOpen) => {
    setOpen(isOpen);
    if (!isOpen) return;

    const result = await load({ limit: 15 });
    if (result?.success) {
      setItems(result.data.items);
      setUnread(result.data.unreadCount);
    } else {
      setItems([]);
    }
  };

  const handleMarkAll = async () => {
    const result = await markAll();
    if (result?.success) {
      setUnread(0);
      setItems((current) =>
        current ? current.map((n) => ({ ...n, isRead: true })) : current
      );
      router.refresh();
    }
  };

  const handleClick = async (notification) => {
    if (!notification.isRead) {
      setUnread((c) => Math.max(0, c - 1));
      setItems((current) =>
        current
          ? current.map((n) =>
              n.id === notification.id ? { ...n, isRead: true } : n
            )
          : current
      );
      await markOne(notification.id);
    }
    setOpen(false);
  };

  const badge = formatUnreadCount(unread);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={
            badge ? `Notifications, ${unread} unread` : "Notifications"
          }
        >
          <Bell size={18} />
          {badge && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-semibold text-white">
              {badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading && items === null ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !items || items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing yet. Shared-expense activity will show up here.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.linkUrl || "/split"}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "block px-3 py-2.5 transition-colors hover:bg-muted/50",
                      !n.isRead && "bg-purple-50/60"
                    )}
                  >
                    <p
                      className={cn(
                        "text-sm leading-snug",
                        !n.isRead && "font-medium"
                      )}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
