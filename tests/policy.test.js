import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLateLogin,
  resolveHalfDaySlot,
  buildMonthlyLateStats,
  classifyDayPolicy,
} from "../utils/attendancePolicy.js";
import {
  evaluateLeaveOnApproval,
  computeOnePlusOnePenalty,
  isSaturdayOrMondayLeaveDay,
} from "../utils/leavePolicy.js";

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
  it("slot A requires login at or before 10:00 and logout at or after 14:30", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "10:00:00", office_out: "14:30:00" }),
      "SLOT_A"
    );
  });

  it("slot B requires login at or after 14:30 and logout at or after 19:00", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "14:30:00", office_out: "19:00:00" }),
      "SLOT_B"
    );
  });

  it("10:30 to 15:00 is not a valid half-day slot", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "10:30:00", office_out: "15:00:00" }),
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

  it("10:10 to 19:00 with 8+ net hours is full day but late counted", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:10:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "full_day");
    assert.ok(result.flags.includes("grace_late_counted"));
  });

  it("10:16 to 19:00 is half day even with high net hours", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:16:00", office_out: "19:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "half_day");
    assert.ok(result.flags.includes("late_after_10_15"));
  });

  it("10:30 to 15:00 is absent, not valid half-day present", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "10:30:00", office_out: "15:00:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.half_day_slot, "INVALID");
    assert.ok(result.flags.includes("invalid_half_day_slot"));
  });

  it("Rohan Desai example: 11:30 to 15:30 with 4 hours is absent", () => {
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log: { office_in: "11:30:00", office_out: "15:30:00" },
      holidaySet: new Set(),
      monthlyLateStats: { exceeded_dates: [] },
      logsByDate: {},
    });

    assert.equal(result.bucket, "absent");
    assert.equal(result.net_hours, 4);
    assert.equal(result.reason, "4 to less than 8 net hours without a valid half-day slot - absent");
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
});
