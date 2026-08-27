import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  getExpenseFormContext,
  getSharedExpense,
} from "@/actions/split/expenses";
import { getCurrentAppUser, getMembership } from "@/lib/split/auth";
import { canEditExpense } from "@/lib/split/access";

import { ExpenseForm } from "../../_components/expense-form";

export default async function EditSharedExpensePage({ params }) {
  const { id } = await params;

  const [expenseResult, contextResult] = await Promise.all([
    getSharedExpense(id),
    getExpenseFormContext(),
  ]);

  if (!expenseResult.success || !expenseResult.data) notFound();

  const expense = expenseResult.data;
  const me = await getCurrentAppUser();
  const membership = expense.groupId
    ? await getMembership(expense.groupId, me.id)
    : null;

  // Rendering the form for someone who cannot save it would be a dead end.
  if (!canEditExpense({ expense, actorId: me.id, membership })) notFound();

  const context = contextResult.success
    ? contextResult.data
    : { me: { id: me.id, name: me.name, email: me.email }, groups: [], friends: [] };

  // Rebuild the per-participant inputs the original split was entered with, so
  // an EXACT or PERCENTAGE expense reopens showing what was typed.
  const splitValues = {};
  for (const split of expense.splits) {
    if (split.shareInput !== null && split.shareInput !== undefined) {
      splitValues[split.userId] = String(split.shareInput);
    } else if (expense.splitMethod === "EXACT") {
      splitValues[split.userId] = String(split.shareAmount);
    }
  }

  const initial = {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    amount: expense.amount,
    date: expense.date,
    category: expense.category,
    notes: expense.notes ?? "",
    splitMethod: expense.splitMethod,
    paidById: expense.paidById,
    participantIds: expense.splits.map((s) => s.userId),
    splitValues,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/split/expenses/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to expense
      </Link>

      <h2 className="text-2xl font-bold">Edit expense</h2>

      <ExpenseForm context={context} initial={initial} />
    </div>
  );
}
