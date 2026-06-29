// VJC Overseas attendance policy engine.
// Pure functions only: no database calls in this file.

export const OFFICE_START = "10:00:00";
export const OFFICE_END = "19:00:00";
export const LATE_GRACE_LIMIT = "10:15:00";
export const MAX_PERMITTED_LATES = 6;

export const HALF_SLOT_A_START = "10:00:00";
export const HALF_SLOT_A_END = "14:30:00";
export const HALF_SLOT_B_START = "14:30:00";
export const HALF_SLOT_B_END = "19:00:00";

export const POST_LOGIN_IDLE_THRESHOLD_MINUTES = 15;

export function calculateLateMinutes(checkInTime) {
  if (!checkInTime) return 0;
  const [h, m] = String(checkInTime).split(":").map(Number);
  return Math.max(0, h * 60 + m - (10 * 60));
}

const MIN_HALF_DAY_HOURS = 4;
const MIN_FULL_DAY_HOURS = 8;

export function timeToSeconds(timeStr) {
  if (!timeStr) return null;

  const str = String(timeStr).trim();
  const parts = str.split(":").map(Number);

  if (parts.length < 2 || parts.some(Number.isNaN)) return null;

  return parts[0] * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

const T_OFFICE_START = timeToSeconds(OFFICE_START);
const T_OFFICE_END = timeToSeconds(OFFICE_END);
const T_LATE_GRACE_LIMIT = timeToSeconds(LATE_GRACE_LIMIT);
const T_HALF_A_START = timeToSeconds(HALF_SLOT_A_START);
const T_HALF_A_END = timeToSeconds(HALF_SLOT_A_END);
const T_HALF_B_START = timeToSeconds(HALF_SLOT_B_START);
const T_HALF_B_END = timeToSeconds(HALF_SLOT_B_END);

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

  const workStart = Math.max(inSec, T_OFFICE_START);
  const workEnd = Math.min(outSec, T_OFFICE_END);
  if (workEnd <= workStart) return 0;

  let breakSec = 0;
  for (const [rawIn, rawOut] of collectBreakPairs(log)) {
    const bIn = timeToSeconds(rawIn);
    const bOut = timeToSeconds(rawOut);
    if (bIn !== null && bOut !== null && bOut > bIn) {
      breakSec += overlapSeconds(bIn, bOut, workStart, workEnd);
    }
  }

  return breakSec * 1000;
}

export function calculateNetWorkMillis(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);

  if (inSec === null || outSec === null) return 0;

  const actualIn = Math.max(inSec, T_OFFICE_START);
  const actualOut = Math.min(outSec, T_OFFICE_END);
  const grossMs = Math.max(0, (actualOut - actualIn) * 1000);

  return Math.max(0, grossMs - calculateBreakMillis(log));
}

