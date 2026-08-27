"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import useFetch from "@/hooks/use-fetch";
import { deleteSharedExpense } from "@/actions/split/expenses";

export function ExpenseActions({ expenseId, groupId, canEdit, isDeleted }) {
  const router = useRouter();
  const { loading, fn: runDelete } = useFetch(deleteSharedExpense);

  if (isDeleted) {
    return (
      <p className="text-xs text-muted-foreground">
        This expense has been deleted. It is kept so past balances and
        settlements stay explainable.
      </p>
    );
  }

  if (!canEdit) {
    return (
      <p className="text-xs text-muted-foreground">
        Only the payer, the person who added it, or a group admin can change
        this.
      </p>
    );
  }

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Delete this expense? Balances will be recalculated. The record is kept for history."
      )
    ) {
      return;
    }

    let result = await runDelete(expenseId, { confirm: false });

    // The server warns before disturbing someone who had already settled.
    if (result?.needsConfirmation) {
      if (!window.confirm(`${result.warning}\n\nDelete anyway?`)) return;
      result = await runDelete(expenseId, { confirm: true });
    }

    if (result?.success) {
      toast.success("Expense deleted");
      router.refresh();
      router.push(groupId ? `/split/groups/${groupId}` : "/split/expenses");
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  return (
    <div className="flex gap-2">
      <Link href={`/split/expenses/${expenseId}/edit`}>
        <Button variant="outline" size="sm" disabled={loading}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </Link>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={handleDelete}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-2 h-4 w-4" />
        )}
        Delete
      </Button>
    </div>
  );
}

export default ExpenseActions;
