import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Decimal, sum } from "../money.js";
import {
  SPLIT_METHODS,
  SplitError,
  splitEqual,
  splitExact,
  splitPercentage,
  splitShares,
  splitCustom,
  splitItemized,
  computeSplit,
  validateSplit,
  assertValidSplit,
} from "./engine.js";

const AYUSH = "ayush";
const RAHUL = "rahul";
const PRIYA = "priya";
const AMAN = "aman";
const THREE = [AYUSH, RAHUL, PRIYA];

const amounts = (splits) => splits.map((s) => s.shareAmount.toFixed(2));
const total = (splits) => sum(splits.map((s) => s.shareAmount));

/** Every method must produce splits summing to exactly the total. */
function assertExact(splits, expected, label) {
  assert.equal(
    total(splits).toFixed(2),
    new Decimal(expected).toFixed(2),
    `${label}: splits must sum to the total`
  );
}

describe("the cases from task.md", () => {
  test("3000 across 3 of 4 members: 1000 each, the fourth absent", () => {
    const splits = splitEqual(3000, THREE);
    assert.deepEqual(amounts(splits), ["1000.00", "1000.00", "1000.00"]);
    assert.ok(!splits.some((s) => s.userId === AMAN), "Aman must not appear");
    assert.equal(splits.length, 3);
  });

  test("100 / 3 loses no paisa", () => {
    const splits = splitEqual(100, THREE);
    assert.deepEqual(amounts(splits), ["33.34", "33.33", "33.33"]);
    assertExact(splits, 100, "equal 100/3");
  });

  test("percentages summing to 99.99 are rejected, not corrected", () => {
    assert.throws(
      () =>
        splitPercentage(100, THREE, {
          [AYUSH]: "33.33",
          [RAHUL]: "33.33",
          [PRIYA]: "33.33",
        }),
      SplitError
    );
  });

  test("negative, zero and empty inputs are rejected", () => {
    assert.throws(() => splitEqual(-100, THREE), SplitError);
    assert.throws(() => splitEqual(0, THREE), SplitError);
    assert.throws(() => splitEqual(100, []), SplitError);
    assert.throws(() => splitEqual(100, null), SplitError);
  });
});

describe("splitEqual", () => {
  test("the payer absorbs the leftover minor unit", () => {
    const splits = splitEqual(100, THREE, { payerId: RAHUL });
    const byId = Object.fromEntries(splits.map((s) => [s.userId, s.shareAmount.toFixed(2)]));

    assert.equal(byId[RAHUL], "33.34", "payer takes the extra paisa");
    assert.equal(byId[AYUSH], "33.33");
    assert.equal(byId[PRIYA], "33.33");
  });

  test("results stay in the caller's participant order", () => {
    const splits = splitEqual(100, THREE, { payerId: PRIYA });
    assert.deepEqual(splits.map((s) => s.userId), THREE);
  });

  test("a payer outside the participant list is ignored", () => {
    const splits = splitEqual(100, THREE, { payerId: AMAN });
    assertExact(splits, 100, "outside payer");
    assert.equal(splits.length, 3);
  });

  test("one participant takes the whole amount", () => {
    assert.deepEqual(amounts(splitEqual("77.77", [AYUSH])), ["77.77"]);
  });

  test("duplicate participants are rejected", () => {
    assert.throws(() => splitEqual(100, [AYUSH, AYUSH]), SplitError);
  });

  test("shareInput is null - there was no user input to preserve", () => {
    assert.equal(splitEqual(100, THREE)[0].shareInput, null);
  });
});

