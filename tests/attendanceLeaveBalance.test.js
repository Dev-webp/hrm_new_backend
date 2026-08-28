import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAttendanceLeaveBalanceDelta,
  getAttendanceLeaveBalanceDelta,
} from "../utils/leaveBalanceTransition.js";

describe("manual attendance leave balance transitions", () => {
  const cases = [
    ["absent to paid leave", "absent", "paid_leave", 1, 0],
    ["full day to paid leave", "full_day", "paid_leave", 1, 0],
    ["half day to paid leave", "half_day", "paid_leave", 1, 0],
    ["paid leave saved again", "paid_leave", "paid_leave", 0, 0],
    ["paid leave restored", "paid_leave", "present", -1, 0],
    ["paid leave converted to unpaid", "paid_leave", "unpaid_leave", -1, 1],
    ["unpaid leave converted to paid", "unpaid_leave", "paid_leave", 1, -1],
    ["unpaid leave restored", "unpaid_leave", "absent", 0, -1],
    ["unrelated status unchanged", "absent", "absent", 0, 0],
  ];

  for (const [name, oldStatus, newStatus, paid, unpaid] of cases) {
    it(name, () => {
      assert.deepEqual(getAttendanceLeaveBalanceDelta(oldStatus, newStatus), {
        paid_days: paid,
        unpaid_days: unpaid,
      });
    });
  }
});

describe("manual attendance balance application", () => {
  const cases = [
    ["no record to paid leave", null, "paid_leave", 1, 0, 0, 1, 0, 1, 0],
    ["paid leave saved again", "paid_leave", "paid_leave", 0, 1, 0, 0, 0, 1, 0],
    ["paid leave to absent", "paid_leave", "absent", 0, 1, 0, -1, 1, 0, 0],
    ["paid leave to full day", "paid_leave", "full_day", 0, 1, 0, -1, 1, 0, 0],
    ["paid leave to half day", "paid_leave", "half_day", 0, 1, 0, -1, 1, 0, 0],
    ["paid leave to unpaid leave", "paid_leave", "unpaid_leave", 0, 1, 0, -1, 1, 0, 1],
    ["unpaid leave to paid leave", "unpaid_leave", "paid_leave", 1, 0, 1, 1, 0, 1, 0],
    ["unpaid leave saved again", "unpaid_leave", "unpaid_leave", 1, 0, 1, 0, 1, 0, 1],
    ["normal half day", "full_day", "half_day", 1, 0, 0, 0, 1, 0, 0],
  ];

  for (const [name, oldStatus, newStatus, available, paidUsed, unpaidUsed, paid, availableAfter, paidAfter, unpaidAfter] of cases) {
    it(name, () => {
      const result = applyAttendanceLeaveBalanceDelta({
        oldStatus,
        newStatus,
        availablePaidBalance: available,
        targetPaidUsed: paidUsed,
        targetUnpaidUsed: unpaidUsed,
      });
      assert.equal(result.paid_days, paid);
      assert.equal(result.available_after, availableAfter);
      assert.equal(result.target_paid_used_after, paidAfter);
      assert.equal(result.target_unpaid_used_after, unpaidAfter);
    });
  }

  it("rejects paid leave when one full day is unavailable", () => {
    assert.throws(
      () => applyAttendanceLeaveBalanceDelta({
        oldStatus: "absent",
        newStatus: "paid_leave",
        availablePaidBalance: 0.5,
        targetPaidUsed: 0,
        targetUnpaidUsed: 0,
      }),
      { message: "Insufficient paid leave balance. Available: 0.5", statusCode: 400 }
    );
  });
});
