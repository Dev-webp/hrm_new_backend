import { classifyDayPolicy } from "../utils/attendancePolicy.js";
import { getComputedAttendanceStatus } from "../utils/computedAttendanceStatus.js";

const examples = [
  ["10:00:00", "14:00:00", 0, "half_day", "Half Day"],
  ["10:00:00", "13:59:00", 0, "absent", "Absent"],
  ["10:12:00", "15:12:00", 0, "half_day", "Half Day"],
  ["10:00:00", "19:00:00", 45, "full_day", "Present"],
  ["10:15:00", "14:15:00", 0, "half_day", "Half Day"],
  ["10:00:00", "14:00:00", 65, "half_day", "Half Day"],
  ["10:30:00", "14:30:00", 15, "half_day", "Half Day"],
  ["10:31:00", "13:30:00", 10, "absent", "Absent"],
];

const afternoonExamples = [
  ["14:30:00", "18:30:00", 0, "18:30:00", "half_day", "Half Day"],
  ["14:30:00", "18:35:00", 5, "18:35:00", "half_day", "Half Day"],
  ["14:30:00", "18:40:00", 10, "18:40:00", "half_day", "Half Day"],
  ["14:30:00", "18:44:00", 14, "18:44:00", "half_day", "Half Day"],
  ["14:30:00", "18:50:00", 20, "18:50:00", "half_day", "Half Day"],
  ["14:30:00", "19:00:00", 30, "19:00:00", "half_day", "Half Day"],
  ["14:30:00", "19:15:00", 45, "19:15:00", "half_day", "Half Day"],
  ["14:30:00", "18:30:00", 14, "18:44:00", "absent", "Absent"],
];

const labelByBucket = {
  full_day: "Present",
  half_day: "Half Day",
  absent: "Absent",
  holiday: "Holiday",
  leave: "Leave",
};

let failures = 0;

console.log("Addendum v3 Section 5: Full Day / Morning track");
for (const [checkIn, checkOut, breakMinutes, expectedBucket, expectedLabel] of examples) {
  const actual = classifyDayPolicy({
    dateStr: "2026-07-06",
    log: {
      office_in: checkIn,
      office_out: checkOut,
      total_break_minutes: breakMinutes,
    },
    holidaySet: new Set(),
  });

  const actualLabel = labelByBucket[actual.bucket] || actual.bucket;
  const ok = actual.bucket === expectedBucket && actualLabel === expectedLabel;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "PASS" : "FAIL"} ${checkIn}-${checkOut} break=${breakMinutes}m ` +
      `expected=${expectedBucket}/${expectedLabel} actual=${actual.bucket}/${actualLabel} ` +
      `gross_hours=${actual.gross_hours}`
  );
}

const liveExamples = [
  ["2026-07-06", "2026-07-06", "in_progress", "Working"],
  ["2026-07-06", "2026-07-07", "absent", "Absent"],
];

console.log("Addendum v3 Section 4.1: Missing checkout live status");
for (const [attendanceDate, todayStr, expectedStatus, expectedLabel] of liveExamples) {
  const actual = getComputedAttendanceStatus(
    {
      date: attendanceDate,
      check_in_time: "10:05:00",
      check_out_time: null,
    },
    {
      dateStr: attendanceDate,
      todayStr,
    }
  );

  const ok = actual.computed_status === expectedStatus && actual.display_status === expectedLabel;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "PASS" : "FAIL"} date=${attendanceDate} viewed=${todayStr} ` +
      `expected=${expectedStatus}/${expectedLabel} actual=${actual.computed_status}/${actual.display_status}`
  );
}

console.log("Section 13.1: Afternoon Half-Day track");
for (const [checkIn, checkOut, breakMinutes, expectedCheckout, expectedBucket, expectedLabel] of afternoonExamples) {
  const actual = classifyDayPolicy({
    dateStr: "2026-07-06",
    log: {
      office_in: checkIn,
      office_out: checkOut,
      total_break_minutes: breakMinutes,
    },
    holidaySet: new Set(),
  });

  const actualLabel = labelByBucket[actual.bucket] || actual.bucket;
  const ok =
    actual.bucket === expectedBucket &&
    actualLabel === expectedLabel &&
    actual.required_checkout_time === expectedCheckout;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "PASS" : "FAIL"} ${checkIn}-${checkOut} break=${breakMinutes}m ` +
      `required=${expectedCheckout} expected=${expectedBucket}/${expectedLabel} ` +
      `actual=${actual.bucket}/${actualLabel} actual_required=${actual.required_checkout_time} ` +
      `production_hours=${actual.net_hours}`
  );
}

if (failures > 0) {
  process.exitCode = 1;
}
