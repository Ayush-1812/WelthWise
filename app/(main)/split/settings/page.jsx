import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { getSplitSettings } from "@/actions/split/settings";

import { SplitSettingsForm } from "./_components/settings-form";

export default async function SplitSettingsPage() {
  const result = await getSplitSettings();

  if (!result.success) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          <p className="font-medium">Could not load your settings</p>
          <p className="text-sm text-muted-foreground">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Defaults for currency, split method and reminders.
        </p>
      </div>

      <SplitSettingsForm settings={result.data} />
    </div>
  );
}
