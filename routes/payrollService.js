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
import { computeMonthSandwich } from "../utils/sandwichEngine.js";
import * as awiDeductionService from "../services/awiDeductionService.js";

// ─── Constants ────────────────────────────────────────────────
const PAID_LEAVE_ELIGIBILITY_DAYS = 90;
const PAID_LEAVE_PER_MONTH          = 1;
const OFFICE_START_MINUTES          = 10 * 60;
const LATE_LOGIN_START_MINUTES      = 10 * 60 + 15;
const HALF_DAY_LOGIN_START_MINUTES  = 10 * 60 + 30;
const AFTERNOON_HALF_DAY_START_MINUTES = 14 * 60 + 30;
const REQUIRED_FULL_DAY_MINUTES     = 9 * 60;
const LATE_LOGIN_PENALTY_AMOUNT    = 100; // ₹100 per late login

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

// Calculate days between two dates
function daysBetween(fromDate, toDate) {
  const f = safeDate(fromDate);
  const t = safeDate(toDate);
  const diffTime = t - f;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
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
  // If it's a Date object, extract date parts directly to avoid UTC timezone shifts
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value).slice(0, 10);
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

  // For sandwich analysis, we need one day before and after the month
  const contextStart = new Date(year, month - 1, 0);
  const contextEnd = new Date(year, month, 1);
  const contextStartStr = contextStart.toISOString().slice(0, 10);
  const contextEndStr = contextEnd.toISOString().slice(0, 10);

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

  const [holidayRes, attRes, breakRes, leaveRes, awiRes] = await Promise.all([
    pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, name, type
       FROM company_holidays
       WHERE date BETWEEN $1 AND $2
         AND (branch = 'all' OR branch IS NULL)
       ORDER BY date`,
      [contextStartStr, contextEndStr]
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
      [userId, contextStartStr, contextEndStr]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         break_type, start_time, end_time, duration_minutes, break3_sessions
       FROM employee_breaks
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, break_type`,
      [userId, effectiveStartDate, monthEnd]
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
      [userId, effectiveStartDate, monthEnd]
    ),
    pool.query(
      `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date, final_status
       FROM awi_cases
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       AND final_status IN ('authorized_absence', 'unauthorized_absence')`,
      [userId, contextStartStr, contextEndStr]
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
    }))
    .filter(row => row.date >= effectiveStartDate && row.date <= monthEnd);

  // Keep all attendance records (including context) for sandwich analysis
  const attendanceWithContext = attRes.rows
    .map(normalizeAttendanceRow)
    .filter(row => row.date)
    .map(row => ({
      ...row,
      total_break_minutes: breakRowsByDate.has(row.date)
        ? calculateBreakMinutesFromRows(breakRowsByDate.get(row.date))
        : row.total_break_minutes,
    }));

  // Filter holidays to only include those within the month for main payroll data
  const holidaysInMonth = holidayRes.rows.filter(h => h.date >= monthStart && h.date <= monthEnd);

  return {
    employee        : userRes.rows[0],
    holidays        : holidaysInMonth,
    holidaysWithContext: holidayRes.rows, // All holidays including context for sandwich
    attendance,
    attendanceWithContext, // All attendance including context for sandwich
    leaves          : leaveRes.rows,
    awiCases        : awiRes.rows,
    year, month,
    monthStart, monthEnd,
    effectiveStartDate,
    contextStartStr,
    contextEndStr,
    totalDaysInMonth: total,
  };
}

// ============================================================
// STEP 2: Build calendar maps
// ============================================================
function buildCalendarMaps(data) {
  const { holidays, holidaysWithContext, attendance, attendanceWithContext, leaves, awiCases, year, month, effectiveStartDate } = data;

  const holidayMap = new Map(holidaysWithContext.map(h => [h.date, h]));
  const attMap     = new Map(attendance.map(a => [a.date, a]));
  const attMapWithContext = new Map(attendanceWithContext.map(a => [a.date, a]));
  const awiMap = new Map(awiCases.map(a => [a.date, a.final_status]));
  const leaveMap = new Map();

  const approvedLeaveSet = new Set();
  for (const leave of leaves) {
    const start = new Date(leave.from_date + "T00:00:00");
    const end   = new Date(leave.to_date   + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      approvedLeaveSet.add(dateStr);
      leaveMap.set(dateStr, { status: leave.status, leave_type: leave.leave_type });
    }
  }

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

  return { holidayMap, attMap, attMapWithContext, approvedLeaveSet, awiMap, leaveMap, allDates, activeDates, sundayDates, holidayDates, workingDays };
}

