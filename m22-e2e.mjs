/**
 * M22 end-to-end: multi-currency provenance and the mixed-ledger guard.
 */
import { PrismaClient } from "@prisma/client";
import { toDecimal } from "./lib/money.js";
import { computeSplit } from "./lib/split/engine.js";
import {
  computeNetBalances,
  computeNetBalancesByCurrency,
  balancesSumToZero,
} from "./lib/split/balances.js";
import {
  buildConversion,
  verifyConversion,
  currenciesIn,
  isSingleCurrency,
  CurrencyError,
} from "./lib/split/currency.js";

const db = new PrismaClient();
const tag = `m22test-${Date.now()}`;
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
  const [a, r] = [await mk("Ayush"), await mk("Rahul")];
  const ids = [a.id, r.id];

  const addExpense = (groupId, desc, amount, currency, extra = {}) => {
    const splits = computeSplit({ method: "EQUAL", total: amount, participantIds: ids, payerId: a.id });
    return db.sharedExpense.create({
      data: {
        groupId, description: desc, amount: String(amount), currency,
        date: new Date(), category: "travel", splitMethod: "EQUAL",
        paidById: a.id, createdById: a.id, ...extra,
        splits: { create: splits.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount.toFixed(2) })) },
      },
    });
  };

  const load = async (groupId) => ({
    expenses: await db.sharedExpense.findMany({
      where: { groupId, isDeleted: false },
      select: { paidById: true, amount: true, currency: true, isDeleted: true,
        splits: { select: { userId: true, shareAmount: true } } },
    }),
    settlements: await db.settlement.findMany({
      where: { groupId }, select: { fromUserId: true, toUserId: true, amount: true, currency: true },
    }),
  });

  try {
    // --- user preference persists ------------------------------------------
    await db.user.update({ where: { id: a.id }, data: { preferredCurrency: "USD" } });
    const pref = await db.user.findUnique({ where: { id: a.id }, select: { preferredCurrency: true } });
    check("preferredCurrency saved", pref.preferredCurrency === "USD");
    const other = await db.user.findUnique({ where: { id: r.id }, select: { preferredCurrency: true } });
    check("existing users default to INR", other.preferredCurrency === "INR");

    const group = await db.expenseGroup.create({
      data: { name: `${tag} Trip`, createdById: a.id,
        members: { create: ids.map((id, i) => ({ userId: id, role: i === 0 ? "OWNER" : "MEMBER" })) } },
    });

    // --- single currency behaves exactly as before ---------------------------
    await addExpense(group.id, "Taxi", 1000, "INR");
    let ledger = await load(group.id);
    check("uniform ledger needs no currency argument",
      f2(computeNetBalances(ledger).get(a.id)) === "500.00");
    check("uniform ledger sums to zero", balancesSumToZero(ledger));
    check("detected as single-currency", isSingleCurrency(ledger));

    // --- conversion provenance ------------------------------------------------
    const conv = buildConversion({
      amount: "100", from: "USD", to: "INR", rate: "95.54", at: new Date("2026-08-27"),
    });
    const converted = await addExpense(group.id, "Hotel", conv.amount, "INR", {
      originalAmount: conv.originalAmount.toFixed(2),
      originalCurrency: conv.originalCurrency,
      exchangeRate: conv.exchangeRate.toString(),
      rateAt: conv.rateAt,
    });

    const stored = await db.sharedExpense.findUnique({ where: { id: converted.id } });
    check("converted amount stored", f2(stored.amount) === "9554.00");
    check("ORIGINAL amount kept, not overwritten", f2(stored.originalAmount) === "100.00");
    check("original currency kept", stored.originalCurrency === "USD");
    check("rate used is recorded", f2(stored.exchangeRate) === "95.54");
    check("moment the rate was fetched is recorded", stored.rateAt !== null);
    check("stored conversion re-derives correctly", verifyConversion({
      converted: true, originalAmount: stored.originalAmount,
      exchangeRate: stored.exchangeRate, amount: stored.amount,
    }));

    // A later rate change must not touch the historical row.
    buildConversion({ amount: "100", from: "USD", to: "INR", rate: "120.00" });
    const unchanged = await db.sharedExpense.findUnique({ where: { id: converted.id } });
    check("a later rate does not rewrite history", f2(unchanged.exchangeRate) === "95.54");

    // --- THE CORE GUARD: a mixed ledger must not silently sum -----------------
    await addExpense(group.id, "Duty free", 200, "USD");
    ledger = await load(group.id);

    check("ledger now holds two currencies", currenciesIn(ledger).size === 2);
    check("no longer single-currency", !isSingleCurrency(ledger));

    let threw = false;
    let message = "";
    try { computeNetBalances(ledger); } catch (e) { threw = e instanceof CurrencyError; message = e.message; }
    check("mixed ledger THROWS instead of summing ₹ and $", threw);
    check("the error names both currencies", /INR/.test(message) && /USD/.test(message));
    check("and says what to do", /per currency/.test(message));

    // --- per-currency balances are correct and each sums to zero --------------
    const byCurrency = computeNetBalancesByCurrency(ledger);
    check("one balance set per currency", byCurrency.size === 2);
    check("INR side: payer owed 5277 (500 taxi + 4777 hotel)",
      f2(byCurrency.get("INR").get(a.id)) === "5277.00");
    check("USD side: payer owed 100", f2(byCurrency.get("USD").get(a.id)) === "100.00");
    check("INR sums to zero", balancesSumToZero(ledger, { currency: "INR" }));
    check("USD sums to zero", balancesSumToZero(ledger, { currency: "USD" }));

    // A naive implementation would report 5377 - a number in no currency.
    const naive = f2(
      toDecimal(byCurrency.get("INR").get(a.id)).plus(toDecimal(byCurrency.get("USD").get(a.id)))
    );
    check("summing them would give a meaningless 5377 (the bug prevented)", naive === "5377.00");

    // --- settlements in another currency also trip the guard -------------------
    await db.settlement.create({
      data: { groupId: group.id, fromUserId: r.id, toUserId: a.id, amount: "50.00",
        currency: "USD", method: "UPI" },
    });
    ledger = await load(group.id);
    let settleThrew = false;
    try { computeNetBalances(ledger); } catch { settleThrew = true; }
    check("a settlement in a second currency still trips the guard", settleThrew);
    check("USD side reflects the settlement",
      f2(computeNetBalancesByCurrency(ledger).get("USD").get(a.id)) === "50.00");
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