export function evaluateLateLogin(log) {
  const result = {
    is_late: false,
    is_within_grace: false,
    is_beyond_grace: false,
  };

  const inSec = timeToSeconds(log?.office_in);

  if (inSec === null || inSec <= T_OFFICE_START) {
    return result;
  }

  result.is_late = true;

  if (inSec <= T_LATE_GRACE_LIMIT) {
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

  let breakSec = 0;
  for (const [rawIn, rawOut] of collectBreakPairs(log)) {
    const bIn = timeToSeconds(rawIn);
    const bOut = timeToSeconds(rawOut);
    if (bIn !== null && bOut !== null && bOut > bIn) {
      breakSec += overlapSeconds(bIn, bOut, workStart, workEnd);
    }
  }

  return Math.max(0, Math.floor((workEnd - workStart - breakSec) / 60));
}

export function qualifiesHalfDayBySlot(log) {
  return resolveHalfDaySlot(log) !== "INVALID";
}

function qualifiesAfternoonHalfDay(log, netHours) {
  const inSec = timeToSeconds(log?.office_in);
  return inSec !== null && inSec <= T_HALF_B_START && netHours >= MIN_HALF_DAY_HOURS;
}

export function buildMonthlyLateStats(logsByDate, daysInMonth, year, month) {
  let totalLateCount = 0;
  let withinGraceCount = 0;
  let beyondGraceCount = 0;
  const exceededDates = [];

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const log = logsByDate[dateStr];
    if (!log) continue;

    const lateInfo = evaluateLateLogin(log);
    if (lateInfo.is_late) {
      totalLateCount += 1;
      if (lateInfo.is_within_grace) withinGraceCount += 1;
      if (lateInfo.is_beyond_grace) beyondGraceCount += 1;
      if (totalLateCount > MAX_PERMITTED_LATES) {
        exceededDates.push(dateStr);
      }
    }
  }

  return {
    permitted_late_count: totalLateCount,
    late_login_count: totalLateCount,
    grace_late_count: totalLateCount,
    within_grace_late_count: withinGraceCount,
    beyond_grace_late_count: beyondGraceCount,
    exceeded_dates: exceededDates,
    max_permitted: MAX_PERMITTED_LATES,
    remaining: Math.max(0, MAX_PERMITTED_LATES - totalLateCount),
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
      (monInSec !== null && monInSec <= T_LATE_GRACE_LIMIT) ||
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
  const date = parseDateStr(dateStr);
  const weekday = date.getDay();
  const flags = [];
  const netMs = log ? calculateNetWorkMillis(log) : 0;
  const breakMs = log ? calculateBreakMillis(log) : 0;
  const netHours = netMs / 3_600_000;
  const totalBreakMinutes = Math.round(breakMs / 60000);

  if (weekday === 0) {
    const bucket = classifySunday(dateStr, logsByDate, holidaySet);
    if (bucket === "holiday") flags.push("weekly_off_conditions_met");
    else flags.push("weekly_off_conditions_not_met");
    return result(
      bucket,
      bucket === "holiday" ? "Sunday weekly off conditions met" : "Sunday weekly off conditions not met",
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
      { total_break_minutes: totalBreakMinutes, half_day_slot: log.half_day_slot }
    );
  }

  if (isPaidLeave) {
    flags.push("paid_leave");
    return result("leave", "Approved paid or earned leave", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
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
  const lateExceeded = (monthlyLateStats.exceeded_dates || []).includes(dateStr);
  const halfDayDetails = getHalfDaySlotDetails(log);
  const halfDaySlot = halfDayDetails.slot;
  const halfDayMeta = {
    half_day_slot: halfDaySlot === "INVALID" ? null : halfDaySlot,
    half_day_effective_minutes: halfDayDetails.effective_minutes,
    half_day_slot_checked: halfDayDetails.slot_checked,
    half_day_invalid_reason: halfDayDetails.invalid_reason || null,
  };
  const outSec = timeToSeconds(log.office_out);
  const misuse =
    log.misuse_of_time === true ||
    Number(log.post_login_idle_minutes || 0) > POST_LOGIN_IDLE_THRESHOLD_MINUTES;

  if (misuse) {
    flags.push("misuse_after_login");
    return result("half_day", "Misuse of time after login - half day absent", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      ...halfDayMeta,
    });
  }

  if (netHours < MIN_HALF_DAY_HOURS) {
    flags.push("less_than_4_net_hours");
    return result("absent", "Less than 4 net working hours", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      ...halfDayMeta,
    });
  }

  if (lateExceeded) {
    flags.push("monthly_late_login_limit_exceeded");
    if (!qualifiesAfternoonHalfDay(log, netHours)) {
      const inSec = timeToSeconds(log?.office_in);
      if (inSec !== null && inSec > T_HALF_B_START) {
        flags.push("login_after_2_30_pm");
        return result("absent", "Late login limit exceeded; login after 2:30 PM", netHours, flags, {
          total_break_minutes: totalBreakMinutes,
          ...halfDayMeta,
        });
      }
      flags.push("strict_half_day_not_eligible");
      return result("absent", "Late login limit exceeded; strict half-day eligibility not met", netHours, flags, {
        total_break_minutes: totalBreakMinutes,
        ...halfDayMeta,
      });
    }
    flags.push("strict_half_day_eligible");
    return result("half_day", "Late login limit exceeded; strict half-day eligibility met", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: "SLOT_B",
      half_day_effective_minutes: Math.round(netHours * 60),
      half_day_slot_checked: "AFTERNOON",
      half_day_invalid_reason: null,
    });
  }

  if (lateInfo.is_beyond_grace) {
    flags.push("late_after_10_15");
    if (halfDaySlot === "INVALID") {
      flags.push("invalid_half_day_slot");
      return result("absent", halfDayDetails.invalid_reason || "Invalid half-day slot", netHours, flags, {
        total_break_minutes: totalBreakMinutes,
        ...halfDayMeta,
      });
    }
    flags.push("beyond_grace_valid_half_day_slot");
    return result("half_day", "Login after 10:15 AM grace time; valid half-day slot completed", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      ...halfDayMeta,
    });
  }

  if (netHours < MIN_FULL_DAY_HOURS) {
    if (halfDaySlot === "INVALID") {
      flags.push("invalid_half_day_slot");
      return result("absent", halfDayDetails.invalid_reason || "Invalid half-day slot", netHours, flags, {
        total_break_minutes: totalBreakMinutes,
        ...halfDayMeta,
      });
    }
    flags.push("valid_half_day_slot");
    return result("half_day", "Valid official half-day slot completed", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      ...halfDayMeta,
    });
  }

  if (outSec !== null && outSec < T_OFFICE_END) {
    flags.push("logout_before_7_pm");
  }

  if (lateInfo.is_within_grace) {
    flags.push("within_grace_time");
  }

  flags.push("full_day_policy_satisfied");
  return result("full_day", "8+ net working hours", netHours, flags, {
    total_break_minutes: totalBreakMinutes,
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

    if (log && evaluateLateLogin(log).is_late) lateCount += 1;

    const netMs = log ? calculateNetWorkMillis(log) : 0;
    if (netMs > 0) {
      totalNetMs += netMs;
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
