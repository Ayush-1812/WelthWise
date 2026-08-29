/**
 * M23 end-to-end: shared analytics stay separate from personal finance, and
 * settlements are never counted as spending.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal, sum } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import {
  buildAnalytics,
  userTotals,
  totalSpending,
  spendingByMember,
} from "./lib/split/analytics.js";
import { filterLedgerByCurrency, currenciesIn } from "./lib/split/currency.js";

const db = new PrismaClient();
const tag = `m23test-${Date.now()}`;
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

  const addExpense = (groupId, desc, amount, payer, participants, category, date, currency = "INR") => {
    const splits = computeSplit({ method: "EQUAL", total: amount, participantIds: participants, payerId: payer });
    return db.sharedExpense.create({
      data: {
        groupId, description: desc, amount: String(amount), currency, date, category,
        splitMethod: "EQUAL", paidById: payer, createdById: payer,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
  };

  const loadLedger = async (where) => ({
    expenses: await db.sharedExpense.findMany({
      where,
      select: { id: true, paidById: true, amount: true, currency: true, category: true,
        date: true, isDeleted: true, splits: { select: { userId: true, shareAmount: true } } },
    }),
    settlements: await db.settlement.findMany({
      where: where.groupId ? { groupId: where.groupId } : {},
      select: { fromUserId: true, toUserId: true, amount: true, currency: true },
    }),
  });

  try {
    const group = await db.expenseGroup.create({
      data: { name: `${tag} Goa`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) } },
    });

    // Ayush fronts 3000 for dinner (his share 1000), Rahul pays 900 for hotel.
    await addExpense(group.id, "Dinner", 3000, a.id, ids, "food", utc("2026-04-05"));
    await addExpense(group.id, "Hotel", 900, r.id, ids, "hotel", utc("2026-05-10"));

    let ledger = await loadLedger({ groupId: group.id, isDeleted: false });
    let analytics = buildAnalytics(ledger);

    // --- total spending -----------------------------------------------------
    check("total spending is 3900", f2(analytics.totalSpending) === "3900.00");
    check("expense count is 2", analytics.expenseCount === 2);

    // --- THE CORE RULE: a settlement must not inflate spending ---------------
    await db.settlement.create({
      data: { groupId: group.id, fromUserId: r.id, toUserId: a.id, amount: "1000.00", method: "UPI" },
    });
    ledger = await loadLedger({ groupId: group.id, isDeleted: false });
    analytics = buildAnalytics(ledger);
    check("a 1000 repayment did NOT change total spending",
      f2(analytics.totalSpending) === "3900.00");
    check("expense count unchanged by the settlement", analytics.expenseCount === 2);

    // --- by member: share, not amount fronted --------------------------------
    const byMember = Object.fromEntries(analytics.byMember.map((m) => [m.userId, f2(m.amount)]));
    check("Ayush's spending is his 1300 share, not the 3000 he fronted",
      byMember[a.id] === "1300.00");
    check("every member spent the same 1300", byMember[r.id] === "1300.00" && byMember[p.id] === "1300.00");
    check("member shares reconcile with total spending",
      f2(sum(analytics.byMember.map((m) => m.amount))) === "3900.00");

    // --- by category ----------------------------------------------------------
    const byCategory = Object.fromEntries(analytics.byCategory.map((c) => [c.category, f2(c.amount)]));
    check("food category is 3000", byCategory.food === "3000.00");
    check("hotel category is 900", byCategory.hotel === "900.00");
    check("category totals reconcile with total spending",
      f2(sum(analytics.byCategory.map((c) => c.amount))) === "3900.00");
    check("categories sorted largest first", analytics.byCategory[0].category === "food");

    // --- over time -------------------------------------------------------------
    check("two monthly buckets", analytics.overTime.length === 2);
    check("chronological", analytics.overTime[0].period === "2026-04");
    check("April bucket is 3000", f2(analytics.overTime[0].amount) === "3000.00");

    // --- user totals: the four figures stay distinct ---------------------------
    const t = userTotals(a.id, ledger);
    check("Ayush paid 3000 (cash out, unchanged by repayment)", f2(t.totalPaid) === "3000.00");
    check("Ayush spent 1300 (his own share)", f2(t.totalSpent) === "1300.00");
    check("Ayush recovered 1000", f2(t.totalRecovered) === "1000.00");
    check("paid and spent are different numbers", f2(t.totalPaid) !== f2(t.totalSpent));

    // --- separate from personal finance ----------------------------------------
    const personalRows = await db.transaction.count({ where: { userId: { in: ids } } });
    check("analytics created zero personal Transaction rows", personalRows === 0);

    // --- deleted expenses drop out ----------------------------------------------
    const hotel = await db.sharedExpense.findFirst({ where: { description: "Hotel" } });
    await db.sharedExpense.update({ where: { id: hotel.id }, data: { isDeleted: true } });
    const afterDelete = buildAnalytics(await loadLedger({ groupId: group.id, isDeleted: false }));
    check("deleting an expense drops it from spending",
      f2(afterDelete.totalSpending) === "3000.00");
    check("and from the category breakdown",
      !afterDelete.byCategory.some((c) => c.category === "hotel"));
    await db.sharedExpense.update({ where: { id: hotel.id }, data: { isDeleted: false } });

    // --- mixed currency is scoped, never summed ---------------------------------
    await addExpense(group.id, "Duty free", 200, a.id, ids, "shopping", utc("2026-05-20"), "USD");
    ledger = await loadLedger({ groupId: group.id, isDeleted: false });
    check("group now spans two currencies", currenciesIn(ledger).size === 2);

    const inrOnly = buildAnalytics(filterLedgerByCurrency(ledger, "INR"));
    const usdOnly = buildAnalytics(filterLedgerByCurrency(ledger, "USD"));
    check("INR analytics unaffected by the USD expense",
      f2(inrOnly.totalSpending) === "3900.00");
    check("USD analytics reported separately", f2(usdOnly.totalSpending) === "200.00");
    check("the two are never added into 4100",
      f2(inrOnly.totalSpending) !== "4100.00" && f2(usdOnly.totalSpending) !== "4100.00");
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.expenseGroup.count()) +
      (await db.settlement.count());
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
