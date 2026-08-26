"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  UsersRound,
  Scale,
  Receipt,
  HandCoins,
  ChartNoAxesCombined,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Single source of truth for the Split Expenses sub-routes.
 * The layout, the nav and the overview cards all read from this list, so a new
 * section is added in exactly one place.
 */
export const SPLIT_SECTIONS = [
  {
    href: "/split/overview",
    label: "Overview",
    icon: LayoutGrid,
    description: "Your shared-expense summary at a glance",
  },
  {
    href: "/split/friends",
    label: "Friends",
    icon: Users,
    description: "Add friends and see what you owe each other",
  },
  {
    href: "/split/groups",
    label: "Groups",
    icon: UsersRound,
    description: "Trips, flatmates, and anything you split regularly",
  },
  {
    href: "/split/balances",
    label: "Balances",
    icon: Scale,
    description: "Who owes whom, and why",
  },
  {
    href: "/split/expenses",
    label: "Expenses",
    icon: Receipt,
    description: "Every shared expense you are part of",
  },
  {
    href: "/split/settlements",
    label: "Settlements",
    icon: HandCoins,
    description: "Payments recorded between you and others",
  },
  {
    href: "/split/analytics",
    label: "Analytics",
    icon: ChartNoAxesCombined,
    description: "Shared spending trends, kept apart from personal",
  },
  {
    href: "/split/settings",
    label: "Settings",
    icon: Settings,
    description: "Defaults for currency, splits and reminders",
  },
];

export function SplitNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Split Expenses sections"
      className="-mx-5 mb-8 overflow-x-auto px-5"
    >
      <ul className="flex min-w-max items-center gap-1 border-b pb-px">
        {SPLIT_SECTIONS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  isActive
                    ? "border-purple-600 text-purple-700"
                    : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default SplitNav;
