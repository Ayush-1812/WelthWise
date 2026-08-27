import { PrismaClient } from "@prisma/client";
import { computeSplit, validateSplit } from "./lib/split/engine.js";
import { computeNetBalances, balancesSumToZero } from "./lib/split/balances.js";

const db = new PrismaClient();
const tag = `m11test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};
const f2 = (d) => d.toFixed(2);

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p] = [await mk("ayush"), await mk("rahul"), await mk("priya")];
  const ids = [a.id, r.id, p.id];

  const groupLedger = async (groupId) => ({
    expenses: await db.sharedExpense.findMany({
      where: { groupId, isDeleted: false },
      select: { id: true, paidById: true, amount: true, isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } } },
    }),
    settlements: await db.settlement.findMany({
      where: { groupId },
      select: { fromUserId: true, toUserId: true, amount: true },
    }),
  });

  // Mirrors the transaction inside updateSharedExpense.
  const editExpense = async (expenseId, { amount, payerId, participantIds, method = "EQUAL", values }) => {
    const splits = computeSplit({ method, total: amount, participantIds, payerId, values });
    if (!validateSplit(amount, splits).ok) throw new Error("split invalid");
    return db.$transaction(async (tx) => {
      await tx.expenseSplit.deleteMany({ where: { expenseId } });
      const updated = await tx.sharedExpense.update({
        where: { id: expenseId },
        data: {
          amount: String(amount),
          paidById: payerId,
          splitMethod: method,
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              shareAmount: s.shareAmount.toFixed(2),
              shareInput: s.shareInput ? s.shareInput.toString() : null,
            })),
          },
        },
        include: { splits: true },
      });
      await tx.sharedExpenseActivity.create({
        data: { groupId: updated.groupId, actorId: a.id, type: "EXPENSE_EDITED",
          expenseId, metadata: { newAmount: String(amount) } },
      });
      return updated;
    });
  };

  try {
    const group = await db.expenseGroup.create({
      data: {
        name: `${tag} Goa`,
        createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });

    const splits = computeSplit({ method: "EQUAL", total: 3000, participantIds: ids, payerId: a.id });
    const expense = await db.sharedExpense.create({
      data: {
        groupId: group.id, description: "Dinner", amount: "3000.00", date: new Date(),
        category: "food", splitMethod: "EQUAL", paidById: a.id, createdById: a.id,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });

    let net = computeNetBalances(await groupLedger(group.id));
    check("start: Ayush +2000, Rahul -1000",
      f2(net.get(a.id)) === "2000.00" && f2(net.get(r.id)) === "-1000.00");

    // --- edit the amount -------------------------------------------------
    await editExpense(expense.id, { amount: 900, payerId: a.id, participantIds: ids });
    net = computeNetBalances(await groupLedger(group.id));
    check("after amount edit: Ayush +600", f2(net.get(a.id)) === "600.00");
    check("after amount edit: Rahul -300", f2(net.get(r.id)) === "-300.00");
    check("still sums to zero", balancesSumToZero(await groupLedger(group.id)));
    check("split rows replaced, not duplicated",
      (await db.expenseSplit.count({ where: { expenseId: expense.id } })) === 3);

    // --- change the payer -------------------------------------------------
    await editExpense(expense.id, { amount: 900, payerId: r.id, participantIds: ids });
    net = computeNetBalances(await groupLedger(group.id));
    check("after payer change: Rahul now +600", f2(net.get(r.id)) === "600.00");
    check("after payer change: Ayush now -300", f2(net.get(a.id)) === "-300.00");
    check("still sums to zero", balancesSumToZero(await groupLedger(group.id)));

    // --- change participants (drop Priya) ---------------------------------
    await editExpense(expense.id, { amount: 900, payerId: r.id, participantIds: [a.id, r.id] });
    net = computeNetBalances(await groupLedger(group.id));
    check("dropped participant has no balance",
      net.get(p.id) === undefined || net.get(p.id).isZero());
    check("Rahul +450 after dropping Priya", f2(net.get(r.id)) === "450.00");
    check("split rows now 2",
      (await db.expenseSplit.count({ where: { expenseId: expense.id } })) === 2);
    check("still sums to zero", balancesSumToZero(await groupLedger(group.id)));

    // --- change split method to PERCENTAGE --------------------------------
    await editExpense(expense.id, {
      amount: 900, payerId: r.id, participantIds: [a.id, r.id],
      method: "PERCENTAGE", values: { [a.id]: 70, [r.id]: 30 },
    });
    net = computeNetBalances(await groupLedger(group.id));
    check("70/30 percentage edit: Ayush owes 630", f2(net.get(a.id)) === "-630.00");
    check("shareInput preserved on edit",
      (await db.expenseSplit.findFirst({ where: { expenseId: expense.id, userId: a.id } })).shareInput.toString() === "70");
    check("still sums to zero", balancesSumToZero(await groupLedger(group.id)));

    // --- snapshot, add, delete, confirm full reversal ----------------------
    const beforeExtra = computeNetBalances(await groupLedger(group.id));
    const snap = JSON.stringify([...beforeExtra.entries()].map(([k, v]) => [k, f2(v)]).sort());

    const extraSplits = computeSplit({ method: "EQUAL", total: 600, participantIds: ids, payerId: p.id });
    const extra = await db.sharedExpense.create({
      data: {
        groupId: group.id, description: "Snacks", amount: "600.00", date: new Date(),
        category: "food", splitMethod: "EQUAL", paidById: p.id, createdById: p.id,
        splits: { create: extraSplits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
    const during = computeNetBalances(await groupLedger(group.id));
    check("adding an expense moves balances",
      JSON.stringify([...during.entries()].map(([k, v]) => [k, f2(v)]).sort()) !== snap);

    await db.$transaction(async (tx) => {
      await tx.sharedExpense.update({
        where: { id: extra.id }, data: { isDeleted: true, deletedAt: new Date() },
      });
      await tx.sharedExpenseActivity.create({
        data: { groupId: group.id, actorId: p.id, type: "EXPENSE_DELETED",
          expenseId: extra.id, metadata: { amount: "600.00" } },
      });
    });

    const after = computeNetBalances(await groupLedger(group.id));
    check("delete fully reverses the effect on every balance",
      JSON.stringify([...after.entries()].map(([k, v]) => [k, f2(v)]).sort()) === snap);
    check("deleted row and its splits are kept",
      (await db.sharedExpense.findUnique({ where: { id: extra.id } })) !== null &&
      (await db.expenseSplit.count({ where: { expenseId: extra.id } })) === 3);
    check("still sums to zero after delete", balancesSumToZero(await groupLedger(group.id)));

    // --- activity rows ------------------------------------------------------
    const edits = await db.sharedExpenseActivity.count({ where: { groupId: group.id, type: "EXPENSE_EDITED" } });
    const dels = await db.sharedExpenseActivity.count({ where: { groupId: group.id, type: "EXPENSE_DELETED" } });
    check("EXPENSE_EDITED activity rows written", edits >= 4);
    check("EXPENSE_DELETED activity row written", dels === 1);

    // --- atomicity ----------------------------------------------------------
    const before = await db.expenseSplit.count({ where: { expenseId: expense.id } });
    let threw = false;
    try {
      await db.$transaction(async (tx) => {
        await tx.expenseSplit.deleteMany({ where: { expenseId: expense.id } });
        throw new Error("simulated failure after deleting splits");
      });
    } catch { threw = true; }
    const stillThere = await db.expenseSplit.count({ where: { expenseId: expense.id } });
    check("failed edit threw", threw);
    check("rollback restored the splits", before === stillThere && stillThere > 0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.sharedExpense.count()) + (await db.expenseSplit.count()) +
      (await db.expenseGroup.count()) + (await db.sharedExpenseActivity.count());
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
