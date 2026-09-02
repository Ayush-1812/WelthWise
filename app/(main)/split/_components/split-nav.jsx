"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Imported, never re-exported: re-exporting it from this "use client"
// module would hand a Server Component a proxy instead of the array again.
import { SPLIT_SECTIONS } from "./split-sections";

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
