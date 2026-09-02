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

/**
 * Single source of truth for the Split Expenses sub-routes.
 * The layout, the nav and the overview cards all read from this list, so a new
 * section is added in exactly one place.
 *
 * This deliberately lives outside split-nav.jsx. That file is a Client
 * Component, and every export of a "use client" module reaches a Server
 * Component as a client-reference proxy rather than the value itself - so
 * `SPLIT_SECTIONS.filter(...)` threw "is not a function" when the server-
 * rendered overview page imported it from there. Plain data shared across the
 * boundary has to come from a module with no "use client" directive.
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
