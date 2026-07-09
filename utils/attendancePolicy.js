// VJC Overseas attendance policy engine.
// Pure functions only: no database calls in this file.

export const OFFICE_START = "10:00:00";
export const OFFICE_END = "19:00:00";
export const ON_TIME_GRACE_END = "10:14:59";
export const LATE_LOGIN_START = "10:15:00";
export const HALF_DAY_LOGIN_START = "10:30:00";
export const LATE_GRACE_LIMIT = ON_TIME_GRACE_END;

export const HALF_SLOT_A_START = "10:00:00";
export const HALF_SLOT_A_END = "14:30:00";
export const HALF_SLOT_B_START = "14:30:00";
export const HALF_SLOT_B_END = "19:00:00";
export const AFTERNOON_HALF_DAY_START = HALF_SLOT_B_START;

export const POST_LOGIN_IDLE_THRESHOLD_MINUTES = 15;

export function calculateLateMinutes(checkInTime) {
  if (!checkInTime) return 0;
  const [h, m] = String(checkInTime).split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 10 * 60 + 15 || minutes >= 10 * 60 + 30) return 0;
  return minutes - (10 * 60 + 15);
}

const MIN_HALF_DAY_HOURS = 4;
const MIN_FULL_DAY_HOURS = 9;
const MAX_BREAK_MINUTES = 60;

