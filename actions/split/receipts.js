"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import {
  getCurrentAppUser,
  assertCanEditExpense,
  assertCanViewExpense,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import {
  ReceiptError,
  validateReceipt,
  buildReceiptPath,
} from "@/lib/split/receipts";
import {
  uploadReceipt,
  getReceiptUrl,
  deleteReceipt,
  isStorageConfigured,
} from "@/lib/storage";

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError || error instanceof ReceiptError) {
    return { success: false, error: error.message };
  }
  console.error("[split/receipts]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/** Whether the app can accept uploads at all, so the UI can say so up front. */
export async function getReceiptStorageStatus() {
  return { success: true, data: { configured: isStorageConfigured() } };
}

/**
 * Attach a receipt to a shared expense.
 *
 * Only someone who may edit the expense may change its receipt. The old file is
 * removed after the new one is stored, so a failed upload never leaves the
 * expense without a receipt.
 */
export async function attachSharedExpenseReceipt(expenseId, formData) {
  try {
    const me = await getCurrentAppUser();
    const expense = await assertCanEditExpense(expenseId, me.id);

    const file = formData?.get?.("file");
    const { extension, contentType } = validateReceipt(file);

    const path = buildReceiptPath({
      ownerId: me.id,
      scope: "shared",
      extension,
    });

    await uploadReceipt({
      path,
      body: Buffer.from(await file.arrayBuffer()),
      contentType,
    });

    const previous = expense.receiptUrl;

    await db.sharedExpense.update({
      where: { id: expenseId },
      data: { receiptUrl: path },
    });

    // Best-effort cleanup, only after the new one is safely referenced.
    if (previous && previous !== path) await deleteReceipt(previous);

    revalidatePath(`/split/expenses/${expenseId}`);
    return { success: true, data: { path } };
  } catch (error) {
    return fail(error);
  }
}

/** Remove a shared expense's receipt. */
export async function removeSharedExpenseReceipt(expenseId) {
  try {
    const me = await getCurrentAppUser();
    const expense = await assertCanEditExpense(expenseId, me.id);

    if (!expense.receiptUrl) {
      return { success: true };
    }

    await db.sharedExpense.update({
      where: { id: expenseId },
      data: { receiptUrl: null },
    });

    await deleteReceipt(expense.receiptUrl);

    revalidatePath(`/split/expenses/${expenseId}`);
    return { success: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * A signed, short-lived URL for a shared expense's receipt.
 * Authorised through the same view check as the expense itself, so a receipt
 * is never reachable by someone who cannot see the expense.
 */
export async function getSharedExpenseReceiptUrl(expenseId) {
  try {
    const me = await getCurrentAppUser();
    const expense = await assertCanViewExpense(expenseId, me.id);

    if (!expense.receiptUrl) return { success: true, data: { url: null } };

    return {
      success: true,
      data: { url: await getReceiptUrl(expense.receiptUrl) },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Attach a receipt to a personal transaction.
 *
 * Transaction.receiptUrl has existed since the first migration but was never
 * read or written - the scanner extracted data and discarded the image. This
 * makes the column real.
 */
export async function attachTransactionReceipt(transactionId, formData) {
  try {
    const me = await getCurrentAppUser();

    const transaction = await db.transaction.findFirst({
      where: { id: transactionId, userId: me.id },
      select: { id: true, receiptUrl: true },
    });
    if (!transaction) {
      throw new AccessError(ACCESS_CODES.NOT_FOUND, "Transaction not found");
    }

    const file = formData?.get?.("file");
    const { extension, contentType } = validateReceipt(file);

    const path = buildReceiptPath({
      ownerId: me.id,
      scope: "personal",
      extension,
    });

    await uploadReceipt({
      path,
      body: Buffer.from(await file.arrayBuffer()),
      contentType,
    });

    await db.transaction.update({
      where: { id: transactionId },
      data: { receiptUrl: path },
    });

    if (transaction.receiptUrl && transaction.receiptUrl !== path) {
      await deleteReceipt(transaction.receiptUrl);
    }

    revalidatePath("/dashboard");
    return { success: true, data: { path } };
  } catch (error) {
    return fail(error);
  }
}

/** A signed URL for a personal transaction's receipt, scoped to its owner. */
export async function getTransactionReceiptUrl(transactionId) {
  try {
    const me = await getCurrentAppUser();

    const transaction = await db.transaction.findFirst({
      where: { id: transactionId, userId: me.id },
      select: { receiptUrl: true },
    });
    // Scoped by userId, so another user's id simply yields nothing.
    if (!transaction?.receiptUrl) return { success: true, data: { url: null } };

    return {
      success: true,
      data: { url: await getReceiptUrl(transaction.receiptUrl) },
    };
  } catch (error) {
    return fail(error);
  }
}