// ============================================================
// STEP 2.5: Sandwich rule analysis
// ============================================================
function analyzeSandwich(sundayDates, holidayDates, attMap, holidayMap, joiningDate, year, month, awiMap, leaveMap) {
  console.log(`[SANDWICH DEBUG] Function called with parameters:`, {
    sundayDatesCount: sundayDates?.length,
    awiMapSize: awiMap?.size,
    leaveMapSize: leaveMap?.size,
  });

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log(`[Sandwich] Month: ${monthStr}, Joining date: ${joiningDate}, Today: ${todayStr}`);
  console.log(`[Sandwich] Sunday dates: ${sundayDates.join(', ')}`);
  console.log(`[Sandwich] Holiday dates: ${holidayDates.join(', ')}`);

  // NEW SANDWICH POLICY IMPLEMENTATION (same as analysisRoutes.js)
  const unpaidSundays = new Set();
  const qualifyingLeaves = [];

  // Helper function to format date string
  function formatDateStr(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Build complete attendance map with AWI days included (like analysisRoutes.js)
  const completeAttMap = new Map(attMap);
  for (const [date, awiStatus] of awiMap.entries()) {
    if (!completeAttMap.has(date)) {
      completeAttMap.set(date, {
        date,
        status: awiStatus,
        check_in_time: null,
        check_out_time: null,
      });
    }
  }

  // Collect all qualifying leaves (Saturday/Monday leaves + AWI + Absent + No Record)
  for (const dateStr of sundayDates) {
    const date = new Date(dateStr + "T00:00:00");
    const saturdayDate = new Date(date);
    saturdayDate.setDate(date.getDate() - 1);
    const saturdayStr = formatDateStr(saturdayDate);

    const mondayDate = new Date(date);
    mondayDate.setDate(date.getDate() + 1);
    const mondayStr = formatDateStr(mondayDate);

    const satDow = 6;
    const monDow = 1;

    // Check Saturday (day before Sunday) - only if within current month
    if (saturdayStr.startsWith(monthStr)) {
      if (awiMap.has(saturdayStr)) {
        qualifyingLeaves.push({ date: saturdayStr, dow: satDow, type: 'AWI' });
      } else if (leaveMap.has(saturdayStr)) {
        qualifyingLeaves.push({ date: saturdayStr, dow: satDow, type: 'LEAVE' });
      } else if (completeAttMap.has(saturdayStr)) {
        const attRec = completeAttMap.get(saturdayStr);
        if (attRec.status === 'absent') {
          qualifyingLeaves.push({ date: saturdayStr, dow: satDow, type: 'ABSENCE' });
        }
      } else if (!completeAttMap.has(saturdayStr) && !holidayMap.has(saturdayStr)) {
        qualifyingLeaves.push({ date: saturdayStr, dow: satDow, type: 'NO_RECORD' });
      }
    }

    // Check Monday (day after Sunday) - only if within current month
    if (mondayStr.startsWith(monthStr)) {
      // Don't count holidays as qualifying events
      if (holidayMap.has(mondayStr)) {
        // Skip - holidays don't affect sandwich policy
      } else if (awiMap.has(mondayStr)) {
        qualifyingLeaves.push({ date: mondayStr, dow: monDow, type: 'AWI' });
      } else if (leaveMap.has(mondayStr)) {
        qualifyingLeaves.push({ date: mondayStr, dow: monDow, type: 'LEAVE' });
      } else if (completeAttMap.has(mondayStr)) {
        const attRec = completeAttMap.get(mondayStr);
        if (attRec.status === 'absent') {
          qualifyingLeaves.push({ date: mondayStr, dow: monDow, type: 'ABSENCE' });
        }
      } else if (!completeAttMap.has(mondayStr)) {
        qualifyingLeaves.push({ date: mondayStr, dow: monDow, type: 'NO_RECORD' });
      }
    }
  }

  // Sort qualifying leaves by date
  qualifyingLeaves.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Track Sundays affected by each qualifying leave
  const affectedSundays = new Map(); // Sunday date -> count of qualifying occurrences

  for (const leave of qualifyingLeaves) {
    const leaveDate = new Date(leave.date + "T00:00:00");
    const leaveDow = leaveDate.getDay();

    // If leave is on Saturday (day 6), check Sunday (day 0, which is leaveDate + 1)
    if (leaveDow === 6) {
      const sundayDate = new Date(leaveDate);
      sundayDate.setDate(sundayDate.getDate() + 1);
      const sundayStr = formatDateStr(sundayDate);
      if (sundayStr.startsWith(monthStr)) {
        affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
      }
    }
    // If leave is on Monday (day 1), check Sunday (day 0, which is leaveDate - 1)
    else if (leaveDow === 1) {
      const sundayDate = new Date(leaveDate);
      sundayDate.setDate(sundayDate.getDate() - 1);
      const sundayStr = formatDateStr(sundayDate);
      if (sundayStr.startsWith(monthStr)) {
        affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
      }
    }
  }

  // Mark Sundays as unpaid using allowance pool system (same as frontend)
  // - First Sunday with 1 qualifying event = Paid (allowance)
  // - Subsequent Sundays with 1 qualifying event = Unpaid (no allowance)
  // - Sundays with 2+ qualifying events = Unpaid
  let firstOneEventSundayPaid = false;
  
  // Sort Sundays by date to identify the first one
  const sortedSundays = Array.from(affectedSundays.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [sundayStr, count] of sortedSundays) {
    if (count >= 2) {
      // 2+ qualifying events = unpaid
      unpaidSundays.add(sundayStr);
    } else if (count === 1) {
      // 1 qualifying event
      if (!firstOneEventSundayPaid) {
        // First Sunday with 1 event = paid (allowance)
        firstOneEventSundayPaid = true;
      } else {
        // Subsequent Sundays with 1 event = unpaid (no allowance)
        unpaidSundays.add(sundayStr);
      }
    }
    // count === 0 = paid (no action needed)
  }

  console.log(`[Sandwich] Qualifying Leaves:`, qualifyingLeaves);
  console.log(`[Sandwich] Affected Sundays:`, Array.from(affectedSundays.entries()));
  console.log(`[Sandwich] Unpaid Sundays:`, Array.from(unpaidSundays));
  console.log(`[Sandwich] Total Sundays: ${sundayDates.length}`);
  console.log(`[Sandwich] AWI Map:`, Array.from(awiMap.entries()));
  console.log(`[Sandwich] Leave Map:`, Array.from(leaveMap.entries()));

  // Separate Sundays into paid vs unpaid
  const paidSundays = [];
  const unpaidSundaysArr = [];

  for (const ds of sundayDates) {
    if (unpaidSundays.has(ds)) {
      unpaidSundaysArr.push(ds);
    } else {
      paidSundays.push(ds);
    }
  }

  // Holidays are always paid
  const paidHolidays = [...holidayDates];
  const unpaidHolidays = [];

  console.log(`[Sandwich] Paid Sundays: ${paidSundays.length}, Unpaid Sundays: ${unpaidSundaysArr.length}`);

  return {
    paidSundays,
    unpaidSundays: unpaidSundaysArr,
    paidHolidays,
    unpaidHolidays,
    sandwichResults: [],
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

function tallyAttendance(workingDays, attMap, approvedLeaveSet, holidayMap = new Map()) {
  let fullDays           = 0;
  let halfDays           = 0;
  let absentDays         = 0;        // raw absent (no attendance record, no approved leave)
  let formalLeaveCount   = 0;        // approved leave_requests days that fall on working days
  let lateLogins         = 0;
  const lateDates        = [];
  const halfDayDates     = [];
  const absentDates      = [];

  for (const ds of workingDays) {
    const rec = attMap.get(ds);

    if (!rec) {
      // No check-in at all
      if (approvedLeaveSet.has(ds)) {
        formalLeaveCount++;   // will be reclassified as paid/unpaid in Step 4
      } else {
        absentDays++;         // same reclassification in Step 4
        absentDates.push(ds);
      }
      continue;
    }

    // Use late_minutes from database (same as attendance analysis API)
    if (rec.late_minutes && rec.late_minutes > 0) {
      lateLogins++;
      lateDates.push({ date: ds, minutes: rec.late_minutes });
    }

    const status = normalizeAttendanceStatus(rec, ds, new Set(holidayMap.keys()));
    if (status === "full_day" || status === "present") {
      fullDays++;
    } else if (status === "half_day") {
      halfDays++;
      halfDayDates.push(ds);
    } else if (status === "leave") {
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
    fullDays, halfDays, absentDays, formalLeaveCount,
    lateLogins, lateLoginHalfDays, lateDates, halfDayDates, absentDates,
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
function computePaidLeave(joiningDate, monthStart, absentDays, formalLeaveCount) {
  const daysCompleted   = daysBetween(joiningDate, monthStart);
  const eligible         = daysCompleted >= PAID_LEAVE_ELIGIBILITY_DAYS;
  const allowedPaidLeave = eligible ? PAID_LEAVE_PER_MONTH : 0;

  console.log(`[PaidLeave] Days completed: ${daysCompleted}, Eligible: ${eligible}, Allowed: ${allowedPaidLeave}`);
  console.log(`[PaidLeave] Absent days: ${absentDays}, Formal leaves: ${formalLeaveCount}`);

  // Total days the employee was NOT present on working days
  const totalAbsences = absentDays + formalLeaveCount;

  // Paid leave absorbs absences up to quota
  const paidLeaveUsed  = Math.min(allowedPaidLeave, totalAbsences);
  // Remaining absences beyond quota are unpaid
  const unpaidLeaveDays = Math.max(0, totalAbsences - paidLeaveUsed);

  console.log(`[PaidLeave] Total absences: ${totalAbsences}, Paid leave used: ${paidLeaveUsed}, Unpaid: ${unpaidLeaveDays}`);

  return {
    daysCompleted,
    eligible,
    allowedPaidLeave,
    paidLeaveUsed,
    unpaidLeaveDays,
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
    awiDeductionDays = 0,
    lateLoginCount = 0,
    incentives,
    manualDeductions,
    tax,
    unauthorizedDays = 0, // Total unauthorized days to subtract
    lateLoginDays = 0, // Total late login days to subtract
  } = params;

  const dailyRate = round2(monthlySalary / totalDaysInMonth);

  const earnedBasic = round2(dailyRate * Number(payableDays || 0));

  // NEW FORMULA: Final Payable Days = Total Payable Days - Total Unauthorized Days - Total Late Login Days
  const finalPayableDays = Math.max(0, 
    Number(payableDays || 0) - 
    Number(unauthorizedDays || 0) - 
    Number(lateLoginDays || 0)
  );
  
  // Net Pay = Final Payable Days × Daily Rate
  const netPay = round2(dailyRate * finalPayableDays);

  // AWI deduction calculation (for reference, but not subtracted from net pay)
  const awiDeduction = round2(dailyRate * Number(awiDeductionDays || 0));
  
  // Penalty deduction (from leave violations) (for reference)
  const penaltyDeduction = round2(dailyRate * Number(penaltyDays || 0));

  // Late login penalty calculation (₹100 per late login) (for reference)
  const lateLoginPenalty = round2(LATE_LOGIN_PENALTY_AMOUNT * Number(lateLoginCount || 0));

  const grossPay = round2(
    earnedBasic + Number(incentives || 0)
  );

  // Total deductions only include manual deductions and tax
  // AWI deductions and late login penalties are handled by reducing payable days, not by deducting from net pay
  const totalDeductions = round2(
    Number(manualDeductions || 0) +
    Number(tax || 0)
  );

  console.log(`[SALARY] Calculation:`, {
    dailyRate,
    payableDays,
    unauthorizedDays,
    lateLoginDays,
    finalPayableDays,
    netPay,
    incentives,
    manualDeductions,
    tax
  });

  return {
    dailyRate,
    payableDays,
    earnedBasic,
    absentDeduction: 0,
    penaltyDeduction,
    awiDeductionDays,
    awiDeduction,
    lateLoginCount,
    lateLoginPenalty,
    totalDeductions,
    grossPay,
    netPay,
  };
}

// ============================================================
// Fetch AWI Deductions for Payroll
// ============================================================
async function fetchAWIDeductions(pool, userId, year, month) {
  try {
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;
    
    // Count only unauthorized AWI cases (not authorized AWI)
    const result = await pool.query(
      `SELECT COUNT(*) as unauthorized_count
       FROM awi_cases
       WHERE user_id = $1
         AND TO_CHAR(date, 'YYYY-MM') = $2
         AND final_status = 'unauthorized_absence'`,
      [userId, monthStr]
    );
    
    return Number(result.rows[0].unauthorized_count || 0);
  } catch (error) {
    console.error('Error fetching AWI deductions:', error);
    return 0;
  }
}



// ============================================================
// MAIN: calculatePayroll
// ============================================================
async function calculatePayroll(pool, userId, year, month, overrides = {}) {
  const { incentives = 0, manualDeductions = 0, tax = 0 } = overrides;

  const data = await fetchPayrollData(pool, userId, year, month);
  const { employee, totalDaysInMonth, monthStart, effectiveStartDate } = data;

  const monthlySalary = finiteNumber(employee.monthly_salary, 0);
  if (monthlySalary <= 0) throw new Error("Employee has no salary configured");

  // Get Sunday dates from analysis
  const maps = buildCalendarMaps(data);
  const { sundayDates, holidayDates, workingDays, attMap, attMapWithContext, approvedLeaveSet, holidayMap, activeDates, awiMap, leaveMap } = maps;

  // Use sandwich calculation to classify Sundays (backend calculation)
  const sandwich = analyzeSandwich(
    sundayDates,
    holidayDates,
    attMapWithContext,
    holidayMap,
    employee.joining_date,
    year,
    month,
    awiMap,
    leaveMap
  );

  // Use the dynamic sandwich calculation from analyzeSandwich
  const finalSandwich = {
    paidSundays: sandwich.paidSundays,
    unpaidSundays: sandwich.unpaidSundays,
    paidHolidays: holidayDates,
    unpaidHolidays: [],
    sandwichResults: sandwich.sandwichResults || [],
  };

  console.log(`[PAYROLL] Using dynamic Sunday classification from analyzeSandwich`);
  console.log(`[PAYROLL] Paid Sundays:`, finalSandwich.paidSundays);
  console.log(`[PAYROLL] Unpaid Sundays:`, finalSandwich.unpaidSundays);

  const tally = tallyAttendance(workingDays, attMap, approvedLeaveSet, holidayMap);

  // ✅ Pass BOTH absentDays and formalLeaveCount to the fixed function
  const approvedLeaveSplit = computeApprovedLeaveSplit(data.leaves);
  const leaveCalc = computePaidLeave(
    employee.joining_date,
    monthStart,
    Number(tally.absentDays || 0),
    Number(tally.formalLeaveCount || 0)
  );
  leaveCalc.penaltyDays = approvedLeaveSplit.penaltyDays;
  leaveCalc.paidLeaveUsed = round2(leaveCalc.paidLeaveUsed);
  leaveCalc.unpaidLeaveDays = round2(leaveCalc.unpaidLeaveDays);
  leaveCalc.totalAbsences = round2(leaveCalc.totalAbsences);
  leaveCalc.totalAbsenceDays = leaveCalc.totalAbsences;

  console.log(`[Payroll] User: ${employee.full_name}, Month: ${year}-${month}`);
  console.log(`[Payroll] Tally - Full: ${tally.fullDays}, Half: ${tally.halfDays}, Absent: ${tally.absentDays}`);
  console.log(`[Payroll] Sandwich - Paid Sundays: ${finalSandwich.paidSundays.length}, Paid Holidays: ${finalSandwich.paidHolidays.length}`);
  console.log(`[Payroll] Leave - Paid Used: ${leaveCalc.paidLeaveUsed}, Unpaid: ${leaveCalc.unpaidLeaveDays}`);
  console.log(`[Payroll] Paid Sundays dates:`, finalSandwich.paidSundays);
  console.log(`[Payroll] Paid Holidays dates:`, finalSandwich.paidHolidays);

  // Fetch AWI deductions
  const awiDeductionDays = await fetchAWIDeductions(pool, userId, year, month);
  console.log(`[Payroll] AWI Deduction Days: ${awiDeductionDays}`);

  const payableDays = round2(
    // Present days
    Number(tally.fullDays || 0) +
    // Eligible absences covered by the monthly paid-leave quota
    Number(leaveCalc.paidLeaveUsed || 0) +
    // Paid Sundays (not affected by sandwich policy)
    Number(finalSandwich.paidSundays.length || 0) +
    // All holidays (holidays are no longer subject to sandwich policy)
    Number(holidayDates.length || 0) +
    // Half days count as 0.5 each
    Number(tally.halfDays || 0) * 0.5
  );

  console.log(`[Payroll] Calculated Payable Days: ${payableDays}`);

  const salary = computeSalary({
    monthlySalary,
    totalDaysInMonth,
    payableDays,
    penaltyDays: leaveCalc.penaltyDays || 0,
    awiDeductionDays,
    lateLoginCount: tally.lateLogins || 0,
    incentives,
    manualDeductions,
    tax,
    unauthorizedDays: awiDeductionDays, // Unauthorized AWI days reduce payable days
    lateLoginDays: tally.lateLogins || 0, // Late login days reduce payable days
  });

  console.log(`[Payroll] Salary Calculation - Monthly: ${monthlySalary}, Daily: ${salary.dailyRate}, Payable: ${payableDays}, Late Logins: ${tally.lateLogins}, Late Penalty: ${salary.lateLoginPenalty}, Net Pay: ${salary.netPay}`);


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
    sandwich: {
      paidSundays: finalSandwich.paidSundays,
      unpaidSundays: finalSandwich.unpaidSundays,
      paidHolidays: finalSandwich.paidHolidays,
      unpaidHolidays: finalSandwich.unpaidHolidays,
      sandwichResults: finalSandwich.sandwichResults,
    },
    attendance: {
      fullDays           : tally.fullDays,
      halfDays           : tally.halfDays,
      absentDays         : tally.absentDays,
      absentDates        : tally.absentDates,
      formalLeaveCount   : tally.formalLeaveCount,
      lateLogins         : tally.lateLogins,
      lateLoginHalfDays  : tally.lateLoginHalfDays,
      lateDates          : tally.lateDates,
      halfDayDates       : tally.halfDayDates,
    },
    leave: {
      daysCompleted: leaveCalc.daysCompleted,
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
  lateLoginCount: salary.lateLoginCount,
  lateLoginPenalty: salary.lateLoginPenalty,
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
  let query = `SELECT id FROM users WHERE role IN ('EMPLOYEE','MANAGER','OPERATIONAL_MANAGER','SUB_ADMIN','HR') AND salary > 0 AND (employment_status = 'ACTIVE' OR employment_status IS NULL)`;
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
    
    // Add late login penalty columns if they don't exist
    try {
      await client.query(`
        ALTER TABLE payslip_records 
        ADD COLUMN IF NOT EXISTS late_login_count INTEGER DEFAULT 0
      `);
      await client.query(`
        ALTER TABLE payslip_records 
        ADD COLUMN IF NOT EXISTS late_login_penalty DECIMAL(10,2) DEFAULT 0.00
      `);
    } catch (alterError) {
      // Ignore if columns already exist or other alter errors
      console.log('Late login penalty columns may already exist:', alterError.message);
    }
    
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
    Number(salary.netPay || 0) + effectiveIncentives - effectiveDeductions
  );

  console.log(`[PERSIST PAYSLIP] Effective values:`, {
    effectiveIncentives,
    effectiveDeductions,
    effectiveTax,
    effectiveNetPay,
    forceManualUpdate,
    manualOverrideApplied
  });

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
  lateLoginPenalty  : salary.lateLoginPenalty,
  monthsCompleted   : leave.monthsCompleted,
  eligible          : leave.eligible,
  allowedPaidLeave  : leave.allowedPaidLeave,
  paidLeaveUsed     : leave.paidLeaveUsed,           // ← was missing in some paths
  unpaidLeaveDays   : leave.unpaidLeaveDays,         // ← was missing in some paths
      totalAbsences     : leave.totalAbsences,
      totalAbsenceDays  : leave.totalAbsenceDays || leave.totalAbsences,
      dailyRate         : salary.dailyRate,
      awiDeductionDays  : salary.awiDeductionDays,
      awiDeduction     : salary.awiDeduction,

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


  // Debug: check actual database schema
  const schemaCheck = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'payslip_records'
     ORDER BY ordinal_position`
  );
  console.log(`[DEBUG] payslip_records schema:`, schemaCheck.rows.map(r => r.column_name));

const result = await client.query(
  `INSERT INTO payslip_records
     (user_id, month, basic_salary, earned_basic,
      incentives, deductions, tax, net_pay,
      working_days, present_days, payment_status, breakdown,
      unpaid_leave_days, leave_deduction, penalty_days, penalty_deduction,
      awi_deduction_days, awi_deduction, late_login_count, late_login_penalty,
      half_days, paid_sundays, unpaid_sundays, holidays,
      auth_awi, unauth_awi, full_days, absent_days, paid_leave, total_paid_days)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unpaid',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
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
     awi_deduction_days = EXCLUDED.awi_deduction_days,
     awi_deduction = EXCLUDED.awi_deduction,
     late_login_count = EXCLUDED.late_login_count,
     late_login_penalty = EXCLUDED.late_login_penalty,
     half_days = EXCLUDED.half_days,
     paid_sundays = EXCLUDED.paid_sundays,
     unpaid_sundays = EXCLUDED.unpaid_sundays,
     holidays = EXCLUDED.holidays,
     auth_awi = EXCLUDED.auth_awi,
     unauth_awi = EXCLUDED.unauth_awi,
     full_days = EXCLUDED.full_days,
     absent_days = EXCLUDED.absent_days,
     paid_leave = EXCLUDED.paid_leave,
     total_paid_days = EXCLUDED.total_paid_days,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`,
[
  employee.id,
  period.monthStart,
  salary.monthlyCTC,
  salary.netPay,
  effectiveIncentives,
  effectiveDeductions,
  effectiveTax,
  effectiveNetPay,
  calendar.workingDaysCount,
  round2(
    attendance.fullDays +
    attendance.halfDays * 0.5
  ),
  breakdown,
  round2(leave.unpaidLeaveDays),
  leaveDeduction,
  leave.penaltyDays || 0,
  penaltyDeduction,
  salary.awiDeductionDays || 0,
  salary.awiDeduction || 0,
  salary.lateLoginCount || 0,
  salary.lateLoginPenalty || 0,
  attendance.halfDays || 0,
  calc.sandwich?.paidSundays?.length || 0,
  calc.sandwich?.unpaidSundays?.length || 0,
  calendar.holidayCount || 0,
  attendance.authorizedAWI || 0, // auth_awi
  attendance.unauthorizedAWI || 0, // unauth_awi
  attendance.fullDays || 0,
  Math.max(0, attendance.absentDays - (leave.paidLeaveUsed || 0)),
  leave.paidLeaveUsed || 0,
  salary.payableDays || 0,
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

console.log("✅✅✅ payrollService.js LOADED - NEW VERSION WITH SANDWICH FIXES ✅✅✅");

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

