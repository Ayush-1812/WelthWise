/**
 * M17 end-to-end: recurring generation must be idempotent.
 * A retried, double-fired, or concurrent cron run must never double-charge.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import {
  duePeriods,
  nextRunAfter,
  advance,
} from "./lib/split/recurring.js";
import { computeNetBalances, balancesSumToZero } from "./lib/split/balances.js";

const db = new PrismaClient();
const tag = `m17test-${Date.now()}`;
let pass = 0;
let fail = 0;
const check = (l, c) => {
  if (c) { pass++; console.log(`  OK   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}`); }
};
const utc = (s) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const mk = (n) =>
    db.user.create({
      data: { clerkUserId: `${tag}-${n}`, email: `${tag}-${n}@x.test`, name: n },
    });
  const [a, r, p] = [await mk("Ayush"), await mk("Rahul"), await mk("Priya")];
  const ids = [a.id, r.id, p.id];

  // Mirrors generateOccurrence: create guarded by the unique index.
  const generate = async (template, period) => {
    const amount = toDecimal(template.amount);
    const participantIds = template.splitTemplate.map((s) => s.userId);
    const splits = computeSplit({
      method: template.splitMethod, total: amount,
      participantIds, payerId: template.paidById,
    });
    try {
      const expense = await db.sharedExpense.create({
        data: {
          groupId: template.groupId, description: template.description, amount,
          date: period.runDate, category: template.category,
          splitMethod: template.splitMethod, paidById: template.paidById,
          createdById: template.createdById,
          recurringId: template.id, periodKey: period.periodKey,
          splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
        },
      });
      return { created: true, expenseId: expense.id };
    } catch (e) {
      if (e?.code === "P2002") return { created: false, reason: "already generated" };
      throw e;
    }
  };

  try {
    const group = await db.expenseGroup.create({
      data: {
        name: `${tag} Flat`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) },
      },
    });

    const template = await db.recurringSharedExpense.create({
      data: {
        groupId: group.id, description: "Monthly rent", amount: "12000.00",
        category: "rent", splitMethod: "EQUAL",
        splitTemplate: ids.map((userId) => ({ userId, shareInput: null })),
        paidById: a.id, createdById: a.id,
        interval: "MONTHLY", every: 1, nextRunDate: utc("2026-04-01"),
      },
    });
    check("template created", template.id !== undefined);

    // --- one period generates exactly one expense -------------------------
    const periods = duePeriods(template, utc("2026-04-01"));
    check("exactly one period due", periods.length === 1);

    const first = await generate(template, periods[0]);
    check("first run created the expense", first.created === true);
    check("one expense exists",
      (await db.sharedExpense.count({ where: { recurringId: template.id } })) === 1);

    // --- THE CORE REQUIREMENT: a retry must not double-charge -------------
    const retry = await generate(template, periods[0]);
    check("retry created nothing", retry.created === false);
    check("retry reported 'already generated'", retry.reason === "already generated");
    check("still exactly one expense",
      (await db.sharedExpense.count({ where: { recurringId: template.id } })) === 1);

    // --- five concurrent runners racing the same period -------------------
    const racers = await Promise.all(
      Array.from({ length: 5 }, () => generate(template, periods[0]))
    );
    check("no concurrent runner created a duplicate", racers.every((x) => !x.created));
    check("still exactly one expense after a 5-way race",
      (await db.sharedExpense.count({ where: { recurringId: template.id } })) === 1);

    // --- ledger stays consistent -------------------------------------------
    const ledger = {
      expenses: await db.sharedExpense.findMany({
        where: { groupId: group.id, isDeleted: false },
        select: { paidById: true, amount: true, isDeleted: true, splits: { select: { userId: true, shareAmount: true } } },
      }),
      settlements: [],
    };
    const net = computeNetBalances(ledger);
    check("payer is owed 8000 (12000 less his 4000 share)", net.get(a.id).toFixed(2) === "8000.00");
    check("each other flatmate owes 4000", net.get(r.id).toFixed(2) === "-4000.00");
    check("group sums to zero", balancesSumToZero(ledger));

    // --- advancing the template -------------------------------------------
    const next = nextRunAfter(template, periods[0].runDate);
    const advanced = await db.recurringSharedExpense.updateMany({
      where: { id: template.id, nextRunDate: template.nextRunDate },
      data: { nextRunDate: next, lastRunAt: new Date() },
    });
    check("template advanced once", advanced.count === 1);
    check("next run is 1 May", next.toISOString().slice(0, 10) === "2026-05-01");

    // A second advance with the stale date must not apply (compare-and-swap).
    const stale = await db.recurringSharedExpense.updateMany({
      where: { id: template.id, nextRunDate: template.nextRunDate },
      data: { nextRunDate: next },
    });
    check("stale compare-and-swap did not apply", stale.count === 0);

    // --- next period is a different key, so it DOES generate ---------------
    const fresh = await db.recurringSharedExpense.findUnique({ where: { id: template.id } });
    const mayPeriods = duePeriods(fresh, utc("2026-05-01"));
    const second = await generate(fresh, mayPeriods[0]);
    check("the next month generates a new expense", second.created === true);
    check("two expenses now exist",
      (await db.sharedExpense.count({ where: { recurringId: template.id } })) === 2);
    check("their period keys differ",
      periods[0].periodKey !== mayPeriods[0].periodKey);

    // --- catch-up after downtime -------------------------------------------
    const behind = await db.recurringSharedExpense.update({
      where: { id: template.id }, data: { nextRunDate: utc("2026-06-01") },
    });
    const missed = duePeriods(behind, utc("2026-08-15"));
    check("catches up on 3 missed months", missed.length === 3);
    let created = 0;
    for (const period of missed) {
      const res = await generate(behind, period);
      if (res.created) created++;
    }
    check("all 3 missed months generated", created === 3);
    check("5 expenses total, none duplicated",
      (await db.sharedExpense.count({ where: { recurringId: template.id } })) === 5);

    const keys = (await db.sharedExpense.findMany({
      where: { recurringId: template.id }, select: { periodKey: true },
    })).map((x) => x.periodKey);
    check("every period key is unique", new Set(keys).size === keys.length);

    // --- pause stops generation ---------------------------------------------
    await db.recurringSharedExpense.update({ where: { id: template.id }, data: { isActive: false } });
    const paused = await db.recurringSharedExpense.findUnique({ where: { id: template.id } });
    check("a paused template is never due", duePeriods(paused, utc("2027-01-01")).length === 0);

    // --- end date stops generation ------------------------------------------
    const ending = await db.recurringSharedExpense.update({
      where: { id: template.id },
      data: { isActive: true, nextRunDate: utc("2026-09-01"), endDate: utc("2026-10-01") },
    });
    check("end date caps the catch-up",
      duePeriods(ending, utc("2027-01-01")).map((x) => x.periodKey).join(",") ===
        "2026-09-01,2026-10-01");

    // --- month-end clamping on real data -------------------------------------
    check("rent on the 31st does not skip February",
      advance(utc("2026-01-31"), "MONTHLY").toISOString().slice(0, 10) === "2026-02-28");

    // --- deleting the template keeps generated expenses ---------------------
    await db.recurringSharedExpense.delete({ where: { id: template.id } });
    const survivors = await db.sharedExpense.count({ where: { groupId: group.id } });
    check("generated expenses survive template deletion", survivors === 5);
    const orphan = await db.sharedExpense.findFirst({ where: { groupId: group.id } });
    check("their recurringId is nulled, not cascaded", orphan.recurringId === null);
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    const leftover =
      (await db.user.count({ where: { clerkUserId: { startsWith: tag } } })) +
      (await db.sharedExpense.count()) + (await db.expenseGroup.count()) +
      (await db.recurringSharedExpense.count());
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
