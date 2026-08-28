"use client";

import { useRef, useState } from "react";
import { ExternalLink, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import useFetch from "@/hooks/use-fetch";
import {
  attachSharedExpenseReceipt,
  removeSharedExpenseReceipt,
  getSharedExpenseReceiptUrl,
} from "@/actions/split/receipts";
import {
  RECEIPT_ACCEPT_ATTR,
  MAX_RECEIPT_BYTES,
  formatBytes,
  validateReceipt,
} from "@/lib/split/receipts";

/**
 * Receipt attachment for a shared expense.
 *
 * The stored value is a private storage path, never a public URL, so viewing
 * fetches a short-lived signed URL on demand rather than embedding one in the
 * page.
 */
export function ReceiptPanel({ expenseId, hasReceipt, canEdit, storageConfigured }) {
  const inputRef = useRef(null);
  const [attached, setAttached] = useState(hasReceipt);

  const { loading: uploading, fn: runUpload } = useFetch(attachSharedExpenseReceipt);
  const { loading: removing, fn: runRemove } = useFetch(removeSharedExpenseReceipt);
  const { loading: opening, fn: runGetUrl } = useFetch(getSharedExpenseReceiptUrl);

  const busy = uploading || removing || opening;

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file
    if (!file) return;

    // Same rules the server enforces, so the failure is immediate.
    try {
      validateReceipt(file);
    } catch (e) {
      toast.error(e.message);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const result = await runUpload(expenseId, formData);
    if (result?.success) {
      setAttached(true);
      toast.success("Receipt attached");
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  const handleView = async () => {
    const result = await runGetUrl(expenseId);
    if (result?.success && result.data.url) {
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    } else {
      toast.error(result?.error ?? "Could not open the receipt");
    }
  };

  const handleRemove = async () => {
    if (!window.confirm("Remove this receipt?")) return;

    const result = await runRemove(expenseId);
    if (result?.success) {
      setAttached(false);
      toast.success("Receipt removed");
    } else if (result?.error) {
      toast.error(result.error);
    }
  };

  if (!storageConfigured) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        Receipt storage is not configured. Add{" "}
        <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env</code> to enable
        uploads.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={RECEIPT_ACCEPT_ATTR}
        className="hidden"
        onChange={handleFile}
      />

      {attached ? (
        <>
          <Button size="sm" variant="outline" onClick={handleView} disabled={busy}>
            {opening ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            View receipt
          </Button>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="mr-2 h-4 w-4" />
                )}
                Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={handleRemove}
                disabled={busy}
              >
                {removing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remove
              </Button>
            </>
          )}
        </>
      ) : canEdit ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="mr-2 h-4 w-4" />
            )}
            Attach receipt
          </Button>
          <span className="text-xs text-muted-foreground">
            JPEG, PNG, WebP, HEIC or PDF, up to {formatBytes(MAX_RECEIPT_BYTES)}
          </span>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No receipt attached.</p>
      )}
    </div>
  );
}

export default ReceiptPanel;
