/**
 * M12 end-to-end: the personal-finance separation.
 * Verifies the exact scenario from task.md / spec #14 against the live DB.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import {
  personalEntriesForExpense,
  personalEntryForSettlement,
} from "./lib/split/personal.js";

const db = new PrismaClient();
const tag = `m12test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};
const f2 = (d) => toDecimal(d).toFixed(2);

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p, q] = [await mk("ayush"), await mk("rahul"), await mk("priya"), await mk("aman")];
  const ids = [a.id, r.id, p.id, q.id];

  const account = await db.account.create({
    data: { name: `${tag} Main`, type: "CURRENT", balance: "10000.00", isDefault: true, userId: a.id },
  });

  // Mirrors syncExpenseToPersonal / syncSettlementToPersonal.
  const writeEntries = async (tx, entries, userId, accountId, link) => {
    let delta = toDecimal(0);
    for (const e of entries) {
      await tx.transaction.create({
        data: {
          type: e.type, amount: e.amount.toFixed(2), description: e.description,
          date: e.date, category: e.category, isTransfer: e.isTransfer,
          userId, accountId, ...link,
        },
      });
      delta = e.type === "EXPENSE" ? delta.minus(e.amount) : delta.plus(e.amount);
    }
    await tx.account.update({
      where: { id: accountId }, data: { balance: { increment: delta.toNumber() } },
    });
  };

  const balance = async () =>
    (await db.account.findUnique({ where: { id: account.id } })).balance;

  // Personal spending, the way analytics now query it.
  const spending = async () => {
    const agg = await db.transaction.aggregate({
      where: { userId: a.id, type: "EXPENSE", isTransfer: false },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? toDecimal(0);
  };
  const income = async () => {
    const agg = await db.transaction.aggregate({
      where: { userId: a.id, type: "INCOME", isTransfer: false },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? toDecimal(0);
  };

  try {
    const group = await db.expenseGroup.create({
      data: {
        name: `${tag} Trip`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });

    check("starting balance 10000", f2(await balance()) === "10000.00");
    check("starting spending 0", f2(await spending()) === "0.00");

    // === Ayush pays a 4000 hotel bill, split 4 ways -> his share is 1000 ===
    const splits = computeSplit({ method: "EQUAL", total: 4000, participantIds: ids, payerId: a.id });
    const myShare = splits.find((s) => s.userId === a.id).shareAmount;
    check("his share is 1000", f2(myShare) === "1000.00");

    const expense = await db.$transaction(async (tx) => {
      const created = await tx.sharedExpense.create({
        data: {
          groupId: group.id, description: "Hotel", amount: "4000.00", date: new Date(),
          category: "travel", splitMethod: "EQUAL", paidById: a.id, createdById: a.id,
          splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
        },
      });
      const entries = personalEntriesForExpense({
        myUserId: a.id, paidById: a.id, amount: "4000.00", myShare,
        description: "Hotel", category: "travel", date: new Date(),
      });
      await writeEntries(tx, entries, a.id, account.id, { sharedExpenseId: created.id });
      return created;
    });

    // --- THE THREE FIGURES THAT MUST STAY DISTINCT ---
    check("cash out: balance moved by the full 4000 -> 6000", f2(await balance()) === "6000.00");
    check("personal spending counted only his 1000 share", f2(await spending()) === "1000.00");

    const receivable = await db.transaction.findFirst({
      where: { sharedExpenseId: expense.id, isTransfer: true },
    });
    check("recoverable 3000 recorded as a transfer, not spending",
      receivable !== null && f2(receivable.amount) === "3000.00");

    check("two linked personal rows exist",
      (await db.transaction.count({ where: { sharedExpenseId: expense.id } })) === 2);

    // A naive implementation would report 4000 here.
    const naive = await db.transaction.aggregate({
      where: { userId: a.id, type: "EXPENSE" }, _sum: { amount: true },
    });
    check("without the isTransfer filter it would report 4000 (the bug this prevents)",
      f2(naive._sum.amount) === "4000.00");

    // Non-payers record nothing personally.
    check("non-payers have no personal transaction",
      (await db.transaction.count({ where: { userId: { in: [r.id, p.id, q.id] } } })) === 0);

    // === Rahul pays back his 1000 ===
    const settlement = await db.$transaction(async (tx) => {
      const s = await tx.settlement.create({
        data: { groupId: group.id, fromUserId: r.id, toUserId: a.id, amount: "1000.00", method: "UPI" },
      });
      const entry = personalEntryForSettlement({
        myUserId: a.id, fromUserId: r.id, toUserId: a.id, amount: "1000.00",
        counterpartyName: "rahul", date: new Date(),
      });
      await writeEntries(tx, [entry], a.id, account.id, { settlementId: s.id });
      return s;
    });

    check("repayment restored the balance -> 7000", f2(await balance()) === "7000.00");
    check("repayment added ZERO income", f2(await income()) === "0.00");
    check("spending is still exactly 1000", f2(await spending()) === "1000.00");

    const settleRow = await db.transaction.findFirst({ where: { settlementId: settlement.id } });
    check("settlement row is INCOME but flagged as a transfer",
      settleRow.type === "INCOME" && settleRow.isTransfer === true);

    // === Everyone pays back: balance -1000 net, spending still 1000 ===
    for (const other of [p, q]) {
      await db.$transaction(async (tx) => {
        const s = await tx.settlement.create({
          data: { groupId: group.id, fromUserId: other.id, toUserId: a.id, amount: "1000.00", method: "UPI" },
        });
        const entry = personalEntryForSettlement({
          myUserId: a.id, fromUserId: other.id, toUserId: a.id, amount: "1000.00",
          counterpartyName: other.name, date: new Date(),
        });
        await writeEntries(tx, [entry], a.id, account.id, { settlementId: s.id });
      });
    }

    check("fully repaid: balance is 9000 (only his own 1000 really left)",
      f2(await balance()) === "9000.00");
    check("spending still exactly his 1000 share", f2(await spending()) === "1000.00");
    check("total income still zero", f2(await income()) === "0.00");

    // === Monthly report / budget queries see the right number ===
    const monthly = await db.transaction.findMany({
      where: { userId: a.id, isTransfer: false },
    });
    const totalExp = monthly.filter((t) => t.type === "EXPENSE")
      .reduce((s, t) => s.plus(toDecimal(t.amount)), toDecimal(0));
    const totalInc = monthly.filter((t) => t.type === "INCOME")
      .reduce((s, t) => s.plus(toDecimal(t.amount)), toDecimal(0));
    check("monthly report expenses = 1000", f2(totalExp) === "1000.00");
    check("monthly report income = 0", f2(totalInc) === "0.00");
    check("category is the real one (travel), not the receivable bucket",
      monthly.find((t) => t.type === "EXPENSE").category === "travel");

    // === Deleting the shared expense reverses the personal side too ===
    await db.$transaction(async (tx) => {
      const linked = await tx.transaction.findMany({ where: { sharedExpenseId: expense.id, userId: a.id } });
      let delta = toDecimal(0);
      for (const row of linked) {
        delta = row.type === "EXPENSE" ? delta.plus(toDecimal(row.amount)) : delta.minus(toDecimal(row.amount));
      }
      await tx.transaction.deleteMany({ where: { sharedExpenseId: expense.id, userId: a.id } });
      await tx.account.update({ where: { id: account.id }, data: { balance: { increment: delta.toNumber() } } });
      await tx.sharedExpense.update({ where: { id: expense.id }, data: { isDeleted: true, deletedAt: new Date() } });
    });

    check("deleting the expense removed its personal rows",
      (await db.transaction.count({ where: { sharedExpenseId: expense.id } })) === 0);
    check("spending back to 0 after delete", f2(await spending()) === "0.00");
    check("balance reflects only the 3 repayments received -> 13000",
      f2(await balance()) === "13000.00");
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    // Scope the check to test data - the database also holds real rows.
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.settlement.count()) +
      (await db.expenseGroup.count());
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
