import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateAttendanceStatus } from "../utils/computedAttendanceStatus.js";

describe("canonical attendance status calculation", () => {
  it("returns the backward-compatible status payload with net production hours", () => {
    const result = calculateAttendanceStatus({
      date: "2026-05-20",
      check_in_time: "10:00:00",
      check_out_time: "19:00:00",
      break_in: "12:00:00",
      break_out: "13:00:00",
      todayStr: "2026-05-20",
    });

    assert.equal(result.status, "half_day");
    assert.equal(result.production_hours, 8);
    assert.equal(result.total_break_minutes, 60);
    assert.match(result.reason, /net production/i);
  });
});