describe("splitExact", () => {
  test("accepts amounts that sum to the total", () => {
    const splits = splitExact(3000, THREE, {
      [AYUSH]: "1500.00",
      [RAHUL]: "1000.00",
      [PRIYA]: "500.00",
    });
    assert.deepEqual(amounts(splits), ["1500.00", "1000.00", "500.00"]);
    assertExact(splits, 3000, "exact");
  });

  test("preserves what the user typed in shareInput", () => {
    const splits = splitExact(100, [AYUSH, RAHUL], { [AYUSH]: "60", [RAHUL]: "40" });
    assert.equal(splits[0].shareInput.toFixed(2), "60.00");
  });

  test("rejects an under-total and names the shortfall", () => {
    assert.throws(
      () => splitExact(100, [AYUSH, RAHUL], { [AYUSH]: "40", [RAHUL]: "40" }),
      (e) => e instanceof SplitError && /20.00 under/.test(e.message)
    );
  });

  test("rejects an over-total", () => {
    assert.throws(
      () => splitExact(100, [AYUSH, RAHUL], { [AYUSH]: "60", [RAHUL]: "60" }),
      (e) => e instanceof SplitError && /20.00 over/.test(e.message)
    );
  });

  test("a zero share for one participant is allowed", () => {
    const splits = splitExact(100, THREE, {
      [AYUSH]: "100",
      [RAHUL]: "0",
      [PRIYA]: "0",
    });
    assertExact(splits, 100, "zero shares");
  });

  test("rejects a negative share", () => {
    assert.throws(
      () => splitExact(100, [AYUSH, RAHUL], { [AYUSH]: "120", [RAHUL]: "-20" }),
      SplitError
    );
  });

  test("missing entries count as zero, so a shortfall is caught", () => {
    // Ayush 50, Rahul and Priya unset (0) -> 50 short of 100.
    assert.throws(() => splitExact(100, THREE, { [AYUSH]: "50" }), SplitError);
  });

  test("one participant covering the whole total is valid", () => {
    // 100 + 0 + 0 sums exactly, so this is a legitimate split, not an error.
    const splits = splitExact(100, THREE, { [AYUSH]: "100" });
    assert.deepEqual(amounts(splits), ["100.00", "0.00", "0.00"]);
  });
});

describe("splitPercentage", () => {
  test("splits by percentage", () => {
    const splits = splitPercentage(250, THREE, {
      [AYUSH]: "50",
      [RAHUL]: "30",
      [PRIYA]: "20",
    });
    assert.deepEqual(amounts(splits), ["125.00", "75.00", "50.00"]);
    assertExact(splits, 250, "percentage");
  });

  test("awkward percentages still sum exactly", () => {
    const splits = splitPercentage(100, THREE, {
      [AYUSH]: "33.34",
      [RAHUL]: "33.33",
      [PRIYA]: "33.33",
    });
    assertExact(splits, 100, "awkward percentage");
  });

  test("rejects a total over 100", () => {
    assert.throws(
      () => splitPercentage(100, [AYUSH, RAHUL], { [AYUSH]: "60", [RAHUL]: "50" }),
      (e) => e instanceof SplitError && /110.00%/.test(e.message)
    );
  });

  test("reports how much percentage remains", () => {
    assert.throws(
      () => splitPercentage(100, [AYUSH, RAHUL], { [AYUSH]: "60", [RAHUL]: "30" }),
      (e) => e instanceof SplitError && /10.00% remaining/.test(e.message)
    );
  });

  test("100% to one participant is valid", () => {
    const splits = splitPercentage(100, [AYUSH, RAHUL], {
      [AYUSH]: "100",
      [RAHUL]: "0",
    });
    assert.deepEqual(amounts(splits), ["100.00", "0.00"]);
  });

  test("rejects negative percentages", () => {
    assert.throws(
      () => splitPercentage(100, [AYUSH, RAHUL], { [AYUSH]: "110", [RAHUL]: "-10" }),
      SplitError
    );
  });
});

describe("splitShares", () => {
  test("weights the split", () => {
    const splits = splitShares(400, THREE, {
      [AYUSH]: 2,
      [RAHUL]: 1,
      [PRIYA]: 1,
    });
    assert.deepEqual(amounts(splits), ["200.00", "100.00", "100.00"]);
    assertExact(splits, 400, "shares");
  });

  test("a zero share means paying nothing", () => {
    const splits = splitShares(100, THREE, { [AYUSH]: 1, [RAHUL]: 1, [PRIYA]: 0 });
    assert.equal(splits[2].shareAmount.toFixed(2), "0.00");
    assertExact(splits, 100, "zero share");
  });

  test("all-zero shares are rejected", () => {
    assert.throws(
      () => splitShares(100, THREE, { [AYUSH]: 0, [RAHUL]: 0, [PRIYA]: 0 }),
      SplitError
    );
  });

  test("fractional shares work", () => {
    const splits = splitShares(100, [AYUSH, RAHUL], { [AYUSH]: "1.5", [RAHUL]: "0.5" });
    assert.deepEqual(amounts(splits), ["75.00", "25.00"]);
  });

  test("awkward share ratios still sum exactly", () => {
    const splits = splitShares(100, THREE, { [AYUSH]: 1, [RAHUL]: 1, [PRIYA]: 1 });
    assertExact(splits, 100, "1:1:1 shares");
  });
});

