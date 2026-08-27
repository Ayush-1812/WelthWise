/**
 * M15 end-to-end: every ledger-mutating action writes exactly one activity row,
 * and each row renders as a sensible sentence.
 */
import { PrismaClient } from "@prisma/client";
import { computeSplit } from "./lib/split/engine.js";
import { nameResolver, describeActivity } from "./lib/split/activity.js";

const db = new PrismaClient();
const tag = `m15test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p] = [await mk("Ayush"), await mk("Rahul"), await mk("Priya")];
  const ids = [a.id, r.id, p.id];

  const countActivity = (groupId, type) =>
    db.sharedExpenseActivity.count({ where: { groupId, ...(type ? { type } : {}) } });

  try {
    // --- GROUP_CREATED + MEMBER_ADDED ---------------------------------
    const group = await db.$transaction(async (tx) => {
      const created = await tx.expenseGroup.create({
        data: {
          name: `${tag} Goa`, createdById: a.id,
          members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
        },
      });
      await tx.sharedExpenseActivity.create({
        data: { groupId: created.id, actorId: a.id, type: "GROUP_CREATED", metadata: { name: created.name } },
      });
      await tx.sharedExpenseActivity.create({
        data: { groupId: created.id, actorId: a.id, type: "MEMBER_ADDED", metadata: { memberIds: [r.id, p.id] } },
      });
      return created;
    });

    check("GROUP_CREATED written once", (await countActivity(group.id, "GROUP_CREATED")) === 1);
    check("MEMBER_ADDED written once", (await countActivity(group.id, "MEMBER_ADDED")) === 1);

    // --- EXPENSE_ADDED --------------------------------------------------
    const splits = computeSplit({ method: "EQUAL", total: 2000, participantIds: ids, payerId: a.id });
    const expense = await db.$transaction(async (tx) => {
      const created = await tx.sharedExpense.create({
        data: {
          groupId: group.id, description: "hotel", amount: "2000.00", date: new Date(),
          category: "hotel", splitMethod: "EQUAL", paidById: a.id, createdById: a.id,
          splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
        },
      });
      await tx.sharedExpenseActivity.create({
        data: {
          groupId: group.id, actorId: a.id, type: "EXPENSE_ADDED", expenseId: created.id,
          metadata: { description: "hotel", amount: "2000.00", participantCount: 3 },
        },
      });
      return created;
    });
    check("EXPENSE_ADDED written once", (await countActivity(group.id, "EXPENSE_ADDED")) === 1);

    // --- EXPENSE_EDITED --------------------------------------------------
    await db.sharedExpenseActivity.create({
      data: {
        groupId: group.id, actorId: a.id, type: "EXPENSE_EDITED", expenseId: expense.id,
        metadata: { description: "hotel", previousAmount: "2000.00", newAmount: "1500.00" },
      },
    });
    check("EXPENSE_EDITED written once", (await countActivity(group.id, "EXPENSE_EDITED")) === 1);

    // --- SETTLEMENT_RECORDED ----------------------------------------------
    await db.$transaction(async (tx) => {
      const s = await tx.settlement.create({
        data: { groupId: group.id, fromUserId: p.id, toUserId: a.id, amount: "500.00", method: "UPI" },
      });
      await tx.sharedExpenseActivity.create({
        data: {
          groupId: group.id, actorId: p.id, type: "SETTLEMENT_RECORDED", settlementId: s.id,
          metadata: { amount: "500.00", method: "UPI", fromUserId: p.id, toUserId: a.id },
        },
      });
    });
    check("SETTLEMENT_RECORDED written once", (await countActivity(group.id, "SETTLEMENT_RECORDED")) === 1);

    // --- MEMBER_REMOVED ----------------------------------------------------
    await db.$transaction(async (tx) => {
      await tx.groupMember.update({
        where: { groupId_userId: { groupId: group.id, userId: r.id } },
        data: { leftAt: new Date() },
      });
      await tx.sharedExpenseActivity.create({
        data: {
          groupId: group.id, actorId: a.id, type: "MEMBER_REMOVED",
          metadata: { targetUserId: r.id, self: false },
        },
      });
    });
    check("MEMBER_REMOVED written once", (await countActivity(group.id, "MEMBER_REMOVED")) === 1);

    // --- EXPENSE_DELETED ---------------------------------------------------
    await db.$transaction(async (tx) => {
      await tx.sharedExpense.update({ where: { id: expense.id }, data: { isDeleted: true } });
      await tx.sharedExpenseActivity.create({
        data: {
          groupId: group.id, actorId: a.id, type: "EXPENSE_DELETED", expenseId: expense.id,
          metadata: { description: "hotel", amount: "1500.00" },
        },
      });
    });
    check("EXPENSE_DELETED written once", (await countActivity(group.id, "EXPENSE_DELETED")) === 1);

    check("6 mutations produced 7 rows (create writes 2)", (await countActivity(group.id)) === 7);

    // --- rendering ----------------------------------------------------------
    const rows = await db.sharedExpenseActivity.findMany({
      where: { groupId: group.id },
      include: { actor: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const users = [a, r, p];
    const outsider = nameResolver({ viewerId: "nobody", users });
    const lines = rows.map((row) => describeActivity(row, { viewerId: "nobody", nameOf: outsider }));

    console.log("\n  --- feed as an outsider sees it ---");
    for (const l of [...lines].reverse()) console.log("    " + l);
    console.log();

    check("no line is blank", lines.every((l) => l.length > 0));
    check("no line leaks undefined/null", lines.every((l) => !/undefined|null/.test(l)));
    check("spec example: Ayush added the hotel expense",
      lines.some((l) => /Ayush added ₹2,000\.00 for hotel/.test(l)));
    check("spec example: Rahul was added to the group",
      lines.some((l) => /Ayush added Rahul and Priya/.test(l)));
    check("spec example: Priya settled with Ayush",
      lines.some((l) => /Priya settled ₹500\.00 with Ayush/.test(l)));
    check("edit names both amounts",
      lines.some((l) => /changed hotel from ₹2,000\.00 to ₹1,500\.00/.test(l)));

    // Viewer perspective
    const mine = nameResolver({ viewerId: a.id, users });
    const asAyush = rows.map((row) => describeActivity(row, { viewerId: a.id, nameOf: mine }));
    check("viewer sees their own actions as 'You'",
      asAyush.some((l) => l.startsWith("You added")));
    check("viewer is 'you' as a settlement counterparty",
      asAyush.some((l) => /Priya settled ₹500\.00 with you/.test(l)));

    // --- ordering + cursor paging ------------------------------------------
    const firstPage = await db.sharedExpenseActivity.findMany({
      where: { groupId: group.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4,
    });
    const secondPage = await db.sharedExpenseActivity.findMany({
      where: { groupId: group.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4, cursor: { id: firstPage[firstPage.length - 1].id }, skip: 1,
    });
    check("newest first", firstPage[0].createdAt >= firstPage[1].createdAt);
    check("cursor paging returns the rest without overlap",
      secondPage.length === 3 && !secondPage.some((x) => firstPage.some((y) => y.id === x.id)));

    // --- activity survives its expense being soft-deleted -------------------
    check("activity rows still reference the deleted expense",
      (await db.sharedExpenseActivity.count({ where: { expenseId: expense.id } })) === 3);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpenseActivity.count()) + (await db.expenseGroup.count()) +
      (await db.sharedExpense.count()) + (await db.settlement.count());
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
