"use server";

import { revalidatePath } from "next/cache";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { db } from "@/lib/prisma";
import { assertWithinRateLimit } from "@/lib/ratelimit";
import { draftItemsFromScan } from "@/lib/split/itemized";
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError || error instanceof ReceiptError) {
    return { success: false, error: error.message };
  }
  // A throttled caller is an expected outcome, not a defect.
  if (error?.code === "RATE_LIMITED") {
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
 * Read a receipt image into a DRAFT list of line items for an ITEMIZED split.
 *
 * This is the OCR half of M21, which was blocked on a Gemini 403 while the
 * manual path was built first. It is deliberately separate from
 * scanReceipt() in actions/transaction.js: that one extracts a single total for
 * a personal transaction, whereas an itemized split needs every line.
 *
 * Nothing here is authoritative. draftItemsFromScan() leaves every item
 * unassigned, the user corrects the rows by hand, and the existing
 * checkItemsTotal() gate still has to pass before the expense can be saved. A
 * scanner that is wrong about a dish name is a nuisance; a scanner trusted to
 * decide who owes what would be a bug.
 */
export async function scanReceiptItems(file) {
  try {
    const me = await getCurrentAppUser();

    // Each call spends Gemini quota, so it is charged like a ledger write.
    await assertWithinRateLimit("write", me.id);

    if (!process.env.GEMINI_API_KEY) {
      throw new ReceiptError(
        "Receipt scanning is not configured. Add the items by hand."
      );
    }

    // Same size and MIME rules as an upload: a 20 MB TIFF should be refused
    // here rather than after it has been base64-encoded into a request body.
    validateReceipt(file);

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `
      Read this receipt and list every purchased line item.

      Rules:
      - One entry per item actually bought. Skip subtotals, taxes, service
        charges, discounts, tips and the grand total.
      - "amount" is the line total for that item as a plain number, with no
        currency symbol and no thousands separators. If a line shows a unit
        price and a quantity, return the line total.
      - "name" is the item as printed, trimmed, at most 100 characters.
      - "total" is the grand total actually charged.
      - If the image is not a receipt, return {"items": []}.

      Respond with valid JSON only, in exactly this shape:
      {
        "items": [{ "name": "string", "amount": number }],
        "total": number,
        "merchantName": "string",
        "date": "ISO date string"
      }
    `;

    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType: file.type } },
      prompt,
    ]);

    // Same shape as scanReceipt() in actions/transaction.js, including the
    // fence strip - Gemini wraps JSON in a markdown code block often enough.
    const response = await result.response;
    const text = response.text().replace(/```(?:json)?\n?/g, "").trim();

    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      // Gemini occasionally returns prose instead of JSON.
      throw new ReceiptError("Could not read that receipt. Add the items by hand.");
    }

    const items = draftItemsFromScan(raw);

    if (items.length === 0) {
      throw new ReceiptError(
        "No line items found on that image. Add them by hand."
      );
    }

    // The scanned grand total is returned for comparison only. It is never
    // written as the expense amount: taxes and tips make it disagree with the
    // item sum on purpose, and checkItemsTotal() must stay the only authority
    // on whether the two reconcile.
    const scannedTotal = Number(raw?.total);

    return {
      success: true,
      data: {
        items,
        scannedTotal: Number.isFinite(scannedTotal) ? scannedTotal : null,
        merchantName:
          typeof raw?.merchantName === "string" ? raw.merchantName.trim() : null,
      },
    };
  } catch (error) {
    return fail(error);
  }
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
