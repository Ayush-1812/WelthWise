import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

import { SPLIT_SECTIONS } from "../_components/split-nav";

/**
 * Overview shell.
 *
 * The three balance tiles render zeroes until M8 derives real balances from the
 * ledger. They are laid out now so M8 only has to swap the data source, and so
 * the section is navigable while the rest is built.
 */
export default function SplitOverviewPage() {
  const summary = [
    {
      label: "You owe",
      value: 0,
      hint: "Total across all friends and groups",
      className: "text-red-600",
    },
    {
      label: "Owed to you",
      value: 0,
      hint: "What others still need to pay back",
      className: "text-green-600",
    },
    {
      label: "Net balance",
      value: 0,
      hint: "Owed to you minus what you owe",
      className: "text-foreground",
    },
  ];

  const shortcuts = SPLIT_SECTIONS.filter(
    (section) => section.href !== "/split/overview"
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-3">
        {summary.map(({ label, value, hint, className }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${className}`}>
                {formatMoney(value)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Balances stay at zero until the ledger is live. Nothing here is
          calculated yet - these tiles read from shared expenses and settlements
          once M8 lands.
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Jump to a section</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map(({ href, label, icon: Icon, description }) => (
            <Link key={href} href={href} className="group">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-purple-600" />
                      <CardTitle className="text-base">{label}</CardTitle>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