export function timeToSeconds(timeStr) {
  if (!timeStr) return null;

  const str = String(timeStr).trim();
  const parts = str.split(":").map(Number);

  if (parts.length < 2 || parts.some(Number.isNaN)) return null;

  return parts[0] * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

const T_OFFICE_START = timeToSeconds(OFFICE_START);
const T_OFFICE_END = timeToSeconds(OFFICE_END);
const T_ON_TIME_GRACE_END = timeToSeconds(ON_TIME_GRACE_END);
const T_LATE_LOGIN_START = timeToSeconds(LATE_LOGIN_START);
const T_HALF_DAY_LOGIN_START = timeToSeconds(HALF_DAY_LOGIN_START);
const REQUIRED_FULL_DAY_SECONDS = MIN_FULL_DAY_HOURS * 3600;
const T_HALF_A_START = timeToSeconds(HALF_SLOT_A_START);
const T_HALF_A_END = timeToSeconds(HALF_SLOT_A_END);
const T_HALF_B_START = timeToSeconds(HALF_SLOT_B_START);
const T_HALF_B_END = timeToSeconds(HALF_SLOT_B_END);
const T_AFTERNOON_HALF_DAY_START = timeToSeconds(AFTERNOON_HALF_DAY_START);

export function parseDateStr(str) {
  const [y, m, d] = str.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function secondsToTimeString(seconds) {
  const normalized = Math.max(0, seconds);
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = Math.floor(normalized % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function overlapSeconds(startA, endA, startB, endB) {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

function collectBreakPairs(log) {
  const pairs = [
    [log?.break_in, log?.break_out],
    [log?.lunch_in, log?.lunch_out],
    [log?.break_in_2, log?.break_out_2],
  ];

  const extraIns = Array.isArray(log?.extra_break_ins) ? log.extra_break_ins : [];
  const extraOuts = Array.isArray(log?.extra_break_outs) ? log.extra_break_outs : [];
  const pairCount = Math.min(extraIns.length, extraOuts.length);

  for (let i = 0; i < pairCount; i += 1) {
    pairs.push([extraIns[i], extraOuts[i]]);
  }

  return pairs;
}

export function calculateBreakMillis(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);

  if (inSec === null || outSec === null) return 0;

  const workStart = inSec;
  const workEnd = outSec;
  if (workEnd <= workStart) return 0;

  let breakSec = 0;
  let hasBreakPairs = false;
  for (const [rawIn, rawOut] of collectBreakPairs(log)) {
    const bIn = timeToSeconds(rawIn);
    const bOut = timeToSeconds(rawOut);
    if (bIn !== null && bOut !== null && bOut > bIn) {
      hasBreakPairs = true;
      breakSec += overlapSeconds(bIn, bOut, workStart, workEnd);
    }
  }

  if (!hasBreakPairs) {
    const storedBreakMinutes = Number(log?.total_break_minutes);
    if (Number.isFinite(storedBreakMinutes) && storedBreakMinutes > 0) {
      return storedBreakMinutes * 60_000;
    }
  }

  return breakSec * 1000;
}

export function calculateNetWorkMillis(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);

  if (inSec === null || outSec === null) return 0;

  const grossMs = Math.max(0, (outSec - inSec) * 1000);
  const breakMs = calculateBreakMillis(log);
  return Math.max(0, grossMs - breakMs);
}

export function calculateGrossWorkMillis(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);

  if (inSec === null || outSec === null) return 0;

  return Math.max(0, (outSec - inSec) * 1000);
}

export function evaluateLateLogin(log) {
  const result = {
    is_late: false,
    is_within_grace: false,
    is_beyond_grace: false,
    is_on_time_grace: false,
    is_late_window: false,
  };

  const inSec = timeToSeconds(log?.office_in);

  if (inSec === null) {
    return result;
  }

  if (inSec <= T_ON_TIME_GRACE_END) {
    result.is_on_time_grace = true;
    return result;
  }

  if (inSec < T_LATE_LOGIN_START || inSec >= T_AFTERNOON_HALF_DAY_START) {
    return result;
  }

  result.is_late = true;

  if (inSec < T_HALF_DAY_LOGIN_START) {
    result.is_late_window = true;
    result.is_within_grace = true;
  } else {
    result.is_beyond_grace = true;
  }

  return result;
}

export function resolveHalfDaySlot(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);

  if (inSec === null || outSec === null) return "INVALID";

  const morningMinutes = calculateHalfDayEffectiveMinutes(log, "SLOT_A");
  if (inSec <= T_HALF_A_START && morningMinutes >= MIN_HALF_DAY_HOURS * 60) {
    return "SLOT_A";
  }

  const afternoonMinutes = calculateHalfDayEffectiveMinutes(log, "SLOT_B");
  if (inSec <= T_HALF_B_START && afternoonMinutes >= MIN_HALF_DAY_HOURS * 60) {
    return "SLOT_B";
  }

  return "INVALID";
}

export function getHalfDaySlotDetails(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);
  const morningMinutes = calculateHalfDayEffectiveMinutes(log, "SLOT_A");
  const afternoonMinutes = calculateHalfDayEffectiveMinutes(log, "SLOT_B");
  const slot = resolveHalfDaySlot(log);

  let slotChecked = "INVALID";
  let effectiveMinutes = Math.max(morningMinutes, afternoonMinutes);
  let invalidReason = "";

  if (slot === "SLOT_A") {
    slotChecked = "MORNING";
    effectiveMinutes = morningMinutes;
  } else if (slot === "SLOT_B") {
    slotChecked = "AFTERNOON";
    effectiveMinutes = afternoonMinutes;
  } else if (inSec === null || outSec === null) {
    invalidReason = "Missing login or logout";
  } else if (inSec > T_HALF_B_START) {
    slotChecked = "AFTERNOON";
    invalidReason = "Afternoon half-day login must be on or before 2:30 PM";
  } else if (inSec > T_HALF_A_START && outSec <= T_HALF_B_START) {
    slotChecked = "MORNING";
    invalidReason = "Morning half-day login must be on or before 10:00 AM";
  } else if (afternoonMinutes > 0 || inSec <= T_HALF_B_START) {
    slotChecked = "AFTERNOON";
    invalidReason = "Afternoon half-day effective production is below 4 hours";
  } else {
    slotChecked = "MORNING";
    invalidReason = "Morning half-day effective production is below 4 hours";
  }

  return {
    slot,
    slot_checked: slotChecked,
    effective_minutes: effectiveMinutes,
    morning_effective_minutes: morningMinutes,
    afternoon_effective_minutes: afternoonMinutes,
    invalid_reason: invalidReason,
  };
}

export function calculateHalfDayEffectiveMinutes(log, slot) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);
  if (inSec === null || outSec === null) return 0;

  const slotStart = slot === "SLOT_B" ? T_HALF_B_START : T_HALF_A_START;
  const slotEnd = slot === "SLOT_B" ? T_HALF_B_END : T_HALF_A_END;

  if (inSec > slotStart) return 0;

  const workStart = Math.max(inSec, slotStart);
  const workEnd = Math.min(outSec, slotEnd);
  if (workEnd <= workStart) return 0;

  return Math.max(0, Math.floor((workEnd - workStart) / 60));
}

