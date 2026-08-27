import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RECURRING_INTERVALS,
  RecurringError,
  startOfDayUTC,
  periodKeyFor,
  advance,
  isDue,
  duePeriods,
  nextRunAfter,
  isExhausted,
  validateRecurringInput,
  describeSchedule,
} from "./recurring.js";

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(`${s}T00:00:00.000Z`);

const template = (over = {}) => ({
  isActive: true,
  interval: "MONTHLY",
  every: 1,
  nextRunDate: utc("2026-04-01"),
  endDate: null,
  ...over,
});

describe("advance", () => {
  test("daily", () => {
    assert.equal(iso(advance(utc("2026-04-01"), "DAILY")), "2026-04-02");
    assert.equal(iso(advance(utc("2026-04-01"), "DAILY", 3)), "2026-04-04");
  });

  test("weekly, including fortnightly via every=2", () => {
    assert.equal(iso(advance(utc("2026-04-01"), "WEEKLY")), "2026-04-08");
    assert.equal(iso(advance(utc("2026-04-01"), "WEEKLY", 2)), "2026-04-15");
  });

  test("monthly", () => {
    assert.equal(iso(advance(utc("2026-04-01"), "MONTHLY")), "2026-05-01");
    assert.equal(iso(advance(utc("2026-04-15"), "MONTHLY", 3)), "2026-07-15");
  });

  test("yearly", () => {
    assert.equal(iso(advance(utc("2026-04-01"), "YEARLY")), "2027-04-01");
  });

  test("month-end clamps instead of overflowing", () => {
    // Rent on the 31st must not skip February by rolling into March.
    assert.equal(iso(advance(utc("2026-01-31"), "MONTHLY")), "2026-02-28");
    assert.equal(iso(advance(utc("2026-03-31"), "MONTHLY")), "2026-04-30");
  });

  test("leap year is handled", () => {
    assert.equal(iso(advance(utc("2028-01-31"), "MONTHLY")), "2028-02-29");
    assert.equal(iso(advance(utc("2028-02-29"), "YEARLY")), "2029-02-28");
  });

  test("crossing a year boundary", () => {
    assert.equal(iso(advance(utc("2026-12-15"), "MONTHLY")), "2027-01-15");
  });

  test("rejects bad input", () => {
    assert.throws(() => advance(utc("2026-04-01"), "HOURLY"), RecurringError);
    assert.throws(() => advance(utc("2026-04-01"), "DAILY", 0), RecurringError);
    assert.throws(() => advance(utc("2026-04-01"), "DAILY", 1.5), RecurringError);
    assert.throws(() => advance("not-a-date", "DAILY"), RecurringError);
  });

  test("does not mutate its input", () => {
    const d = utc("2026-04-01");
    advance(d, "MONTHLY");
    assert.equal(iso(d), "2026-04-01");
  });
});

describe("periodKey - the idempotency key", () => {
  test("is the scheduled date, normalised to UTC midnight", () => {
    assert.equal(periodKeyFor(utc("2026-04-01")), "2026-04-01");
  });

  test("is identical regardless of the time of day the cron fires", () => {
    // The same occurrence run at 00:01 and at 23:59 must collide.
    const early = new Date("2026-04-01T00:01:00.000Z");
    const late = new Date("2026-04-01T23:59:00.000Z");
    assert.equal(periodKeyFor(early), periodKeyFor(late));
  });

  test("differs between occurrences of a fortnightly schedule in one month", () => {
    // A coarser key like "2026-04" would collide here and lose an expense.
    const first = utc("2026-04-01");
    const second = advance(first, "WEEKLY", 2);
    assert.notEqual(periodKeyFor(first), periodKeyFor(second));
  });

  test("successive periods never repeat a key", () => {
    for (const interval of ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
      const seen = new Set();
      let cursor = utc("2026-01-31");
      for (let i = 0; i < 40; i++) {
        const key = periodKeyFor(cursor);
        assert.ok(!seen.has(key), `${interval} repeated key ${key}`);
        seen.add(key);
        cursor = advance(cursor, interval);
      }
    }
  });
});

describe("isDue", () => {
  test("due on and after the scheduled date", () => {
    assert.ok(isDue(template(), utc("2026-04-01")));
    assert.ok(isDue(template(), utc("2026-04-05")));
  });

  test("not due before", () => {
    assert.ok(!isDue(template(), utc("2026-03-31")));
  });

  test("paused templates never run", () => {
    assert.ok(!isDue(template({ isActive: false }), utc("2026-05-01")));
  });

  test("not due past the end date", () => {
    const t = template({ endDate: utc("2026-03-01") });
    assert.ok(!isDue(t, utc("2026-04-01")));
  });

  test("the end date is inclusive", () => {
    const t = template({ nextRunDate: utc("2026-04-01"), endDate: utc("2026-04-01") });
    assert.ok(isDue(t, utc("2026-04-01")));
  });

  test("missing template is not due", () => {
    assert.ok(!isDue(null));
  });
});

