/**
 * Receipt validation and storage-path logic - pure functions, no I/O.
 *
 * Kept pure so the accept-list, the size cap and the path shape are testable
 * without a storage backend, and so the same rules apply to a shared expense
 * and a personal transaction.
 */

/** Matches the 5MB cap the existing Gemini receipt scanner already enforces. */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/**
 * Accept-list, not a deny-list. Anything not named here is rejected, so a new
 * file type can never sneak in by having an unfamiliar extension.
 */
export const ALLOWED_RECEIPT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export const RECEIPT_ACCEPT_ATTR = Object.keys(ALLOWED_RECEIPT_TYPES).join(",");

export const RECEIPT_BUCKET = "receipts";

export class ReceiptError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiptError";
  }
}

/** Human size, for error messages. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate an uploaded file.
 *
 * @param {{ type: string, size: number, name?: string }} file
 * @returns {{ extension: string, contentType: string }}
 */
export function validateReceipt(file) {
  if (!file || typeof file !== "object") {
    throw new ReceiptError("No file was provided");
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new ReceiptError("That file appears to be empty");
  }
  if (size > MAX_RECEIPT_BYTES) {
    throw new ReceiptError(
      `Receipt must be under ${formatBytes(MAX_RECEIPT_BYTES)} (yours is ${formatBytes(size)})`
    );
  }

  const contentType = String(file.type ?? "").toLowerCase();
  const extension = ALLOWED_RECEIPT_TYPES[contentType];
  if (!extension) {
    throw new ReceiptError(
      "Receipts must be a JPEG, PNG, WebP, HEIC image or a PDF"
    );
  }

  return { extension, contentType };
}

/**
 * Storage path for a receipt.
 *
 * Namespaced by owner so one user's uploads can never collide with or overwrite
 * another's, and randomised so the path cannot be guessed from an expense id.
 *
 * @param {object} args
 * @param {string} args.ownerId   the uploading user
 * @param {string} args.scope     "shared" or "personal"
 * @param {string} args.extension from validateReceipt
 * @param {string} [args.token]   injectable for deterministic tests
 */
export function buildReceiptPath({ ownerId, scope, extension, token }) {
  if (!ownerId) throw new ReceiptError("An owner is required");
  if (scope !== "shared" && scope !== "personal") {
    throw new ReceiptError(`Unknown receipt scope: ${scope}`);
  }
  if (!extension) throw new ReceiptError("A file extension is required");

  const unique = token ?? crypto.randomUUID();
  return `${scope}/${ownerId}/${unique}.${extension}`;
}

/**
 * Whether a stored value is one of our storage paths rather than an external
 * URL. Older rows could in principle hold a full URL, so reads must cope.
 */
export function isStoragePath(value) {
  if (!value || typeof value !== "string") return false;
  if (/^https?:\/\//i.test(value)) return false;
  return value.startsWith("shared/") || value.startsWith("personal/");
}

/**
 * The owner encoded in a storage path.
 * Used to check that a caller may delete a given object.
 */
export function ownerOfPath(path) {
  if (!isStoragePath(path)) return null;
  const parts = path.split("/");
  return parts.length >= 3 ? parts[1] : null;
}