export function qualifiesHalfDayBySlot(log) {
  return resolveHalfDaySlot(log) !== "INVALID";
}

export function buildMonthlyLateStats(logsByDate, daysInMonth, year, month) {
  let lateLoginCount = 0;
  let withinGraceCount = 0;
  let beyondGraceCount = 0;

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const log = logsByDate[dateStr];
    if (!log) continue;

    const lateInfo = evaluateLateLogin(log);
    if (lateInfo.is_late) {
      lateLoginCount += 1;
    }
    if (lateInfo.is_within_grace) withinGraceCount += 1;
    if (lateInfo.is_beyond_grace) beyondGraceCount += 1;
  }

  return {
    permitted_late_count: lateLoginCount,
    late_login_count: lateLoginCount,
    grace_late_count: lateLoginCount,
    within_grace_late_count: withinGraceCount,
    actual_grace_late_count: lateLoginCount,
    actual_within_grace_late_count: withinGraceCount,
    beyond_grace_late_count: beyondGraceCount,
    exceeded_dates: [],
    max_permitted: null,
    remaining: null,
  };
}

export function classifySunday(sundayDateStr, logsByDate = {}, holidaySet = new Set()) {
  if (holidaySet.has(sundayDateStr)) return "holiday";

  const sunday = parseDateStr(sundayDateStr);
  const satDate = new Date(sunday);
  satDate.setDate(sunday.getDate() - 1);
  const monDate = new Date(sunday);
  monDate.setDate(sunday.getDate() + 1);

  const satStr = formatDateStr(satDate);
  const monStr = formatDateStr(monDate);
  const satLog = logsByDate[satStr] || null;
  const monLog = logsByDate[monStr] || null;

  const isMonthStartSunday = sunday.getDate() === 1;
  let satConditionMet = isMonthStartSunday;

  if (!satConditionMet && satLog) {
    const satOutSec = timeToSeconds(satLog.office_out);
    const satLeave = String(satLog.leave_type || "").toLowerCase();
    satConditionMet =
      (satOutSec !== null && satOutSec >= T_OFFICE_END) ||
      satLeave.includes("paid") ||
      satLeave.includes("half") ||
      satLeave.includes("earned");
  }

  let monConditionMet = false;
  if (monLog) {
    const monInSec = timeToSeconds(monLog.office_in);
    const monLeave = String(monLog.leave_type || "").toLowerCase();
    monConditionMet =
      (monInSec !== null && monInSec <= T_ON_TIME_GRACE_END) ||
      monLeave.includes("earned") ||
      monLeave.includes("paid");
  }

  return satConditionMet && monConditionMet ? "holiday" : "absent";
}

function result(bucket, reason, netHours, flags, extra = {}) {
  return {
    bucket,
    reason,
    net_hours: Number(netHours.toFixed(2)),
    flags,
    ...extra,
  };
}

