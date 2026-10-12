"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * The personal-finance actions in actions/*.js signal failure by throwing
 * ("Unauthorized", "User not found", an unreachable database). A throw inside a
 * Server Component with no boundary above it renders Next's raw error screen,
 * so every one of those failures used to look like a crash. This is that
 * boundary: the header and footer survive, the user gets an explanation, and
 * `reset()` re-runs the failed render instead of forcing a full reload.
 */
export default function RouteError({ error, reset }) {
  useEffect(() => {
    // Production builds strip the message before it reaches the client, so the
    // digest is the only handle that ties this screen to the server log.
    console.error("Route error:", error?.digest ?? error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="gradient-title mb-4 text-5xl font-bold">
        Something went wrong
      </h1>
      <p className="mb-2 max-w-md text-gray-600">
        We could not load this page. This is usually a temporary problem
        reaching the database, and trying again often clears it.
      </p>

      {process.env.NODE_ENV !== "production" && error?.message && (
        <pre className="mb-4 max-w-xl overflow-x-auto rounded-lg bg-gray-100 p-3 text-left font-mono text-xs text-gray-700">
          {error.message}
        </pre>
      )}

      {error?.digest && (
        <p className="mb-8 font-mono text-xs text-gray-400">
          Reference: {error.digest}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
