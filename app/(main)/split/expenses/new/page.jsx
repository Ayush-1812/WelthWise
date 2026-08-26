import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getExpenseFormContext } from "@/actions/split/expenses";

import { ExpenseForm } from "../_components/expense-form";

export default async function NewSharedExpensePage() {
  const result = await getExpenseFormContext();

  const context = result.success
    ? result.data
    : { me: { id: "", name: "", email: "" }, groups: [], friends: [] };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/split/expenses"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All expenses
      </Link>

      <h2 className="text-2xl font-bold">Add a shared expense</h2>

      <ExpenseForm context={context} />
    </div>
  );
}
