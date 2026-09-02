"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import useFetch from "@/hooks/use-fetch";
import { updateSplitSettings } from "@/actions/split/settings";
import { CURRENCIES } from "@/lib/split/currency";

const METHOD_LABELS = {
  EQUAL: "Split equally",
  EXACT: "Exact amounts",
  PERCENTAGE: "Percentages",
  SHARES: "Shares",
  CUSTOM: "Custom",
  ITEMIZED: "By line item",
};

export function SplitSettingsForm({ settings }) {
  const [currency, setCurrency] = useState(settings.preferredCurrency);
  const [method, setMethod] = useState(settings.defaultSplitMethod);
  const [emails, setEmails] = useState(settings.emailNotifications);

  const { loading, fn: runSave, data: result } = useFetch(updateSplitSettings);

  const dirty =
    currency !== settings.preferredCurrency ||
    method !== settings.defaultSplitMethod ||
    emails !== settings.emailNotifications;

  useEffect(() => {
    if (result?.success) toast.success("Settings saved");
    else if (result && !result.success) toast.error(result.error);
  }, [result]);

  const save = async () => {
    await runSave({
      preferredCurrency: currency,
      defaultSplitMethod: method,
      emailNotifications: emails,
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Currency</CardTitle>
          <CardDescription>
            Used for new expenses and to decide which currency your balances are
            shown in. Amounts in different currencies are always tracked
            separately, never added together.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {settings.currencyOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  {CURRENCIES[code].symbol} {code} — {CURRENCIES[code].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default split method</CardTitle>
          <CardDescription>
            Preselected when you add an expense. You can still change it per
            expense.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {settings.splitMethodOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {METHOD_LABELS[value] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email notifications</CardTitle>
          <CardDescription>
            Send an email when someone adds an expense, settles up, or invites
            you. In-app notifications keep working either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                Send me emails
              </span>
              <span className="block text-xs text-muted-foreground">
                {emails
                  ? "You will get an email for important events."
                  : "You will only see notifications inside the app."}
              </span>
            </span>
            <Switch checked={emails} onCheckedChange={setEmails} />
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save changes
            </>
          )}
        </Button>
        {dirty && !loading && (
          <span className="text-xs text-muted-foreground">
            You have unsaved changes.
          </span>
        )}
      </div>
    </div>
  );
}
