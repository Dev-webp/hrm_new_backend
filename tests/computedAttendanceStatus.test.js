import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAttendanceStatus,
  getComputedAttendanceStatus,
} from "../utils/computedAttendanceStatus.js";
import { classifyDayPolicy } from "../utils/attendancePolicy.js";
import { mapPolicyBucketToDisplayStatus } from "../routes/attendanceRoutes.js";
import { calculateFinalAttendanceStatus } from "../services/adminDashboardAttendanceService.js";

describe("canonical attendance status calculation", () => {
  it("returns full day for 9 gross hours even when net production is 8 hours", () => {
    const result = calculateAttendanceStatus({
      date: "2026-05-20",
      check_in_time: "10:00:00",
      check_out_time: "19:00:00",
      break_in: "12:00:00",
      break_out: "13:00:00",
      todayStr: "2026-05-20",
    });

    assert.equal(result.status, "full_day");
    assert.equal(result.production_hours, 8);
    assert.equal(result.total_break_minutes, 60);
    assert.match(result.reason, /gross hours/i);
  });

  it("keeps Attendance Register display Present for 9:56 to 19:01 with a 38 minute break", () => {
    const policy = classifyDayPolicy({
      dateStr: "2026-07-09",
      log: {
        office_in: "09:56:00",
        office_out: "19:01:00",
        total_break_minutes: 38,
      },
      holidaySet: new Set(),
      monthlyLateStats: {},
      logsByDate: {},
    });

    const computed = calculateAttendanceStatus({
      date: "2026-07-09",
      check_in_time: "09:56:00",
      check_out_time: "19:01:00",
      total_break_minutes: 38,
      todayStr: "2026-07-09",
    });

    assert.equal(policy.bucket, "full_day");
    assert.equal(computed.status, "full_day");
    assert.equal(mapPolicyBucketToDisplayStatus(policy.bucket), "Present");
  });

  it("keeps approved paid and unpaid half-day leave as no record without punches", () => {
    for (const leaveType of ["paid_leave", "unpaid_leave"]) {
      const result = getComputedAttendanceStatus(
        {
          date: "2026-10-12",
          status: "absent",
          leave_type: leaveType,
          leave_status: "approved",
          leave_request_status: "approved",
          leave_duration_type: "half_day",
          is_paid_leave: leaveType === "paid_leave",
        },
        {
          dateStr: "2026-10-12",
          halfDayLeaveAsNoRecord: true,
        }
      );

      assert.equal(result.computed_status, "no_record");
    }
  });

  it("uses existing net-hours policy for attendance during approved half-day leave", () => {
    const shared = {
      date: "2026-10-12",
      leave_type: "paid_leave",
      leave_status: "approved",
      leave_request_status: "approved",
      leave_duration_type: "half_day",
      is_paid_leave: true,
    };
    const context = {
      dateStr: "2026-10-12",
      todayStr: "2026-10-31",
      halfDayLeaveAsNoRecord: true,
    };

    const fourNetHours = getComputedAttendanceStatus(
      {
        ...shared,
        check_in_time: "10:00:00",
        check_out_time: "14:30:00",
        total_break_minutes: 30,
      },
      context
    );
    const belowFourNetHours = getComputedAttendanceStatus(
      {
        ...shared,
        check_in_time: "10:00:00",
        check_out_time: "14:00:00",
        total_break_minutes: 30,
      },
      context
    );

    assert.equal(fourNetHours.computed_status, "half_day");
    assert.equal(fourNetHours.production_hours, 4);
    assert.equal(belowFourNetHours.computed_status, "absent");
  });

  it("keeps incomplete attendance under the existing incomplete-checkout rule", () => {
    const result = getComputedAttendanceStatus(
      {
        date: "2026-10-12",
        check_in_time: "10:00:00",
        leave_type: "paid_leave",
        leave_status: "approved",
        leave_request_status: "approved",
        leave_duration_type: "half_day",
        is_paid_leave: true,
      },
      {
        dateStr: "2026-10-12",
        todayStr: "2026-10-31",
        halfDayLeaveAsNoRecord: true,
      }
    );

    assert.equal(result.computed_status, "absent");
    assert.match(result.policy_reason, /missed checkout/i);
  });

  it("preserves full-day paid and unpaid leave statuses", () => {
    for (const [leaveType, expected] of [
      ["paid_leave", "paid_leave"],
      ["unpaid_leave", "unpaid_leave"],
    ]) {
      const result = getComputedAttendanceStatus(
        {
          date: "2026-10-12",
          leave_type: leaveType,
          leave_status: "approved",
          leave_request_status: "approved",
          leave_duration_type: "full_day",
          is_paid_leave: leaveType === "paid_leave",
          is_unpaid_leave: leaveType === "unpaid_leave",
        },
        {
          dateStr: "2026-10-12",
          halfDayLeaveAsNoRecord: true,
        }
      );

      assert.equal(result.computed_status, expected);
    }
  });

  it("keeps dashboard half-day leave separate from attendance and uses actual hours", () => {
    const common = {
      leave_type: "paid_leave",
      leave_status: "approved",
      leave_request_status: "approved",
      leave_duration_type: "half_day",
      is_paid_leave: true,
    };
    const noAttendance = calculateFinalAttendanceStatus({
      record: { ...common, status: "paid_leave" },
      date: "2026-10-12",
      today: "2026-10-31",
    });
    const fourNetHours = calculateFinalAttendanceStatus({
      record: {
        ...common,
        status: "paid_leave",
        check_in_time: "10:00:00",
        check_out_time: "14:30:00",
        total_break_minutes: 30,
      },
      date: "2026-10-12",
      today: "2026-10-31",
    });

    assert.equal(noAttendance.status, "no_record");
    assert.equal(fourNetHours.status, "half_day");
  });
});
