/**
 * Safety catch for the end-to-end scripts in this folder.
 *
 * Each script creates users, groups, expenses and settlements, then deletes
 * what it created - in whatever database DATABASE_URL points at. There is no
 * separate test database, so by default that is the live one, and a script
 * that crashes between its inserts and its cleanup leaves its rows behind.
 *
 * Imported first by every script, this stops the run unless the caller has
 * explicitly opted in:
 *
 *   E2E_ALLOW_WRITES=1 node scripts/e2e/m13-e2e.mjs
 *
 * Point DATABASE_URL at a disposable database before doing that.
 */

if (process.env.E2E_ALLOW_WRITES !== "1") {
  console.error(
    [
      "Refusing to run: this e2e script writes to the database in DATABASE_URL.",
      "Point DATABASE_URL at a disposable database, then re-run with",
      "  E2E_ALLOW_WRITES=1 node <script>",
    ].join("\n")
  );
  process.exit(1);
}
