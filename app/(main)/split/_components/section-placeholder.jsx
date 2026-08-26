import { Construction } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Stub body for a Split Expenses section that has not been built yet.
 *
 * Each section names the module that will fill it in, so the shell is honest
 * about what works rather than showing an empty page that looks broken.
 * Delete the usage as each module lands.
 */
export function SectionPlaceholder({ title, description, module: moduleName }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Construction className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        </div>
        {moduleName && (
          <p className="text-xs text-muted-foreground/70">
            Arrives in {moduleName}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default SectionPlaceholder;
