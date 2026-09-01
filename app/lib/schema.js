import { z } from "zod";

import { CURRENCY_CODES, DEFAULT_CURRENCY } from "@/lib/split/currency";

export const accountSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["CURRENT", "SAVINGS"]),
  balance: z.string().min(1, "Initial balance is required"),
  isDefault: z.boolean().default(false),
});

export const transactionSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: z.string().min(1, "Amount is required"),
    description: z.string().optional(),
    date: z.date({ required_error: "Date is required" }),
    accountId: z.string().min(1, "Account is required"),
    category: z.string().min(1, "Category is required"),
    isRecurring: z.boolean().default(false),
    recurringInterval: z
      .enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isRecurring && !data.recurringInterval) {
      ctx.addIssue({
        code: "custom",  
        message: "Recurring interval is required for recurring transactions",
        path: ["recurringInterval"],
      });
    }
  });
// --- Split Expenses (M7) ---------------------------------------------------

export const SPLIT_METHOD_VALUES = [
  "EQUAL",
  "EXACT",
  "PERCENTAGE",
  "SHARES",
  "CUSTOM",
  "ITEMIZED",
];

/** One line of an itemized bill. Validated properly by normalizeItems(). */
const splitItemSchema = z.object({
  name: z.string(),
  amount: z.union([z.string(), z.number()]),
  quantity: z.union([z.string(), z.number()]).optional(),
  assignedTo: z.array(z.string()).optional(),
});

export const sharedExpenseSchema = z
  .object({
    description: z.string().min(1, "Description is required").max(140),
    amount: z.string().min(1, "Amount is required"),
    // The currency the expense was actually incurred in. Restricted to what the
    // rate source can price, and defaulted rather than left undefined so it can
    // never be silently dropped on its way to the database.
    currency: z.enum(CURRENCY_CODES).default(DEFAULT_CURRENCY),
    date: z.date({ required_error: "Date is required" }),
    category: z.string().min(1, "Category is required"),
    // null for a direct 1:1 friend expense
    groupId: z.string().nullable().optional(),
    paidById: z.string().min(1, "Select who paid"),
    participantIds: z
      .array(z.string())
      .min(1, "Select at least one participant"),
    splitMethod: z.enum(SPLIT_METHOD_VALUES),
    // Per-participant input keyed by user id (EXACT, SHARES, PERCENTAGE...),
    // or a list of line items for ITEMIZED. The two shapes are disjoint, so a
    // union admits both; amounts stay loose here because normalizeItems and
    // computeSplit do the real validation and produce better messages.
    splitValues: z
      .union([
        z.object({ items: z.array(splitItemSchema) }),
        z.record(z.string(), z.union([z.string(), z.number()])),
      ])
      .optional(),
    notes: z.string().max(500).optional(),
    // Optional: record the cash outflow against a personal account (M12).
    accountId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.participantIds.includes(data.paidById)) {
      // The payer need not have a share, but must be part of the expense.
      ctx.addIssue({
        code: "custom",
        message: "The payer must be one of the participants",
        path: ["paidById"],
      });
    }
    if (data.splitMethod === "ITEMIZED" && !data.splitValues?.items?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Add at least one item",
        path: ["splitValues", "items"],
      });
    }
    if (new Set(data.participantIds).size !== data.participantIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "The same participant is selected twice",
        path: ["participantIds"],
      });
    }
  });
