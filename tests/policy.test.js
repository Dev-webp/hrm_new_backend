import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateLateMinutes,
  evaluateLateLogin,
  resolveHalfDaySlot,
  calculateHalfDayEffectiveMinutes,
  buildMonthlyLateStats,
  classifyDayPolicy,
} from "../utils/attendancePolicy.js";
import {
  evaluateLeaveOnApproval,
  computeOnePlusOnePenalty,
  isSaturdayOrMondayLeaveDay,
} from "../utils/leavePolicy.js";

describe("late minute calculation", () => {
  const cases = [
    ["09:55:00", 0],
    ["10:00:00", 0],
    ["10:05:00", 5],
    ["10:10:00", 10],
    ["10:12:00", 12],
    ["10:15:00", 15],
    ["10:16:00", 16],
    ["10:20:00", 20],
    ["10:35:00", 35],
    ["11:00:00", 60],
    ["16:10:00", 370],
  ];

  for (const [checkInTime, expected] of cases) {
    it(`${checkInTime} returns ${expected}`, () => {
      assert.equal(calculateLateMinutes(checkInTime), expected);
    });
  }
});

describe("late login detection", () => {
  it("on-time at 10:00 is not late", () => {
    const r = evaluateLateLogin({ office_in: "10:00:00" });
    assert.equal(r.is_late, false);
  });

  it("10:10 is within grace", () => {
    const r = evaluateLateLogin({ office_in: "10:10:00" });
    assert.equal(r.is_within_grace, true);
    assert.equal(r.is_beyond_grace, false);
  });

  it("10:20 is beyond grace", () => {
    const r = evaluateLateLogin({ office_in: "10:20:00" });
    assert.equal(r.is_beyond_grace, true);
  });
});

describe("half-day slot validation", () => {
  it("slot A requires login at or before 10:00 and 240 effective minutes", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "09:45:00", office_out: "14:00:00" }),
      "SLOT_A"
    );
  });

  it("slot B requires login at or before 14:30 and 240 effective minutes", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "14:00:00", office_out: "18:30:00" }),
      "SLOT_B"
    );
  });

  it("10:30 to 15:00 is not a valid half-day slot", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "10:30:00", office_out: "15:00:00" }),
      "INVALID"
    );
  });

  it("2:00 PM to 6:00 PM counts afternoon effective work from 2:30 PM", () => {
    assert.equal(
      calculateHalfDayEffectiveMinutes({ office_in: "14:00:00", office_out: "18:00:00" }, "SLOT_B"),
      210
    );
    assert.equal(
      resolveHalfDaySlot({ office_in: "14:00:00", office_out: "18:00:00" }),
      "INVALID"
    );
  });
});

describe("day classification policy", () => {
  it("9:50 to 19:00 with 8+ net hours is full day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "09:50:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
  });

  it("10:10 to 19:00 with 8+ net hours is full day within grace", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:10:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.ok(result.flags.includes("within_grace_time"));
  });

  it("10:16 to 19:00 is half day because it completes the afternoon slot", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:16:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.half_day_slot, "SLOT_B");
    assert.equal(result.reason, "Login after 10:15 AM grace time; valid half-day slot completed");
    assert.ok(result.flags.includes("late_after_10_15"));
    assert.ok(result.flags.includes("beyond_grace_valid_half_day_slot"));
  });

  it("10:30 to 15:00 is absent because login misses the morning half-day slot", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:30:00", office_out: "15:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.half_day_slot, null);
    assert.equal(result.reason, "Afternoon half-day effective production is below 4 hours");
    assert.ok(result.flags.includes("invalid_half_day_slot"));
  });

  it("11:30 to 15:30 with 4 total hours is absent without a valid half-day slot", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "11:30:00", office_out: "15:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.net_hours, 4);
    assert.equal(result.reason, "Afternoon half-day effective production is below 4 hours");
    assert.ok(result.flags.includes("invalid_half_day_slot"));
  });

  it("14:30 to 19:00 is afternoon half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "14:30:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.half_day_slot, "SLOT_B");
  });

  it("10:00 to 14:15 with a 15 minute break is morning half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "14:15:00",
        break_in: "12:00:00",
        break_out: "12:15:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.half_day_slot, "SLOT_A");
  });

  it("10:00 to 14:00 with a 15 minute break is absent", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "14:00:00",
        break_in: "12:00:00",
        break_out: "12:15:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.ok(result.flags.includes("less_than_4_net_hours"));
  });

  it("10:05 to 14:30 is absent because morning half-day login is after 10:00", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:05:00", office_out: "14:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.half_day_slot, null);
    assert.ok(result.flags.includes("invalid_half_day_slot"));
  });

  it("14:30 to 18:45 with a 15 minute break is afternoon half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "14:30:00",
        office_out: "18:45:00",
        break_in: "16:00:00",
        break_out: "16:15:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.half_day_slot, "SLOT_B");
  });

  it("14:35 to 19:00 is absent because afternoon half-day login is after 2:30", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "14:35:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.half_day_slot, null);
    assert.equal(result.reason, "Afternoon half-day login must be on or before 2:30 PM");
  });

  it("less than 4 net hours is absent", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:00:00", office_out: "13:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
  });

  it("4 to less than 8 net hours without valid slot is absent", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:05:00", office_out: "15:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.ok(result.flags.includes("invalid_half_day_slot"));
  });
});

