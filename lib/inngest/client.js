import { Inngest } from "inngest";

/**
 * Client used to send and receive events.
 *
 * Retries are configured per function, not here. The client accepts no retry
 * option, so the `retryFunction` that used to sit here (exponential backoff,
 * maxAttempts: 2) was silently ignored by the SDK, and so was `name`. Every
 * function in lib/inngest/functions.js therefore runs on Inngest's defaults:
 * up to 4 retries with exponential backoff. Steps are memoized, so a retry
 * re-runs only the step that failed - a monthly report that emailed user #49
 * and then failed on user #50 does not email #49 again.
 *
 * To change retry behaviour, set `retries` in a function's own config.
 */
export const inngest = new Inngest({ id: "welthwise" });
