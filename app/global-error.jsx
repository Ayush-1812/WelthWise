"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown by the root layout itself.
 *
 * app/layout.tsx renders <Header/>, which calls checkUser() and therefore
 * touches the database on every single route. A throw there happens *above*
 * app/error.jsx, so this is the only boundary that can catch it.
 *
 * It ships its own <html>/<body> because the layout that normally provides
 * them is the thing that failed, and it deliberately uses inline styles with no
 * imports - if the failure is in the design system or globals.css, a styled
 * fallback would fail too.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("Root layout error:", error?.digest ?? error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fff",
          color: "#111827",
        }}
      >
        <div style={{ maxWidth: "32rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.75rem" }}>
            WealthWise is unavailable
          </h1>
          <p style={{ color: "#4b5563", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            The application could not start. This usually means the database is
            unreachable or a required environment variable is missing.
          </p>
          {error?.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#9ca3af",
                marginBottom: "1.5rem",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: "#9333ea",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
