-- Recurring shared expenses (M17): link a generated expense to its template.
-- The unique index is what makes generation idempotent: a retried or
-- double-fired cron run physically cannot insert the same occurrence twice.

-- AlterTable
ALTER TABLE "shared_expenses" ADD COLUMN     "periodKey" TEXT,
ADD COLUMN     "recurringId" TEXT;

-- CreateIndex
CREATE INDEX "shared_expenses_recurringId_idx" ON "shared_expenses"("recurringId");

-- CreateIndex
CREATE UNIQUE INDEX "shared_expenses_recurringId_periodKey_key" ON "shared_expenses"("recurringId", "periodKey");

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_shared_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
