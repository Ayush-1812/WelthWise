/**
 * M18 end-to-end: filtering and pagination happen in the database, and access
 * scoping can never be widened by a filter.
 */
import { PrismaClient } from "@prisma/client";
import { computeSplit } from "./lib/split/engine.js";
import {
  normalizeFilters,
  buildExpenseWhere,
  EXPENSE_ORDER,
} from "./lib/split/filters.js";

const db = new PrismaClient();
const tag = `m18test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};
const utc = (s) => new Date(`${s}T00:00:00.000Z`);

const query = (filters, userId, extra = {}) =>
  db.sharedExpense.findMany({
    where: buildExpenseWhere(normalizeFilters(filters), userId),
    orderBy: EXPENSE_ORDER,
    ...extra,
  });

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p, outsider] = [
    await mk("Ayush"), await mk("Rahul"), await mk("Priya"), await mk("Outsider"),
  ];
  const ids = [a.id, r.id, p.id];

  const addExpense = (groupId, desc, amount, payer, participants, category, date, notes) => {
    const splits = computeSplit({ method: "EQUAL", total: amount, participantIds: participants, payerId: payer });
    return db.sharedExpense.create({
      data: {
        groupId, description: desc, amount: String(amount), date, category, notes,
        splitMethod: "EQUAL", paidById: payer, createdById: payer,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
  };

  try {
    const goa = await db.expenseGroup.create({
      data: {
        name: `${tag} Goa`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });
    const flat = await db.expenseGroup.create({
      data: {
        name: `${tag} Flat`, createdById: a.id,
        members: { create: [a.id, r.id].map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });

    await addExpense(goa.id, "Beach dinner", 3000, a.id, ids, "food", utc("2026-04-05"), "seafood platter");
    await addExpense(goa.id, "Hotel room", 12000, r.id, ids, "hotel", utc("2026-04-06"), null);
    await addExpense(goa.id, "Cab to airport", 800, p.id, [a.id, p.id], "transportation", utc("2026-04-10"), null);
    await addExpense(flat.id, "Monthly rent", 20000, a.id, [a.id, r.id], "rent", utc("2026-05-01"), null);
    await addExpense(null, "Coffee", 250, r.id, [a.id, r.id], "food", utc("2026-05-03"), null);
    // An expense between two other people that Ayush is not part of.
    const priv = await addExpense(null, "Private lunch", 500, r.id, [r.id, p.id], "food", utc("2026-05-04"), null);

    check("6 expenses seeded", (await db.sharedExpense.count()) === 6);

    // --- access scoping ----------------------------------------------------
    const mine = await query({}, a.id);
    check("Ayush sees 5 of 6 (not the private one)", mine.length === 5);
    check("the private expense is excluded", !mine.some((x) => x.id === priv.id));

    const none = await query({}, outsider.id);
    check("an unrelated user sees nothing", none.length === 0);

    // A filter must never widen visibility.
    const probing = await query({ personId: r.id }, outsider.id);
    check("filtering by a person does not leak to an outsider", probing.length === 0);

    // --- text search --------------------------------------------------------
    check("search by description",
      (await query({ q: "hotel" }, a.id)).length === 1);
    check("search is case-insensitive",
      (await query({ q: "HOTEL" }, a.id)).length === 1);
    check("search also covers notes",
      (await query({ q: "seafood" }, a.id)).length === 1);
    check("partial match works",
      (await query({ q: "cab" }, a.id)).length === 1);
    check("no match returns empty, not an error",
      (await query({ q: "zzzznothing" }, a.id)).length === 0);

    // --- group / person / category ------------------------------------------
    check("group filter", (await query({ groupId: goa.id }, a.id)).length === 3);
    check("person filter includes payer and participants",
      (await query({ personId: p.id }, a.id)).length === 3);
    check("category filter", (await query({ category: "food" }, a.id)).length === 2);

    // --- date range ----------------------------------------------------------
    check("date range",
      (await query({ from: "2026-04-01", to: "2026-04-30" }, a.id)).length === 3);
    check("open-ended from",
      (await query({ from: "2026-05-01" }, a.id)).length === 2);
    check("open-ended to",
      (await query({ to: "2026-04-06" }, a.id)).length === 2);

    // --- amount range --------------------------------------------------------
    check("min amount", (await query({ minAmount: "1000" }, a.id)).length === 3);
    check("max amount", (await query({ maxAmount: "1000" }, a.id)).length === 2);
    check("amount band",
      (await query({ minAmount: "500", maxAmount: "5000" }, a.id)).length === 2);

    // --- combined ------------------------------------------------------------
    const combined = await query(
      { groupId: goa.id, category: "food", minAmount: "1000" }, a.id);
    check("combined filters narrow correctly", combined.length === 1);
    check("combined result is the right row", combined[0].description === "Beach dinner");

    // --- ordering + cursor paging ---------------------------------------------
    const page1 = await query({}, a.id, { take: 3 });
    check("newest first", page1[0].description === "Coffee");
    const page2 = await query({}, a.id, { take: 3, cursor: { id: page1[2].id }, skip: 1 });
    check("second page has the remainder", page2.length === 2);
    check("no overlap between pages",
      !page2.some((x) => page1.some((y) => y.id === x.id)));
    check("pages cover everything exactly once",
      new Set([...page1, ...page2].map((x) => x.id)).size === 5);

    // --- deleted expenses never appear -----------------------------------------
    await db.sharedExpense.update({
      where: { id: (await db.sharedExpense.findFirst({ where: { description: "Coffee" } })).id },
      data: { isDeleted: true },
    });
    check("soft-deleted expenses are excluded", (await query({}, a.id)).length === 4);
    check("and excluded even when they match a filter",
      (await query({ q: "coffee" }, a.id)).length === 0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: [...ids, outsider.id] } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.expenseGroup.count());
    check("all test rows cleaned up", leftover === 0);
    await db.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  await db.user.deleteMany({ where: { clerkUserId: { startsWith: tag } } });
  await db.$disconnect();
  process.exit(1);
});
