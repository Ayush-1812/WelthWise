import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./prisma";

/**
 * Resolve the signed-in Clerk session to a WealthWise User row, creating that
 * row if this is the first request that has ever seen the account.
 *
 * Why this provisions instead of throwing:
 *
 * The User row is created just in time by checkUser(), which runs inside
 * <Header/> in the ROOT layout. The App Router renders layouts and pages
 * CONCURRENTLY, not in sequence, so a new user redirected from sign-up
 * straight to /dashboard can reach this lookup before the header's insert has
 * committed. Eleven call sites across actions/*.js each had their own
 * findUnique + `throw new Error("User not found")`, which turned that race into
 * a crash page. Provisioning here makes every entry point self-sufficient, so
 * the ordering stops mattering.
 *
 * The create-and-catch is the race fix. If two concurrent requests both miss
 * the read, Postgres lets exactly one insert win on the clerkUserId unique
 * index; the loser catches P2002 and reads the winner's row.
 */
/** Thrown when there is no Clerk session at all, tagged for callers to map. */
function unauthenticated() {
  const error = new Error("Unauthorized");
  error.code = "UNAUTHENTICATED";
  return error;
}

export async function ensureAppUser() {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw unauthenticated();
  }

  const existing = await db.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;

  // Only reached on the first request for an account, so the extra Clerk round
  // trip never touches the hot path.
  const clerkUser = await currentUser();

  if (!clerkUser) {
    throw unauthenticated();
  }

  const email = clerkUser.emailAddresses?.[0]?.emailAddress;

  if (!email) {
    // The column is NOT NULL and unique, so a placeholder would collide with
    // the next such signup rather than failing here.
    throw new Error("Your account has no email address on file");
  }

  // Joining the parts conditionally: the old checkUser() interpolated both
  // names unguarded and stored the literal string "null null" for a Clerk
  // account with no name set.
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

  try {
    return await db.user.create({
      data: { clerkUserId, email, name, imageUrl: clerkUser.imageUrl ?? null },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const won = await db.user.findUnique({ where: { clerkUserId } });
      if (won) return won;

      // The collision was on email, not clerkUserId: this address already
      // belongs to a different WealthWise row, which happens when a Clerk
      // account is deleted and recreated. Silently adopting that row would
      // hand the new session someone else's ledger.
      throw new Error(
        "An account already exists for this email address. Please contact support."
      );
    }
    throw error;
  }
}

/** Non-throwing variant for read paths that would rather render an empty state. */
export async function getAppUserOrNull() {
  try {
    return await ensureAppUser();
  } catch (error) {
    // Next probes server components for static renderability, and that probe
    // throws DYNAMIC_SERVER_USAGE. Swallowing it would hide the signal Next
    // needs to mark the route dynamic, and it is not a failure to report -
    // the same rethrow guards every fail() in actions/split/*.js.
    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;

    console.error("ensureAppUser failed:", error?.message ?? error);
    return null;
  }
}
