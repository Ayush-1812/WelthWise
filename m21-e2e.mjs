/**
 * M21 end-to-end: itemized splits persist, reconcile, and survive an edit.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal, sum } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import { computeNetBalances, balancesSumToZero } from "./lib/split/balances.js";
import { normalizeItems, itemsForUser } from "./lib/split/itemized.js";

const db = new PrismaClient();
const tag = `m21test-${Date.now()}`;
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
  const [a, r, p] = [await mk("Ayush"), await mk("Rahul"), await mk("Priya")];
  const ids = [a.id, r.id, p.id];

  const saveItemized = async (groupId, description, total, items) => {
    const splits = computeSplit({
      method: "ITEMIZED", total, participantIds: ids, values: { items }, payerId: a.id,
    });
    return db.$transaction(async (tx) => {
      const expense = await tx.sharedExpense.create({
        data: {
          groupId, description, amount: String(total), date: new Date(), category: "food",
          splitMethod: "ITEMIZED", paidById: a.id, createdById: a.id,
          splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
        },
      });
      await tx.expenseItem.createMany({
        data: normalizeItems(items).map((i) => ({
          expenseId: expense.id, name: i.name, amount: i.amount.toFixed(2),
          quantity: i.quantity, assignedTo: i.assignedTo,
        })),
      });
      return expense;
    });
  };

  try {
    const group = await db.expenseGroup.create({
      data: { name: `${tag} Dinner`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) } },
    });

    // Ayush eats biryani, Rahul paneer, all three share the dessert.
    const items = [
      { name: "Biryani", amount: "300.00", assignedTo: [a.id] },
      { name: "Paneer", amount: "200.00", assignedTo: [r.id] },
      { name: "Gulab jamun", amount: "100.00", assignedTo: ids },
    ];

    const expense = await saveItemized(group.id, "Restaurant", 600, items);

    const saved = await db.sharedExpense.findUnique({
      where: { id: expense.id }, include: { splits: true, items: true },
    });

    check("3 line items persisted", saved.items.length === 3);
    check("3 splits persisted", saved.splits.length === 3);
    check("splitMethod recorded as ITEMIZED", saved.splitMethod === "ITEMIZED");

    const byId = Object.fromEntries(saved.splits.map((s) => [s.userId, f2(s.shareAmount)]));
    // Biryani 300 + dessert 33.34 (payer-first ordering within the item)
    check("Ayush pays for his biryani plus a dessert share", byId[a.id] === "333.34");
    check("Rahul pays for paneer plus a dessert share", byId[r.id] === "233.33");
    check("Priya pays only her dessert share", byId[p.id] === "33.33");

    const total = sum(saved.splits.map((s) => toDecimal(s.shareAmount)));
    check("splits sum to exactly the expense total", f2(total) === "600.00");

    const itemTotal = sum(saved.items.map((i) => toDecimal(i.amount)));
    check("items sum to exactly the expense total", f2(itemTotal) === "600.00");

    // --- assignments round-trip -------------------------------------------
    const dessert = saved.items.find((i) => i.name === "Gulab jamun");
    check("shared item kept all 3 assignees", dessert.assignedTo.length === 3);
    const biryani = saved.items.find((i) => i.name === "Biryani");
    check("solo item kept 1 assignee", biryani.assignedTo.length === 1);

    // --- per-person explanation ---------------------------------------------
    const priyaItems = itemsForUser(items, p.id);
    check("Priya's breakdown lists only the dessert",
      priyaItems.length === 1 && priyaItems[0].name === "Gulab jamun");
    check("and shows her portion of it", f2(priyaItems[0].yourShare) === "33.33");

    // --- ledger consistency ---------------------------------------------------
    const ledger = {
      expenses: await db.sharedExpense.findMany({
        where: { groupId: group.id, isDeleted: false },
        select: { paidById: true, amount: true, isDeleted: true,
          splits: { select: { userId: true, shareAmount: true } } },
      }),
      settlements: [],
    };
    const net = computeNetBalances(ledger);
    check("payer is owed what others ate", f2(net.get(a.id)) === "266.66");
    check("group sums to zero", balancesSumToZero(ledger));

    // --- editing rewrites items wholesale -------------------------------------
    const newItems = [
      { name: "Biryani", amount: "300.00", assignedTo: [a.id, r.id] },
      { name: "Lassi", amount: "300.00", assignedTo: [p.id] },
    ];
    const newSplits = computeSplit({
      method: "ITEMIZED", total: 600, participantIds: ids, values: { items: newItems }, payerId: a.id,
    });
    await db.$transaction(async (tx) => {
      await tx.expenseSplit.deleteMany({ where: { expenseId: expense.id } });
      await tx.expenseItem.deleteMany({ where: { expenseId: expense.id } });
      await tx.sharedExpense.update({
        where: { id: expense.id },
        data: { splits: { create: newSplits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) } },
      });
      await tx.expenseItem.createMany({
        data: normalizeItems(newItems).map((i) => ({
          expenseId: expense.id, name: i.name, amount: i.amount.toFixed(2),
          quantity: i.quantity, assignedTo: i.assignedTo,
        })),
      });
    });

    const edited = await db.sharedExpense.findUnique({
      where: { id: expense.id }, include: { splits: true, items: true },
    });
    check("edit replaced items, no stale rows", edited.items.length === 2);
    check("edit replaced splits", edited.splits.length === 3);
    const editedById = Object.fromEntries(edited.splits.map((s) => [s.userId, f2(s.shareAmount)]));
    check("Ayush and Rahul now share the biryani", editedById[a.id] === "150.00");
    check("Priya pays for her lassi", editedById[p.id] === "300.00");
    check("still sums to the total",
      f2(sum(edited.splits.map((s) => toDecimal(s.shareAmount)))) === "600.00");

    // --- items that do not reconcile are refused ------------------------------
    let refused = false;
    try {
      computeSplit({ method: "ITEMIZED", total: 999, participantIds: ids,
        values: { items }, payerId: a.id });
    } catch { refused = true; }
    check("items that do not add up to the total are refused", refused);

    // --- deleting the expense removes its items -------------------------------
    await db.sharedExpense.delete({ where: { id: expense.id } });
    check("items cascade with the expense",
      (await db.expenseItem.count({ where: { expenseId: expense.id } })) === 0);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.expenseGroup.count()) +
      (await db.expenseItem.count());
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