export function classifyDayPolicy({
  dateStr,
  log,
  holidaySet = new Set(),
  monthlyLateStats = {},
  logsByDate = {},
}) {
  /*
   * VJC Overseas HRMS Attendance Policy Guide, July 2026
   *
   * Section 1:
   * - Office Time: 10:00 AM to 7:00 PM
   * - Grace Time: 10:00 AM to 10:14 AM
   * - Late Login Starts: 10:15 AM
   * - Late Login Window for Full Day Eligibility: 10:15 AM to 10:29 AM
   * - Half Day Login Starts: 10:30 AM
   * - Afternoon Half-Day Start Time: 2:30 PM
   * - Full Day Requirement: 9 Gross Hours
   * - Half Day Minimum Requirement: 4 Gross Hours
   * - Afternoon Half-Day Required Production: 4 Hours plus break compensation
   * - Break Limit: 60 Minutes
   *
   * Sections 6-13.1:
   * - Login at or after 2:30 PM uses the Afternoon Half-Day track.
   * - Afternoon Required Checkout = Login + 4 Hours + Total Break Minutes.
   * - Afternoon track status is Half Day only when checkout meets required checkout.
   * - Afternoon track does not increment late count and does not use the 60-minute break cap.
   * - Full Day/Morning Half-Day breaks are tracked separately and do not reduce gross hours.
   * - Full Day/Morning Half-Day breaks of 61 minutes or more make final attendance Half Day.
   * - Attendance display must recalculate from logs, breaks, and policy rules.
   * - Missing check-in or check-out is Absent.
   * - Morning-track login at or after 10:15 AM increments late count.
   * - Login before 10:30 AM needs 9 gross hours for Present, otherwise Absent.
   * - Login at or after 10:30 AM needs 4 gross hours for Half Day, otherwise Absent.
   * - Addendum v3: login before 10:30 AM with 4+ and less than 9 gross hours is Half Day.
   * - The v3 examples table and afternoon examples are validated by scripts/validateAttendancePolicyExamples.js.
   */
  const date = parseDateStr(dateStr);
  const weekday = date.getDay();
  const flags = [];
  const grossMs = log ? calculateGrossWorkMillis(log) : 0;
  const breakMs = log ? calculateBreakMillis(log) : 0;
  const grossHours = grossMs / 3_600_000;
  const netHours = Math.max(0, grossHours - Math.round(breakMs / 60000) / 60);
  const totalBreakMinutes = Math.round(breakMs / 60000);

  if (weekday === 0) {
    if (log?.office_in || log?.office_out) {
      flags.push("sunday_attendance_recorded");
      return result("holiday", "Sunday attendance recorded", netHours, flags, {
        total_break_minutes: totalBreakMinutes,
        gross_hours: Number(grossHours.toFixed(2)),
        half_day_slot: null,
      });
    }

    flags.push("sunday_weekly_off");
    return result(
      "holiday",
      "Sunday weekly off",
      0,
      flags,
      { total_break_minutes: 0, half_day_slot: null }
    );
  }

  if (holidaySet.has(dateStr)) {
    flags.push("company_holiday");
    return result("holiday", "Company holiday", 0, flags, {
      total_break_minutes: 0,
      half_day_slot: null,
    });
  }

  const leaveType = String(log?.leave_type || "").toLowerCase();
  const leaveStatus = String(log?.leave_status || "").toLowerCase();
  const isPaidLeave = leaveType === "paid" || leaveType === "earned";

  if ((leaveStatus === "pending" || leaveStatus === "rejected") && !log?.office_in && !log?.office_out) {
    flags.push(leaveStatus === "pending" ? "leave_pending" : "leave_rejected");
    return result("absent", `Leave ${leaveStatus} - no attendance`, 0, flags, {
      total_break_minutes: 0,
      half_day_slot: null,
    });
  }

  if (leaveStatus === "approved" && ["SLOT_A", "SLOT_B"].includes(log?.half_day_slot)) {
    flags.push(isPaidLeave ? "paid_half_day_leave" : "unpaid_half_day_leave");
    return result(
      "half_day",
      `Approved ${isPaidLeave ? "paid" : "unpaid"} half-day leave (${log.half_day_slot})`,
      netHours,
      flags,
      { total_break_minutes: totalBreakMinutes, gross_hours: Number(grossHours.toFixed(2)), half_day_slot: log.half_day_slot }
    );
  }

  if (isPaidLeave) {
    flags.push("paid_leave");
    return result("leave", "Approved paid or earned leave", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      gross_hours: Number(grossHours.toFixed(2)),
      half_day_slot: null,
    });
  }

  if (log?.leave_type && !isPaidLeave) {
    flags.push("unpaid_leave");
    return result("absent", "Unpaid leave counts as absent", 0, flags, {
      total_break_minutes: 0,
      half_day_slot: null,
    });
  }

  if (!log?.office_in || !log?.office_out) {
    flags.push("missing_login_or_logout");
    return result("absent", "Missing login or logout", 0, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: null,
    });
  }

  const lateInfo = evaluateLateLogin(log);
  const inSec = timeToSeconds(log.office_in);
  const outSec = timeToSeconds(log.office_out);

  if (inSec !== null && inSec >= T_AFTERNOON_HALF_DAY_START) {
    const requiredCheckoutSec = inSec + MIN_HALF_DAY_HOURS * 3600 + totalBreakMinutes * 60;
    const afternoonMeta = {
      attendance_track: "afternoon_half_day",
      total_break_minutes: totalBreakMinutes,
      gross_hours: Number(grossHours.toFixed(2)),
      required_checkout_time: secondsToTimeString(requiredCheckoutSec),
      required_checkout_minutes: Math.round(requiredCheckoutSec / 60),
      half_day_slot: outSec !== null && outSec >= requiredCheckoutSec ? "SLOT_B" : null,
    };

    flags.push("afternoon_half_day_track");
    if (outSec !== null && outSec >= requiredCheckoutSec) {
      return result(
        "half_day",
        "Afternoon half-day required checkout met",
        netHours,
        flags,
        afternoonMeta
      );
    }

    flags.push("afternoon_required_checkout_not_met");
    return result(
      "absent",
      "Afternoon half-day required checkout not met",
      netHours,
      flags,
      afternoonMeta
    );
  }

  if (grossHours < MIN_HALF_DAY_HOURS) {
    flags.push("less_than_4_gross_hours");
    return result("absent", "Less than 4 gross hours", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      gross_hours: Number(grossHours.toFixed(2)),
      attendance_track: "full_day_morning_half_day",
      half_day_slot: null,
    });
  }

  if (lateInfo.is_on_time_grace) {
    flags.push("within_on_time_grace");
  }

  if (lateInfo.is_late_window) {
    flags.push("late_login_window");
  }

  if (lateInfo.is_beyond_grace) {
    flags.push("late_after_10_30");
    flags.push("half_day_login_window");
  }

  let baseBucket = "absent";
  let reason = "Less than 9 gross hours";

  if (inSec !== null && inSec < T_HALF_DAY_LOGIN_START) {
    if (grossHours >= MIN_FULL_DAY_HOURS) {
      baseBucket = "full_day";
      reason = "9+ gross hours completed before half-day login cutoff";
      flags.push("full_day_policy_satisfied");
    } else if (grossHours >= MIN_HALF_DAY_HOURS) {
      baseBucket = "half_day";
      reason = "Early login with at least 4 and less than 9 gross hours";
      flags.push("early_login_morning_half_day");
    } else {
      flags.push("less_than_9_gross_hours");
    }
  } else if (grossHours >= MIN_HALF_DAY_HOURS) {
    baseBucket = "half_day";
    reason = "Login at or after 10:30 AM and at least 4 gross hours completed";
  } else {
    flags.push("less_than_4_gross_hours");
  }

  if (totalBreakMinutes > MAX_BREAK_MINUTES) {
    flags.push("break_exceeded");
    return result("half_day", "Break limit exceeded - attendance marked as half day", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      gross_hours: Number(grossHours.toFixed(2)),
      break_exceeded: true,
      attendance_track: "full_day_morning_half_day",
      half_day_slot: null,
    });
  }

  return result(baseBucket, reason, netHours, flags, {
    total_break_minutes: totalBreakMinutes,
    gross_hours: Number(grossHours.toFixed(2)),
    attendance_track: "full_day_morning_half_day",
    half_day_slot: null,
  });
}

