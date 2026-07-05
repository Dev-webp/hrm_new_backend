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

// ─── Constants ────────────────────────────────────────────────
const PAID_LEAVE_ELIGIBILITY_MONTHS = 3;
const PAID_LEAVE_PER_MONTH          = 1;
const OFFICE_START_MINUTES          = 10 * 60;
const LATE_LOGIN_START_MINUTES      = 10 * 60 + 15;
const HALF_DAY_LOGIN_START_MINUTES  = 10 * 60 + 30;
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

function normalizeAttendanceStatus(rec) {
  if (!rec?.check_in_time || !rec?.check_out_time) return "absent";

  const existingStatus = rec?.status || "absent";
  if (["leave", "holiday", "sunday"].includes(existingStatus)) return existingStatus;

  const grossHours = grossHoursFromRecord(rec);
  const checkInMinutes = timeToMinutes(rec.check_in_time);
  const checkOutMinutes = timeToMinutes(rec.check_out_time);
  const requiredLogoutMinutes =
    checkInMinutes === null
      ? 19 * 60
      : Math.max(checkInMinutes, OFFICE_START_MINUTES) + REQUIRED_FULL_DAY_MINUTES;

  if (grossHours < 4) return "absent";
  if (checkInMinutes !== null && checkInMinutes >= HALF_DAY_LOGIN_START_MINUTES) return "half_day";
  if (checkOutMinutes !== null && checkOutMinutes < requiredLogoutMinutes) return "half_day";
  if (grossHours >= 9 && checkOutMinutes !== null && checkOutMinutes >= requiredLogoutMinutes) return "full_day";
  if (grossHours >= 4) return "half_day";

  return "absent";
}

// ============================================================
// STEP 1: Fetch raw data
// ============================================================
async function fetchPayrollData(pool, userId, year, month) {
  const monthStr   = String(month).padStart(2, "0");
  const monthStart = `${year}-${monthStr}-01`;
  const total      = daysInMonth(year, month);
  const monthEnd   = `${year}-${monthStr}-${String(total).padStart(2, "0")}`;

  const [userRes, holidayRes, attRes, leaveRes] = await Promise.all([
    pool.query(
      `SELECT
         id, full_name, email, department, branch,
         salary               AS monthly_salary,
         employee_code,
         COALESCE(joining_date, DATE(created_at)) AS joining_date,
         role
       FROM users WHERE id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, name, type
       FROM company_holidays
       WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2
         AND (branch = 'all' OR branch IS NULL)
       ORDER BY date`,
      [year, month]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         status, late_minutes, check_in_time, check_out_time,
         production_hours, total_break_minutes, half_day_slot
       FROM attendance_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [userId, monthStart, monthEnd]
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
      [userId, monthStart, monthEnd]
    ),
  ]);

  if (!userRes.rows.length) throw new Error(`Employee ${userId} not found`);

  return {
    employee        : userRes.rows[0],
    holidays        : holidayRes.rows,
    attendance      : attRes.rows,
    leaves          : leaveRes.rows,
    year, month,
    monthStart, monthEnd,
    totalDaysInMonth: total,
  };
}

// ============================================================
// STEP 2: Build calendar maps
// ============================================================
function buildCalendarMaps(data) {
  const { holidays, attendance, leaves, year, month } = data;

  const holidayMap = new Map(holidays.map(h => [h.date, h]));
  const attMap     = new Map(attendance.map(a => [a.date, a]));

  const approvedLeaveSet = new Set();
  for (const leave of leaves) {
    const start = new Date(leave.from_date + "T00:00:00");
    const end   = new Date(leave.to_date   + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      approvedLeaveSet.add(d.toISOString().slice(0, 10));
    }
  }

  const allDates    = allDatesInMonth(year, month);
  const sundayDates  = [];
  const holidayDates = [];
  const workingDays  = [];

  for (const ds of allDates) {
    const dow = new Date(ds + "T00:00:00").getDay();
    if (dow === 0)               sundayDates.push(ds);
    else if (holidayMap.has(ds)) holidayDates.push(ds);
    else                         workingDays.push(ds);
  }

  return { holidayMap, attMap, approvedLeaveSet, allDates, sundayDates, holidayDates, workingDays };
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
    && checkInMinutes < HALF_DAY_LOGIN_START_MINUTES;
}

function tallyAttendance(workingDays, attMap, approvedLeaveSet) {
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

    if (isGraceLateLogin(rec)) {
      lateLogins++;
      lateDates.push({ date: ds, minutes: rec.late_minutes });
    }

    const status = normalizeAttendanceStatus(rec);
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
  const monthsCompleted  = monthsBetween(joiningDate, monthStart);
  const eligible         = monthsCompleted >= PAID_LEAVE_ELIGIBILITY_MONTHS;
  const allowedPaidLeave = eligible ? PAID_LEAVE_PER_MONTH : 0;





  // Total days the employee was NOT present on working days
  const totalAbsences = absentDays + formalLeaveCount;

  // Paid leave absorbs absences up to quota
  const paidLeaveUsed  = Math.min(allowedPaidLeave, totalAbsences);
  // Remaining absences beyond quota are unpaid
  const unpaidLeaveDays = Math.max(0, totalAbsences - paidLeaveUsed);

  return {
    monthsCompleted,
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
  const { incentives = 0, manualDeductions = 0, tax = 0 } = overrides;

  const data = await fetchPayrollData(pool, userId, year, month);
  const { employee, totalDaysInMonth, monthStart } = data;

  const monthlySalary = Number(employee.monthly_salary || 0);
  if (monthlySalary <= 0) throw new Error("Employee has no salary configured");

  const maps = buildCalendarMaps(data);
  const { sundayDates, holidayDates, workingDays, attMap, approvedLeaveSet } = maps;

  const tally = tallyAttendance(workingDays, attMap, approvedLeaveSet);

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

  const payableDays = round2(Math.max(
    0,
    Math.min(
      totalDaysInMonth,
      Number(totalDaysInMonth || 0) -
        Number(leaveCalc.unpaidLeaveDays || 0) -
        Number(tally.halfDays || 0) * 0.5
    )
  ));

  const salary = computeSalary({
    monthlySalary,
    totalDaysInMonth,
    payableDays,
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
      joining_date  : new Date(employee.joining_date).toISOString().slice(0, 10),
      monthly_salary: monthlySalary,
    },
    period: { year, month, monthStart },
    calendar: {
      totalDaysInMonth,
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
      lateLogins         : tally.lateLogins,
      lateLoginHalfDays  : tally.lateLoginHalfDays,
      lateDates          : tally.lateDates,
      halfDayDates       : tally.halfDayDates,
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
  let query = `SELECT id FROM users WHERE role IN ('EMPLOYEE','MANAGER','OPERATIONAL_MANAGER','SUB_ADMIN') AND salary > 0`;
  const params = [];
  let idx = 1;
  if (branch && branch !== "all")         { query += ` AND branch     = $${idx}`; params.push(branch);     idx++; }
  if (department && department !== "all") { query += ` AND department = $${idx}`; params.push(department); idx++; }
  query += " ORDER BY id";

  const employees = await pool.query(query, params);
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
  const { employee, period, attendance, leave, salary, calendar } = calc;

  const existingRes = await pool.query(
    `SELECT incentives, deductions, tax, net_pay
     FROM payslip_records
     WHERE user_id = $1 AND month = $2`,
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
    existingPayslip && !manualOverrideApplied
      ? Number(existingPayslip.net_pay || 0)
      : Number(salary.earnedSalary || 0) + effectiveIncentives - effectiveDeductions
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


const result = await pool.query(
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

return result.rows[0];
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

