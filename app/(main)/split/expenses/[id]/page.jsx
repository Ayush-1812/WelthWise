import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { categoryName } from "@/data/categories";
import { getSharedExpense } from "@/actions/split/expenses";
import { getCurrentAppUser, getMembership } from "@/lib/split/auth";
import { canEditExpense } from "@/lib/split/access";

import { isStorageConfigured } from "@/lib/storage";

import { FriendAvatar } from "../../friends/_components/friend-avatar";
import { ExpenseActions } from "./_components/expense-actions";
import { ReceiptPanel } from "./_components/receipt-panel";

const METHOD_LABEL = {
  EQUAL: "Split equally",
  EXACT: "Exact amounts",
  PERCENTAGE: "Percentages",
  SHARES: "Shares",
  CUSTOM: "Adjustments",
  ITEMIZED: "Itemized",
};

export default async function SharedExpenseDetailPage({ params }) {
  const { id } = await params;

  const result = await getSharedExpense(id);
  // A permission failure returns NOT_FOUND, so a bad id never confirms the
  // expense exists.
  if (!result.success || !result.data) notFound();

  const expense = result.data;
  const me = await getCurrentAppUser();
  const membership = expense.groupId
    ? await getMembership(expense.groupId, me.id)
    : null;

  const mayEdit = canEditExpense({ expense, actorId: me.id, membership });
  const storageConfigured = isStorageConfigured();
  const payerName = expense.paidBy?.name || expense.paidBy?.email;
  const paidByMe = expense.paidById === me.id;

  // Who owes whom because of this one expense: every participant except the
  // payer owes the payer their share.
  const debts = expense.splits
    .filter((s) => s.userId !== expense.paidById && s.shareAmount > 0)
    .sort((a, b) => b.shareAmount - a.shareAmount);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/split/expenses"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All expenses
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-xl">
                <span className="truncate">{expense.description}</span>
                {expense.isDeleted && (
                  <Badge variant="secondary">Deleted</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {paidByMe ? "You" : payerName} paid{" "}
                {formatMoney(expense.amount)}
                {expense.group && (
                  <>
                    {" in "}
                    {expense.group.icon} {expense.group.name}
                  </>
                )}
              </CardDescription>
            </div>
            <p className="text-3xl font-bold">{formatMoney(expense.amount)}</p>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-medium">
                {format(new Date(expense.date), "PP")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Category</dt>
              <dd className="font-medium">{categoryName(expense.category)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Split method</dt>
              <dd className="font-medium">
                {METHOD_LABEL[expense.splitMethod] ?? expense.splitMethod}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Added by</dt>
              <dd className="font-medium">
                {expense.createdById === me.id
                  ? "You"
                  : expense.createdBy?.name || expense.createdBy?.email}
              </dd>
            </div>
          </dl>

          {expense.notes && (
            <div className="mt-4 rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm">{expense.notes}</p>
            </div>
          )}

          <ReceiptPanel
            expenseId={expense.id}
            hasReceipt={Boolean(expense.receiptUrl)}
            canEdit={mayEdit}
            storageConfigured={storageConfigured}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Participants ({expense.splits.length})
          </CardTitle>
          <CardDescription>
            Individual shares. These add up to exactly the expense total.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {expense.splits.map((split) => (
              <li
                key={split.id}
                className="flex items-center justify-between gap-4 px-6 py-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <FriendAvatar user={split.user} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {split.userId === me.id
                        ? "You"
                        : split.user?.name || split.user?.email}
                      {split.userId === expense.paidById && (
                        <span className="ml-2 text-xs font-normal text-purple-600">
                          paid
                        </span>
                      )}
                    </span>
                    {split.shareInput !== null &&
                      split.shareInput !== undefined && (
                        <span className="block text-xs text-muted-foreground">
                          entered {split.shareInput}
                          {expense.splitMethod === "PERCENTAGE" ? "%" : ""}
                        </span>
                      )}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(split.shareAmount)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 bg-muted/40 px-6 py-3">
              <span className="text-sm font-medium">Total</span>
              <span className="text-sm font-bold tabular-nums">
                {formatMoney(expense.amount)}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Who owes whom because of this
          </CardTitle>
          <CardDescription>
            Everyone except the payer owes the payer their share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {debts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              This expense creates no debts — the payer covered only their own
              share.
            </p>
          ) : (
            <ul className="space-y-2">
              {debts.map((split) => (
                <li key={split.id} className="text-sm">
                  <span className="font-medium">
                    {split.userId === me.id
                      ? "You"
                      : split.user?.name || split.user?.email}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {split.userId === me.id ? "owe" : "owes"}
                  </span>{" "}
                  <span className="font-medium">
                    {paidByMe ? "you" : payerName}
                  </span>{" "}
                  <span className="font-semibold">
                    {formatMoney(split.shareAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-4">
        <ExpenseActions
          expenseId={expense.id}
          groupId={expense.groupId}
          canEdit={mayEdit}
          isDeleted={expense.isDeleted}
        />
      </div>
    </div>
  );
}
