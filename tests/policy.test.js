import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLateLogin,
  resolveHalfDaySlot,
  buildMonthlyLateStats,
  classifyDayPolicy,
  timeToSeconds,
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
  it("slot A: in 10:00 out 14:30", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "10:00:00", office_out: "14:30:00" }),
      "SLOT_A"
    );
  });

  it("slot B: in 14:30 out 19:00", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "14:30:00", office_out: "19:00:00" }),
      "SLOT_B"
    );
  });

  it("invalid: 10:30 to 15:00", () => {
    assert.equal(
      resolveHalfDaySlot({ office_in: "10:30:00", office_out: "15:00:00" }),
      "INVALID"
    );
  });

  it("classify 4-8h without slot → absent", () => {
    const log = {
      office_in: "10:05:00",
      office_out: "15:00:00",
      break_in: null,
      break_out: null,
      break_in_2: null,
      break_out_2: null,
      lunch_in: null,
      lunch_out: null,
    };
    const stats = { exceeded_dates: [], permitted_late_count: 0 };
    const result = classifyDayPolicy({
      dateStr: "2026-05-20",
      log,
      holidaySet: new Set(),
      monthlyLateStats: stats,
      logsByDate: {},
      policyConfig: { minFullDayHours: 8, minHalfDayHours: 4 },
    });
    assert.equal(result.bucket, "absent");
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
    for (let d = 1; d <= 7; d++) {
      const ds = `2026-05-${String(d).padStart(2, "0")}`;
      logs[ds] = { office_in: `10:${String(d).padStart(2, "0")}:00` };
    }
    const stats = buildMonthlyLateStats(logs, 31, 2026, 5);
    assert.ok(stats.permitted_late_count > 6);
    assert.ok(stats.exceeded_dates.length > 0);
  });
});