describe("splitCustom (adjustment mode)", () => {
  test("adjustment on top of an equal base", () => {
    // 3000 total, Rahul had a 200 dessert -> base 2800 split 3 ways.
    const splits = splitCustom(3000, THREE, { [RAHUL]: "200" });
    const byId = Object.fromEntries(
      splits.map((s) => [s.userId, s.shareAmount.toFixed(2)])
    );

    assert.equal(byId[RAHUL], "1133.33");
    assertExact(splits, 3000, "custom adjustment");
  });

  test("no adjustments behaves exactly like an equal split", () => {
    const custom = splitCustom(100, THREE, {});
    const equal = splitEqual(100, THREE);
    assert.deepEqual(amounts(custom), amounts(equal));
  });

  test("negative adjustments are allowed", () => {
    const splits = splitCustom(300, THREE, { [PRIYA]: "-30" });
    const byId = Object.fromEntries(
      splits.map((s) => [s.userId, s.shareAmount.toFixed(2)])
    );
    assert.equal(byId[PRIYA], "80.00");
    assertExact(splits, 300, "negative adjustment");
  });

  test("adjustments exceeding the total are rejected", () => {
    assert.throws(() => splitCustom(100, THREE, { [AYUSH]: "500" }), SplitError);
  });

  test("an adjustment producing a negative share is rejected", () => {
    assert.throws(
      () => splitCustom(300, THREE, { [PRIYA]: "-200", [AYUSH]: "200" }),
      (e) => e instanceof SplitError && /negative share/.test(e.message)
    );
  });

  test("the payer absorbs the leftover on the base portion", () => {
    const splits = splitCustom(100, THREE, {}, { payerId: RAHUL });
    const byId = Object.fromEntries(
      splits.map((s) => [s.userId, s.shareAmount.toFixed(2)])
    );
    assert.equal(byId[RAHUL], "33.34");
  });
});

describe("splitItemized", () => {
  test("is not implemented yet and says so", () => {
    assert.throws(
      () => splitItemized(),
      (e) => e instanceof SplitError && e.code === "NOT_IMPLEMENTED"
    );
  });
});

describe("computeSplit dispatcher", () => {
  test("routes each method", () => {
    assert.equal(
      computeSplit({ method: "EQUAL", total: 90, participantIds: THREE }).length,
      3
    );
    assert.equal(
      computeSplit({
        method: "SHARES",
        total: 90,
        participantIds: THREE,
        values: { [AYUSH]: 1, [RAHUL]: 1, [PRIYA]: 1 },
      })[0].shareAmount.toFixed(2),
      "30.00"
    );
  });

  test("rejects an unknown method", () => {
    assert.throws(
      () => computeSplit({ method: "TELEPATHY", total: 90, participantIds: THREE }),
      SplitError
    );
  });

  test("every declared method is routed", () => {
    for (const method of SPLIT_METHODS) {
      const call = () =>
        computeSplit({
          method,
          total: 90,
          participantIds: THREE,
          values: { [AYUSH]: 30, [RAHUL]: 30, [PRIYA]: 30 },
        });

      if (method === "ITEMIZED") {
        assert.throws(call, (e) => e.code === "NOT_IMPLEMENTED");
      } else if (method === "PERCENTAGE") {
        assert.throws(call, SplitError); // 30+30+30 != 100
      } else {
        assert.doesNotThrow(call, `${method} should route`);
      }
    }
  });
});

