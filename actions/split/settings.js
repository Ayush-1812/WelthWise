"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { getCurrentAppUser, AccessError } from "@/lib/split/auth";
import {
  normalizeCurrency,
  CURRENCY_CODES,
  CurrencyError,
} from "@/lib/split/currency";
import { SPLIT_METHOD_VALUES } from "@/app/lib/schema";

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (error instanceof AccessError || error instanceof CurrencyError) {
    return { success: false, error: error.message };
  }
  console.error("[split/settings]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/** The caller's split preferences, plus the options the form needs. */
export async function getSplitSettings() {
  try {
    const me = await getCurrentAppUser();

    return {
      success: true,
      data: {
        preferredCurrency: me.preferredCurrency,
        defaultSplitMethod: me.defaultSplitMethod,
        emailNotifications: me.emailNotifications,
        currencyOptions: CURRENCY_CODES,
        splitMethodOptions: SPLIT_METHOD_VALUES,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Update the caller's split preferences.
 *
 * Every field is optional so the form can send only what changed, and each is
 * validated against the same lists the rest of the app uses - a preference is
 * still user input, and an unsupported currency here would break every balance
 * that later defaults to it.
 */
export async function updateSplitSettings(input = {}) {
  try {
    const me = await getCurrentAppUser();

    const data = {};

    if (input.preferredCurrency !== undefined) {
      // Throws CurrencyError for anything the rate source cannot price.
      data.preferredCurrency = normalizeCurrency(input.preferredCurrency);
    }

    if (input.defaultSplitMethod !== undefined) {
      if (!SPLIT_METHOD_VALUES.includes(input.defaultSplitMethod)) {
        throw new AccessError("INVALID", "That is not a split method");
      }
      data.defaultSplitMethod = input.defaultSplitMethod;
    }

    if (input.emailNotifications !== undefined) {
      data.emailNotifications = Boolean(input.emailNotifications);
    }

    if (Object.keys(data).length === 0) {
      return { success: true, data: { unchanged: true } };
    }

    const updated = await db.user.update({
      where: { id: me.id },
      data,
      select: {
        preferredCurrency: true,
        defaultSplitMethod: true,
        emailNotifications: true,
      },
    });

    // Preferences change what other pages render, so refresh the ones that
    // read them rather than leaving a stale cached copy behind.
    revalidatePath("/split/settings");
    revalidatePath("/split/overview");
    revalidatePath("/split/balances");
    revalidatePath("/split/expenses/new");

    return { success: true, data: updated };
  } catch (error) {
    return fail(error);
  }
}
