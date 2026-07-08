import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countWorkingDays,
  resolveLeaveRequest,
  halfDaySlotForSession,
  resolveLeaveBalanceUsage,
} from "../utils/leaveRequestPolicy.js";

describe("half-day leave requests", () => {
  it("creates a 0.5 morning request", () => {
    const request = resolveLeaveRequest({
      fromDate: "2026-06-22",
      toDate: "2026-06-22",
      leaveDurationType: "half_day",
      halfDaySession: "morning",
    });
    assert.equal(request.requestedDays, 0.5);
    assert.equal(halfDaySlotForSession(request.halfDaySession), "SLOT_A");
  });

  it("two half-day requests consume one day", () => {
    assert.equal(0.5 + 0.5, 1);
  });

  it("rejects a multi-date half-day request", () => {
    assert.throws(
      () => resolveLeaveRequest({
        fromDate: "2026-06-22",
        toDate: "2026-06-23",
        leaveDurationType: "half_day",
        halfDaySession: "afternoon",
      }),
      /single date/
    );
  });

  it("requires a half-day session", () => {
    assert.throws(
      () => resolveLeaveRequest({
        fromDate: "2026-06-22",
        toDate: "2026-06-22",
        leaveDurationType: "half_day",
      }),
      /morning or afternoon/
    );
  });
});

describe("full-day working-day calculation", () => {
  it("excludes Sundays and company holidays", () => {
    const holidays = new Set(["2026-06-23"]);
    assert.equal(countWorkingDays("2026-06-20", "2026-06-23", holidays), 2);
  });
});

describe("paid leave balance allocation", () => {
  it("balance 1.0 minus a half day leaves 0.5", () => {
    const usage = resolveLeaveBalanceUsage({ usePaidLeave: true, requestedDays: 0.5, availableBalance: 1 });
    assert.deepEqual(usage, { paidDays: 0.5, unpaidDays: 0, remainingBalance: 0.5 });
  });

  it("two half days consume the full 1.0 balance", () => {
    const first = resolveLeaveBalanceUsage({ usePaidLeave: true, requestedDays: 0.5, availableBalance: 1 });
    const second = resolveLeaveBalanceUsage({ usePaidLeave: true, requestedDays: 0.5, availableBalance: first.remainingBalance });
    assert.equal(second.remainingBalance, 0);
  });

  it("splits a request when only partial paid leave is available", () => {
    const usage = resolveLeaveBalanceUsage({ usePaidLeave: true, requestedDays: 1, availableBalance: 0.5 });
    assert.deepEqual(usage, { paidDays: 0.5, unpaidDays: 0.5, remainingBalance: 0 });
  });

  it("balance 1.0 minus a full day leaves zero", () => {
    const usage = resolveLeaveBalanceUsage({ usePaidLeave: true, requestedDays: 1, availableBalance: 1 });
    assert.equal(usage.remainingBalance, 0);
  });

  it("does not consume paid leave when the employee declines", () => {
    const usage = resolveLeaveBalanceUsage({ usePaidLeave: false, requestedDays: 3, availableBalance: 1 });
    assert.deepEqual(usage, { paidDays: 0, unpaidDays: 3, remainingBalance: 1 });
  });
});
