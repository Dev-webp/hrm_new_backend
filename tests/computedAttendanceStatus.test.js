import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateAttendanceStatus } from "../utils/computedAttendanceStatus.js";
import { classifyDayPolicy } from "../utils/attendancePolicy.js";
import { mapPolicyBucketToDisplayStatus } from "../routes/attendanceRoutes.js";

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
});
