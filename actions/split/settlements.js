"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/prisma";
import { Decimal } from "@/lib/money";
import {
  getCurrentAppUser,
  assertGroupMember,
  AccessError,
  ACCESS_CODES,
} from "@/lib/split/auth";
import { pairwiseForUser } from "@/lib/split/balances";
import {
  assertValidSettlement,
  settlementDirection,
  SettlementError,
} from "@/lib/split/settlements";

import { loadUserLedger } from "./balances";

const USER_FIELDS = { id: true, name: true, email: true, imageUrl: true };

function fail(error) {
  if (error instanceof AccessError || error instanceof SettlementError) {
    return { success: false, error: error.message };
  }
  console.error("[split/settlements]", error);
  return { success: false, error: error.message ?? "Something went wrong" };
}

/**
 * Everyone the caller currently has an unsettled balance with, and the exact
 * amount that would clear it. Used to prefill the settle-up form.
 */
export async function getSettleUpTargets() {
  try {
    const me = await getCurrentAppUser();
    const ledger = await loadUserLedger(me.id);
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

    return { success: true, data: { myUserId: me.id, targets } };
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

    // Derive the debt from the ledger, never from the request.
    const ledger = await loadUserLedger(me.id);
    const net = pairwiseForUser(ledger, me.id).get(otherUserId) ?? new Decimal(0);
    const direction = settlementDirection(net, me.id, otherUserId);

    if (!direction) {
      throw new SettlementError("You are already settled up with this person");
    }

    const { amount: value, remaining, isFull } = assertValidSettlement({
      amount,
      outstanding: direction.outstanding,
      fromUserId: direction.fromUserId,
      toUserId: direction.toUserId,
      method,
    });

    await db.settlement.create({
      data: {
        groupId,
        fromUserId: direction.fromUserId,
        toUserId: direction.toUserId,
        amount: value.toFixed(2),
        method,
        note: String(note ?? "").trim() || null,
        settledAt: new Date(),
      },
    });

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
        iPaid: direction.fromUserId === me.id,
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
