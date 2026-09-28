/**
 * ============================================================
 * PAYROLL CALCULATION ENGINE — VJC OVERSEAS HRMS
 * ============================================================
 *
 * ✅ FIXED: Paid leave eligibility now correctly applies to
 *    ABSENT days (not just formal leave_requests).
 *
 * PAID LEAVE LOGIC (corrected):
 *   1. Employee eligible after 3 completed months from joining.
 *   2. Quota = 1 paid leave per month.
 *   3. Absent days consume the quota first → become paidLeaveUsed.
 *   4. Only days beyond the quota remain as unpaidLeaveDays.
 *   5. Formally approved leave_requests are handled the same way.
 *
 *
 * SALARY FORaMULA:
 *   totalUnpaidDays = unpaidLeaveDays + halfDays × 0.5
 *   leaveDeduction  = dailyRate × totalUnpaidDays
 *   penaltyDeduction = dailyRate × penaltyDays
 *   grossPay = monthlySalary + incentives
 netPay      = grossPay − tax − otherDeductions
 * ============================================================
 */

import { getComputedAttendanceStatus } from "../utils/computedAttendanceStatus.js";
import { calculateBreakMinutesFromRows } from "../utils/breakMinutes.js";
import { applySandwichPolicy, getSandwichSummary } from "../utils/sandwichPolicy.js";

// ─── Constants ────────────────────────────────────────────────
const PAID_LEAVE_ELIGIBILITY_MONTHS = 3;
const PAID_LEAVE_PER_MONTH          = 1;
const OFFICE_START_MINUTES          = 10 * 60;
const LATE_LOGIN_START_MINUTES      = 10 * 60 + 15;
const HALF_DAY_LOGIN_START_MINUTES  = 10 * 60 + 30;
const AFTERNOON_HALF_DAY_START_MINUTES = 14 * 60 + 30;
const REQUIRED_FULL_DAY_MINUTES     = 9 * 60;

