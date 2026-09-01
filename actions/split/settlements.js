"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { Decimal } from "@/lib/money";
import { canonicalPair } from "@/lib/split/access";
import {
  getCurrentAppUser,
  assertGroupMember,
  assertOwnedAccount,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { pairwiseForUser } from "@/lib/split/balances";
import {
  assertValidSettlement,
  settlementDirection,
  SettlementError,
} from "@/lib/split/settlements";

import { loadUserLedger } from "@/lib/split/ledger";
import {
  currenciesIn,
  resolveLedgerCurrency,
  scopeLedgerToCurrency,
  CurrencyError,
  DEFAULT_CURRENCY,
} from "@/lib/split/currency";
import { syncSettlementToPersonal } from "./personal-sync";
import { queueNotifications, deliverEmailsInBackground } from "./notify";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

/**
 * Narrow a ledger to the single currency a settlement is being recorded in.
 * A debt of $50 and a debt of Rs.50 are different debts; settling has to name
 * which one it clears.
 */
function reportIn(raw, me, requested = null) {
  const available = [...currenciesIn(raw)].sort();
  const currency = resolveLedgerCurrency(raw, requested, me?.preferredCurrency);
  return { ledger: scopeLedgerToCurrency(raw, currency), currency, available };
}

function fail(error) {
  // Next probes server components for static renderability; that probe throws
  // DYNAMIC_SERVER_USAGE. Rethrow so Next can mark the route dynamic instead of
  // swallowing it into a failed result and logging a misleading error.
  if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  if (
    error instanceof AccessError ||
    error instanceof SettlementError ||
    error instanceof CurrencyError
  ) {
    return { success: false, error: error.message };
  }
  console.error("[split/settlements]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Everyone the caller currently has an unsettled balance with, and the exact
 * amount that would clear it. Used to prefill the settle-up form.
 */
export async function getSettleUpTargets({ currency: requested = null } = {}) {
  try {
    const me = await getCurrentAppUser();
    const { ledger, currency, available } = reportIn(
      await loadUserLedger(me.id),
      me,
      requested
    );
    const perPerson = pairwiseForUser(ledger, me.id);

    const ids = [...perPerson.keys()].filter(
      (id) => !perPerson.get(id).isZero()
    );

    const users = ids.length
      ? await db.user.findMany({
          where: { id: { in: ids } },
          select: USER_FIELDS,
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const targets = ids
      .map((id) => {
        const net = perPerson.get(id);
        const direction = settlementDirection(net, me.id, id);
        return {
          user: byId.get(id) ?? null,
          netBalance: net.toNumber(),
          // Positive outstanding, plus who pays whom.
          outstanding: direction.outstanding.toNumber(),
          iPay: direction.fromUserId === me.id,
        };
      })
      .filter((t) => t.user)
      .sort((a, b) => b.outstanding - a.outstanding);

    return {
      success: true,
      data: { myUserId: me.id, targets, currency, availableCurrencies: available },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Record a payment between two people.
 *
 * The outstanding amount is always recomputed from the ledger server-side; a
 * client-supplied balance is never trusted. A settlement may only reduce an
 * existing debt, so it can never create money or flip a balance negative.
 */
export async function createSettlement({
  otherUserId,
  amount,
  method = "EXTERNAL",
  note = "",
  groupId = null,
  accountId = null,
  currency: requestedCurrency = null,
}) {
  try {
    const me = await getCurrentAppUser();

    if (!otherUserId || otherUserId === me.id) {
      throw new AccessError(
        ACCESS_CODES.INVALID,
        "You cannot settle up with yourself"
      );
    }

    const other = await db.user.findUnique({
      where: { id: otherUserId },
      select: USER_FIELDS,
    });
    if (!other) throw new AccessError(ACCESS_CODES.NOT_FOUND, "Person not found");

    if (groupId) {
      await assertGroupMember(groupId, me.id);
      await assertGroupMember(groupId, otherUserId);
    }

    // The accountId is caller-supplied and gets written against below.
    const ownedAccountId = await assertOwnedAccount(accountId, me.id);

    const settlementEmails = [];

    // Reading the ledger before the transaction and writing inside it left a
    // window where two concurrent settle-ups both saw the full outstanding
    // amount and both recorded it, over-settling the debt and flipping the
    // balance negative - the one thing this function promises cannot happen.
    // The debt is an aggregate over many rows, so no unique constraint can
    // express it; instead both people's settle-ups serialize on a lock keyed
    // by the pair, and the outstanding amount is re-derived while holding it.
    let direction;
    let value;
    let remaining;
    let isFull;
    let currency;
    let personalCurrencyMatches;

    await db.$transaction(async (tx) => {
      const [lo, hi] = canonicalPair(me.id, otherUserId);
      // Transaction-scoped, so it releases on commit or rollback and is safe
      // through a transaction-mode connection pooler.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle:${lo}:${hi}`}))`;

      // Re-derive the debt from the ledger while holding the lock, never from
      // the request, and narrowed to one currency: settling is always against
      // a specific currency's debt, never a total across several.
      const scoped = reportIn(
        await loadUserLedger(me.id, { client: tx }),
        me,
        requestedCurrency
      );
      currency = scoped.currency;

      const net =
        pairwiseForUser(scoped.ledger, me.id).get(otherUserId) ?? new Decimal(0);
      direction = settlementDirection(net, me.id, otherUserId);

      if (!direction) {
        throw new SettlementError("You are already settled up with this person");
      }

      ({ amount: value, remaining, isFull } = assertValidSettlement({
        amount,
        outstanding: direction.outstanding,
        fromUserId: direction.fromUserId,
        toUserId: direction.toUserId,
        method,
      }));

      personalCurrencyMatches =
        currency === (me.preferredCurrency || DEFAULT_CURRENCY);

      const settlement = await tx.settlement.create({
        data: {
          groupId,
          fromUserId: direction.fromUserId,
          toUserId: direction.toUserId,
          amount: value.toFixed(2),
          currency,
          method,
          note: String(note ?? "").trim() || null,
          settledAt: new Date(),
        },
      });

      // Personal-finance side (M12): a settlement moves cash but is never
      // income or expense, so the row is written as a transfer.
      await syncSettlementToPersonal(tx, {
        settlementId: settlement.id,
        userId: me.id,
        // Transaction rows carry no currency of their own - they are implicitly
        // in the user's preferred currency. Recording a foreign-currency
        // settlement against a personal account would silently mis-state its
        // balance, so the personal leg is skipped instead.
        accountId: personalCurrencyMatches ? ownedAccountId : null,
        fromUserId: direction.fromUserId,
        toUserId: direction.toUserId,
        amount: value,
        counterpartyName: other.name || other.email,
        date: settlement.settledAt,
      });

      // Only the person receiving the money needs telling, and the wording
      // differs depending on whether it clears the balance.
      settlementEmails.push(
        ...(await queueNotifications(tx, {
          type: isFull ? "SETTLEMENT_RECEIVED" : "SETTLEMENT_PARTIAL",
          recipientIds: [direction.toUserId],
          actorId: me.id,
          context: {
            actor: direction.fromUserId === me.id ? me : other,
            amount: value,
            remaining,
          },
        }))
      );

      await tx.sharedExpenseActivity.create({
        data: {
          groupId,
          actorId: me.id,
          type: "SETTLEMENT_RECORDED",
          settlementId: settlement.id,
          metadata: {
            amount: value.toFixed(2),
            method,
            fromUserId: direction.fromUserId,
            toUserId: direction.toUserId,
          },
        },
      });
    });

    deliverEmailsInBackground(settlementEmails);

    revalidatePath("/split/settlements");
    revalidatePath("/split/balances");
    revalidatePath(`/split/balances/${otherUserId}`);
    revalidatePath("/split/overview");
    revalidatePath("/split/friends");
    if (groupId) revalidatePath(`/split/groups/${groupId}`);

    return {
      success: true,
      data: {
        amount: value.toNumber(),
        remaining: remaining.toNumber(),
        isFull,
        currency,
        iPaid: direction.fromUserId === me.id,
        // Surfaced so the UI can explain why no personal transaction appeared.
        personalSyncSkipped: Boolean(ownedAccountId) && !personalCurrencyMatches,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Settlement history involving the caller. */
export async function getSettlements({ limit = 50 } = {}) {
  try {
    const me = await getCurrentAppUser();

    const rows = await db.settlement.findMany({
      where: { OR: [{ fromUserId: me.id }, { toUserId: me.id }] },
      include: {
        fromUser: { select: USER_FIELDS },
        toUser: { select: USER_FIELDS },
        group: { select: { id: true, name: true, icon: true } },
      },
      orderBy: { settledAt: "desc" },
      take: limit,
    });

    const data = rows.map((row) => ({
      id: row.id,
      amount: row.amount.toNumber(),
      currency: row.currency,
      method: row.method,
      note: row.note,
      settledAt: row.settledAt,
      group: row.group,
      fromUser: row.fromUser,
      toUser: row.toUser,
      sentByMe: row.fromUserId === me.id,
    }));

    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}
