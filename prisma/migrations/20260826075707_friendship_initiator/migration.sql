/*
  Warnings:

  - Added the required column `initiatedById` to the `friendships` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "friendships" ADD COLUMN     "initiatedById" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "friendships_initiatedById_idx" ON "friendships"("initiatedById");

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
