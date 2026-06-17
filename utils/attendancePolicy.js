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
const T_HALF_A_END = timeToSeconds(HALF_SLOT_A_END);
const T_HALF_B_START = timeToSeconds(HALF_SLOT_B_START);

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
  if (inSec === null || inSec <= T_OFFICE_START) return result;

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

  if (inSec <= T_OFFICE_START && outSec >= T_HALF_A_END) return "SLOT_A";
  if (inSec >= T_HALF_B_START && outSec >= T_OFFICE_END) return "SLOT_B";

  return "INVALID";
}

export function qualifiesHalfDayBySlot(log, netMillis = calculateNetWorkMillis(log)) {
  const netHours = netMillis / 3_600_000;
  return netHours >= MIN_HALF_DAY_HOURS && netHours < MIN_FULL_DAY_HOURS && resolveHalfDaySlot(log) !== "INVALID";
}

export function buildMonthlyLateStats(logsByDate, daysInMonth, year, month) {
  let graceLateCount = 0;
  const exceededDates = [];

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const log = logsByDate[dateStr];
    if (!log) continue;

    const lateInfo = evaluateLateLogin(log);
    if (lateInfo.is_within_grace) {
      graceLateCount += 1;
      if (graceLateCount > MAX_PERMITTED_LATES) {
        exceededDates.push(dateStr);
      }
    }
  }

  return {
    permitted_late_count: graceLateCount,
    grace_late_count: graceLateCount,
    exceeded_dates: exceededDates,
    max_permitted: MAX_PERMITTED_LATES,
    remaining: Math.max(0, MAX_PERMITTED_LATES - graceLateCount),
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
  const isPaidLeave = leaveType.includes("paid") || leaveType.includes("earned");

  if ((leaveStatus === "pending" || leaveStatus === "rejected") && !log?.office_in && !log?.office_out) {
    flags.push(leaveStatus === "pending" ? "leave_pending" : "leave_rejected");
    return result("absent", `Leave ${leaveStatus} - no attendance`, 0, flags, {
      total_break_minutes: 0,
      half_day_slot: null,
    });
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
  const halfDaySlot = resolveHalfDaySlot(log);
  const outSec = timeToSeconds(log.office_out);
  const misuse =
    log.misuse_of_time === true ||
    Number(log.post_login_idle_minutes || 0) > POST_LOGIN_IDLE_THRESHOLD_MINUTES;

  if (misuse) {
    flags.push("misuse_after_login");
    return result("half_day", "Misuse of time after login - half day absent", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: halfDaySlot,
    });
  }

  if (netHours < MIN_HALF_DAY_HOURS) {
    flags.push("less_than_4_net_hours");
    return result("absent", "Less than 4 net working hours", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: halfDaySlot,
    });
  }

  if (netHours < MIN_FULL_DAY_HOURS) {
    if (halfDaySlot !== "INVALID") {
      flags.push("valid_half_day_slot");
      return result("half_day", `Valid half-day present slot ${halfDaySlot}`, netHours, flags, {
        total_break_minutes: totalBreakMinutes,
        half_day_slot: halfDaySlot,
      });
    }

    flags.push("invalid_half_day_slot");
    return result("absent", "4 to less than 8 net hours without a valid half-day slot - absent", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: "INVALID",
    });
  }

  if (lateInfo.is_beyond_grace) {
    flags.push("late_after_10_15");
    return result("half_day", "Login after 10:15 AM - half day absent, no exceptions", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: halfDaySlot,
    });
  }

  if (lateExceeded) {
    flags.push("monthly_grace_late_limit_exceeded");
    return result("half_day", "Monthly grace late limit exceeded - late penalty", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: halfDaySlot,
    });
  }

  if (outSec !== null && outSec < T_OFFICE_END) {
    flags.push("logout_before_7_pm");
    return result("half_day", "Logout before 7:00 PM - half day absent", netHours, flags, {
      total_break_minutes: totalBreakMinutes,
      half_day_slot: halfDaySlot,
    });
  }

  if (lateInfo.is_within_grace) {
    flags.push("grace_late_counted");
  }

  flags.push("full_day_policy_satisfied");
  return result("full_day", "8+ net hours, logout at/after 7:00 PM, and late rules satisfied", netHours, flags, {
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