describe("duePeriods - catch-up", () => {
  test("one period when exactly due", () => {
    const periods = duePeriods(template(), utc("2026-04-01"));
    assert.equal(periods.length, 1);
    assert.equal(periods[0].periodKey, "2026-04-01");
  });

  test("catches up on missed runs rather than skipping them", () => {
    // Cron was down for three months.
    const periods = duePeriods(template(), utc("2026-06-15"));
    assert.deepEqual(
      periods.map((p) => p.periodKey),
      ["2026-04-01", "2026-05-01", "2026-06-01"]
    );
  });

  test("catch-up is capped so an old template cannot flood the ledger", () => {
    const t = template({ nextRunDate: utc("2020-01-01"), interval: "DAILY" });
    assert.equal(duePeriods(t, utc("2026-04-01")).length, 12);
    assert.equal(duePeriods(t, utc("2026-04-01"), { max: 3 }).length, 3);
  });

  test("stops at the end date", () => {
    const t = template({ endDate: utc("2026-05-01") });
    assert.deepEqual(
      duePeriods(t, utc("2026-08-01")).map((p) => p.periodKey),
      ["2026-04-01", "2026-05-01"]
    );
  });

  test("nothing when not yet due", () => {
    assert.deepEqual(duePeriods(template(), utc("2026-03-01")), []);
  });

  test("nothing when paused", () => {
    assert.deepEqual(duePeriods(template({ isActive: false }), utc("2026-09-01")), []);
  });

  test("every period key in a catch-up run is unique", () => {
    const periods = duePeriods(
      template({ nextRunDate: utc("2026-01-01"), interval: "DAILY" }),
      utc("2026-01-20")
    );
    const keys = periods.map((p) => p.periodKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("nextRunAfter / isExhausted", () => {
  test("advances by the template's own cadence", () => {
    assert.equal(
      iso(nextRunAfter(template({ interval: "WEEKLY", every: 2 }), utc("2026-04-01"))),
      "2026-04-15"
    );
  });

  test("exhausted once the next run passes the end date", () => {
    const t = template({ endDate: utc("2026-04-30") });
    assert.ok(!isExhausted(t, utc("2026-04-15")));
    assert.ok(isExhausted(t, utc("2026-05-01")));
  });

  test("a template with no end date never exhausts", () => {
    assert.ok(!isExhausted(template(), utc("2099-01-01")));
  });
});

describe("validateRecurringInput", () => {
  test("accepts a valid template", () => {
    const r = validateRecurringInput({
      description: "  Monthly rent  ",
      interval: "MONTHLY",
      startDate: utc("2026-04-01"),
    });
    assert.equal(r.description, "Monthly rent");
    assert.equal(r.interval, "MONTHLY");
    assert.equal(r.every, 1);
    assert.equal(iso(r.nextRunDate), "2026-04-01");
    assert.equal(r.endDate, null);
  });

  test("rejects an empty description", () => {
    assert.throws(() => validateRecurringInput({ interval: "MONTHLY" }), RecurringError);
  });

  test("rejects an unknown interval", () => {
    assert.throws(
      () => validateRecurringInput({ description: "x", interval: "HOURLY" }),
      RecurringError
    );
  });

  test("rejects a silly repeat count", () => {
    for (const every of [0, -1, 1.5, 53]) {
      assert.throws(
        () => validateRecurringInput({ description: "x", interval: "WEEKLY", every }),
        RecurringError,
        `every=${every} should be rejected`
      );
    }
  });

  test("rejects an end date before the start", () => {
    assert.throws(
      () =>
        validateRecurringInput({
          description: "x",
          interval: "MONTHLY",
          startDate: utc("2026-04-01"),
          endDate: utc("2026-03-01"),
        }),
      RecurringError
    );
  });

  test("an end date equal to the start is allowed - one occurrence", () => {
    assert.doesNotThrow(() =>
      validateRecurringInput({
        description: "x",
        interval: "MONTHLY",
        startDate: utc("2026-04-01"),
        endDate: utc("2026-04-01"),
      })
    );
  });
});

describe("describeSchedule", () => {
  test("singular and plural", () => {
    assert.equal(describeSchedule({ interval: "MONTHLY" }), "Every month");
    assert.equal(describeSchedule({ interval: "WEEKLY", every: 2 }), "Every 2 weeks");
    assert.equal(describeSchedule({ interval: "DAILY", every: 3 }), "Every 3 days");
  });

  test("every declared interval renders", () => {
    for (const { value } of RECURRING_INTERVALS) {
      const s = describeSchedule({ interval: value });
      assert.ok(s.startsWith("Every "), `${value} rendered as ${s}`);
      assert.ok(!s.includes("undefined"));
    }
  });

  test("unknown interval is visible, not blank", () => {
    assert.equal(describeSchedule({ interval: "NOPE" }), "Unknown schedule");
  });
});

describe("startOfDayUTC", () => {
  test("normalises away the time of day", () => {
    assert.equal(
      startOfDayUTC(new Date("2026-04-01T18:45:00.000Z")).toISOString(),
      "2026-04-01T00:00:00.000Z"
    );
  });

  test("rejects an invalid date", () => {
    assert.throws(() => startOfDayUTC("nonsense"), RecurringError);
  });
});