// ─── Utilities ────────────────────────────────────────────────
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function allDatesInMonth(year, month) {
  const total = daysInMonth(year, month);
  const dates = [];
  for (let d = 1; d <= total; d++) {
    dates.push(
      `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }
  return dates;
}


// ADD this helper above monthsBetween
function safeDate(d) {
  // Always parse as a local date — never let timezone shift the day
  if (!d) throw new Error("Missing date value");
  const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day); // local midnight, no UTC shift
}

// REPLACE monthsBetween entirely
function monthsBetween(fromDate, toDate) {
  const f = safeDate(fromDate);
  const t = safeDate(toDate);
  return (
    (t.getFullYear() - f.getFullYear()) * 12 +
    (t.getMonth() - f.getMonth())
  );
}



function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeDateString(value, fallback = null) {
  if (!value) return fallback;
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeAttendanceRow(row = {}) {
  const status = row.status ? String(row.status).toLowerCase() : null;
  return {
    ...row,
    date: safeDateString(row.date),
    status,
    late_minutes: finiteNumber(row.late_minutes, 0),
    production_hours: finiteNumber(row.production_hours, 0),
    total_break_minutes: finiteNumber(row.total_break_minutes, 0),
    check_in_time: row.check_in_time || null,
    check_out_time: row.check_out_time || null,
    half_day_slot: row.half_day_slot || null,
  };
}

function fmtINR(n) {
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isValidHalfDaySlot(rec) {
  return ["SLOT_A", "SLOT_B"].includes(rec?.half_day_slot);
}

function grossHoursFromRecord(rec) {
  const checkInMinutes = timeToMinutes(rec?.check_in_time);
  const checkOutMinutes = timeToMinutes(rec?.check_out_time);
  if (checkInMinutes === null || checkOutMinutes === null || checkOutMinutes <= checkInMinutes) {
    return 0;
  }
  return (checkOutMinutes - Math.max(checkInMinutes, OFFICE_START_MINUTES)) / 60;
}

function normalizeAttendanceStatus(rec, dateStr, holidaySet = new Set()) {
  return getComputedAttendanceStatus(rec, { dateStr, holidaySet }).computed_status;
}

// ============================================================
// STEP 1: Fetch raw data
// ============================================================
async function fetchPayrollData(pool, userId, year, month) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error("Invalid employee id");
  }
  if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(month)) || month < 1 || month > 12) {
    throw new Error("Invalid payroll month");
  }

  const monthStr   = String(month).padStart(2, "0");
  const monthStart = `${year}-${monthStr}-01`;
  const total      = daysInMonth(year, month);
  const monthEnd   = `${year}-${monthStr}-${String(total).padStart(2, "0")}`;

  // Rule R: Extend date range by 1 day on both sides for cross-month sandwich support
  const extendedStart = new Date(year, month - 1, 0); // Last day of previous month
  const extendedEnd = new Date(year, month, 1); // First day of next month
  const extendedStartStr = extendedStart.toISOString().slice(0, 10);
  const extendedEndStr = extendedEnd.toISOString().slice(0, 10);

  const userRes = await pool.query(
    `SELECT
         id, full_name, email, department, branch,
         salary               AS monthly_salary,
         employee_code,
         COALESCE(joining_date, DATE(created_at)) AS joining_date,
         role
       FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) throw new Error(`Employee ${userId} not found`);

  const joiningDate = safeDateString(userRes.rows[0].joining_date, monthStart);
  const effectiveStartDate = joiningDate > monthStart ? joiningDate : monthStart;

  const [holidayRes, attRes, breakRes, leaveRes] = await Promise.all([
    pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, name, type
       FROM company_holidays
       WHERE date BETWEEN $1 AND $2
         AND (branch = 'all' OR branch IS NULL)
       ORDER BY date`,
      [extendedStartStr, extendedEndStr]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         status, late_minutes, check_in_time, check_out_time,
         production_hours, total_break_minutes, half_day_slot,
         leave_type, leave_status, post_login_idle_minutes, misuse_of_time
       FROM attendance_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [userId, extendedStartStr, extendedEndStr]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         break_type, start_time, end_time, duration_minutes, break3_sessions
       FROM employee_breaks
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, break_type`,
      [userId, extendedStartStr, extendedEndStr]
    ),
    pool.query(
      `SELECT
  TO_CHAR(from_date,'YYYY-MM-DD') AS from_date,
  TO_CHAR(to_date,'YYYY-MM-DD') AS to_date,
  days,
  requested_days,
  leave_duration_type,
  leave_type,
  status,
  COALESCE(paid_days,0) AS paid_days,
  COALESCE(unpaid_days,0) AS unpaid_days,
  COALESCE(penalty_days,0) AS penalty_days,
  leave_category
FROM leave_requests
WHERE user_id = $1
  AND status = 'approved'
  AND from_date <= $3
  AND to_date >= $2`,
      [userId, extendedStartStr, extendedEndStr]
    ),
  ]);

  const breakRowsByDate = new Map();
  for (const row of breakRes.rows) {
    if (!breakRowsByDate.has(row.date)) breakRowsByDate.set(row.date, []);
    breakRowsByDate.get(row.date).push(row);
  }
  const attendance = attRes.rows
    .map(normalizeAttendanceRow)
    .filter(row => row.date)
    .map(row => ({
      ...row,
      total_break_minutes: breakRowsByDate.has(row.date)
        ? calculateBreakMinutesFromRows(breakRowsByDate.get(row.date))
        : row.total_break_minutes,
    }));

  return {
    employee        : userRes.rows[0],
    holidays        : holidayRes.rows,
    attendance,
    leaves          : leaveRes.rows,
    year, month,
    monthStart, monthEnd,
    effectiveStartDate,
    totalDaysInMonth: total,
  };
}

