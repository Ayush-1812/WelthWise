/**
 * M13 end-to-end: debt simplification against a real group ledger.
 */
import { PrismaClient } from "@prisma/client";
import { computeSplit } from "./lib/split/engine.js";
import { computeNetBalances, computePairwiseBalances } from "./lib/split/balances.js";
import { buildSettlementPlan, preservesBalances } from "./lib/split/simplify.js";

const db = new PrismaClient();
const tag = `m13test-${Date.now()}`;
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
  const [a, b, c] = [await mk("alice"), await mk("bob"), await mk("carl")];
  const ids = [a.id, b.id, c.id];

  const ledgerOf = async (groupId) => ({
    expenses: await db.sharedExpense.findMany({
      where: { groupId, isDeleted: false },
      select: { id: true, paidById: true, amount: true, isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } } },
    }),
    settlements: await db.settlement.findMany({
      where: { groupId }, select: { fromUserId: true, toUserId: true, amount: true },
    }),
  });

  const addExpense = (groupId, desc, amount, payer, participants) => {
    const splits = computeSplit({ method: "EQUAL", total: amount, participantIds: participants, payerId: payer });
    return db.sharedExpense.create({
      data: {
        groupId, description: desc, amount: String(amount), date: new Date(),
        category: "food", splitMethod: "EQUAL", paidById: payer, createdById: payer,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
  };

  try {
    const group = await db.expenseGroup.create({
      data: {
        name: `${tag} Chain`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });

    // === the task.md example: A owes B 500, B owes C 500 ===
    // B paid 500 entirely for A  -> A owes B 500
    await addExpense(group.id, "For Alice", 500, b.id, [a.id]);
    // C paid 500 entirely for B  -> B owes C 500
    await addExpense(group.id, "For Bob", 500, c.id, [b.id]);

    let ledger = await ledgerOf(group.id);
    let balances = computeNetBalances(ledger);
    let pairs = computePairwiseBalances(ledger);

    check("raw plan needs 2 payments", pairs.length === 2);
    check("Alice -500", f2(balances.get(a.id)) === "-500.00");
    check("Bob nets to 0 (pure middleman)", balances.get(b.id).isZero());
    check("Carl +500", f2(balances.get(c.id)) === "500.00");

    const plan = buildSettlementPlan(balances, pairs);

    check("simplified to a single payment", plan.payments.length === 1);
    check("that payment is Alice -> Carl 500",
      plan.payments[0].fromUserId === a.id &&
      plan.payments[0].toUserId === c.id &&
      f2(plan.payments[0].amount) === "500.00");
    check("Bob drops out of the plan entirely",
      !plan.payments.some((p) => p.fromUserId === b.id || p.toUserId === b.id));
    check("plan preserves every balance", plan.verified);
    check("comparison reports 2 -> 1", plan.comparison.before === 2 && plan.comparison.after === 1);
    check("saved one payment", plan.comparison.saved === 1);

    // === the plan is a recommendation: nothing was written ===
    check("no settlements were created", (await db.settlement.count({ where: { groupId: group.id } })) === 0);
    check("ledger unchanged after simplifying",
      (await db.sharedExpense.count({ where: { groupId: group.id } })) === 2);
    const after = computeNetBalances(await ledgerOf(group.id));
    check("balances identical after simplifying",
      f2(after.get(a.id)) === "-500.00" && f2(after.get(c.id)) === "500.00");

    // === a messier ledger ===
    await addExpense(group.id, "Dinner", 900, a.id, ids);
    await addExpense(group.id, "Cab", 300, c.id, [a.id, b.id]);
    await db.settlement.create({
      data: { groupId: group.id, fromUserId: a.id, toUserId: c.id, amount: "100.00", method: "UPI" },
    });

    ledger = await ledgerOf(group.id);
    balances = computeNetBalances(ledger);
    pairs = computePairwiseBalances(ledger);
    const plan2 = buildSettlementPlan(balances, pairs);

    check("messy ledger: plan preserves balances", plan2.verified);
    check("messy ledger: verified independently",
      preservesBalances(balances, plan2.payments));
    check("messy ledger: payment count never increases",
      plan2.payments.length <= pairs.length);
    check("messy ledger: at most n-1 payments",
      plan2.payments.length <= [...balances.values()].filter((v) => !v.isZero()).length - 1);
    check("messy ledger: no self-payments or zero amounts",
      plan2.payments.every((p) => p.fromUserId !== p.toUserId && !p.amount.isZero()));

    // === a fully settled group produces no plan ===
    for (const p of plan2.payments) {
      await db.settlement.create({
        data: { groupId: group.id, fromUserId: p.fromUserId, toUserId: p.toUserId,
          amount: p.amount.toFixed(2), method: "UPI" },
      });
    }
    const finalBalances = computeNetBalances(await ledgerOf(group.id));
    check("following the plan settles everyone to zero",
      [...finalBalances.values()].every((v) => v.isZero()));
    check("no further payments recommended",
      buildSettlementPlan(finalBalances, []).payments.length === 0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
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
