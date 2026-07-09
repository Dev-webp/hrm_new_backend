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
    ["10:05:00", 0],
    ["10:10:00", 0],
    ["10:12:00", 0],
    ["10:15:00", 0],
    ["10:16:00", 1],
    ["10:20:00", 5],
    ["10:29:00", 14],
    ["10:30:00", 0],
    ["10:35:00", 0],
    ["11:00:00", 0],
    ["16:10:00", 0],
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

  it("10:10 is on-time grace and not late", () => {
    const r = evaluateLateLogin({ office_in: "10:10:00" });
    assert.equal(r.is_late, false);
    assert.equal(r.is_on_time_grace, true);
    assert.equal(r.is_beyond_grace, false);
  });

  it("10:20 is in the late login window", () => {
    const r = evaluateLateLogin({ office_in: "10:20:00" });
    assert.equal(r.is_late, true);
    assert.equal(r.is_late_window, true);
    assert.equal(r.is_beyond_grace, false);
  });

  it("10:31 is late and beyond the full-day login window", () => {
    const r = evaluateLateLogin({ office_in: "10:31:00" });
    assert.equal(r.is_late, true);
    assert.equal(r.is_late_window, false);
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
  it("9:50 to 19:00 with 9 gross hours from office start is full day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "09:50:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
  });

  it("10:12 to 19:00 is half day because early login worked at least 4 hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:12:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("early_login_morning_half_day"));
  });

  it("10:12 to 19:12 is full day within on-time grace", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:12:00", office_out: "19:12:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.ok(result.flags.includes("within_on_time_grace"));
  });

  it("10:20 to 19:20 is full day but counts as late login", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:20:00", office_out: "19:20:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.ok(result.flags.includes("late_login_window"));
  });

  it("10:06 to 19:06 is full day even with a normal break because full day uses gross hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-07-04",
      log: {
        office_in: "10:06:00",
        office_out: "19:06:00",
        total_break_minutes: 45,
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.equal(result.gross_hours, 9);
    assert.equal(result.net_hours, 8.25);
    assert.ok(result.flags.includes("full_day_policy_satisfied"));
  });

  it("10:30 to 15:00 is half day when gross duration is at least 4 hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:30:00", office_out: "15:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("half_day_login_window"));
  });

  it("11:30 to 15:30 with 4 total hours is half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "11:30:00", office_out: "15:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.gross_hours, 4);
    assert.equal(result.net_hours, 4);
    assert.ok(result.flags.includes("late_after_10_30"));
  });

  it("14:30 to 19:00 is afternoon half day with required checkout met", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "14:30:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.half_day_slot, "SLOT_B");
    assert.equal(result.attendance_track, "afternoon_half_day");
    assert.equal(result.required_checkout_time, "18:30:00");
  });

  it("10:00 to 14:15 is half day because early login worked at least 4 hours", () => {
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
    assert.ok(result.flags.includes("early_login_morning_half_day"));
  });

  it("10:00 to 14:00 with a 15 minute break is half day because half day uses gross hours", () => {
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

    assert.equal(result.bucket, "half_day");
    assert.equal(result.gross_hours, 4);
    assert.equal(result.net_hours, 3.75);
    assert.ok(result.flags.includes("early_login_morning_half_day"));
  });

  it("10:05 to 14:30 is half day because early login worked at least 4 hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:05:00", office_out: "14:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("early_login_morning_half_day"));
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
    assert.equal(result.attendance_track, "afternoon_half_day");
    assert.equal(result.required_checkout_time, "18:45:00");
  });

  it("14:35 to 19:00 is afternoon half day when required checkout is met", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "14:35:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("afternoon_half_day_track"));
    assert.equal(result.required_checkout_time, "18:35:00");
  });

  it("less than 4 gross hours is absent", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:00:00", office_out: "13:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.ok(result.flags.includes("less_than_4_gross_hours"));
  });

  it("pre-10:30 login with 4 to less than 9 gross hours is half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:05:00", office_out: "15:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("early_login_morning_half_day"));
  });

  it("10:00 to 18:00 with 8 gross hours is half day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:00:00", office_out: "18:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("early_login_morning_half_day"));
  });

  it("10:00 to 19:00 with a 1 hour break is full day with 9 gross hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "19:00:00",
        break_in: "12:00:00",
        break_out: "13:00:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.equal(result.gross_hours, 9);
    assert.equal(result.net_hours, 8);
  });

  it("10:00 to 19:00 with a 61 minute break is half day because break limit is exceeded", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "19:00:00",
        break_in: "11:00:00",
        break_out: "12:01:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.total_break_minutes, 61);
    assert.equal(result.break_exceeded, true);
    assert.ok(result.flags.includes("break_exceeded"));
  });

  it("10:10 to 19:10 with a 1 hour break is full day within on-time grace", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:10:00",
        office_out: "19:10:00",
        break_in: "12:00:00",
        break_out: "13:00:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.equal(result.gross_hours, 9);
    assert.equal(result.net_hours, 8);
    assert.ok(result.flags.includes("within_on_time_grace"));
  });

  it("deducts breaks from morning half-day production", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "14:30:00",
        break_in: "12:00:00",
        break_out: "12:30:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.gross_hours, 4.5);
    assert.equal(result.net_hours, 4);
  });

  it("deducts breaks from afternoon half-day production", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "14:30:00",
        office_out: "19:00:00",
        break_in: "16:00:00",
        break_out: "16:30:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.net_hours, 4);
    assert.equal(result.required_checkout_time, "19:00:00");
  });

  it("01:46 to 14:46 uses gross login-to-logout hours and is full day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-07-06",
      log: {
        office_in: "01:46:00",
        office_out: "14:46:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.equal(result.net_hours, 13);
    assert.equal(result.gross_hours, 13);
  });

  it("10:00 to 19:00 with 9 gross hours is full day", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: {
        office_in: "10:00:00",
        office_out: "19:00:00",
      },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
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
  it("counts all late-window logins with no monthly cap", () => {
    const logs = {};
    for (let d = 1; d <= 7; d += 1) {
      const ds = `2026-05-${String(d).padStart(2, "0")}`;
      logs[ds] = { office_in: `10:${String(14 + d).padStart(2, "0")}:00` };
    }
    const stats = buildMonthlyLateStats(logs, 31, 2026, 5);
    assert.equal(stats.permitted_late_count, 7);
    assert.equal(stats.late_login_count, 7);
    assert.equal(stats.actual_grace_late_count, 7);
    assert.deepEqual(stats.exceeded_dates, []);
  });

  it("counts morning-track 10:15 or later logins as late, excluding afternoon track", () => {
    const logs = {
      "2026-05-01": { office_in: "10:01:00" },
      "2026-05-02": { office_in: "10:20:00" },
      "2026-05-03": { office_in: "14:30:00" },
      "2026-05-04": { office_in: "10:31:00" },
      "2026-05-05": { office_in: "10:00:00" },
      "2026-05-06": { office_in: "10:15:00" },
      "2026-05-07": { office_in: "10:29:00" },
    };
    const stats = buildMonthlyLateStats(logs, 31, 2026, 5);
    assert.equal(stats.late_login_count, 4);
    assert.equal(stats.within_grace_late_count, 3);
    assert.equal(stats.beyond_grace_late_count, 1);
  });

  it("does not downgrade because of a monthly late-login cap", () => {
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
    assert.equal(result.reason, "Afternoon half-day required checkout met");
    assert.equal(result.required_checkout_time, "19:00:00");
  });

  it("marks login after 2:30 PM half day when required checkout is met", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-09",
      log: { office_in: "14:31:00", office_out: "19:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: ["2026-05-09"] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.equal(result.reason, "Afternoon half-day required checkout met");
    assert.ok(result.flags.includes("afternoon_half_day_track"));
  });
});
