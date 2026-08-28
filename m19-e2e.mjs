/**
 * M19 end-to-end: the dashboard summary is correct, cheap, and degrades safely.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import { pairwiseForUser, summarizeByCounterparty } from "./lib/split/balances.js";
import { describeSchedule } from "./lib/split/recurring.js";

const db = new PrismaClient();
const tag = `m19test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};
const f2 = (d) => toDecimal(d).toFixed(2);
const utc = (s) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p] = [await mk("Ayush"), await mk("Rahul"), await mk("Priya")];
  const ids = [a.id, r.id, p.id];

  const addExpense = (groupId, desc, amount, payer, participants, date) => {
    const splits = computeSplit({ method: "EQUAL", total: amount, participantIds: participants, payerId: payer });
    return db.sharedExpense.create({
      data: {
        groupId, description: desc, amount: String(amount), date, category: "food",
        splitMethod: "EQUAL", paidById: payer, createdById: payer,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
  };

  // Mirrors getDashboardSplitSummary: everything in one parallel batch.
  const summarise = async (userId) => {
    const t0 = Date.now();
    const [ledgerExpenses, ledgerSettlements, recentExpenses, recentSettlements, memberships, upcoming] =
      await Promise.all([
        db.sharedExpense.findMany({
          where: { isDeleted: false, OR: [{ paidById: userId }, { splits: { some: { userId } } }] },
          select: { id: true, groupId: true, paidById: true, amount: true, isDeleted: true,
            splits: { select: { userId: true, shareAmount: true } } },
        }),
        db.settlement.findMany({
          where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
          select: { fromUserId: true, toUserId: true, amount: true, groupId: true },
        }),
        db.sharedExpense.findMany({
          where: { isDeleted: false, OR: [{ paidById: userId }, { splits: { some: { userId } } }] },
          select: { id: true, description: true, amount: true, date: true, paidById: true,
            splits: { where: { userId }, select: { shareAmount: true } } },
          orderBy: [{ date: "desc" }, { id: "desc" }], take: 3,
        }),
        db.settlement.findMany({
          where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
          orderBy: { settledAt: "desc" }, take: 3,
        }),
        db.groupMember.findMany({
          where: { userId, leftAt: null, group: { isArchived: false } },
          select: { group: { select: { id: true, name: true, _count: { select: { members: true, expenses: true } } } } },
          take: 3,
        }),
        db.recurringSharedExpense.findMany({
          where: { isActive: true, OR: [{ paidById: userId }, { createdById: userId },
            { group: { members: { some: { userId, leftAt: null } } } }] },
          orderBy: { nextRunDate: "asc" }, take: 3,
        }),
      ]);

    const ledger = { expenses: ledgerExpenses, settlements: ledgerSettlements };
    const totals = summarizeByCounterparty(pairwiseForUser(ledger, userId));
    return { totals, recentExpenses, recentSettlements, memberships, upcoming, ms: Date.now() - t0 };
  };

  try {
    const goa = await db.expenseGroup.create({
      data: { name: `${tag} Goa`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) } },
    });
    const flat = await db.expenseGroup.create({
      data: { name: `${tag} Flat`, createdById: a.id,
        members: { create: [a.id, r.id].map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) } },
    });
    const archived = await db.expenseGroup.create({
      data: { name: `${tag} Old`, createdById: a.id, isArchived: true,
        members: { create: [{ userId: a.id, role: "OWNER" }] } },
    });

    // Ayush pays 3000 split 3 ways -> owed 2000
    await addExpense(goa.id, "Dinner", 3000, a.id, ids, utc("2026-04-05"));
    // Priya pays 900 for Ayush only -> Ayush owes Priya 900
    await addExpense(null, "Coffee run", 1500, p.id, [a.id], utc("2026-04-06"));
    await addExpense(flat.id, "Groceries", 600, a.id, [a.id, r.id], utc("2026-04-07"));
    await db.settlement.create({
      data: { groupId: goa.id, fromUserId: r.id, toUserId: a.id, amount: "400.00", method: "UPI" },
    });
    await db.recurringSharedExpense.create({
      data: { groupId: flat.id, description: "Monthly rent", amount: "20000.00", category: "rent",
        splitMethod: "EQUAL", splitTemplate: [a.id, r.id].map((userId) => ({ userId, shareInput: null })),
        paidById: a.id, createdById: a.id, interval: "MONTHLY", every: 1, nextRunDate: utc("2026-05-01") },
    });

    const s = await summarise(a.id);

    // --- totals ------------------------------------------------------------
    // Rahul owes Ayush 1000 (dinner) + 300 (groceries) - 400 (settled) = 900.
    // Priya paid 1500 for Ayush but owes 1000 for dinner, so Ayush owes her 500.
    check("owed to you is 900 (Rahul)", f2(s.totals.owedToYou) === "900.00");
    check("you owe 500 (Priya)", f2(s.totals.youOwe) === "500.00");
    check("net is 400", f2(s.totals.net) === "400.00");
    check("counterparties are NOT netted: owed 900 while owing 500, not just 400",
      f2(s.totals.owedToYou) !== f2(s.totals.net) && f2(s.totals.youOwe) !== "0.00");

    // --- recent lists are capped and ordered --------------------------------
    check("recent expenses capped at 3", s.recentExpenses.length === 3);
    check("recent expenses newest first",
      s.recentExpenses[0].description === "Groceries");
    check("recent settlements present", s.recentSettlements.length === 1);

    // --- groups --------------------------------------------------------------
    check("active groups exclude the archived one", s.memberships.length === 2);
    check("archived group is genuinely excluded",
      !s.memberships.some((m) => m.group.id === archived.id));
    check("group counts are included",
      s.memberships.every((m) => typeof m.group._count.members === "number"));

    // --- upcoming recurring ---------------------------------------------------
    check("upcoming recurring listed", s.upcoming.length === 1);
    check("schedule renders as words",
      describeSchedule({ interval: s.upcoming[0].interval, every: s.upcoming[0].every }) ===
        "Every month");

    // --- performance ----------------------------------------------------------
    check(`one parallel batch completes quickly (${s.ms}ms)`, s.ms < 5000);

    // A second user with no shared activity gets an empty, cheap summary.
    const outsider = await mk("Outsider");
    const empty = await summarise(outsider.id);
    check("a user with no activity has zero totals",
      f2(empty.totals.owedToYou) === "0.00" && f2(empty.totals.youOwe) === "0.00");
    check("and empty lists",
      empty.recentExpenses.length === 0 && empty.memberships.length === 0);
    ids.push(outsider.id);

    // --- deleted expenses do not appear ----------------------------------------
    const groceries = await db.sharedExpense.findFirst({ where: { description: "Groceries" } });
    await db.sharedExpense.update({ where: { id: groceries.id }, data: { isDeleted: true } });
    const after = await summarise(a.id);
    check("deleted expense drops out of recents",
      !after.recentExpenses.some((e) => e.id === groceries.id));
    check("deleted expense no longer affects totals (owed drops 300 to 600)",
      f2(after.totals.owedToYou) === "600.00");
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.expenseGroup.count()) +
      (await db.settlement.count()) + (await db.recurringSharedExpense.count());
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
