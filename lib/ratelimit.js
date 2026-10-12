import "server-only";

import arcjet, { tokenBucket, request } from "@arcjet/next";

/**
 * Rate limits for the Split Expenses mutations.
 *
 * lib/arcjet.js holds a single 10-per-hour bucket sized for account and
 * transaction creation. The split module writes far more often in normal use -
 * entering five expenses after a trip is not abuse - so charging those writes
 * to that bucket would lock honest users out of their own ledger. These are
 * separate buckets with their own budgets.
 *
 * Every limiter FAILS OPEN. If ARCJET_KEY is unset or Arcjet is unreachable,
 * the action proceeds and the reason is logged. A rate limiter that takes the
 * ledger offline when it breaks is worse than no rate limiter at all.
 */

const LIMITS = {
  /** Ordinary ledger writes: expenses, settlements, group and friend changes. */
  write: { refillRate: 60, interval: 3600, capacity: 60 },
  /**
   * Invite links mint random tokens that grant entry to a group's ledger, and
   * redemption is reachable by anyone holding a link. Both halves stay tight.
   */
  invite: { refillRate: 10, interval: 3600, capacity: 10 },
};

/** One Arcjet client per bucket, built on first use. */
const clients = new Map();

function clientFor(kind) {
  if (!clients.has(kind)) {
    clients.set(
      kind,
      arcjet({
        key: process.env.ARCJET_KEY,
        characteristics: ["userId"],
        rules: [tokenBucket({ mode: "LIVE", ...LIMITS[kind] })],
      })
    );
  }
  return clients.get(kind);
}

export class RateLimitError extends Error {
  constructor(message) {
    super(message ?? "Too many requests. Please try again in a few minutes.");
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
  }
}

/**
 * Charge one token against `userId`'s bucket.
 *
 * @param {"write"|"invite"} kind which bucket to charge
 * @param {string} userId the WealthWise user id (not the Clerk id - the
 *   characteristic only has to be stable, and this is the id every caller
 *   already holds)
 * @throws {RateLimitError} when the bucket is empty
 */
export async function assertWithinRateLimit(kind, userId) {
  if (!process.env.ARCJET_KEY) return;

  let decision;
  try {
    decision = await clientFor(kind).protect(await request(), {
      userId,
      requested: 1,
    });
  } catch (error) {
    // Unreachable or misconfigured: fail open, but say so.
    console.error("Rate limit check failed open:", error?.message ?? error);
    return;
  }

  if (!decision.isDenied()) return;

  if (decision.reason.isRateLimit()) {
    const { remaining, reset } = decision.reason;
    console.error({
      code: "RATE_LIMIT_EXCEEDED",
      bucket: kind,
      details: { remaining, resetInSeconds: reset },
    });
    throw new RateLimitError();
  }

  throw new RateLimitError("Request blocked.");
}
