// ═══════════════════════════════════════════════════════════════
// VJC OVERSEAS — Attendance Policy Engine
// Pure functions only — NO database calls inside any function.
// ═══════════════════════════════════════════════════════════════

export const OFFICE_START = "10:00:00";
export const LATE_GRACE_LIMIT = "10:15:00";
export const MONDAY_CUTOFF = "14:00:00";
export const LOGOUT_CUTOFF = "19:00:00";
export const MAX_PERMITTED_LATES = 6;

export const HALF_SLOT_A_START = "10:00:00";
export const HALF_SLOT_A_END = "14:30:00";
export const HALF_SLOT_B_START = "14:30:00";
export const HALF_SLOT_B_END = "19:00:00";

export function timeToSeconds(timeStr) {
  if (!timeStr) return null;

  const str = String(timeStr).trim();
  const parts = str.split(":").map(Number);

  if (parts.some(Number.isNaN)) return null;

  return parts[0] * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

const T_OFFICE_START = timeToSeconds(OFFICE_START);
const T_LATE_GRACE_LIMIT = timeToSeconds(LATE_GRACE_LIMIT);
const T_MONDAY_CUTOFF = timeToSeconds(MONDAY_CUTOFF);
const T_LOGOUT_CUTOFF = timeToSeconds(LOGOUT_CUTOFF);
const T_HALF_A_END = timeToSeconds(HALF_SLOT_A_END);
const T_HALF_B_START = timeToSeconds(HALF_SLOT_B_START);

export function resolveHalfDaySlot(log) {
  const inSec = timeToSeconds(log.office_in);
  const outSec = timeToSeconds(log.office_out);

  if (inSec === null || outSec === null) return "INVALID";

  if (
    inSec <= T_OFFICE_START &&
    outSec >= T_HALF_A_END &&
    outSec < T_HALF_B_START + 1
  ) {
    return "SLOT_A";
  }

  if (inSec >= T_HALF_B_START && outSec >= T_LOGOUT_CUTOFF) {
    return "SLOT_B";
  }

  return "INVALID";
}

export function calculateNetWorkMillis(log) {
  const inSec = timeToSeconds(log.office_in);
  const outSec = timeToSeconds(log.office_out);

  if (inSec === null || outSec === null) return 0;

  // ✅ If employee logs in before 10 AM, count only from 10 AM
  const actualIn = Math.max(inSec, T_OFFICE_START);

  // ✅ Count only until 7 PM maximum
  const actualOut = Math.min(outSec, T_LOGOUT_CUTOFF);

  const grossMs = Math.max(0, (actualOut - actualIn) * 1000);

  let breakMs = 0;

  const breakPairs = [
    [log.break_in, log.break_out],
    [log.break_in_2, log.break_out_2],
    [log.lunch_in, log.lunch_out],
  ];

  for (const [bIn, bOut] of breakPairs) {
    const bInSec = timeToSeconds(bIn);
    const bOutSec = timeToSeconds(bOut);

    if (bInSec !== null && bOutSec !== null && bOutSec > bInSec) {
      breakMs += (bOutSec - bInSec) * 1000;
    }
  }

  const extraIns = Array.isArray(log.extra_break_ins)
    ? log.extra_break_ins
    : [];
  const extraOuts = Array.isArray(log.extra_break_outs)
    ? log.extra_break_outs
    : [];

  const pairCount = Math.min(extraIns.length, extraOuts.length);

  for (let i = 0; i < pairCount; i++) {
    const bInSec = timeToSeconds(extraIns[i]);
    const bOutSec = timeToSeconds(extraOuts[i]);

    if (bInSec !== null && bOutSec !== null && bOutSec > bInSec) {
      breakMs += (bOutSec - bInSec) * 1000;
    }
  }

  return Math.max(0, grossMs - breakMs);
}

export function evaluateLateLogin(log) {
  const result = {
    is_late: false,
    is_within_grace: false,
    is_beyond_grace: false,
  };

  const inSec = timeToSeconds(log?.office_in);
  if (inSec === null) return result;

  if (inSec <= T_OFFICE_START) return result;

  result.is_late = true;

  if (inSec <= T_LATE_GRACE_LIMIT) {
    result.is_within_grace = true;
  } else {
    result.is_beyond_grace = true;
  }

  return result;
}

export function buildMonthlyLateStats(logsByDate, daysInMonth, year, month) {
  let permittedLateCount = 0;
  const exceededDates = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      d
    ).padStart(2, "0")}`;

    const log = logsByDate[dateStr];
    if (!log) continue;

    const lateInfo = evaluateLateLogin(log);

    if (lateInfo.is_within_grace) {
      permittedLateCount++;

      if (permittedLateCount > MAX_PERMITTED_LATES) {
        exceededDates.push(dateStr);
      }
    }
  }

  return {
    permitted_late_count: permittedLateCount,
    exceeded_dates: exceededDates,
    max_permitted: MAX_PERMITTED_LATES,
    remaining: Math.max(0, MAX_PERMITTED_LATES - permittedLateCount),
  };
}

export function qualifiesHalfDayBySlot(log, netMillis) {
  const netHours = netMillis / 3_600_000;

  if (netHours < 4 || netHours >= 8) return false;

  const inSec = timeToSeconds(log.office_in);
  const outSec = timeToSeconds(log.office_out);

  if (inSec === null || outSec === null) return false;

  // Morning half day: login by 10 AM, logout around/after 2:30 PM but before 7 PM
  const coversSlotA =
    inSec <= T_OFFICE_START &&
    outSec >= T_HALF_A_END &&
    outSec < T_LOGOUT_CUTOFF;

  // Afternoon half day: login from 2:30 PM, logout at/after 7 PM
  const coversSlotB =
    inSec >= T_HALF_B_START &&
    outSec >= T_LOGOUT_CUTOFF;

  return coversSlotA || coversSlotB;
}




export function classifySunday(sundayDateStr, logsByDate, holidaySet) {
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

  let satConditionMet = false;

  if (isMonthStartSunday) {
    satConditionMet = true;
  } else if (satLog) {
    const satOutSec = timeToSeconds(satLog.office_out);
    const satLT = (satLog.leave_type || "").toLowerCase();

    satConditionMet =
      (satOutSec !== null && satOutSec >= T_LOGOUT_CUTOFF) ||
      satLT.includes("paid") ||
      satLT.includes("half") ||
      satLT.includes("earned");
  }

  let monConditionMet = false;

  if (monLog) {
    const monInSec = timeToSeconds(monLog.office_in);
    const monLT = (monLog.leave_type || "").toLowerCase();

    monConditionMet =
      (monInSec !== null && monInSec <= T_LATE_GRACE_LIMIT) ||
      monLT.includes("earned") ||
      monLT.includes("paid");
  }

  return satConditionMet && monConditionMet ? "holiday" : "absent";
}

export function classifyDayPolicy({
  dateStr,
  log,
  holidaySet,
  monthlyLateStats,
  logsByDate,
}) {
  const date = parseDateStr(dateStr);
  const weekday = date.getDay();

  const netMs = log ? calculateNetWorkMillis(log) : 0;
  const netHours = netMs / 3_600_000;
  const flags = [];

  // Monday after 2 PM = absent
  if (weekday === 1 && log?.office_in) {
    const inSec = timeToSeconds(log.office_in);

    if (inSec !== null && inSec > T_MONDAY_CUTOFF) {
      flags.push("monday_late_full_absent");

      return {
        bucket: "absent",
        reason: "Monday login after 2:00 PM",
        net_hours: netHours,
        flags,
      };
    }
  }

  // Sunday
  if (weekday === 0) {
    const bucket = classifySunday(dateStr, logsByDate, holidaySet);

    return {
      bucket,
      reason:
        bucket === "holiday"
          ? "Sunday — conditions met"
          : "Sunday — conditions not met",
      net_hours: 0,
      flags,
    };
  }

  // Company holiday
  if (holidaySet.has(dateStr)) {
    flags.push("paid_holiday");

    return {
      bucket: "holiday",
      reason: "Company holiday",
      net_hours: 0,
      flags,
    };
  }

  const leaveType = (log?.leave_type || "").toLowerCase();
  const leaveStatus = (log?.leave_status || "").toLowerCase();
  const isPaidLeave =
    leaveType.includes("paid") || leaveType.includes("earned");

  if (
    (leaveStatus === "pending" || leaveStatus === "rejected") &&
    !log?.office_in &&
    !log?.office_out
  ) {
    flags.push(
      "grace_absent",
      leaveStatus === "pending" ? "leave_pending" : "leave_rejected"
    );

    return {
      bucket: "absent",
      reason: `Leave ${leaveStatus} — no attendance`,
      net_hours: 0,
      flags,
    };
  }

  if (isPaidLeave) {
    flags.push("paid_leave");

    return {
      bucket: "paidleave",
      reason: "Paid leave",
      net_hours: netHours,
      flags,
    };
  }

  if (log?.leave_type && !isPaidLeave) {
    flags.push("unpaid_leave");

    return {
      bucket: "absent",
      reason: "Unpaid leave",
      net_hours: 0,
      flags,
    };
  }

  if (!log?.office_in || !log?.office_out) {
    return {
      bucket: "absent",
      reason: "No attendance record",
      net_hours: 0,
      flags,
    };
  }

  const outSec = timeToSeconds(log.office_out);
  const lateInfo = evaluateLateLogin(log);
  const isExceededLate = (monthlyLateStats?.exceeded_dates || []).includes(
    dateStr
  );

  // ✅ Main rule requested:
  // Even if production hours are 8, logout before 7 PM = HALF DAY
  if (outSec !== null && outSec < T_LOGOUT_CUTOFF) {
    if (netHours < 4) {
      flags.push("early_logout_absent");

      return {
        bucket: "absent",
        reason: "Early logout before 7 PM and less than 4 net working hours",
        net_hours: netHours,
        flags,
      };
    }

    flags.push("early_logout_halfday");

    return {
      bucket: "halfday",
      reason: "Early logout before 7 PM",
      net_hours: netHours,
      flags,
    };
  }
  // ✅ Half-day slot rule: 2:30 PM to 7 PM = Half Day
if (qualifiesHalfDayBySlot(log, netMs)) {
  flags.push("halfday_slot");

  return {
    bucket: "halfday",
    reason: "Valid half-day slot worked",
    net_hours: netHours,
    flags,
  };
}
const lateCountExceeded = isExceededLate;
const beyondGrace = lateInfo.is_beyond_grace;

// ✅ If late is still within allowed 6 late logins, do not punish.
// Example: 10:16 to 7 PM with 8+ hrs should be FULL DAY
if ((lateInfo.is_within_grace || beyondGrace) && !lateCountExceeded) {
  if (netHours >= 8 && outSec >= T_LOGOUT_CUTOFF) {
    return {
      bucket: "fullday",
      reason: "Full day — late within monthly allowed limit",
      net_hours: netHours,
      flags,
    };
  }

  if (netHours >= 4 && outSec >= T_LOGOUT_CUTOFF) {
    return {
      bucket: "halfday",
      reason: "Half day — late within monthly allowed limit",
      net_hours: netHours,
      flags,
    };
  }

  return {
    bucket: "absent",
    reason: "Late login — insufficient working hours",
    net_hours: netHours,
    flags,
  };
}

// ✅ After allowed late count exceeded, apply penalty
if (lateCountExceeded || beyondGrace) {
  flags.push("late_penalty");

  if (netHours >= 4 && outSec >= T_LOGOUT_CUTOFF) {
    return {
      bucket: "halfday",
      reason: "Late penalty — half day",
      net_hours: netHours,
      flags,
    };
  }

  return {
    bucket: "absent",
    reason: "Late penalty — absent",
    net_hours: netHours,
    flags,
  };
}
 

  if (netHours < 4) {
    flags.push("lt4h");

    return {
      bucket: "absent",
      reason: "Less than 4 net hours",
      net_hours: netHours,
      flags,
    };
  }

  if (netHours < 8) {
    flags.push("half_day");

    return {
      bucket: "halfday",
      reason: "4–8 net hours",
      net_hours: netHours,
      flags,
    };
  }

  return {
    bucket: "fullday",
    reason: "Full day — logout after 7 PM and 8+ net hours",
    net_hours: netHours,
    flags,
  };
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

  const monthlyLateStats = buildMonthlyLateStats(
    logsByDate,
    daysInMonth,
    year,
    month
  );

  let fullDays = 0;
  let halfDays = 0;
  let paidLeaves = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let lateCount = 0;
  let totalNetMs = 0;
  let workDayCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(
      d
    ).padStart(2, "0")}`;

    if (dateStr > todayStr) break;

    const log = logsByDate[dateStr] || null;

    const result = classifyDayPolicy({
      dateStr,
      log,
      holidaySet,
      monthlyLateStats,
      logsByDate: logsByDateExtended || logsByDate,
    });

    switch (result.bucket) {
      case "fullday":
        fullDays++;
        break;
      case "halfday":
        halfDays++;
        break;
      case "paidleave":
        paidLeaves++;
        break;
      case "holiday":
        holidayDays++;
        break;
      case "absent":
        absentDays++;
        break;
      default:
        break;
    }

    if (log) {
      const lateInfo = evaluateLateLogin(log);
      if (lateInfo.is_late) lateCount++;
    }

    const netMs = log ? calculateNetWorkMillis(log) : 0;

    if (netMs > 0) {
      totalNetMs += netMs;
      workDayCount++;
    }
  }

  return {
    full_days: fullDays,
    half_days: halfDays,
    paid_leaves: paidLeaves,
    absent_days: absentDays,
    holiday_days: holidayDays,
    late_count: lateCount,
    total_net_millis: totalNetMs,
    avg_net_millis:
      workDayCount > 0 ? Math.round(totalNetMs / workDayCount) : null,
    work_day_count: workDayCount,
  };
}

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