export function calculateMonthlySummary(
  logsByDate,
  year,
  month,
  holidaySet,
  logsByDateExtended
) {
  const today = new Date();
  const todayStr = formatDateStr(today);
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthlyLateStats = buildMonthlyLateStats(logsByDate, daysInMonth, year, month);

  let fullDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let lateCount = 0;
  let totalNetMs = 0;
  let workDayCount = 0;

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dateStr > todayStr) break;

    const log = logsByDate[dateStr] || null;
    const day = classifyDayPolicy({
      dateStr,
      log,
      holidaySet,
      monthlyLateStats,
      logsByDate: logsByDateExtended || logsByDate,
    });

    if (day.bucket === "full_day") fullDays += 1;
    else if (day.bucket === "half_day") halfDays += 1;
    else if (day.bucket === "leave") leaveDays += 1;
    else if (day.bucket === "holiday") holidayDays += 1;
    else if (day.bucket === "absent") absentDays += 1;

    if (log && evaluateLateLogin(log).is_late) {
      lateCount += 1;
    }

    const netMs = Number(day.net_hours || 0) * 3_600_000;
    if (netMs > 0) {
      totalNetMs += Math.round(netMs);
      workDayCount += 1;
    }
  }

  return {
    full_days: fullDays,
    half_days: halfDays,
    paid_leaves: leaveDays,
    leave_days: leaveDays,
    absent_days: absentDays,
    holiday_days: holidayDays,
    late_count: lateCount,
    total_net_millis: totalNetMs,
    avg_net_millis: workDayCount > 0 ? Math.round(totalNetMs / workDayCount) : null,
    work_day_count: workDayCount,
  };
}