describe("validateSplit - the gate", () => {
  const good = [
    { userId: AYUSH, shareAmount: "1000.00" },
    { userId: RAHUL, shareAmount: "1000.00" },
    { userId: PRIYA, shareAmount: "1000.00" },
  ];

  test("accepts a correct split", () => {
    const r = validateSplit(3000, good);
    assert.ok(r.ok);
    assert.deepEqual(r.errors, []);
    assert.ok(r.difference.isZero());
  });

  test("rejects a tampered payload that does not sum", () => {
    const tampered = [...good.slice(0, 2), { userId: PRIYA, shareAmount: "0.01" }];
    const r = validateSplit(3000, tampered);
    assert.ok(!r.ok);
    assert.match(r.errors[0], /add up to/);
  });

  test("rejects duplicate participants", () => {
    const r = validateSplit(2000, [
      { userId: AYUSH, shareAmount: "1000.00" },
      { userId: AYUSH, shareAmount: "1000.00" },
    ]);
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => /twice/.test(e)));
  });

  test("rejects a negative share", () => {
    const r = validateSplit(100, [
      { userId: AYUSH, shareAmount: "150.00" },
      { userId: RAHUL, shareAmount: "-50.00" },
    ]);
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => /negative/.test(e)));
  });

  test("rejects sub-paisa precision", () => {
    const r = validateSplit(100, [
      { userId: AYUSH, shareAmount: "50.005" },
      { userId: RAHUL, shareAmount: "49.995" },
    ]);
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => /precision/.test(e)));
  });

  test("rejects empty splits", () => {
    assert.ok(!validateSplit(100, []).ok);
    assert.ok(!validateSplit(100, null).ok);
  });

  test("rejects a zero or negative total", () => {
    assert.ok(!validateSplit(0, good).ok);
    assert.ok(!validateSplit(-3000, good).ok);
  });

  test("rejects a split missing its participant", () => {
    const r = validateSplit(100, [{ shareAmount: "100.00" }]);
    assert.ok(!r.ok);
  });

  test("assertValidSplit throws on the first error", () => {
    assert.throws(() => assertValidSplit(3000, []), SplitError);
    assert.doesNotThrow(() => assertValidSplit(3000, good));
  });
});

describe("property test: every method sums exactly", () => {
  test("1000 randomized cases across all implemented methods", () => {
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [AYUSH, RAHUL, PRIYA, AMAN, "e", "f", "g"];

    for (let i = 0; i < 1000; i++) {
      const cents = 1 + Math.floor(rand() * 5_000_00);
      const amount = new Decimal(cents).div(100);
      const count = 1 + Math.floor(rand() * people.length);
      const ids = people.slice(0, count);
      const payerId = ids[Math.floor(rand() * ids.length)];

      // EQUAL
      assertExact(splitEqual(amount, ids, { payerId }), amount, `case ${i} EQUAL`);

      // SHARES with random weights, at least one non-zero
      const shares = {};
      let any = false;
      for (const id of ids) {
        const w = Math.floor(rand() * 5);
        shares[id] = w;
        if (w > 0) any = true;
      }
      if (!any) shares[ids[0]] = 1;
      assertExact(splitShares(amount, ids, shares), amount, `case ${i} SHARES`);

      // EXACT built from a valid equal split, so it must validate
      const base = splitEqual(amount, ids);
      const exactValues = Object.fromEntries(
        base.map((s) => [s.userId, s.shareAmount])
      );
      assertExact(
        splitExact(amount, ids, exactValues),
        amount,
        `case ${i} EXACT`
      );

      // CUSTOM with a small adjustment on one participant
      const adjTarget = ids[Math.floor(rand() * ids.length)];
      const adjustments = {};
      const maxAdj = amount.div(ids.length + 1).toNumber();
      if (maxAdj >= 0.02) {
        adjustments[adjTarget] = new Decimal(
          Math.floor(rand() * maxAdj * 100)
        ).div(100);
      }
      assertExact(
        splitCustom(amount, ids, adjustments, { payerId }),
        amount,
        `case ${i} CUSTOM`
      );

      // PERCENTAGE derived from an exact allocation, normalized to 100
      const pctWeights = base.map((s) => s.shareAmount.div(amount).times(100));
      const pctSum = sum(pctWeights);
      // Push any rounding drift onto the first participant so it totals 100.
      pctWeights[0] = pctWeights[0].plus(new Decimal(100).minus(pctSum));
      const pctValues = Object.fromEntries(
        ids.map((id, idx) => [id, pctWeights[idx]])
      );
      assertExact(
        splitPercentage(amount, ids, pctValues),
        amount,
        `case ${i} PERCENTAGE`
      );
    }
  });

  test("every generated split also passes validateSplit", () => {
    let seed = 13579;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const people = [AYUSH, RAHUL, PRIYA, AMAN];

    for (let i = 0; i < 300; i++) {
      const amount = new Decimal(1 + Math.floor(rand() * 100000)).div(100);
      const ids = people.slice(0, 1 + Math.floor(rand() * people.length));
      const splits = splitEqual(amount, ids, { payerId: ids[0] });

      const r = validateSplit(amount, splits);
      assert.ok(r.ok, `case ${i}: ${r.errors.join("; ")}`);
    }
  });
});
