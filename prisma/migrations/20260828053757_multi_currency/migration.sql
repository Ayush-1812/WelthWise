-- Multi-currency (M22).
-- Conversion provenance: the original amount and currency are kept alongside
-- the converted value, with the rate used and when it was fetched. A rate that
-- moves later must never rewrite a historical expense.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferredCurrency" TEXT NOT NULL DEFAULT 'INR';

-- AlterTable
ALTER TABLE "shared_expenses" ADD COLUMN     "exchangeRate" DECIMAL(65,30),
ADD COLUMN     "originalAmount" DECIMAL(65,30),
ADD COLUMN     "originalCurrency" TEXT,
ADD COLUMN     "rateAt" TIMESTAMP(3);
