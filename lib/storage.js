import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  RECEIPT_BUCKET,
  ReceiptError,
  isStoragePath,
} from "@/lib/split/receipts";

/**
 * Receipt storage on Supabase Storage (M20).
 *
 * The bucket is PRIVATE. Nothing is served from a public URL - every read goes
 * through a short-lived signed URL, so a receipt cannot be enumerated or shared
 * by guessing an object key.
 *
 * The service-role key is used server-side only. This module is `server-only`
 * so importing it from a Client Component fails at build time rather than
 * leaking the key into the browser bundle.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Signed URLs are short-lived: long enough to view, short enough not to leak. */
export const SIGNED_URL_TTL_SECONDS = 60 * 10;

let client = null;

/** True when the app is configured for uploads. */
export function isStorageConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function getClient() {
  if (!isStorageConfigured()) {
    throw new ReceiptError(
      "Receipt storage is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env"
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/**
 * Upload a receipt.
 *
 * `upsert: false` so a path collision fails loudly rather than silently
 * overwriting someone's file.
 */
export async function uploadReceipt({ path, body, contentType }) {
  const { error } = await getClient()
    .storage.from(RECEIPT_BUCKET)
    .upload(path, body, { contentType, upsert: false });

  if (error) {
    throw new ReceiptError(`Could not upload the receipt: ${error.message}`);
  }

  return path;
}

/**
 * A short-lived signed URL for a stored receipt.
 *
 * Returns the value unchanged if it is already an external URL, so any row
 * holding a full URL still renders. Returns null on failure rather than
 * throwing - a missing receipt should not break an expense page.
 */
export async function getReceiptUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (!isStoragePath(pathOrUrl)) return pathOrUrl;
  if (!isStorageConfigured()) return null;

  try {
    const { data, error } = await getClient()
      .storage.from(RECEIPT_BUCKET)
      .createSignedUrl(pathOrUrl, SIGNED_URL_TTL_SECONDS);

    if (error) {
      console.error("[storage] signed url failed:", error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    console.error("[storage] signed url threw:", error.message);
    return null;
  }
}

/**
 * Delete a stored receipt. Never throws - a failed cleanup must not block the
 * expense edit or deletion that triggered it.
 */
export async function deleteReceipt(pathOrUrl) {
  if (!isStoragePath(pathOrUrl) || !isStorageConfigured()) return false;

  try {
    const { error } = await getClient()
      .storage.from(RECEIPT_BUCKET)
      .remove([pathOrUrl]);

    if (error) {
      console.error("[storage] delete failed:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[storage] delete threw:", error.message);
    return false;
  }
}
