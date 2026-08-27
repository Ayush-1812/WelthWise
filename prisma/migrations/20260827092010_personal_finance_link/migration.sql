-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "isTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "settlementId" TEXT,
ADD COLUMN     "sharedExpenseId" TEXT;

-- CreateIndex
CREATE INDEX "transactions_sharedExpenseId_idx" ON "transactions"("sharedExpenseId");

-- CreateIndex
CREATE INDEX "transactions_settlementId_idx" ON "transactions"("settlementId");

-- CreateIndex
CREATE INDEX "transactions_userId_isTransfer_idx" ON "transactions"("userId", "isTransfer");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sharedExpenseId_fkey" FOREIGN KEY ("sharedExpenseId") REFERENCES "shared_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