// ============================================================
// Helper: Iterate dates using UTC to avoid timezone bugs
// ============================================================
function eachDate(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const out = [];
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ============================================================
// STEP 2: Build calendar maps with sandwich policy
// ============================================================
function buildCalendarMaps(data, options = {}) {
  const { holidays, attendance, leaves, year, month, effectiveStartDate } = data;
  const { today, sandwichEnabled = true } = options || {};

  const holidayMap = new Map(holidays.map(h => [h.date, h]));
  const attMap     = new Map(attendance.map(a => [a.date, a]));

  const approvedLeaveSet = new Set();
  const halfDayLeaveMap = new Map(); // date -> { paid, unpaid } (each 0..0.5)
  
  for (const leave of leaves) {
    const isHalf = String(leave.leave_duration_type || "").toLowerCase() === "half_day";
    for (const ds of eachDate(leave.from_date, leave.to_date)) {
      if (isHalf) {
        const paid = Math.min(0.5, Math.max(0, Number(leave.paid_days) || 0));
        const unpaid = Number(leave.unpaid_days) > 0
          ? Math.min(0.5, Number(leave.unpaid_days))
          : round2(0.5 - paid);
        halfDayLeaveMap.set(ds, { paid, unpaid });
      } else {
        approvedLeaveSet.add(ds);
      }
    }
  }

  // Rule R: Use extended date range for sandwich policy (previous month last day to next month first day)
  const extendedStart = new Date(year, month - 1, 0); // Last day of previous month
  const extendedEnd = new Date(year, month, 1); // First day of next month
  const extendedStartStr = extendedStart.toISOString().slice(0, 10);
  const extendedEndStr = extendedEnd.toISOString().slice(0, 10);
  
  // Generate extended date range for sandwich processing
  const allDatesExtended = [];
  for (let t = Date.UTC(year, month - 1, 0); t <= Date.UTC(year, month, 1); t += 86400000) {
    allDatesExtended.push(new Date(t).toISOString().slice(0, 10));
  }

  // Apply sandwich policy to extended range
  const sandwichData = {
    attMap,
    holidayMap,
    halfDayLeaveMap,
    allDates: allDatesExtended,
    leaves: data.leaves,
  };
  
  let sandwichResults = [];
  let allowanceUsage = new Map();
  
  if (sandwichEnabled) {
    const result = applySandwichPolicy(sandwichData, {
      todayStr: today || new Date().toISOString().slice(0, 10),
      joiningDate: data.employee.joining_date,
    });
    sandwichResults = result.sandwichResults;
    allowanceUsage = result.allowanceUsage;
  }
  
  // We no longer mutate the attendance map - sandwich results are separate metadata

  // Generate original month dates for processing
  const allDates    = allDatesInMonth(year, month);
  const activeDates = allDates.filter(ds => ds >= effectiveStartDate);
  const sundayDates  = [];
  const holidayDates = [];
  const workingDays  = [];

  for (const ds of activeDates) {
    const dow = new Date(ds + "T00:00:00").getDay();
    if (dow === 0)               sundayDates.push(ds);
    else if (holidayMap.has(ds)) holidayDates.push(ds);
    else                         workingDays.push(ds);
  }

  return { 
    holidayMap, 
    attMap, // Use original attendance map (no mutation)
    approvedLeaveSet, 
    halfDayLeaveMap,
    allDates, 
    activeDates, 
    sundayDates, 
    holidayDates, 
    workingDays,
    sandwichResults, // Include sandwich results for debugging
    allowanceUsage, // Include allowance usage for debugging
    allDatesExtended // Include extended dates for cross-month support
  };
}

// ============================================================
// STEP 3: Tally attendance
// ============================================================
function minutesFromTime(value) {
  if (!value) return null;
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function isGraceLateLogin(rec = {}) {
  const checkInMinutes = minutesFromTime(rec.check_in_time);
  return checkInMinutes !== null
    && checkInMinutes >= LATE_LOGIN_START_MINUTES
    && checkInMinutes < AFTERNOON_HALF_DAY_START_MINUTES;
}

function tallyAttendance(workingDays, attMap, approvedLeaveSet, holidayMap = new Map(), halfDayLeaveMap = new Map(), options = {}) {
  const { today } = options || {};
  
  let fullDays           = 0;
  let halfDays           = 0;
  let absentDays         = 0;        // raw absent (no attendance record, no approved leave)
  let pendingDays       = 0;        // future no-record days
  let formalLeaveCount   = 0;        // approved leave_requests days that fall on working days
  let lateLogins         = 0;
  let halfLeavePaid      = 0;
  let halfLeaveUnpaid    = 0;
  let halfLeaveAbsent    = 0;
  const lateDates        = [];
  const halfDayDates     = [];
  const absentDates      = [];
  const pendingDates     = [];

  for (const ds of workingDays) {
    const rec = attMap.get(ds);

    const hl = halfDayLeaveMap.get(ds);
    if (hl) {
      halfLeavePaid += hl.paid;
      halfLeaveUnpaid += hl.unpaid;
      const worked = rec && (rec.check_in_time || rec.check_out_time);
      if (!worked) halfLeaveAbsent += 0.5; // other half not worked
      continue; // never also counted as halfDays / formalLeave
    }

    if (!rec) {
      // No check-in at all
      if (approvedLeaveSet.has(ds)) {
        formalLeaveCount++;   // will be reclassified as paid/unpaid in Step 4
      } else {
        // Check if this is a future/pending date
        const isFuture = today && ds > today;
        if (isFuture) {
          pendingDays++;
          pendingDates.push(ds);
        } else {
          absentDays++;         // same reclassification in Step 4
          absentDates.push(ds);
        }
      }
      continue;
    }

    if (isGraceLateLogin(rec)) {
      lateLogins++;
      lateDates.push({ date: ds, minutes: rec.late_minutes });
    }

    const status = normalizeAttendanceStatus(rec, ds, new Set(holidayMap.keys()));
    
    if (status === "full_day" || status === "present") {
      fullDays++;
    } else if (status === "half_day") {
      halfDays++;
      halfDayDates.push(ds);
    } else if (["leave", "paid_leave", "unpaid_leave"].includes(status)) {
      // Fix (d): paid_leave and unpaid_leave should count as formal leave
      if (approvedLeaveSet.has(ds)) formalLeaveCount++;
      else { absentDays++; absentDates.push(ds); }
    } else {
      // absent / unknown
      absentDays++;
      absentDates.push(ds);
    }
  }

  const lateLoginHalfDays = 0;

  return {
    fullDays, halfDays, absentDays, pendingDays, formalLeaveCount,
    lateLogins, lateLoginHalfDays, lateDates, halfDayDates, absentDates, pendingDates,
    halfLeavePaid, halfLeaveUnpaid, halfLeaveAbsent,
  };
}

function computeApprovedLeaveSplit(leaves) {
  let paidLeaveUsed = 0;
  let unpaidLeaveDays = 0;
  let penaltyDays = 0;

  for (const leave of leaves || []) {
    const type = String(leave.leave_type || "").toLowerCase();
    const category = String(leave.leave_category || "").toLowerCase();
    const days = Number(leave.requested_days ?? leave.days ?? 0);

    if (type === "paid" || category === "paid") {
      paidLeaveUsed += Number(leave.paid_days || days || 0);
      unpaidLeaveDays += Number(leave.unpaid_days || 0);
    } else {
      paidLeaveUsed += 0;
      unpaidLeaveDays += days;
    }

    penaltyDays += Number(leave.penalty_days || 0);
  }

  return {
    paidLeaveUsed: round2(paidLeaveUsed),
    unpaidLeaveDays: round2(unpaidLeaveDays),
    penaltyDays: round2(penaltyDays),
  };
}

// ============================================================
// STEP 4: Paid leave eligibility  ✅ FIXED
//
// FIX: Both plain absences AND formal leave requests consume
//      the paid leave quota. Only the surplus is unpaid.
//
// totalAbsences = absentDays + formalLeaveCount
// paidLeaveUsed = min(quota, totalAbsences)
// unpaidLeaveDays = totalAbsences - paidLeaveUsed
// ============================================================
function computePaidLeave(joiningDate, monthStart, absentDays, formalLeaveCount, halfLeavePaid = 0) {
  const monthsCompleted  = monthsBetween(joiningDate, monthStart);
  const eligible         = monthsCompleted >= PAID_LEAVE_ELIGIBILITY_MONTHS;
  const allowedPaidLeave = eligible ? PAID_LEAVE_PER_MONTH : 0;


  // Half-day paid leave consumes quota first
  const usedByHalf   = Math.min(halfLeavePaid, allowedPaidLeave);
  const quotaLeft    = allowedPaidLeave - usedByHalf;
  const totalAbsences = absentDays + formalLeaveCount;
  const paidFromAbs   = Math.min(quotaLeft, totalAbsences);


  return {
    monthsCompleted,
    eligible,
    allowedPaidLeave,
    paidLeaveUsed: usedByHalf + paidFromAbs,
    unpaidLeaveDays: Math.max(0, totalAbsences - paidFromAbs),
    totalAbsences,
  };
}

// ============================================================
// STEP 5: Salary formula (no double-deduction)
// ============================================================
function computeSalary(params) {
  const {
    monthlySalary,
    totalDaysInMonth,
    payableDays,
    penaltyDays = 0,
    incentives,
    manualDeductions,
    tax,
  } = params;

  const dailyRate = round2(monthlySalary / totalDaysInMonth);

  const earnedBasic = round2(dailyRate * Number(payableDays || 0));

  const absentDeduction = round2(
    monthlySalary - earnedBasic
  );

  const penaltyDeduction = round2(
    dailyRate * Number(penaltyDays || 0)
  );

  const grossPay = round2(
    earnedBasic + Number(incentives || 0)
  );

  const totalDeductions = round2(
    penaltyDeduction +
      Number(manualDeductions || 0) +
      Number(tax || 0)
  );

  const netPay = round2(
    grossPay -
      penaltyDeduction -
      Number(manualDeductions || 0) -
      Number(tax || 0)
  );

  return {
    dailyRate,
    payableDays,
    earnedBasic,
    absentDeduction,
    penaltyDeduction,
    totalDeductions,
    grossPay,
    netPay,
  };
}



// ============================================================
// MAIN: calculatePayroll
// ============================================================
async function calculatePayroll(pool, userId, year, month, overrides = {}) {
  const { incentives = 0, manualDeductions = 0, tax = 0, today, sandwichEnabled = true } = overrides;

  const data = await fetchPayrollData(pool, userId, year, month);
  const { employee, totalDaysInMonth, monthStart, effectiveStartDate } = data;

  const monthlySalary = finiteNumber(employee.monthly_salary, 0);
  if (monthlySalary <= 0) throw new Error("Employee has no salary configured");

  const maps = buildCalendarMaps(data, { today, sandwichEnabled });
  const { sundayDates, holidayDates, workingDays, attMap, approvedLeaveSet, holidayMap, activeDates, halfDayLeaveMap, sandwichResults, allowanceUsage, leaves } = maps;

  const tally = tallyAttendance(workingDays, attMap, approvedLeaveSet, holidayMap, halfDayLeaveMap, { today });

  // ✅ Pass BOTH absentDays and formalLeaveCount to the fixed function
  const approvedLeaveSplit = computeApprovedLeaveSplit(data.leaves);
  const leaveCalc = computePaidLeave(
    employee.joining_date,
    monthStart,
    Number(tally.absentDays || 0) + Number(tally.halfLeaveAbsent || 0),
    Number(tally.formalLeaveCount || 0),
    Number(tally.halfLeavePaid || 0)
  );
  leaveCalc.penaltyDays = approvedLeaveSplit.penaltyDays;
  leaveCalc.paidLeaveUsed = round2(leaveCalc.paidLeaveUsed);
  leaveCalc.unpaidLeaveDays = round2(leaveCalc.unpaidLeaveDays) + Number(tally.halfLeaveUnpaid || 0); // ledger-unpaid half days
  leaveCalc.totalAbsences = round2(leaveCalc.totalAbsences);
  leaveCalc.totalAbsenceDays = leaveCalc.totalAbsences;

  const payableDays = round2(Math.max(
    0,
    Math.min(
      activeDates.length,
      Number(activeDates.length || 0) -
        Number(leaveCalc.unpaidLeaveDays || 0) -
        Number(tally.halfDays || 0) * 0.5
    )
  ));

  // Add sandwich Sundays to unpaidLeaveDays AFTER computePaidLeave()
  // This ensures sandwich Sundays don't consume the paid-leave quota
  const sandwichSundays = sandwichResults.filter(r => r.applied);
  const sandwichSundayCount = sandwichSundays.length;
  
  // Add sandwich Sundays to unpaidLeaveDays
  leaveCalc.unpaidLeaveDays = round2(leaveCalc.unpaidLeaveDays + sandwichSundayCount);
  
  // Recalculate payableDays with sandwich Sundays included
  const finalPayableDays = round2(Math.max(
    0,
    Math.min(
      activeDates.length,
      Number(activeDates.length || 0) -
        Number(leaveCalc.unpaidLeaveDays || 0) -
        Number(tally.halfDays || 0) * 0.5
    )
  ));

  const salary = computeSalary({
    monthlySalary,
    totalDaysInMonth,
    payableDays: finalPayableDays,
    penaltyDays: leaveCalc.penaltyDays || 0,
    incentives,
    manualDeductions,
    tax,
  });


  return {
    employee: {
      id            : employee.id,
      full_name     : employee.full_name,
      email         : employee.email,
      department    : employee.department,
      branch        : employee.branch,
      employee_code : employee.employee_code,
      joining_date  : safeDateString(employee.joining_date, monthStart),
      monthly_salary: monthlySalary,
    },
    period: { year, month, monthStart, effectiveStartDate },
    calendar: {
      totalDaysInMonth,
      activeDaysInMonth  : activeDates.length,
      preJoinExcludedDays: totalDaysInMonth - activeDates.length,
      sundayCount      : sundayDates.length,
      sundayDates,
      holidayCount     : holidayDates.length,
      holidayDates     : data.holidays,
      workingDaysCount : workingDays.length,
    },
    attendance: {
      fullDays           : tally.fullDays,
      halfDays           : tally.halfDays,
      absentDays         : tally.absentDays,
      absentDates        : tally.absentDates,
      formalLeaveCount   : tally.formalLeaveCount,
      pendingDays        : tally.pendingDays,
      pendingDates       : tally.pendingDates,
      lateLogins         : tally.lateLogins,
      lateLoginHalfDays  : tally.lateLoginHalfDays,
      lateDates          : tally.lateDates,
      halfDayDates       : tally.halfDayDates,
    },
    sandwich: {
      allowanceUsage: Object.fromEntries(allowanceUsage),
      results: getSandwichSummary(sandwichResults),
      sundaysAddedToUnpaid: sandwichSundayCount,
    },
    leave: {
      monthsCompleted: leaveCalc.monthsCompleted,
      eligible: leaveCalc.eligible,
      allowedPaidLeave: leaveCalc.allowedPaidLeave,
      paidLeaveUsed: leaveCalc.paidLeaveUsed,
      unpaidLeaveDays: leaveCalc.unpaidLeaveDays,
      penaltyDays: leaveCalc.penaltyDays || 0,
      totalAbsences: leaveCalc.totalAbsences,
      totalAbsenceDays: leaveCalc.totalAbsenceDays,
      remainingPaidLeave: Math.max(
        0,
        leaveCalc.allowedPaidLeave - leaveCalc.paidLeaveUsed
      ),
    },

    salary: {
      monthlyCTC: monthlySalary,
      dailyRate: salary.dailyRate,
      payableDays: salary.payableDays,
      earnedSalary: salary.earnedBasic,
      incentives: Number(incentives),
      grossPay: salary.grossPay,
      absenceDeduction: salary.absentDeduction,
      penaltyDeduction: salary.penaltyDeduction,
      manualDeductions: Number(manualDeductions),
      totalDeductions: salary.totalDeductions,
      tax: Number(tax),
      netPay: salary.netPay,
    },
  };
}

// ============================================================
// BATCH
// ============================================================
async function batchCalculatePayroll(pool, year, month, filters = {}) {
  const { branch, department } = filters;
  const maxBatchEmployees = Number(process.env.MAX_PAYROLL_BATCH_EMPLOYEES || 100);
  let query = `SELECT id FROM users WHERE role IN ('EMPLOYEE','MANAGER','OPERATIONAL_MANAGER','SUB_ADMIN') AND salary > 0`;
  const params = [];
  let idx = 1;
  if (branch && branch !== "all")         { query += ` AND branch     = $${idx}`; params.push(branch);     idx++; }
  if (department && department !== "all") { query += ` AND department = $${idx}`; params.push(department); idx++; }
  query += " ORDER BY id";

  const employees = await pool.query(query, params);
  if (employees.rows.length > maxBatchEmployees) {
    const err = new Error(`Payroll batch has ${employees.rows.length} employees. Limit is ${maxBatchEmployees}; filter by branch/department or increase MAX_PAYROLL_BATCH_EMPLOYEES.`);
    err.statusCode = 413;
    throw err;
  }
  const results   = [];
  const errors    = [];
  const CHUNK     = 10;

  for (let i = 0; i < employees.rows.length; i += CHUNK) {
    const chunk   = employees.rows.slice(i, i + CHUNK);
    const settled = await Promise.allSettled(
      chunk.map(e => calculatePayroll(pool, e.id, year, month))
    );
    settled.forEach((s, ci) => {
      if (s.status === "fulfilled") results.push(s.value);
      else errors.push({ userId: chunk[ci].id, error: s.reason.message });
    });
  }
  return { results, errors, processed: results.length, failed: errors.length };
}

// ============================================================
// PERSIST
// ============================================================
async function persistPayslip(pool, calc, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
  const { employee, period, attendance, leave, salary, calendar } = calc;

  const existingRes = await client.query(
    `SELECT incentives, deductions, tax, net_pay
     FROM payslip_records
     WHERE user_id = $1 AND month = $2
     FOR UPDATE`,
    [employee.id, period.monthStart]
  );
  const existingPayslip = existingRes.rows[0] || null;
  const forceManualUpdate = Boolean(
    overrides.forceManualUpdate ||
      overrides.forceManualAdjustments ||
      overrides.forceRegeneration
  );
  const hasNonZeroOverride = key =>
    Object.prototype.hasOwnProperty.call(overrides, key) &&
    Number(overrides[key] || 0) !== 0;
  const shouldUseOverride = key =>
    forceManualUpdate || hasNonZeroOverride(key);

  const leaveDeduction = round2(Number(salary.absenceDeduction || 0));
  const penaltyDeduction = round2(Number(salary.penaltyDeduction || 0));
  const calculatedDeductions = round2(Number(salary.totalDeductions || 0));
  const effectiveIncentives = round2(
    existingPayslip && !shouldUseOverride("incentives")
      ? Number(existingPayslip.incentives || 0)
      : Number(salary.incentives || 0)
  );
  const effectiveDeductions = round2(
    existingPayslip && !shouldUseOverride("deductions")
      ? Number(existingPayslip.deductions || 0)
      : calculatedDeductions
  );
  const effectiveTax = round2(
    existingPayslip && !shouldUseOverride("tax")
      ? Number(existingPayslip.tax || 0)
      : Number(salary.tax || 0)
  );
  const manualOverrideApplied =
    forceManualUpdate ||
    hasNonZeroOverride("incentives") ||
    hasNonZeroOverride("deductions") ||
    hasNonZeroOverride("tax");
  const effectiveNetPay = round2(
    Number(salary.earnedSalary || 0) + effectiveIncentives - effectiveDeductions
  );

  const breakdown = JSON.stringify({
    autoCalculated: {
      totalDaysInMonth  : calendar.totalDaysInMonth,
  sundayCount       : calendar.sundayCount,
  holidayCount      : calendar.holidayCount,
  workingDaysCount  : calendar.workingDaysCount,
  fullDays          : attendance.fullDays,
  halfDays          : attendance.halfDays,
  absentDays        : attendance.absentDays,
  formalLeaveCount  : attendance.formalLeaveCount,
  approvedLeaveCount: attendance.formalLeaveCount,   // UI alias
  lateLogins        : attendance.lateLogins,
  lateLoginHalfDays : attendance.lateLoginHalfDays,
  monthsCompleted   : leave.monthsCompleted,
  eligible          : leave.eligible,
  allowedPaidLeave  : leave.allowedPaidLeave,
  paidLeaveUsed     : leave.paidLeaveUsed,           // ← was missing in some paths
  unpaidLeaveDays   : leave.unpaidLeaveDays,         // ← was missing in some paths
      totalAbsences     : leave.totalAbsences,
      totalAbsenceDays  : leave.totalAbsenceDays || leave.totalAbsences,
      dailyRate         : salary.dailyRate,

      earnedSalary      : salary.earnedSalary,
      grossPay          : salary.grossPay,
    },
  manualAdjustments: {
    incentives       : effectiveIncentives,
    deductions       : effectiveDeductions,
    tax              : effectiveTax,
    netPay           : effectiveNetPay,
    preservedExisting: Boolean(existingPayslip && !manualOverrideApplied),
  },
  totalDaysInMonth  : calendar.totalDaysInMonth,
  sundayCount       : calendar.sundayCount,
  holidayCount      : calendar.holidayCount,
  workingDaysCount  : calendar.workingDaysCount,
  fullDays          : attendance.fullDays,
  halfDays          : attendance.halfDays,
  absentDays        : attendance.absentDays,
  formalLeaveCount  : attendance.formalLeaveCount,
  approvedLeaveCount: attendance.formalLeaveCount,
  lateLogins        : attendance.lateLogins,
  lateLoginHalfDays : attendance.lateLoginHalfDays,
  monthsCompleted   : leave.monthsCompleted,
  eligible          : leave.eligible,
  allowedPaidLeave  : leave.allowedPaidLeave,
  paidLeaveUsed     : leave.paidLeaveUsed,
  unpaidLeaveDays   : leave.unpaidLeaveDays,
  totalAbsences     : leave.totalAbsences,
  totalAbsenceDays  : leave.totalAbsenceDays || leave.totalAbsences,
  dailyRate         : salary.dailyRate,
  earnedSalary      : salary.earnedSalary,
  grossPay          : salary.grossPay,
});


const result = await client.query(
  `INSERT INTO payslip_records
     (user_id, month, basic_salary, earned_basic,
      incentives, deductions, tax, net_pay,
      working_days, present_days, payment_status, breakdown,
      unpaid_leave_days, leave_deduction, penalty_days, penalty_deduction)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unpaid',$11,$12,$13,$14,$15)
   ON CONFLICT (user_id, month) DO UPDATE SET
     basic_salary = EXCLUDED.basic_salary,
     earned_basic = EXCLUDED.earned_basic,
     incentives = EXCLUDED.incentives,
     deductions = EXCLUDED.deductions,
     tax = EXCLUDED.tax,
     net_pay = EXCLUDED.net_pay,
     working_days = EXCLUDED.working_days,
     present_days = EXCLUDED.present_days,
     breakdown = EXCLUDED.breakdown,
     unpaid_leave_days = EXCLUDED.unpaid_leave_days,
     leave_deduction = EXCLUDED.leave_deduction,
     penalty_days = EXCLUDED.penalty_days,
     penalty_deduction = EXCLUDED.penalty_deduction,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`,
[
  employee.id,
  period.monthStart,
  salary.monthlyCTC,
  salary.earnedSalary,
  effectiveIncentives,
  effectiveDeductions,
  effectiveTax,
  effectiveNetPay,
  calendar.workingDaysCount,
  round2(
    attendance.fullDays +
    attendance.halfDays * 0.5 +
    leave.paidLeaveUsed
  ),
  breakdown,
  round2(leave.unpaidLeaveDays), // ✅ pure unpaid leave only
  leaveDeduction,
  leave.penaltyDays || 0,
  penaltyDeduction,
]
);

  await client.query("COMMIT");
  return result.rows[0];
  } catch (err) {
    await client.query("ROLLBACK").catch((rollbackErr) => {
      console.error("persistPayslip rollback failed:", rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
}

export {
  calculatePayroll,
  batchCalculatePayroll,
  persistPayslip,
  fetchPayrollData,
  buildCalendarMaps,
  tallyAttendance,
  computePaidLeave,
  computeSalary,
  daysInMonth,
  fmtINR,
  round2,
};