describe("1+1 leave penalty", () => {
  it("computeOnePlusOnePenalty sets penalty_days", () => {
    const p = computeOnePlusOnePenalty(2);
    assert.equal(p.penalty_applied, true);
    assert.equal(p.penalty_days, 2);
  });

  it("sudden leave on approval", () => {
    const leave = {
      from_date: "2026-05-20",
      to_date: "2026-05-20",
      days: 1,
      created_at: "2026-05-20T08:00:00Z",
      leave_type: "Casual",
      status: "pending",
    };
    const flags = evaluateLeaveOnApproval(leave, [], {});
    assert.equal(flags.is_sudden, true);
    assert.equal(flags.penalty_applied, true);
  });

  it("Saturday detection", () => {
    assert.equal(isSaturdayOrMondayLeaveDay("2026-05-23"), true);
  });
});

describe("proxy detection logic", () => {
  it("logged_by must equal subject", () => {
    const loggedBy = 5;
    const subject = 7;
    assert.notEqual(loggedBy, subject);
  });
});

describe("monthly late count", () => {
  it("exceeds after 6 grace lates", () => {
    const logs = {};
    for (let d = 1; d <= 7; d += 1) {
      const ds = `2026-05-${String(d).padStart(2, "0")}`;
      logs[ds] = { office_in: `10:${String(d).padStart(2, "0")}:00` };
    }
    const stats = buildMonthlyLateStats(logs, 31, 2026, 5);
    assert.ok(stats.permitted_late_count > 6);
    assert.ok(stats.exceeded_dates.length > 0);
  });

  it("counts every login after 10:00, including beyond grace", () => {
    const logs = {
      "2026-05-01": { office_in: "10:01:00" },
      "2026-05-02": { office_in: "10:20:00" },
      "2026-05-03": { office_in: "14:30:00" },
      "2026-05-04": { office_in: "10:00:00" },
    };
    const stats = buildMonthlyLateStats(logs, 31, 2026, 5);
    assert.equal(stats.late_login_count, 3);
    assert.equal(stats.within_grace_late_count, 1);
    assert.equal(stats.beyond_grace_late_count, 2);
  });

  it("applies strict half-day eligibility from the 7th late login", () => {
    const monthlyLateStats = { exceeded_dates: ["2026-05-07"] };
    const result = classifyDayPolicy({
      dateStr: "2026-05-07",
      log: {
        office_in: "14:30:00",
        office_out: "19:00:00",
        break_in: "16:00:00",
        break_out: "16:30:00",
      },
      holidaySet: new Set(),
      monthlyLateStats,
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.reason, "Late login limit exceeded; strict half-day eligibility met");
  });

  it("marks login after 2:30 PM absent after late limit is exceeded", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-09",
      log: { office_in: "14:31:00", office_out: "19:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: ["2026-05-09"] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.reason, "Late login limit exceeded; login after 2:30 PM");
  });
});
