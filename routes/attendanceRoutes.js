// ═══════════════════════════════════════════════════════════════════
// VJC OVERSEAS — attendanceRoutes.js (REWRITTEN)
// Integrates attendancePolicy.js for all classification logic.
// All existing routes preserved. New policy-based routes added.
// DO NOT touch auth, payroll, leads, or chat routes.
// ═══════════════════════════════════════════════════════════════════

import express from "express";
import { pool } from "../middleware/db.js";
import {
  verifyToken,
  authorizeRoles,
  canEditAttendance,
  isBranchRestrictedOperationalRole,
} from "../middleware/auth.js";
import { invalidateCache } from "./analysisRoutes.js";
import {
  notifyCheckin,
  notifyCheckout,
  notifyLateLogin,
} from "./notificationTriggers.js";
import { createNotification } from "./notificationRoutes.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";
import { formatTime12Hour } from "../utils/timeFormat.js";
import {
  getComputedAttendanceStatus,
  withComputedAttendanceStatus,
} from "../utils/computedAttendanceStatus.js";
import { adjustLeaveBalanceForAttendanceStatusChange } from "../utils/leavePolicy.js";

// ── Policy engine (pure functions, no DB calls) ──────────────────
import {
  calculateNetWorkMillis,
  calculateBreakMillis,
  evaluateLateLogin,
  buildMonthlyLateStats,
  classifyDayPolicy,
  classifySunday,
  calculateMonthlySummary,
  formatDateStr,
  parseDateStr,
  calculateLateMinutes,
  timeToSeconds,
  OFFICE_START,
} from "../utils/attendancePolicy.js";

const router = express.Router();
const OFFICE_END_TIME = "19:00:00";
const MAX_ATTENDANCE_RANGE_DAYS = Number(process.env.MAX_ATTENDANCE_RANGE_DAYS || 62);

function validateAttendanceRange(start, end, label = "date range") {
  if (!start || !end) return null;
  const startDate = parseDateStr(start);
  const endDate = parseDateStr(end);
  if (!startDate || !endDate || endDate < startDate) {
    return `${label} is invalid`;
  }
  const days = Math.floor((endDate - startDate) / 86400000) + 1;
  if (days > MAX_ATTENDANCE_RANGE_DAYS) {
    return `${label} cannot exceed ${MAX_ATTENDANCE_RANGE_DAYS} days`;
  }
  return null;
}

function timeToSqlMinutesExpr(startColumn = "start_time", endColumn = "end_time") {
  return `GREATEST(EXTRACT(EPOCH FROM (($endColumn$)::time - ($startColumn$)::time)) / 60, 0)::int`
    .replace("$endColumn$", endColumn)
    .replace("$startColumn$", startColumn);
}

async function setNamedBreakTime({ userId, dateStr, breakType, action, timeStr }) {
  const existingResult = await pool.query(
    `SELECT start_time, end_time
     FROM employee_breaks
     WHERE user_id = $1 AND date = $2::date AND break_type = $3`,
    [userId, dateStr, breakType]
  );
  const existing = existingResult.rows[0] || {};

  if (action === "start") {
    if (existing.start_time && !existing.end_time) {
      const err = new Error(`${breakType} is already active`);
      err.statusCode = 409;
      throw err;
    }
    if (existing.start_time && existing.end_time) {
      const err = new Error(`${breakType} is already completed`);
      err.statusCode = 409;
      throw err;
    }
    await pool.query(
      `INSERT INTO employee_breaks (user_id, date, break_type, start_time)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, date, break_type) DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = NULL,
         duration_minutes = NULL`,
      [userId, dateStr, breakType, timeStr]
    );
    return;
  }

  if (!existing.start_time) {
    const err = new Error(`${breakType} cannot end before it starts`);
    err.statusCode = 400;
    throw err;
  }
  if (existing.end_time) {
    const err = new Error(`${breakType} is already ended`);
    err.statusCode = 409;
    throw err;
  }

  await pool.query(
    `UPDATE employee_breaks
     SET end_time = $1,
         duration_minutes = ${timeToSqlMinutesExpr("start_time", "$1")},
         updated_at = NOW()
     WHERE user_id = $2 AND date = $3::date AND break_type = $4`,
    [timeStr, userId, dateStr, breakType]
  );
}

// ═══════════════════════════════════════════════════════════════════
// MATERIALIZED VIEW REFRESH (throttled)
// ═══════════════════════════════════════════════════════════════════
let refreshTimer = null;
function scheduleViewRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      await pool.query(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_attendance`
      );
      console.log("✅ mv_monthly_attendance refreshed");
    } catch (e) {
      console.warn("View refresh failed:", e.message);
    }
  }, 30000);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Parse "HH:MM:SS" → minutes (kept for legacy routes that use it) */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(":").map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

/** Fetch holiday Set for a given year */
async function fetchHolidaySet(year) {
  const res = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date FROM company_holidays
     WHERE EXTRACT(YEAR FROM date) = $1`,
    [year]
  );
  return new Set(res.rows.map((r) => r.date));
}

async function fetchHolidaySetForDateRange(startDate, endDate) {
  const res = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1::date AND $2::date`,
    [startDate, endDate]
  );
  return new Set(res.rows.map((r) => r.date));
}

/**
 * Fetch attendance logs for a user spanning multiple months,
 * returned as a { "YYYY-MM-DD": logRow } map.
 * logRow fields use the NEW column names (office_in, office_out, …).
 * We alias the old check_in_time / check_out_time columns.
 */
async function fetchLogsByDate(userId, startDate, endDate) {
  const res = await pool.query(
    `SELECT
       TO_CHAR(a.date,'YYYY-MM-DD')  AS date,
       a.check_in_time               AS office_in,
       a.check_out_time              AS office_out,
       b1s.start_time                AS break_in,
       b1s.end_time                  AS break_out,
       b2s.start_time                AS break_in_2,
       b2s.end_time                  AS break_out_2,
       ls.start_time                 AS lunch_in,
       ls.end_time                   AS lunch_out,
       b3s.start_time                AS break3_in,
       b3s.end_time                  AS break3_out,
       b3s.duration_minutes          AS break3_duration_minutes,
       b3s.break3_sessions           AS break3_sessions,
       a.total_break_minutes,
       a.extra_break_ins,
       a.extra_break_outs,
       a.leave_type,
       a.leave_status,
       a.paid_leave_reason,
       a.post_login_idle_minutes,
       a.misuse_of_time
     FROM attendance_records a
     LEFT JOIN employee_breaks b1s 
       ON b1s.user_id = a.user_id
      AND b1s.date = a.date 
      AND b1s.break_type = 'break1'
     LEFT JOIN employee_breaks b2s 
       ON b2s.user_id = a.user_id
      AND b2s.date = a.date 
      AND b2s.break_type = 'break2'
      LEFT JOIN employee_breaks ls  
        ON ls.user_id = a.user_id
       AND ls.date = a.date 
       AND ls.break_type = 'lunch'
      LEFT JOIN employee_breaks b3s
        ON b3s.user_id = a.user_id
       AND b3s.date = a.date
       AND b3s.break_type = 'break3'
      WHERE a.user_id = $1
        AND a.date BETWEEN $2::date AND $3::date`,
    [userId, startDate, endDate]
  );

  const map = {};
  for (const row of res.rows) {
    map[row.date] = row;
  }
  return map;
}

/**
 * Build the "extended" logsByDate that spans M-1 … M+1 (for Sunday logic).
 */
async function fetchExtendedLogsByDate(userId, year, month) {
  const prev = new Date(year, month - 2, 1);
  const next = new Date(year, month, 1);
  const startDate = formatDateStr(new Date(prev.getFullYear(), prev.getMonth(), 1));
  const endDate   = formatDateStr(new Date(next.getFullYear(), next.getMonth() + 1, 0));
  return fetchLogsByDate(userId, startDate, endDate);
}

/** Days in a month */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizedAttendanceStatusSql(alias = "a") {
  return `COALESCE(${alias}.status, 'absent')`;
}

const policyBucketStatusMap = {
  full_day: "full_day",
  half_day: "half_day",
  leave: "leave",
  holiday: "holiday",
  absent: "absent",
};

const policyBucketDisplayStatusMap = {
  full_day: "Present",
  half_day: "Half Day",
  leave: "Leave",
  holiday: "Holiday",
  absent: "Absent",
};

function mapPolicyBucketToStatus(bucket) {
  return policyBucketStatusMap[bucket] || "absent";
}

function mapPolicyBucketToDisplayStatus(bucket) {
  return policyBucketDisplayStatusMap[bucket] || "Absent";
}

function todayLocalDateStr() {
  return formatDateStr(new Date());
}

function nowTimeString() {
  return new Date().toTimeString().slice(0, 8);
}

function hasOfficeEndPassed() {
  const nowSec = timeToSeconds(nowTimeString());
  const officeEndSec = timeToSeconds(OFFICE_END_TIME);
  return nowSec !== null && officeEndSec !== null && nowSec >= officeEndSec;
}

function isBeforeOfficeEndForDate(dateStr) {
  const today = todayLocalDateStr();
  if (dateStr < today) return false;
  if (dateStr > today) return true;
  return !hasOfficeEndPassed();
}

function isPastAttendanceDate(dateStr) {
  return Boolean(dateStr) && dateStr < todayLocalDateStr();
}

function isSundayDate(dateStr) {
  if (!dateStr) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).getDay() === 0;
}

function getDisplayAttendanceStatus(record = {}, dateStr = null) {
  return getComputedAttendanceStatus(record, { dateStr }).computed_status;
}

function withDisplayAttendanceStatus(row = {}, dateStr = null, context = {}) {
  return withComputedAttendanceStatus(row, { ...context, dateStr });
}

function buildLiveLog(log) {
  if (!log?.office_in || log?.office_out) return log;
  return {
    ...log,
    office_out: nowTimeString(),
  };
}

function buildOfficeEndCutoffLog(log) {
  if (!log?.office_in || log?.office_out) return log;
  return {
    ...log,
    office_out: OFFICE_END_TIME,
  };
}

function isAttendanceInProgress(dateStr, log) {
  return false;
}

function isAttendanceMissingCheckout(dateStr, log) {
  return false;
}

function shouldUseOfficeEndCutoff(dateStr, log) {
  return false;
}

function shouldLogPolicyDebug(dateStr, fullName) {
  if (dateStr !== "2026-06-23") return false;
  return [
    "hyderabad manager",
    "arjun mehta",
    "ramesh kumar",
    "priyanka vaddi",
  ].includes(String(fullName || "").toLowerCase());
}

function getStoredBreakMillis(log) {
  const storedMinutes = Number(log?.total_break_minutes);
  return Number.isFinite(storedMinutes) && storedMinutes > 0
    ? storedMinutes * 60_000
    : null;
}

function calculateGrossMillisFromLog(log) {
  const inSec = timeToSeconds(log?.office_in);
  const outSec = timeToSeconds(log?.office_out);
  const officeStartSec = timeToSeconds(OFFICE_START);
  if (inSec === null || outSec === null || officeStartSec === null) return 0;
  return Math.max(0, (outSec - Math.max(inSec, officeStartSec)) * 1000);
}

function buildLateLoginPolicyMeta(log, monthlyLateStats = {}, dateStr) {
  const lateInfo = evaluateLateLogin(log);
  const count = Number(monthlyLateStats.late_login_count ?? monthlyLateStats.permitted_late_count ?? 0);
  let status = "No Login";

  if (log?.office_in) {
    if (lateInfo.is_late_window) status = "Late";
    else if (lateInfo.is_beyond_grace) status = "Half Day";
    else status = "On Time";
  }

  return {
    late_login_count: count,
    late_login_limit: null,
    late_login_count_label: String(count),
    late_login_status: status,
    remaining_grace_late_logins: null,
    late_login_limit_exceeded: false,
  };
}

async function classifyAttendanceForResponse(user, dateStr, att, holidaySet) {
  const [year, month] = dateStr.split("-").map(Number);
  const dim = daysInMonth(year, month);
  const logsByDateExtended = await fetchExtendedLogsByDate(user.user_id, year, month);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(dim).padStart(2, "0")}`;
  const logsByDate = {};

  for (const [day, log] of Object.entries(logsByDateExtended)) {
    if (day >= monthStart && day <= monthEnd) logsByDate[day] = log;
  }

  const monthlyLateStats = buildMonthlyLateStats(logsByDate, dim, year, month);
  const rawLog = logsByDateExtended[dateStr] || null;
  const inProgress = isAttendanceInProgress(dateStr, rawLog);
  const useOfficeEndCutoff = shouldUseOfficeEndCutoff(dateStr, rawLog);
  const log = useOfficeEndCutoff ? buildOfficeEndCutoffLog(rawLog) : rawLog;
  if (log) {
    logsByDateExtended[dateStr] = log;
    if (dateStr >= monthStart && dateStr <= monthEnd) logsByDate[dateStr] = log;
  }
  const displayLog = inProgress ? buildLiveLog(log) : log;
  const liveNetMs = inProgress ? calculateNetWorkMillis(displayLog) : null;
  const liveBreakMs = inProgress ? calculateBreakMillis(displayLog) : null;
  const lateLoginMeta = buildLateLoginPolicyMeta(log, monthlyLateStats, dateStr);

  if (inProgress) {
    const computed = getComputedAttendanceStatus(
      { ...(att || {}), ...log, date: dateStr, check_out_time: null },
      { dateStr, holidaySet, monthlyLateStats, logsByDate: logsByDateExtended }
    );
    return {
      ...user,
      ...(att || {}),
      status: computed.computed_status,
      computed_status: computed.computed_status,
      display_status: computed.display_status,
      policy_status: computed.policy_status,
      policy_bucket: computed.policy_status,
      policy_reason: computed.policy_reason,
      policy_flags: computed.policy_flags,
      half_day_slot: att?.half_day_slot || null,
      production_hours: Number(((liveNetMs || 0) / 3_600_000).toFixed(2)),
      total_break_minutes: Math.round((liveBreakMs || 0) / 60000),
      late_minutes: att?.late_minutes ?? calculateLateMinutes(log?.office_in),
      check_in_time: att?.check_in_time ?? log?.office_in ?? null,
      check_out_time: null,
      is_in_progress: true,
      ...lateLoginMeta,
    };
  }

  if (isAttendanceMissingCheckout(dateStr, log)) {
    const computed = getComputedAttendanceStatus(
      { ...(att || {}), ...log, date: dateStr, check_out_time: null },
      { dateStr, holidaySet, monthlyLateStats, logsByDate: logsByDateExtended }
    );
    return {
      ...user,
      ...(att || {}),
      status: computed.computed_status,
      computed_status: computed.computed_status,
      display_status: computed.display_status,
      policy_status: computed.policy_status,
      policy_bucket: computed.policy_status,
      policy_reason: computed.policy_reason,
      policy_flags: computed.policy_flags,
      half_day_slot: att?.half_day_slot || null,
      production_hours: Number(att?.production_hours || 0),
      total_break_minutes: Number(att?.total_break_minutes || 0),
      late_minutes: att?.late_minutes ?? calculateLateMinutes(log?.office_in),
      check_in_time: att?.check_in_time ?? log?.office_in ?? null,
      check_out_time: null,
      is_in_progress: false,
      is_missing_checkout: true,
      ...lateLoginMeta,
    };
  }

  const policy = classifyDayPolicy({
    dateStr,
    log,
    holidaySet,
    monthlyLateStats,
    logsByDate: logsByDateExtended,
  });
  const status = mapPolicyBucketToStatus(policy.bucket);
  const displayStatus = mapPolicyBucketToDisplayStatus(policy.bucket);

  if (shouldLogPolicyDebug(dateStr, user.full_name)) {
    console.log(
      user.full_name,
      log?.office_in || null,
      log?.office_out || null,
      Number(policy.net_hours || 0).toFixed(2),
      policy.half_day_slot || null,
      policy.bucket,
      policy.reason
    );
  }

  return {
    ...user,
    ...(att || {}),
    status,
    computed_status: status,
    display_status: displayStatus,
    policy_status: policy.bucket,
    policy_bucket: policy.bucket,
    policy_reason: policy.reason,
    policy_flags: policy.flags || [],
    half_day_slot: policy.half_day_slot || att?.half_day_slot || null,
    half_day_effective_minutes: policy.half_day_effective_minutes ?? null,
    half_day_slot_checked: policy.half_day_slot_checked ?? null,
    half_day_invalid_reason: policy.half_day_invalid_reason ?? null,
    production_hours: Number(policy.net_hours ?? att?.production_hours ?? 0),
    total_break_minutes: Number(policy.total_break_minutes ?? att?.total_break_minutes ?? 0),
    late_minutes: att?.late_minutes ?? calculateLateMinutes(log?.office_in),
    check_in_time: att?.check_in_time ?? rawLog?.office_in ?? null,
    check_out_time: att?.check_out_time ?? rawLog?.office_out ?? null,
    ...lateLoginMeta,
  };
}

async function finalizeForgottenCheckoutsBeforeToday() {
  const today = todayLocalDateStr();
  const result = await pool.query(
    `UPDATE attendance_records
     SET status = 'absent',
         production_hours = 0,
         half_day_slot = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE date < $1::date
       AND check_in_time IS NOT NULL
       AND check_out_time IS NULL
       AND COALESCE(status, '') NOT IN (
         'leave', 'paid_leave', 'unpaid_leave', 'holiday', 'absent'
       )`,
    [today]
  );
  if (result.rowCount > 0) {
    invalidateCache("summary");
    scheduleViewRefresh();
  }
}

function logAttendanceRecalculation(event = {}) {
  console.info("[AttendanceRecalc]", {
    user_id: event.userId,
    date: event.dateStr,
    source: event.source || "recalculate",
    previous_status: event.previousStatus || null,
    new_status: event.newStatus || null,
    production_hours: Number(event.productionHours || 0),
    overtime_hours: event.overtimeHours ?? null,
    late_minutes: Number(event.lateMinutes || 0),
    attendance_rule_applied: event.ruleApplied || null,
    policy_flags: event.policyFlags || [],
    recalculated_at: new Date().toISOString(),
  });
}

/**
 * Re-classify and persist a single day using the policy engine.
 * Called after check-in, check-out, or break edits.
 */
async function recalcAttendanceForUserDate(userId, dateStr, options = {}) {
  const {
    source = "recalculate",
    logResult = false,
    forceManualOverride = false,
  } = options;
  const [year, month] = dateStr.split("-").map(Number);
  const dim = daysInMonth(year, month);

  const previousRecord = await pool.query(
    `SELECT id, status, production_hours, late_minutes, check_in_time, check_out_time
     FROM attendance_records
     WHERE user_id = $1 AND date = $2::date`,
    [userId, dateStr]
  );
  const previousAttendanceId = previousRecord.rows[0]?.id || null;
  const previousStatus = previousRecord.rows[0]?.status || null;
  if (!forceManualOverride && previousAttendanceId) {
    const manualRes = await pool.query(
      `SELECT id, edited_by_email
       FROM attendance_history
       WHERE original_attendance_id = $1
          OR (date = $2::date AND employee_email = (SELECT email FROM users WHERE id = $3))
       ORDER BY id DESC
       LIMIT 1`,
      [previousAttendanceId, dateStr, userId]
    );
    if (manualRes.rows.length) {
      console.info(
        `[attendance-policy] Skipped auto recalc for user ${userId} on ${dateStr}: manual override by ${manualRes.rows[0].edited_by_email || "unknown"}`
      );
      return { skipped: true, reason: "manual_override" };
    }
  }
  await pool.query(
    `UPDATE employee_breaks
     SET duration_minutes = ${timeToSqlMinutesExpr("start_time", "end_time")},
         updated_at = NOW()
     WHERE user_id = $1
       AND date = $2::date
       AND duration_minutes IS NULL
       AND start_time IS NOT NULL
       AND end_time IS NOT NULL`,
    [userId, dateStr]
  );

  const breakTotalResult = await pool.query(
    `SELECT COALESCE(SUM(
       COALESCE(duration_minutes, ${timeToSqlMinutesExpr("start_time", "end_time")}, 0)
     ), 0)::int AS total_break_minutes
     FROM employee_breaks
     WHERE user_id = $1 AND date = $2::date`,
    [userId, dateStr]
  );
  const latestBreakMinutes = Number(breakTotalResult.rows[0]?.total_break_minutes || 0);

  // Fetch extended logs (M-1 to M+1) for Sunday logic
  const logsByDateExtended = await fetchExtendedLogsByDate(userId, year, month);

  // Current-month slice for late stats
  const monthStart = `${year}-${String(month).padStart(2,"0")}-01`;
  const monthEnd   = `${year}-${String(month).padStart(2,"0")}-${String(dim).padStart(2,"0")}`;
  const logsByDate = {};
  for (const [d, v] of Object.entries(logsByDateExtended)) {
    if (d >= monthStart && d <= monthEnd) logsByDate[d] = v;
  }

  const monthlyLateStats = buildMonthlyLateStats(logsByDate, dim, year, month);
  const holidaySet = await fetchHolidaySet(year);

  const rawLog = logsByDateExtended[dateStr] || null;
  const log = shouldUseOfficeEndCutoff(dateStr, rawLog)
    ? buildOfficeEndCutoffLog(rawLog)
    : rawLog;
  if (log) {
    log.total_break_minutes = latestBreakMinutes;
    logsByDateExtended[dateStr] = log;
    if (dateStr >= monthStart && dateStr <= monthEnd) logsByDate[dateStr] = log;
  }

  if (log?.office_in && !log?.office_out) {
    const statusResult = await pool.query(
      `SELECT status
       FROM attendance_records
       WHERE user_id = $1 AND date = $2::date`,
      [userId, dateStr]
    );
    const currentStatus = String(statusResult.rows[0]?.status || "").toLowerCase();

    if (
      isPastAttendanceDate(dateStr) &&
      !["leave", "paid_leave", "unpaid_leave", "holiday"].includes(currentStatus)
    ) {
      await pool.query(
        `UPDATE attendance_records
         SET status = 'absent',
             late_minutes = $1,
             production_hours = 0,
             half_day_slot = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND date = $3`,
        [calculateLateMinutes(log.office_in), userId, dateStr]
      );
      return;
    }

    const openStatus = ["leave", "paid_leave", "unpaid_leave", "holiday"].includes(currentStatus)
      ? currentStatus
      : "absent";

    await pool.query(
      `UPDATE attendance_records
       SET status = $1,
           late_minutes = $2,
           production_hours = 0,
           total_break_minutes = $3,
           half_day_slot = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $4 AND date = $5`,
      [
        openStatus,
        calculateLateMinutes(log.office_in),
        latestBreakMinutes,
        userId,
        dateStr,
      ]
    );
    return;
  }

  const result = classifyDayPolicy({
    dateStr,
    log,
    holidaySet,
    monthlyLateStats,
    logsByDate: logsByDateExtended,
  });

  const storedBreakMs = getStoredBreakMillis(log);
  const calculatedBreakMs = log ? calculateBreakMillis(log) : 0;
  const breakMs = storedBreakMs ?? calculatedBreakMs;
  const productionHours = Number(result.net_hours || 0);
  const totalBreakMinutes = Math.round(breakMs / 60000);
  const lateMinutes = calculateLateMinutes(log?.office_in);

  // Map policy buckets → legacy status values used by other routes
  const statusMap = {
    full_day: "full_day",
    half_day: "half_day",
    leave: "leave",
    holiday: "holiday",
    absent: "absent",
  };
  const legacyStatus = statusMap[result.bucket] || "absent";
  const halfDaySlot = result.half_day_slot || null;

  await pool.query(
    `UPDATE attendance_records
     SET status=$1,
         late_minutes=$2,
         production_hours=$3,
         total_break_minutes=$4,
         half_day_slot=$5,
         updated_at=CURRENT_TIMESTAMP
     WHERE user_id=$6 AND date=$7`,
    [
      legacyStatus,
      lateMinutes,
      parseFloat(productionHours.toFixed(2)),
      totalBreakMinutes,
      halfDaySlot,
      userId,
      dateStr,
    ]
  );

  if (logResult) {
    logAttendanceRecalculation({
      userId,
      dateStr,
      source,
      previousStatus,
      newStatus: legacyStatus,
      productionHours: parseFloat(productionHours.toFixed(2)),
      lateMinutes,
      ruleApplied: result.reason,
      policyFlags: result.flags,
    });
  }
}

async function recalcAttendanceForUserDateIfFinal(userId, dateStr) {
  const existing = await pool.query(
    `SELECT check_in_time, check_out_time
     FROM attendance_records
     WHERE user_id=$1 AND date=$2`,
    [userId, dateStr]
  );
  const row = existing.rows[0];
  if (
    row?.check_in_time &&
    (row?.check_out_time ||
      shouldUseOfficeEndCutoff(dateStr, {
        office_in: row.check_in_time,
        office_out: row.check_out_time,
      }))
  ) {
    await recalcAttendanceForUserDate(userId, dateStr);
  }
}

export {
  finalizeForgottenCheckoutsBeforeToday,
  getDisplayAttendanceStatus,
  mapPolicyBucketToDisplayStatus,
  mapPolicyBucketToStatus,
  recalcAttendanceForUserDate,
};

async function recalcAttendanceForUserMonth(userId, year, month, options = {}) {
  const dim = daysInMonth(year, month);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(dim).padStart(2, "0")}`;
  const records = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
     FROM attendance_records
     WHERE user_id=$1 AND date BETWEEN $2::date AND $3::date
     ORDER BY date ASC`,
    [userId, monthStart, monthEnd]
  );

  for (const row of records.rows) {
    await recalcAttendanceForUserDate(userId, row.date, options);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 10 — API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// GET /api/my-attendance?month=YYYY-MM
// Returns current + next month logs (for cross-month Sunday edge cases).
// ───────────────────────────────────────────────────────────────────
let lastForgottenCheckoutMiddlewareRun = 0;
let forgottenCheckoutMiddlewareRunning = false;
const FORGOTTEN_CHECKOUT_MIDDLEWARE_INTERVAL_MS = Number(
  process.env.FORGOTTEN_CHECKOUT_MIDDLEWARE_INTERVAL_MS || 5 * 60 * 1000
);

router.use(async (_req, _res, next) => {
  const now = Date.now();
  if (
    forgottenCheckoutMiddlewareRunning ||
    now - lastForgottenCheckoutMiddlewareRun < FORGOTTEN_CHECKOUT_MIDDLEWARE_INTERVAL_MS
  ) {
    return next();
  }

  forgottenCheckoutMiddlewareRunning = true;
  try {
    await finalizeForgottenCheckoutsBeforeToday();
    lastForgottenCheckoutMiddlewareRun = Date.now();
    next();
  } catch (err) {
    next(err);
  } finally {
    forgottenCheckoutMiddlewareRunning = false;
  }
});

router.get("/my-attendance", verifyToken, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ message: "month must be YYYY-MM" });
    }

    const [year, mon] = month.split("-").map(Number);

    // Current month
    const curStart = `${year}-${String(mon).padStart(2,"0")}-01`;
    const curEnd   = `${year}-${String(mon).padStart(2,"0")}-${String(daysInMonth(year, mon)).padStart(2,"0")}`;

    // Next month (for Sunday edge cases)
    const nextMon   = mon === 12 ? 1 : mon + 1;
    const nextYear  = mon === 12 ? year + 1 : year;
    const nextStart = `${nextYear}-${String(nextMon).padStart(2,"0")}-01`;
    const nextEnd   = `${nextYear}-${String(nextMon).padStart(2,"0")}-${String(daysInMonth(nextYear, nextMon)).padStart(2,"0")}`;

    const logs = await fetchLogsByDate(req.user.id, curStart, nextEnd);
    const holidaySet = await fetchHolidaySetForDateRange(curStart, nextEnd);

    // Normalize to array sorted by date
    const rows = Object.values(logs)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => withDisplayAttendanceStatus(row, row.date, { holidaySet, logsByDate: logs }));

    res.json(rows);
  } catch (err) {
    console.error("GET /my-attendance error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// GET /api/all-attendance?month=YYYY-MM
// Chairman / Manager: dict keyed by email.
// ───────────────────────────────────────────────────────────────────
router.get(
  "/all-attendance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { month } = req.query;
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "month must be YYYY-MM" });
      }

      const [year, mon] = month.split("-").map(Number);
      const startDate = `${year}-${String(mon).padStart(2,"0")}-01`;
      const endDate   = `${year}-${String(mon).padStart(2,"0")}-${String(daysInMonth(year, mon)).padStart(2,"0")}`;

      // Branch restriction for managers
      let userQuery = `
        SELECT id, full_name, email, role, department, branch, salary
        FROM users
        WHERE role != 'SUPER_ADMIN'
          AND COALESCE(status, 'active') = 'active'`;
      const userParams = [];
      if (req.user.role === "MANAGER") {
        userQuery += ` AND branch = $1`;
        userParams.push(req.user.branch);
      }

      const usersRes = await pool.query(userQuery, userParams);
      const holidaySet = await fetchHolidaySet(year);

      const result = {};

      for (const user of usersRes.rows) {
        const logs = await fetchLogsByDate(user.id, startDate, endDate);
        result[user.email] = {
          name:       user.full_name,
          role:       user.role,
          location:   user.branch,
          salary:     parseFloat(user.salary) || 0,
          attendance: Object.values(logs).sort((a, b) => a.date.localeCompare(b.date)),
        };
      }

      res.json(result);
    } catch (err) {
      console.error("GET /all-attendance error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ───────────────────────────────────────────────────────────────────
// POST /api/get-attendance-summary  { email, month }
// Returns the monthly summary from Section 9.
// ───────────────────────────────────────────────────────────────────
router.post(
  "/get-attendance-summary",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { email, month } = req.body;
      if (!email || !month) {
        return res.status(400).json({ message: "email and month required" });
      }
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "month must be YYYY-MM" });
      }

      const userRes = await pool.query(
        `SELECT id FROM users WHERE email = $1`,
        [email]
      );
      if (!userRes.rows.length) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = userRes.rows[0].id;
      const [year, mon] = month.split("-").map(Number);
      const dim = daysInMonth(year, mon);

      const monthStart = `${year}-${String(mon).padStart(2,"0")}-01`;
      const monthEnd   = `${year}-${String(mon).padStart(2,"0")}-${String(dim).padStart(2,"0")}`;

      const logsByDateExtended = await fetchExtendedLogsByDate(userId, year, mon);
      const logsByDate = {};
      for (const [d, v] of Object.entries(logsByDateExtended)) {
        if (d >= monthStart && d <= monthEnd) logsByDate[d] = v;
      }

      const holidaySet = await fetchHolidaySet(year);

      const summary = calculateMonthlySummary(
        logsByDate, year, mon, holidaySet, logsByDateExtended
      );

      // Compute sundays, workDays, totalDays
      let sundays = 0, workDays = 0, totalDays = dim;
      for (let d = 1; d <= dim; d++) {
        const ds = `${year}-${String(mon).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const date = parseDateStr(ds);
        if (date.getDay() === 0) { sundays++; continue; }
        if (holidaySet.has(ds)) continue;
        workDays++;
      }

      res.json({ ...summary, sundays, workDays, totalDays });
    } catch (err) {
      console.error("POST /get-attendance-summary error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ───────────────────────────────────────────────────────────────────
// GET /api/holidays?month=YYYY-MM  (or ?year=YYYY for full year)
//
// FIX: Return `type` column directly (was returning is_paid boolean).
// Frontend reads h.type to distinguish "holiday" vs "halfday".
// ───────────────────────────────────────────────────────────────────
router.get("/holidays", verifyToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    let rows;

    if (year && /^\d{4}$/.test(year)) {
      // Full year
      const r = await pool.query(
        `SELECT
           TO_CHAR(date, 'YYYY-MM-DD') AS date,
           name,
           COALESCE(type, 'holiday')   AS type
         FROM company_holidays
         WHERE EXTRACT(YEAR FROM date) = $1
         ORDER BY date`,
        [parseInt(year)]
      );
      rows = r.rows;
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-");
      const r = await pool.query(
        `SELECT
           TO_CHAR(date, 'YYYY-MM-DD') AS date,
           name,
           COALESCE(type, 'holiday')   AS type
         FROM company_holidays
         WHERE EXTRACT(YEAR FROM date)  = $1
           AND EXTRACT(MONTH FROM date) = $2
         ORDER BY date`,
        [parseInt(y), parseInt(m)]
      );
      rows = r.rows;
    } else {
      return res.status(400).json({ message: "Provide month=YYYY-MM or year=YYYY" });
    }

    res.json(rows);
  } catch (err) {
    console.error("GET /holidays error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// POST /api/holidays  { date, name, type }
// Add a holiday or half-day.
// ───────────────────────────────────────────────────────────────────
router.post(
  "/holidays",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { date, name, type } = req.body;

      if (!date || !name) {
        return res.status(400).json({ message: "date and name are required" });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date must be YYYY-MM-DD" });
      }

      const validType = type === "halfday" ? "halfday" : "holiday";

      const result = await pool.query(
        `INSERT INTO company_holidays (date, name, type)
         VALUES ($1::date, $2, $3)
         ON CONFLICT (date) DO UPDATE
           SET name = EXCLUDED.name,
               type = EXCLUDED.type
         RETURNING
           TO_CHAR(date, 'YYYY-MM-DD') AS date,
           name,
           COALESCE(type, 'holiday') AS type`,
        [date, name.trim(), validType]
      );

      scheduleViewRefresh();
      res.json(result.rows[0]);
    } catch (err) {
      console.error("POST /holidays error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ───────────────────────────────────────────────────────────────────
// POST /api/attendance  { action }
// Records check-in/out/breaks with current timestamp.
// Supports: office_in, office_out, break_in, break_out, break_in_2,
//           break_out_2, lunch_in, lunch_out, extra_break_in, extra_break_out
// ───────────────────────────────────────────────────────────────────
router.post("/attendance", verifyToken, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ message: "action required" });

    const userId    = req.user.id;
    const now       = new Date();
    const today     = todayLocalDateStr(now);
    const timeStr   = now.toTimeString().slice(0, 8);   // "HH:MM:SS"

    const userRes = await pool.query(
      `SELECT branch, department, full_name FROM users WHERE id = $1`,
      [userId]
    );
    if (!userRes.rows.length) return res.status(404).json({ message: "User not found" });
    const { branch, department, full_name } = userRes.rows[0];

    // Ensure attendance record exists for today
    await pool.query(
      `INSERT INTO attendance_records
         (user_id, date, status, branch, department, extra_break_ins, extra_break_outs)
       VALUES ($1,$2,'absent',$3,$4,'[]','[]')
       ON CONFLICT (user_id, date) DO NOTHING`,
      [userId, today, branch, department]
    );

    switch (action) {
      // ── Office in/out ────────────────────────────────────────
      case "office_in": {
        const lateMinutes = calculateLateMinutes(timeStr);
        const updateResult = await pool.query(
          `UPDATE attendance_records
           SET check_in_time=$1,
               check_out_time=NULL,
               status='present',
               late_minutes=$4,
               production_hours=0,
               total_break_minutes=0,
               half_day_slot=NULL,
               updated_at=CURRENT_TIMESTAMP
           WHERE user_id=$2 AND date=$3 AND check_in_time IS NULL
           RETURNING id`,
          [timeStr, userId, today, lateMinutes]
        );
        if (!updateResult.rowCount) {
          return res.status(409).json({ message: "Already checked in today" });
        }

                // Notifications
        const attId = updateResult.rows[0]?.id;
        notifyCheckin({ id: userId, full_name, branch, department }, timeStr, lateMinutes, attId)
          .catch((err) => console.error("Check-in notification error:", err));
        if (lateMinutes > 0) {
          notifyLateLogin({ id: userId, full_name, branch, department }, lateMinutes, attId)
            .catch((err) => console.error("Late-login notification error:", err));
        }

        // 🔄 SYNC — mark this employee online for invoice round-robin
        fetch("https://invoice.vjcoverseas.com/api/departments/staff/online", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: req.user.email }),
        }).catch((err) => console.error("Invoice online-status sync error (non-fatal):", err.message));
        break;
      }

      case "office_out": {
        const updateResult = await pool.query(
          `UPDATE attendance_records
           SET check_out_time=$1, updated_at=CURRENT_TIMESTAMP
           WHERE user_id=$2 AND date=$3
             AND check_in_time IS NOT NULL
             AND check_out_time IS NULL
           RETURNING id`,
          [timeStr, userId, today]
        );
        if (!updateResult.rowCount) {
          const existing = await pool.query(
            `SELECT check_in_time, check_out_time FROM attendance_records WHERE user_id=$1 AND date=$2`,
            [userId, today]
          );
          if (existing.rows[0]?.check_out_time) {
            return res.status(409).json({ message: "Already checked out" });
          }
          return res.status(400).json({ message: "Check in first" });
        }
        await recalcAttendanceForUserDate(userId, today, {
          source: "attendance_action_checkout",
          logResult: true,
        });

                const attRow = await pool.query(
          `SELECT id, production_hours FROM attendance_records WHERE user_id=$1 AND date=$2`,
          [userId, today]
        );
        notifyCheckout(
          { id: userId, full_name, branch, department },
          timeStr,
          attRow.rows[0]?.production_hours || 0,
          attRow.rows[0]?.id
        ).catch((err) => console.error("Checkout notification error:", err));

        // 🔄 SYNC — mark this employee offline for invoice round-robin
        fetch("https://invoice.vjcoverseas.com/api/departments/staff/offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: req.user.email }),
        }).catch((err) => console.error("Invoice online-status sync error (non-fatal):", err.message));
        break;
      }

      // ── Named breaks via employee_breaks table ───────────────
      case "break_in":
      case "break_out": {
        await setNamedBreakTime({ userId, dateStr: today, breakType: "break1", action: action === "break_in" ? "start" : "end", timeStr });
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      case "break_in_2":
      case "break_out_2": {
        await setNamedBreakTime({ userId, dateStr: today, breakType: "break2", action: action === "break_in_2" ? "start" : "end", timeStr });
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      case "lunch_in":
      case "lunch_out": {
        await setNamedBreakTime({ userId, dateStr: today, breakType: "lunch", action: action === "lunch_in" ? "start" : "end", timeStr });
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      // ── Extra breaks (append to JSONB arrays) ────────────────
      case "extra_break_in": {
        await pool.query(
          `UPDATE attendance_records
           SET extra_break_ins = COALESCE(extra_break_ins,'[]'::jsonb) || $1::jsonb
           WHERE user_id=$2 AND date=$3`,
          [JSON.stringify([timeStr]), userId, today]
        );
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      case "extra_break_out": {
        await pool.query(
          `UPDATE attendance_records
           SET extra_break_outs = COALESCE(extra_break_outs,'[]'::jsonb) || $1::jsonb
           WHERE user_id=$2 AND date=$3`,
          [JSON.stringify([timeStr]), userId, today]
        );
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      default:
        return res.status(400).json({ message: `Unknown action: ${action}` });
    }

    invalidateCache("summary");
    invalidateCache(`individual|${userId}|${today.slice(0, 7)}`);
    scheduleViewRefresh();

    res.json({ message: `${action} recorded`, timestamp: timeStr });
  } catch (err) {
    console.error("POST /attendance error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// GET /api/attendance-history/:email?month=YYYY-MM
// Returns edit history grouped by date.
// ───────────────────────────────────────────────────────────────────
router.get(
  "/attendance-history/:email",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { email } = req.params;
      const { month } = req.query;

      let query = `
        SELECT
          TO_CHAR(date,'YYYY-MM-DD') AS date,
          office_in, office_out,
          break_in, break_out, break_in_2, break_out_2,
          lunch_in, lunch_out,
          extra_break_ins, extra_break_outs,
          leave_type, leave_status,
          edited_by_email, edited_at
        FROM attendance_history
        WHERE employee_email = $1`;
      const params = [email];

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, m] = month.split("-");
        query += ` AND EXTRACT(YEAR FROM date) = $2 AND EXTRACT(MONTH FROM date) = $3`;
        params.push(parseInt(y), parseInt(m));
      }

      query += ` ORDER BY date DESC, edited_at DESC`;

      const res2 = await pool.query(query, params);

      // Group by date
      const grouped = {};
      for (const row of res2.rows) {
        if (!grouped[row.date]) grouped[row.date] = [];
        grouped[row.date].push(row);
      }

      res.json(grouped);
    } catch (err) {
      console.error("GET /attendance-history error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ───────────────────────────────────────────────────────────────────
// POST /api/save-attendance-summary  { month, summary }
// Saves computed summary for payroll use.
// ───────────────────────────────────────────────────────────────────
router.post(
  "/save-attendance-summary",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { month, summary } = req.body;
      if (!month || !summary) {
        return res.status(400).json({ message: "month and summary required" });
      }

      await pool.query(
        `INSERT INTO attendance_summaries (month, summary_json, saved_by, saved_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (month) DO UPDATE SET
           summary_json=EXCLUDED.summary_json,
           saved_by=EXCLUDED.saved_by,
           saved_at=NOW()`,
        [month, JSON.stringify(summary), req.user.email]
      );

      res.json({ message: `Summary saved for ${month}` });
    } catch (err) {
      console.error("POST /save-attendance-summary error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// LEGACY ROUTES (preserved for compatibility with existing frontend)
// ═══════════════════════════════════════════════════════════════════

// GET /api/attendance?date=YYYY-MM-DD
router.get("/attendance", verifyToken, async (req, res) => {
  try {
    const { date, department, search, branch } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });

    let effectiveBranch = null;
    if (isBranchRestrictedOperationalRole(req.user)) {
      effectiveBranch = req.user.branch;
    } else if (branch && branch !== "all") {
      effectiveBranch = branch;
    }

    let userQuery = `SELECT u.id AS user_id, u.full_name, u.department, u.branch
                     FROM users u
                     WHERE u.role NOT IN ('SUPER_ADMIN')
                       AND COALESCE(u.status, 'active') = 'active'`;
    let params = []; let idx = 1;
    if (effectiveBranch) { userQuery += ` AND u.branch=$${idx}`; params.push(effectiveBranch); idx++; }
    if (department && department !== "all") { userQuery += ` AND u.department=$${idx}`; params.push(department); idx++; }
    if (search) { userQuery += ` AND (u.full_name ILIKE $${idx} OR u.department ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const usersResult = await pool.query(userQuery, params);
    if (!usersResult.rows.length) return res.json([]);

    const attResult = await pool.query(
      `SELECT
          ar.user_id,
          ar.check_in_time,
          ar.check_out_time,
          ${normalizedAttendanceStatusSql("ar")} AS status,
          ar.late_minutes,
          ar.production_hours,
          ar.half_day_slot,
          ar.leave_type,
          ar.leave_status,
          ar.post_login_idle_minutes,
          ar.misuse_of_time,
          b1.start_time AS break1_in,
          b1.end_time AS break1_out,
          b2.start_time AS break2_in,
           b2.end_time AS break2_out,
           ln.start_time AS lunch_in,
           ln.end_time AS lunch_out,
           b3.start_time AS break3_in,
           b3.end_time AS break3_out,
           b3.duration_minutes AS break3_duration_minutes,
           b3.break3_sessions AS break3_sessions,
           COALESCE((
            SELECT SUM(COALESCE(
              b.duration_minutes,
              GREATEST(EXTRACT(EPOCH FROM (b.end_time::time - b.start_time::time)) / 60, 0)::int,
              0
            ))
            FROM employee_breaks b
            WHERE b.user_id = ar.user_id
              AND b.date = $1::date
          ), ar.total_break_minutes, 0) AS total_break_minutes
       FROM attendance_records ar
       LEFT JOIN employee_breaks b1
         ON b1.user_id = ar.user_id
        AND b1.date = ar.date
        AND b1.break_type = 'break1'
       LEFT JOIN employee_breaks b2
         ON b2.user_id = ar.user_id
        AND b2.date = ar.date
        AND b2.break_type = 'break2'
       LEFT JOIN employee_breaks ln
         ON ln.user_id = ar.user_id
        AND ln.date = ar.date
        AND ln.break_type = 'lunch'
       LEFT JOIN employee_breaks b3
         ON b3.user_id = ar.user_id
        AND b3.date = ar.date
        AND b3.break_type = 'break3'
       WHERE ar.date = $1::date`,
      [date]
    );
    const attMap = new Map(attResult.rows.map((r) => [r.user_id, r]));
    const [year] = date.split("-").map(Number);
    const holidaySet = await fetchHolidaySet(year);

    const rows = [];
    for (const user of usersResult.rows) {
      const att = attMap.get(user.user_id);
      rows.push(await classifyAttendanceForResponse(user, date, att, holidaySet));
    }

    res.json(rows);
  } catch (err) {
    console.error("GET /attendance error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/stats?date=YYYY-MM-DD
router.get("/attendance/stats", verifyToken, async (req, res) => {
  try {
    const { date, branch } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });
    const effectiveBranch = isBranchRestrictedOperationalRole(req.user) ? req.user.branch
      : branch && branch !== "all" ? branch : null;

    const [y, m, d] = date.split("-").map(Number);
    const isSunday  = new Date(y, m - 1, d).getDay() === 0;
    const holidaySet = await fetchHolidaySet(y);
    const isHoliday  = !isSunday && holidaySet.has(date);

    let userQuery = `SELECT id AS user_id, full_name, department, branch
                     FROM users
                     WHERE role NOT IN ('SUPER_ADMIN')
                       AND COALESCE(status, 'active') = 'active'`;
    const userParams = [];
    if (effectiveBranch) {
      userQuery += " AND branch=$1";
      userParams.push(effectiveBranch);
    }
    const usersResult = await pool.query(userQuery, userParams);
    const totalEmployees = usersResult.rows.length;

    const attResult = await pool.query(
      `SELECT
          ar.user_id,
          ar.check_in_time,
          ar.check_out_time,
          ${normalizedAttendanceStatusSql("ar")} AS status,
          ar.late_minutes,
          ar.production_hours,
          ar.half_day_slot,
          ar.leave_type,
          ar.leave_status,
          ar.post_login_idle_minutes,
          ar.misuse_of_time,
          COALESCE((
            SELECT SUM(COALESCE(
              b.duration_minutes,
              GREATEST(EXTRACT(EPOCH FROM (b.end_time::time - b.start_time::time)) / 60, 0)::int,
              0
            ))
            FROM employee_breaks b
            WHERE b.user_id = ar.user_id
              AND b.date = $1::date
          ), ar.total_break_minutes, 0) AS total_break_minutes
       FROM attendance_records ar
       WHERE ar.date = $1::date`,
      [date]
    );
    const attMap = new Map(attResult.rows.map((r) => [r.user_id, r]));
    let present = 0;
    let absent = 0;
    let leave = 0;
    let lateCount = 0;

    for (const user of usersResult.rows) {
      const row = await classifyAttendanceForResponse(
        user,
        date,
        attMap.get(user.user_id),
        holidaySet
      );
      if (["full_day", "in_progress", "working"].includes(row.status)) {
        present += 1;
      } else if (row.status === "half_day") {
        present += 0.5;
      } else if (row.status === "leave") {
        leave += 1;
      } else if (row.status === "absent") {
        absent += 1;
      }
      if (row.late_login_status === "Late") lateCount += 1;
    }

    const attendanceDenominator = present + absent;
    const attendanceRate = attendanceDenominator > 0
      ? Math.round((present / attendanceDenominator) * 100) : 0;

    res.json({
      attendanceRate: isSunday || isHoliday ? 100 : attendanceRate,
      dailyPresent: present,
      dailyAbsent: absent,
      dailyLeave: leave,
      totalActive:  totalEmployees,
      lateToday:    lateCount,
      isSunday,
      isHoliday,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/attendance/checkin  (legacy endpoint used by some frontend pages)
router.post("/attendance/checkin", verifyToken, async (req, res) => {
  try {
    const userId  = req.user.id;
    const now     = new Date();
    const today   = todayLocalDateStr(now);
    const timeStr = now.toTimeString().slice(0, 8);

    const userRes = await pool.query(
      `SELECT branch, department, full_name FROM users WHERE id=$1`, [userId]
    );
    if (!userRes.rows.length) return res.status(404).json({ message: "User not found" });
    const { branch, department, full_name } = userRes.rows[0];

    const lateMinutes = calculateLateMinutes(timeStr);

    const insertResult = await pool.query(
      `INSERT INTO attendance_records
         (user_id, date, check_in_time, status, branch, department,
          late_minutes, production_hours, total_break_minutes,
          extra_break_ins, extra_break_outs)
       VALUES ($1,$2,$3,'present',$4,$5,$6,0,0,'[]','[]')
       ON CONFLICT (user_id, date) DO UPDATE SET
         check_in_time=EXCLUDED.check_in_time,
         check_out_time=NULL,
         status='present',
         late_minutes=EXCLUDED.late_minutes,
         production_hours=0,
         total_break_minutes=0,
         half_day_slot=NULL,
         updated_at=CURRENT_TIMESTAMP
       WHERE attendance_records.check_in_time IS NULL
       RETURNING id`,
      [userId, today, timeStr, branch, department, lateMinutes]
    );
    if (!insertResult.rowCount) {
      return res.status(409).json({ message: "Already checked in today" });
    }

    const attId = insertResult.rows[0]?.id;
    notifyCheckin({ id: userId, full_name, branch, department }, timeStr, lateMinutes, attId)
      .catch((err) => console.error("Legacy check-in notification error:", err));
    if (lateMinutes > 0) {
      notifyLateLogin({ id: userId, full_name, branch, department }, lateMinutes, attId)
        .catch((err) => console.error("Legacy late-login notification error:", err));
    }

    invalidateCache("summary");
    invalidateCache(`individual|${userId}|${today.slice(0,7)}`);
    scheduleViewRefresh();

    const record = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id=$1 AND date=$2`, [userId, today]
    );
    res.json({
      message: "Checked in",
      record: withDisplayAttendanceStatus(record.rows[0], today),
    });
  } catch (err) {
    console.error("/attendance/checkin error:", err);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/attendance/checkout  (legacy)
router.post("/attendance/checkout", verifyToken, async (req, res) => {
  try {
    const userId  = req.user.id;
    const now     = new Date();
    const today   = todayLocalDateStr(now);
    const timeStr = now.toTimeString().slice(0, 8);

    const updateResult = await pool.query(
      `UPDATE attendance_records
       SET check_out_time=$1, updated_at=CURRENT_TIMESTAMP
       WHERE user_id=$2 AND date=$3
         AND check_in_time IS NOT NULL
         AND check_out_time IS NULL
       RETURNING id`,
      [timeStr, userId, today]
    );
    if (!updateResult.rowCount) {
      const existing = await pool.query(
        `SELECT check_in_time, check_out_time FROM attendance_records WHERE user_id=$1 AND date=$2`,
        [userId, today]
      );
      if (existing.rows[0]?.check_out_time) {
        return res.status(409).json({ message: "Already checked out" });
      }
      return res.status(400).json({ message: "Check in first" });
    }

    await recalcAttendanceForUserDate(userId, today, {
      source: "legacy_attendance_checkout",
      logResult: true,
    });

    const record = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id=$1 AND date=$2`, [userId, today]
    );
    const userFull = await pool.query(
      `SELECT id, full_name, branch, department FROM users WHERE id=$1`, [userId]
    );
    if (userFull.rows[0]) {
      await notifyCheckout(
        userFull.rows[0], timeStr,
        record.rows[0]?.production_hours || 0,
        record.rows[0]?.id
      );
    }

    invalidateCache("summary");
    invalidateCache(`individual|${userId}|${today.slice(0,7)}`);
    scheduleViewRefresh();

    const holidaySet = await fetchHolidaySetForDateRange(today, today);
    res.json({
      message: "Checked out",
      record: withDisplayAttendanceStatus(record.rows[0], today, { holidaySet }),
    });
  } catch (err) {
    console.error("/attendance/checkout error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/self/today
router.get("/attendance/self/today", verifyToken, async (req, res) => {
  try {
    const today = todayLocalDateStr();
    const userResult = await pool.query(
      `SELECT id AS user_id, full_name, department, branch
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });

    const result = await pool.query(
      `SELECT ar.id, ar.user_id, TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
              ar.check_in_time, ar.check_out_time, ${normalizedAttendanceStatusSql("ar")} AS status,
              ar.late_minutes, ar.production_hours, ar.total_break_minutes,
              ar.half_day_slot, ar.leave_type, ar.leave_status,
              ar.post_login_idle_minutes, ar.misuse_of_time
       FROM attendance_records ar WHERE ar.user_id=$1 AND ar.date=$2`,
      [req.user.id, today]
    );

    if (!result.rows.length) return res.json(null);

    const [year] = today.split("-").map(Number);
    const holidaySet = await fetchHolidaySet(year);
    const row = await classifyAttendanceForResponse(
      userResult.rows[0],
      today,
      result.rows[0],
      holidaySet
    );

    res.json(row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

// GET /api/attendance/self/history?start=&end=
router.get("/attendance/self/history", verifyToken, async (req, res) => {
  try {
    const { start, end } = req.query;
    const rangeError = validateAttendanceRange(start, end, "Attendance history range");
    if (rangeError) return res.status(400).json({ message: rangeError });
    if (!start || !end) return res.status(400).json({ message: "start and end required" });
    const result = await pool.query(
      `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
              ar.check_in_time, ar.check_out_time, ${normalizedAttendanceStatusSql("ar")} AS status,
              ar.late_minutes, ar.production_hours, ar.total_break_minutes,
              ar.half_day_slot, ar.leave_type, ar.leave_status,
              ar.post_login_idle_minutes, ar.misuse_of_time
       FROM attendance_records ar
       WHERE ar.user_id=$1 AND ar.date BETWEEN $2 AND $3
       ORDER BY ar.date ASC`,
      [req.user.id, start, end]
    );
    const holidaySet = await fetchHolidaySetForDateRange(start, end);
    const logsByDate = Object.fromEntries(result.rows.map((row) => [row.date, row]));
    res.json(result.rows.map((row) => withDisplayAttendanceStatus(row, row.date, { holidaySet, logsByDate })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ======================================================
// GET /api/attendance/range?start=YYYY-MM-DD&end=YYYY-MM-DD
// ======================================================

router.get("/attendance/range", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;

    const rangeError = validateAttendanceRange(
      start,
      end,
      "Attendance range"
    );

    if (rangeError) {
      return res.status(400).json({
        message: rangeError,
      });
    }

    if (!start || !end) {
      return res.status(400).json({
        message: "start and end required",
      });
    }


    // ==================================================
    // BRANCH SECURITY
    // ==================================================

    const effectiveBranch =
      isBranchRestrictedOperationalRole(req.user)
        ? req.user.branch
        : branch && branch !== "all"
        ? branch
        : null;


    // ==================================================
    // FETCH EVERY DATE + EVERY ACTIVE EMPLOYEE
    //
    // IMPORTANT:
    // Approved leave_requests are now merged here.
    // ==================================================

    let query = `
      SELECT
        TO_CHAR(d.day::date, 'YYYY-MM-DD') AS date,

        u.id AS user_id,

        u.full_name,
        u.department,
        u.branch,


        -- =============================================
        -- ATTENDANCE DATA
        -- =============================================

        a.check_in_time,

        a.check_out_time,

        a.status AS attendance_status,

        a.late_minutes,

        COALESCE(a.production_hours, 0) AS production_hours,

        COALESCE(a.total_break_minutes, 0)
          AS total_break_minutes,

        a.half_day_slot,

        a.post_login_idle_minutes,

        a.misuse_of_time,


        -- =============================================
        -- APPROVED LEAVE DATA
        -- =============================================

        lr.id AS leave_request_id,

        lr.leave_type AS requested_leave_type,

        lr.status AS leave_request_status,

        lr.paid_days,

        lr.unpaid_days,

        lr.leave_duration_type,

        lr.half_day_session,


        -- =============================================
        -- FINAL STATUS
        --
        -- APPROVED LEAVE HAS PRIORITY
        -- =============================================

        CASE

          WHEN lr.id IS NOT NULL
            AND LOWER(COALESCE(lr.status, '')) = 'approved'

          THEN

            CASE

              WHEN LOWER(
                REPLACE(
                  REPLACE(
                    COALESCE(lr.leave_type, ''),
                    ' ',
                    '_'
                  ),
                  '-',
                  '_'
                )
              ) IN (
                'paid_leave',
                'paidleave',
                'pl'
              )

              THEN 'paid_leave'


              WHEN LOWER(
                REPLACE(
                  REPLACE(
                    COALESCE(lr.leave_type, ''),
                    ' ',
                    '_'
                  ),
                  '-',
                  '_'
                )
              ) IN (
                'unpaid_leave',
                'unpaidleave',
                'loss_of_pay',
                'lop'
              )

              THEN 'unpaid_leave'


              ELSE 'leave'

            END


          WHEN a.status IS NOT NULL

          THEN a.status


          ELSE NULL

        END AS status,


        -- =============================================
        -- FINAL LEAVE TYPE
        -- =============================================

        CASE

          WHEN lr.id IS NOT NULL
            AND LOWER(COALESCE(lr.status, '')) = 'approved'

          THEN

            CASE

              WHEN LOWER(
                REPLACE(
                  REPLACE(
                    COALESCE(lr.leave_type, ''),
                    ' ',
                    '_'
                  ),
                  '-',
                  '_'
                )
              ) IN (
                'paid_leave',
                'paidleave',
                'pl'
              )

              THEN 'paid_leave'


              WHEN LOWER(
                REPLACE(
                  REPLACE(
                    COALESCE(lr.leave_type, ''),
                    ' ',
                    '_'
                  ),
                  '-',
                  '_'
                )
              ) IN (
                'unpaid_leave',
                'unpaidleave',
                'loss_of_pay',
                'lop'
              )

              THEN 'unpaid_leave'


              ELSE 'leave'

            END


          ELSE a.leave_type

        END AS leave_type,


        -- =============================================
        -- FINAL LEAVE STATUS
        -- =============================================

        CASE

          WHEN lr.id IS NOT NULL
            AND LOWER(COALESCE(lr.status, '')) = 'approved'

          THEN 'approved'

          ELSE a.leave_status

        END AS leave_status


      FROM generate_series(
        $1::date,
        $2::date,
        interval '1 day'
      ) d(day)


      CROSS JOIN users u


      -- =============================================
      -- ATTENDANCE RECORD
      -- =============================================

      LEFT JOIN attendance_records a

        ON a.user_id = u.id

        AND a.date = d.day::date


      -- =============================================
      -- APPROVED LEAVE REQUEST
      --
      -- The generated calendar date must fall between
      -- from_date and to_date.
      -- =============================================

      LEFT JOIN leave_requests lr

        ON lr.user_id = u.id

        AND LOWER(COALESCE(lr.status, '')) = 'approved'

        AND d.day::date
          BETWEEN lr.from_date
          AND lr.to_date


      WHERE

        u.role != 'SUPER_ADMIN'

        AND COALESCE(
          u.status,
          'active'
        ) = 'active'
    `;


    // ==================================================
    // PARAMETERS
    // ==================================================

    const params = [
      start,
      end,
    ];

    let idx = 3;


    // ==================================================
    // BRANCH FILTER
    // ==================================================

    if (effectiveBranch) {

      query += `
        AND u.branch = $${idx}
      `;

      params.push(effectiveBranch);

      idx++;

    }


    query += `
      ORDER BY
        d.day ASC,
        u.id ASC
    `;


    // ==================================================
    // EXECUTE QUERY
    // ==================================================

    const result = await pool.query(
      query,
      params
    );


    // ==================================================
    // HOLIDAYS
    // ==================================================

    const holidaySet =
      await fetchHolidaySetForDateRange(
        start,
        end
      );


    // ==================================================
    // CREATE LOOKUP MAP
    // ==================================================

    const logsByDate =
      Object.fromEntries(

        result.rows.map((row) => [

          `${row.user_id}|${row.date}`,

          {
            ...row,

            date: row.date,
          },

        ])

      );


    // ==================================================
    // FINAL RESPONSE
    // ==================================================

 // ==================================================
// FINAL RESPONSE
// ==================================================

const response = result.rows.map((row) => {
  const dateStr = String(row.date).slice(0, 10);

  const normalizedStatus = String(row.status || "")
    .trim()
    .toLowerCase();

  const normalizedLeaveType = String(
    row.leave_type || row.requested_leave_type || ""
  )
    .trim()
    .toLowerCase();

  const normalizedLeaveStatus = String(
    row.leave_status || row.leave_request_status || ""
  )
    .trim()
    .toLowerCase();

  const isApprovedLeave =
    normalizedLeaveStatus === "approved";

  const isPaidLeave =
    isApprovedLeave &&
    (
      normalizedStatus === "paid_leave" ||
      normalizedLeaveType === "paid_leave" ||
      Number(row.paid_days || 0) > 0
    );

  const isUnpaidLeave =
    isApprovedLeave &&
    (
      normalizedStatus === "unpaid_leave" ||
      normalizedLeaveType === "unpaid_leave" ||
      Number(row.unpaid_days || 0) > 0
    );

  // ==============================================
  // IMPORTANT:
  // APPROVED LEAVE MUST NOT BE OVERRIDDEN
  // BY withDisplayAttendanceStatus()
  // ==============================================

  if (isPaidLeave) {
    return {
      ...row,

      date: dateStr,

      status: "paid_leave",

      raw_status: row.attendance_status || row.status,

      leave_type: "paid_leave",
      leaveType: "paid_leave",

      leave_status: "approved",
      leaveStatus: "approved",

      is_paid_leave: true,
      isPaidLeave: true,

      paid_days: Number(row.paid_days || 1),
      paidDays: Number(row.paid_days || 1),

      unpaid_days: Number(row.unpaid_days || 0),
      unpaidDays: Number(row.unpaid_days || 0),
    };
  }

  if (isUnpaidLeave) {
    return {
      ...row,

      date: dateStr,

      status: "unpaid_leave",

      raw_status: row.attendance_status || row.status,

      leave_type: "unpaid_leave",
      leaveType: "unpaid_leave",

      leave_status: "approved",
      leaveStatus: "approved",

      is_paid_leave: false,
      isPaidLeave: false,

      paid_days: Number(row.paid_days || 0),
      paidDays: Number(row.paid_days || 0),

      unpaid_days: Number(row.unpaid_days || 1),
      unpaidDays: Number(row.unpaid_days || 1),
    };
  }

  // ==============================================
  // NORMAL ATTENDANCE CALCULATION
  // ==============================================

  const record = {
    ...row,

    date: dateStr,

    paid_days: Number(row.paid_days || 0),
    paidDays: Number(row.paid_days || 0),

    unpaid_days: Number(row.unpaid_days || 0),
    unpaidDays: Number(row.unpaid_days || 0),

    is_paid_leave: false,
    isPaidLeave: false,
  };

  return withDisplayAttendanceStatus(
    record,
    dateStr,
    {
      holidaySet,
      logsByDate,
    }
  );
});

res.json(response);

  } catch (err) {

    console.error(
      "GET /attendance/range error:",
      err
    );


    res.status(500).json({
      message: err.message,
    });

  }
});

// GET /api/attendance/range/summary?start=&end=&branch=

router.get("/attendance/range/summary", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;
    const rangeError = validateAttendanceRange(start, end, "Attendance summary range");
    if (rangeError) return res.status(400).json({ message: rangeError });

    if (!start || !end) {
      return res.status(400).json({ message: "start and end required" });
    }

    const effectiveBranch = isBranchRestrictedOperationalRole(req.user)
      ? req.user.branch
      : branch && branch !== "all"
      ? branch
      : null;

    const params = [start, end];
    let branchCondition = "";
    let idx = 3;

    if (effectiveBranch) {
      branchCondition = `AND u.branch = $${idx}`;
      params.push(effectiveBranch);
      idx += 1;
    }

    const query = `
      SELECT
        TO_CHAR(d.day::date, 'YYYY-MM-DD') AS date,
        u.id AS user_id,
        a.check_in_time,
        a.check_out_time,
        ${normalizedAttendanceStatusSql("a")} AS status,
        a.late_minutes,
        a.production_hours,
        a.total_break_minutes,
        a.half_day_slot,
        COALESCE(a.leave_type, l.leave_type) AS leave_type,
        COALESCE(a.leave_status, CASE WHEN l.id IS NOT NULL THEN 'approved' END) AS leave_status,
        a.post_login_idle_minutes,
        a.misuse_of_time

      FROM generate_series($1::date, $2::date, interval '1 day') d(day)

      CROSS JOIN users u

      LEFT JOIN attendance_records a
        ON a.user_id = u.id
       AND a.date = d.day::date

      LEFT JOIN leave_requests l
        ON l.user_id = u.id
       AND LOWER(l.status) = 'approved'
       AND d.day::date BETWEEN l.from_date AND l.to_date

      WHERE u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') = 'active'
      ${branchCondition}

      ORDER BY d.day::date ASC, u.id ASC
    `;

    const result = await pool.query(query, params);
    const holidaySet = await fetchHolidaySetForDateRange(start, end);
    const summary = new Map();

    for (const row of result.rows) {
      if (!summary.has(row.date)) {
        summary.set(row.date, {
          date: row.date,
          present: 0,
          halfDay: 0,
          absent: 0,
          leave: 0,
          late: 0,
          total: 0,
        });
      }

      const item = summary.get(row.date);
      item.total += 1;

      const computed = getComputedAttendanceStatus(row, {
        dateStr: row.date,
        holidaySet,
        noRecordStatus: "absent",
      });

      if (computed.computed_status === "full_day") item.present += 1;
      else if (computed.computed_status === "half_day") item.halfDay += 1;
      // FIX: previously only matched the legacy "leave" bucket and silently
      // dropped paid_leave/unpaid_leave from the chart.
      else if (["leave", "paid_leave", "unpaid_leave"].includes(computed.computed_status))
        item.leave += 1;
      else if (computed.computed_status === "absent") item.absent += 1;

      // FIX: reuse the already-computed late_minutes instead of a separate
      // evaluateLateLogin() call with its own late-window assumptions.
      if (Number(computed.late_minutes) > 0) item.late += 1;
    }

    res.json([...summary.values()]);
  } catch (err) {
    console.error("GET /attendance/range/summary error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/bulk-monthly
router.get("/attendance/bulk-monthly", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;
    const rangeError = validateAttendanceRange(start, end, "Bulk monthly attendance range");
    if (rangeError) return res.status(400).json({ message: rangeError });
    if (!start || !end) return res.status(400).json({ message: "start and end required" });

    const effectiveBranch = isBranchRestrictedOperationalRole(req.user)
      ? req.user.branch
      : branch && branch !== "all"
      ? branch
      : null;

    let query = `
      SELECT a.user_id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
             a.status, a.late_minutes, a.check_in_time, a.check_out_time,
             a.production_hours, a.total_break_minutes,
             a.half_day_slot, a.leave_type, a.leave_status,
             a.post_login_idle_minutes, a.misuse_of_time
      FROM attendance_records a JOIN users u ON a.user_id=u.id
      WHERE a.date BETWEEN $1 AND $2 AND u.role!='SUPER_ADMIN'`;
    const params = [start, end];
    let idx = 3;
    if (effectiveBranch) {
      query += ` AND u.branch=$${idx}`;
      params.push(effectiveBranch);
      idx += 1;
    }
    query += ` ORDER BY a.user_id, a.date ASC`;

    // FIX: bulk-monthly previously only read attendance_records, so approved
    // leave with no punch row silently disappeared from the monthly grid.
    const leaveParams = [start, end];
    let leaveQuery = `
      SELECT l.user_id, l.leave_type, l.from_date, l.to_date
      FROM leave_requests l
      JOIN users u ON l.user_id = u.id
      WHERE LOWER(l.status) = 'approved'
        AND l.from_date <= $2::date AND l.to_date >= $1::date
        AND u.role != 'SUPER_ADMIN'`;
    if (effectiveBranch) {
      leaveQuery += ` AND u.branch = $3`;
      leaveParams.push(effectiveBranch);
    }

    const [result, leaveResult] = await Promise.all([
      pool.query(query, params),
      pool.query(leaveQuery, leaveParams),
    ]);

    const holidaySet = await fetchHolidaySetForDateRange(start, end);
    const logsByDate = Object.fromEntries(result.rows.map((row) => [row.date, row]));

    const leaveByUserDate = new Map();
    for (const lv of leaveResult.rows) {
      const cur = new Date(lv.from_date);
      const to = new Date(lv.to_date);
      while (cur <= to) {
        const dateStr = cur.toISOString().slice(0, 10);
        if (dateStr >= start && dateStr <= end) {
          leaveByUserDate.set(`${lv.user_id}_${dateStr}`, lv.leave_type);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    const grouped = {};
    const seenUserDate = new Set();

    for (const row of result.rows) {
      const leaveType = leaveByUserDate.get(`${row.user_id}_${row.date}`);
      const merged = leaveType
        ? { ...row, leave_type: row.leave_type || leaveType, leave_status: row.leave_status || "approved" }
        : row;

      if (!grouped[row.user_id]) grouped[row.user_id] = [];
      grouped[row.user_id].push(
        // FIX: withDisplayAttendanceStatus was undefined in the provided
        // files; use the shared, verified engine instead.
        withComputedAttendanceStatus(merged, { dateStr: row.date, holidaySet, logsByDate })
      );
      seenUserDate.add(`${row.user_id}_${row.date}`);
    }

    // Synthesize rows for approved-leave days with NO attendance_records row.
    for (const lv of leaveResult.rows) {
      const cur = new Date(lv.from_date);
      const to = new Date(lv.to_date);
      while (cur <= to) {
        const dateStr = cur.toISOString().slice(0, 10);
        if (dateStr >= start && dateStr <= end && !seenUserDate.has(`${lv.user_id}_${dateStr}`)) {
          const synthetic = {
            user_id: lv.user_id,
            date: dateStr,
            leave_type: lv.leave_type,
            leave_status: "approved",
          };
          if (!grouped[lv.user_id]) grouped[lv.user_id] = [];
          grouped[lv.user_id].push(
            withComputedAttendanceStatus(synthetic, { dateStr, holidaySet, logsByDate })
          );
          seenUserDate.add(`${lv.user_id}_${dateStr}`);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    res.json(grouped);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// PUT /api/attendance/:userId  (manual admin edit)
//
// FIX: Use explicit CASE-based time casting to avoid null::time errors.
// Also handles break times via employee_breaks table.
// ───────────────────────────────────────────────────────────────────
router.put(
  "/attendance/:userId",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const userId = Number(req.params.userId);

      const rawDate = req.body.date;
      const date = rawDate ? String(rawDate).slice(0, 10) : null;

      if (!userId || !date) {
        return res.status(400).json({
          message: "userId and date are required",
        });
      }

      const reason = String(req.body.reason || "").trim();

      if (reason.length < 5) {
        return res.status(400).json({
          message: "Please enter a reason of at least 5 characters.",
        });
      }

      const hasBodyField = (name) =>
        Object.prototype.hasOwnProperty.call(req.body, name);

      // ============================================================
      // STATUS
      // ============================================================

      const requestedStatus = hasBodyField("status")
        ? String(req.body.status || "").trim().toLowerCase()
        : undefined;

      const allowedStatuses = [
        "auto",
        "full_day",
        "half_day",
        "absent",
        "paid_leave",
        "unpaid_leave",
        "leave",
        "present",
      ];

      if (
        requestedStatus !== undefined &&
        !allowedStatuses.includes(requestedStatus)
      ) {
        return res.status(400).json({
          message: `Invalid attendance status: ${requestedStatus}`,
        });
      }

      // Safely convert time strings.
      const toTime = (v) =>
        v && v !== "--" && String(v).trim() !== ""
          ? String(v).trim()
          : null;

      const requestedTimes = {
        check_in_time: hasBodyField("check_in_time")
          ? toTime(req.body.check_in_time)
          : undefined,

        check_out_time: hasBodyField("check_out_time")
          ? toTime(req.body.check_out_time)
          : undefined,

        break1_in: hasBodyField("break1_in")
          ? toTime(req.body.break1_in)
          : undefined,

        break1_out: hasBodyField("break1_out")
          ? toTime(req.body.break1_out)
          : undefined,

        break2_in: hasBodyField("break2_in")
          ? toTime(req.body.break2_in)
          : undefined,

        break2_out: hasBodyField("break2_out")
          ? toTime(req.body.break2_out)
          : undefined,

        lunch_in: hasBodyField("lunch_in")
          ? toTime(req.body.lunch_in)
          : hasBodyField("break3_in")
          ? toTime(req.body.break3_in)
          : undefined,

        lunch_out: hasBodyField("lunch_out")
          ? toTime(req.body.lunch_out)
          : hasBodyField("break3_out")
          ? toTime(req.body.break3_out)
          : undefined,
      };

      const editSource = String(req.body.source || "").toLowerCase();

      // ============================================================
      // EMPLOYEE
      // ============================================================

      const employeeRes = await client.query(
        `SELECT id, full_name, email, branch, department
         FROM users
         WHERE id = $1`,
        [userId]
      );

      if (!employeeRes.rows.length) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const employee = employeeRes.rows[0];

      if (!canEditAttendance(req.user, employee)) {
        return res.status(403).json({
          message:
            "You can only edit attendance for employees in your permitted branch",
        });
      }

      // ============================================================
      // EDITOR
      // ============================================================

      const editorRes = await client.query(
        `SELECT id, full_name, email, role
         FROM users
         WHERE id = $1`,
        [req.user.id]
      );

      const editor = editorRes.rows[0] || {
        id: req.user.id,
        full_name: req.user.full_name || req.user.email || "Unknown user",
        email: req.user.email || null,
        role: req.user.role,
      };

      // ============================================================
      // OLD ATTENDANCE
      // ============================================================

      await client.query("BEGIN");
      // A row lock cannot protect a not-yet-created attendance row. This
      // transaction lock serializes concurrent edits for this employee/date.
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [userId, Number(date.replaceAll("-", ""))]
      );

      const oldRes = await client.query(
        `SELECT
           id,
           TO_CHAR(date,'YYYY-MM-DD') AS date,
           check_in_time,
           check_out_time,
           status,
           leave_type,
           leave_status,
           leave_request_id
         FROM attendance_records
         WHERE user_id = $1
           AND date = $2::date
         FOR UPDATE`,
        [userId, date]
      );

      const oldRecord = oldRes.rows[0] || null;

      const oldValues = {
        check_in_time: oldRecord?.check_in_time || null,
        check_out_time: oldRecord?.check_out_time || null,
        status: oldRecord?.status || null,
        leave_type: oldRecord?.leave_type || null,
        leave_status: oldRecord?.leave_status || null,
      };

      // ============================================================
      // OLD BREAKS
      // ============================================================

      const breakRes = await client.query(
        `SELECT break_type, start_time, end_time
         FROM employee_breaks
         WHERE user_id = $1
           AND date = $2::date
           AND break_type IN ('break1', 'break2', 'lunch')`,
        [userId, date]
      );

      const oldBreaks = new Map(
        breakRes.rows.map((row) => [row.break_type, row])
      );

      const oldBreakValues = {
        break1_in: oldBreaks.get("break1")?.start_time || null,
        break1_out: oldBreaks.get("break1")?.end_time || null,

        break2_in: oldBreaks.get("break2")?.start_time || null,
        break2_out: oldBreaks.get("break2")?.end_time || null,

        lunch_in: oldBreaks.get("lunch")?.start_time || null,
        lunch_out: oldBreaks.get("lunch")?.end_time || null,
      };

      // ============================================================
      // NEXT VALUES
      // ============================================================

      const nextMainValues = {
        check_in_time:
          requestedTimes.check_in_time !== undefined
            ? requestedTimes.check_in_time
            : oldValues.check_in_time,

        check_out_time:
          requestedTimes.check_out_time !== undefined
            ? requestedTimes.check_out_time
            : oldValues.check_out_time,
      };

      /*
       * IMPORTANT:
       *
       * "auto" means do not manually override the status.
       * For every other status, save the admin-selected status.
       */
      const manualStatus =
        requestedStatus !== undefined && requestedStatus !== "auto"
          ? requestedStatus
          : null;

          console.log("🔥 MANUAL STATUS DEBUG:", {
  userId,
  date,
  requestedStatus,
  manualStatus,
  body: req.body,
});

      const leaveBalanceAdjustment = await adjustLeaveBalanceForAttendanceStatusChange({
        userId,
        attendanceDate: date,
        oldStatus: oldRecord?.status,
        newStatus: manualStatus || oldRecord?.status,
        client,
        // Approved leave requests have already adjusted leave_balance before
        // synchronizing their attendance row; calendar edits must not double count.
        skipAccounting: Boolean(
          oldRecord?.leave_request_id && oldRecord?.leave_status === "approved"
        ),
      });

      // ============================================================
      // ATTENDANCE HISTORY
      // ============================================================

      await client.query(
        `INSERT INTO attendance_history
           (
             original_attendance_id,
             date,
             employee_email,
             office_in,
             office_out,
             edited_by_email,
             edit_reason,
             snapshot_metadata
           )
         VALUES
           (
             $1,
             $2::date,
             $3,
             $4::time,
             $5::time,
             $6,
             $7,
             $8::jsonb
           )`,
        [
          oldRecord?.id || null,
          date,
          employee.email,
          oldValues.check_in_time,
          oldValues.check_out_time,
          req.user.email || req.user.full_name || "unknown",
          reason,
          JSON.stringify({
            oldValues: {
              ...oldValues,
              ...oldBreakValues,
            },
            requestedValues: req.body,
            leaveBalanceAdjustment: {
              oldStatus: oldRecord?.status || null,
              newStatus: manualStatus || oldRecord?.status || null,
              ...leaveBalanceAdjustment,
            },
          }),
        ]
      );

      // ============================================================
      // 1. UPSERT ATTENDANCE
      // ============================================================

      await client.query(
        `INSERT INTO attendance_records
           (
             user_id,
             date,
             check_in_time,
             check_out_time,
             status,
             extra_break_ins,
             extra_break_outs
           )
         VALUES
           (
             $1,
             $2::date,
             $3::time,
             $4::time,
             COALESCE($5, 'absent'),
             '[]'::jsonb,
             '[]'::jsonb
           )
         ON CONFLICT (user_id, date)
         DO UPDATE SET
           check_in_time =
             EXCLUDED.check_in_time,

           check_out_time =
             EXCLUDED.check_out_time,

           status =
             CASE
               WHEN $5 IS NOT NULL
                 THEN EXCLUDED.status
               ELSE attendance_records.status
             END,

           updated_at = CURRENT_TIMESTAMP`,
        [
          userId,
          date,
          nextMainValues.check_in_time,
          nextMainValues.check_out_time,
          manualStatus,
        ]
      );

      // ============================================================
      // 2. BREAKS
      // ============================================================

      const upsertBreak = async (breakType, inKey, outKey) => {
        if (
          requestedTimes[inKey] === undefined &&
          requestedTimes[outKey] === undefined
        ) {
          return;
        }

        const existing = oldBreaks.get(breakType) || {};

        const nextIn =
          requestedTimes[inKey] !== undefined
            ? requestedTimes[inKey]
            : existing.start_time || null;

        const nextOut =
          requestedTimes[outKey] !== undefined
            ? requestedTimes[outKey]
            : existing.end_time || null;

        await client.query(
          `INSERT INTO employee_breaks
             (
               user_id,
               date,
               break_type,
               start_time,
               end_time
             )
           VALUES
             (
               $1,
               $2::date,
               $3,
               $4::time,
               $5::time
             )
           ON CONFLICT (user_id, date, break_type)
           DO UPDATE SET
             start_time = EXCLUDED.start_time,
             end_time   = EXCLUDED.end_time`,
          [
            userId,
            date,
            breakType,
            nextIn,
            nextOut,
          ]
        );
      };

      await upsertBreak(
        "break1",
        "break1_in",
        "break1_out"
      );

      await upsertBreak(
        "break2",
        "break2_in",
        "break2_out"
      );

      await upsertBreak(
        "lunch",
        "lunch_in",
        "lunch_out"
      );

      // ============================================================
      // 3. COMMIT
      // ============================================================

      await client.query("COMMIT");

      // ============================================================
      // 4. RECALCULATE ONLY WHEN STATUS WAS NOT MANUALLY FORCED
      // ============================================================

      if (
        !manualStatus &&
        nextMainValues.check_in_time &&
        nextMainValues.check_out_time
      ) {
        const [editYear, editMonth] = date
          .split("-")
          .map(Number);

        await recalcAttendanceForUserMonth(
          userId,
          editYear,
          editMonth,
          {
            source: "manual_attendance_edit",
            forceManualOverride: true,
          }
        );
      } else if (
        !manualStatus &&
        requestedTimes.check_in_time !== undefined
      ) {
        await pool.query(
          `UPDATE attendance_records
           SET
             late_minutes = $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2
             AND date = $3::date`,
          [
            calculateLateMinutes(
              nextMainValues.check_in_time
            ),
            userId,
            date,
          ]
        );
      }

      // ============================================================
      // 5. FETCH UPDATED RECORD
      // ============================================================

      const updated = await pool.query(
        `SELECT
           id,
           user_id,
           TO_CHAR(date,'YYYY-MM-DD') AS date,
           check_in_time,
           check_out_time,
           status,
           late_minutes,
           production_hours,
           total_break_minutes,
           half_day_slot,
           leave_type,
           leave_status,
           post_login_idle_minutes,
           misuse_of_time
         FROM attendance_records
         WHERE user_id = $1
           AND date = $2::date`,
        [userId, date]
      );

      invalidateCache("summary");
      invalidateCache(
        `individual|${userId}|${date.slice(0, 7)}`
      );

      scheduleViewRefresh();

      const holidaySet =
        await fetchHolidaySetForDateRange(date, date);

  const rawUpdatedRecord = updated.rows[0];

const updatedRecord = rawUpdatedRecord
  ? {
      ...rawUpdatedRecord,

      // IMPORTANT:
      // If admin manually selected a status,
      // preserve that exact status for the response,
      // activity log, and frontend.
      status:
        manualStatus !== null
          ? manualStatus
          : rawUpdatedRecord.status,
    }
  : null;

      const newValues = {
        check_in_time:
          updatedRecord?.check_in_time || null,

        check_out_time:
          updatedRecord?.check_out_time || null,

        status:
          updatedRecord?.status || null,
      };

      // ============================================================
      // 6. ACTIVITY LOG
      // ============================================================

      await logActivity({
        userId: editor.id,
        userName:
          editor.full_name ||
          editor.email ||
          "Unknown user",

        role:
          editor.role ||
          req.user.role,

        action: "ATTENDANCE_EDITED",

        actionType: "attendance_changed",

        moduleName:
          editSource === "calendar"
            ? "Calendar Attendance Edit"
            : "Attendance",

        details:
          `Attendance edited for ${employee.full_name} ` +
          `(${employee.email}) on ${date}. ` +
          `Reason: ${reason}. ` +
          `Status: ${newValues.status || "--"}.`,

        ip: getClientIp(req),

        branch:
          employee.branch ||
          req.user.branch ||
          "all",

        department:
          employee.department || null,

        metadata: {
          editedBy: {
            id: editor.id,

            name:
              editor.full_name ||
              editor.email ||
              "Unknown user",

            email:
              editor.email || null,

            role:
              editor.role ||
              req.user.role,
          },

          editedFor: {
            id: userId,
            name: employee.full_name,
            email: employee.email,
          },

          date,
          reason,
          oldValues,
          newValues,

          editedRecordId:
            updatedRecord?.id ||
            oldRecord?.id ||
            null,
        },
      });

      // ============================================================
      // 7. NOTIFICATION
      // ============================================================

      await createNotification({
        userId,

        actionType:
          "attendance_update",

        relatedId:
          updatedRecord?.id ||
          oldRecord?.id ||
          null,

        targetRole:
          "EMPLOYEE",

        relatedDate:
          date,

        reason,

        description:
          `Attendance updated for ${date}. ` +
          `Status: ${newValues.status || "--"}, ` +
          `In: ${formatTime12Hour(
            newValues.check_in_time
          )}, ` +
          `Out: ${formatTime12Hour(
            newValues.check_out_time
          )}. ` +
          `Reason: ${reason}`,
      });

      // ============================================================
      // RESPONSE
      // ============================================================

      res.json({
        message:
          manualStatus === "paid_leave"
            ? "Paid Leave assigned successfully"
            : "Attendance updated successfully",

        data: updatedRecord,
      });
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch((rollbackErr) => {
          console.error(
            "PUT /attendance/:userId rollback failed:",
            rollbackErr
          );
        });

      console.error(
        "PUT /attendance/:userId error:",
        err
      );

      res.status(err.statusCode || 500).json({
        message: err.message,
      });
    } finally {
      client.release();
    }
  }
);

// POST /api/attendance/apply-holiday
router.post(
  "/attendance/apply-holiday",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { date } = req.body;
      if (!date) return res.status(400).json({ message: "date required" });
      const holiday = await pool.query(
        `SELECT * FROM company_holidays WHERE date=$1`, [date]
      );
      if (!holiday.rows.length) return res.status(400).json({ message: "Not a holiday" });
      await pool.query(
        `UPDATE attendance_records SET status='holiday', late_minutes=0,
                production_hours=0 WHERE date=$1`,
        [date]
      );
      await pool.query(
        `INSERT INTO attendance_records (user_id, date, status, branch, department,
           extra_break_ins, extra_break_outs)
         SELECT u.id,$1,'holiday',u.branch,u.department,'[]','[]' FROM users u
         WHERE u.role!='SUPER_ADMIN'
         AND NOT EXISTS (SELECT 1 FROM attendance_records a2 WHERE a2.user_id=u.id AND a2.date=$1)`,
        [date]
      );
      invalidateCache("summary");
      scheduleViewRefresh();
      res.json({ message: `Holiday applied for ${date}` });
    } catch (err) {
      console.error("POST /attendance/apply-holiday error:", err);
      res.status(500).json({ message: err.message || "Failed to apply holiday" });
    }
  }
);

// POST /api/attendance/recalculate
router.post(
  "/attendance/recalculate",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const { start, end } = req.body;
      if (!start || !end) return res.status(400).json({ message: "start and end required" });
      const rangeError = validateAttendanceRange(start, end, "recalculate range");
      if (rangeError) return res.status(400).json({ message: rangeError });
      const records = await pool.query(
        `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date
         FROM attendance_records WHERE date BETWEEN $1 AND $2 ORDER BY date ASC`,
        [start, end]
      );
      const maxRecords = Number(process.env.MAX_ATTENDANCE_RECALC_RECORDS || 2000);
      if (records.rows.length > maxRecords) {
        return res.status(413).json({
          message: `Too many records to recalculate in one request. Limit is ${maxRecords}.`,
          records: records.rows.length,
        });
      }
      let updated = 0;
      for (const row of records.rows) {
        await recalcAttendanceForUserDate(row.user_id, row.date);
        updated++;
      }
      scheduleViewRefresh();
      res.json({ message: `Recalculated ${updated} records`, updated });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// GET /api/attendance/department-leaderboard
router.get("/attendance/department-leaderboard", verifyToken, async (req, res) => {
  try {
    const { date, branch } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });
    const effectiveBranch = (req.user.role === "MANAGER") ? req.user.branch
      : branch && branch !== "all" ? branch : null;

    let totalQ = `SELECT u.id AS user_id, u.full_name, u.department, u.branch
                  FROM users u
                  WHERE u.role NOT IN ('SUPER_ADMIN') AND u.department IS NOT NULL
                    AND COALESCE(u.status, 'active') = 'active'`;
    let totalP = []; let tIdx = 1;
    if (effectiveBranch) { totalQ += ` AND u.branch=$${tIdx}`; totalP.push(effectiveBranch); tIdx++; }
    const usersRes = await pool.query(totalQ, totalP);
    const deptTotals = new Map();
    usersRes.rows.forEach((user) => {
      deptTotals.set(user.department, (deptTotals.get(user.department) || 0) + 1);
    });

    const attResult = await pool.query(
      `SELECT
          ar.user_id,
          ar.check_in_time,
          ar.check_out_time,
          ${normalizedAttendanceStatusSql("ar")} AS status,
          ar.late_minutes,
          ar.production_hours,
          ar.half_day_slot,
          ar.leave_type,
          ar.leave_status,
          ar.post_login_idle_minutes,
          ar.misuse_of_time,
          COALESCE((SELECT SUM(COALESCE(b.duration_minutes, 0))
                    FROM employee_breaks b
                    WHERE b.user_id = ar.user_id
                      AND b.date = $1::date), ar.total_break_minutes, 0) AS total_break_minutes
       FROM attendance_records ar
       WHERE ar.date = $1::date`,
      [date]
    );
    const attMap = new Map(attResult.rows.map((r) => [r.user_id, r]));
    const [year] = date.split("-").map(Number);
    const holidaySet = await fetchHolidaySet(year);
    const presentMap = new Map();
    const absentMap = new Map();
    const leaveMap = new Map();

    for (const user of usersRes.rows) {
      const row = await classifyAttendanceForResponse(user, date, attMap.get(user.user_id), holidaySet);
      if (["full_day", "in_progress", "working"].includes(row.status)) {
        presentMap.set(user.department, (presentMap.get(user.department) || 0) + 1);
      } else if (row.status === "half_day") {
        presentMap.set(user.department, (presentMap.get(user.department) || 0) + 0.5);
      } else if (row.status === "leave") {
        leaveMap.set(user.department, (leaveMap.get(user.department) || 0) + 1);
      } else if (row.status === "absent") {
        absentMap.set(user.department, (absentMap.get(user.department) || 0) + 1);
      }
    }

    const leaderboard = [];
    for (const [dept, total] of deptTotals.entries()) {
      const present = presentMap.get(dept) || 0;
      const absent = absentMap.get(dept) || 0;
      const leave = leaveMap.get(dept) || 0;
      leaderboard.push({
        name: dept,
        present,
        absent,
        leave,
        percent: present + absent > 0 ? Math.round((present / (present + absent)) * 100) : 0,
      });
    }
    leaderboard.sort((a, b) => b.percent - a.percent);
    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
// GET /api/attendance/employee/:userId
//
// FIX: Added explicit table alias `ar` — was missing, causing
// "missing FROM-clause entry for table a" error when TO_CHAR(a.date,...)
// was referenced without alias.
// Also joins employee_breaks to return actual break times.
// ───────────────────────────────────────────────────────────────────

// ============================================================
// GET EMPLOYEE ATTENDANCE CALENDAR
//
// IMPORTANT:
// Returns attendance + approved leave requests.
// Paid Leave / Unpaid Leave will appear even when there is
// NO attendance_records row.
// ============================================================

router.get(
  "/attendance/employee/:userId",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { start, end } = req.query;

      // ========================================================
      // VALIDATE DATE RANGE
      // ========================================================

      if (!start || !end) {
        return res.status(400).json({
          message: "start and end required",
        });
      }

      // ========================================================
      // GET TARGET EMPLOYEE
      // ========================================================

      const target = await pool.query(
        `
        SELECT branch, role
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (!target.rows.length) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // ========================================================
      // ACCESS CONTROL
      // ========================================================

      if (
        req.user.role === "EMPLOYEE" &&
        Number(req.user.id) !== Number(userId)
      ) {
        return res.status(403).json({
          message: "Access denied",
        });
      }

      if (
        req.user.role === "MANAGER" &&
        target.rows[0].branch !== req.user.branch
      ) {
        return res.status(403).json({
          message: "Cross-branch access denied",
        });
      }

      // ========================================================
      // GET EVERY DAY IN THE REQUESTED RANGE
      //
      // This is the important part.
      // We generate dates and merge:
      //
      // 1. Approved leave_requests
      // 2. attendance_records
      //
      // Approved leave gets highest priority.
      // ========================================================

      const result = await pool.query(
        `
        SELECT
          TO_CHAR(d.day::date, 'YYYY-MM-DD') AS date,

          -- ==================================================
          -- FINAL STATUS
          -- ==================================================

          CASE

            -- PAID LEAVE
            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.paid_days, 0) > 0
            THEN 'paid_leave'

            -- UNPAID LEAVE
            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.unpaid_days, 0) > 0
            THEN 'unpaid_leave'

            -- NORMAL ATTENDANCE
            WHEN ar.id IS NOT NULL
            THEN ${normalizedAttendanceStatusSql("ar")}

            -- NO RECORD
            ELSE 'no_record'

          END AS status,


          -- ==================================================
          -- ATTENDANCE DATA
          -- ==================================================

          ar.id AS attendance_id,

          ar.check_in_time,
          ar.check_out_time,

          ar.late_minutes,

          ar.production_hours,

          ar.total_break_minutes,

          ar.half_day_slot,

          ar.post_login_idle_minutes,

          ar.misuse_of_time,


          -- ==================================================
          -- ATTENDANCE BREAK DATA
          -- ==================================================

          b1.start_time AS break1_in,
          b1.end_time AS break1_out,

          b2.start_time AS break2_in,
          b2.end_time AS break2_out,

          ln.start_time AS lunch_in,
          ln.end_time AS lunch_out,


          -- ==================================================
          -- LEAVE REQUEST DATA
          -- ==================================================

          lr.id AS leave_request_id,

          lr.leave_type AS request_leave_type,

          lr.leave_type,

          lr.status AS leave_status,

          COALESCE(lr.paid_days, 0) AS paid_days,

          COALESCE(lr.unpaid_days, 0) AS unpaid_days,


          -- ==================================================
          -- PAID LEAVE FLAG
          -- ==================================================

          CASE
            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.paid_days, 0) > 0
            THEN true

            ELSE COALESCE(ar.is_paid_leave, false)

          END AS is_paid_leave,


          -- ==================================================
          -- UNPAID LEAVE FLAG
          -- ==================================================

          CASE
            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.unpaid_days, 0) > 0
            THEN true

            ELSE false

          END AS is_unpaid_leave


        -- ======================================================
        -- GENERATE ALL DATES
        -- ======================================================

        FROM generate_series(
          $2::date,
          $3::date,
          INTERVAL '1 day'
        ) AS d(day)


        -- ======================================================
        -- ATTENDANCE RECORD
        -- ======================================================

        LEFT JOIN attendance_records ar
          ON ar.user_id = $1
          AND ar.date = d.day::date


        -- ======================================================
        -- APPROVED LEAVE REQUEST
        --
        -- This works even if attendance_records has NO ROW.
        -- ======================================================

        LEFT JOIN LATERAL (
          SELECT lr.*

          FROM leave_requests lr

          WHERE lr.user_id = $1

            AND d.day::date BETWEEN
              lr.from_date::date
              AND lr.to_date::date

            AND LOWER(COALESCE(lr.status, '')) = 'approved'

          ORDER BY lr.id DESC

          LIMIT 1

        ) lr ON true


        -- ======================================================
        -- BREAK 1
        -- ======================================================

        LEFT JOIN employee_breaks b1
          ON b1.user_id = $1
          AND b1.date = d.day::date
          AND b1.break_type = 'break1'


        -- ======================================================
        -- BREAK 2
        -- ======================================================

        LEFT JOIN employee_breaks b2
          ON b2.user_id = $1
          AND b2.date = d.day::date
          AND b2.break_type = 'break2'


        -- ======================================================
        -- LUNCH
        -- ======================================================

        LEFT JOIN employee_breaks ln
          ON ln.user_id = $1
          AND ln.date = d.day::date
          AND ln.break_type = 'lunch'


        ORDER BY d.day ASC
        `,
        [userId, start, end]
      );

      // ========================================================
      // HOLIDAYS
      // ========================================================

      const holidaySet =
        await fetchHolidaySetForDateRange(start, end);

      const logsByDate = Object.fromEntries(
        result.rows.map((row) => [
          row.date,
          row,
        ])
      );

      // ========================================================
      // FINAL RESPONSE
      //
      // VERY IMPORTANT:
      // Paid Leave and Unpaid Leave should NOT be overridden by
      // Sunday / Holiday / normal attendance logic.
      // ========================================================

      const response = result.rows.map((row) => {

        // ======================================================
        // PAID LEAVE
        // ======================================================

        if (row.status === "paid_leave") {
          return {
            ...row,

            status: "paid_leave",

            is_paid_leave: true,

            isPaidLeave: true,
          };
        }


        // ======================================================
        // UNPAID LEAVE
        // ======================================================

        if (row.status === "unpaid_leave") {
          return {
            ...row,

            status: "unpaid_leave",

            is_unpaid_leave: true,

            isUnpaidLeave: true,
          };
        }


        // ======================================================
        // NORMAL ATTENDANCE
        // ======================================================

        return withDisplayAttendanceStatus(
          row,
          row.date,
          {
            holidaySet,
            logsByDate,
          }
        );
      });


      // ========================================================
      // DEBUG
      // ========================================================

      console.log(
        "EMPLOYEE CALENDAR:",
        userId,
        response.filter(
          (row) =>
            row.status === "paid_leave" ||
            row.status === "unpaid_leave"
        )
      );


      return res.json(response);

    } catch (err) {

      console.error(
        "GET /attendance/employee/:userId ERROR:",
        err
      );

      return res.status(500).json({
        message: err.message,
      });
    }
  }
);

// GET /api/attendance/user/:userId (super admin)
// ============================================================
// GET /api/attendance/user/:userId
// SUPER ADMIN / OPERATIONAL MANAGER
//
// IMPORTANT:
// Merges attendance_records with approved leave_requests.
// This allows Paid Leave / Unpaid Leave to appear in the calendar
// even when no attendance_records row exists.
// ============================================================


// ============================================================
// GET ATTENDANCE FOR SUPER ADMIN / OPERATIONAL MANAGER
// Includes approved leave even when attendance_records has no row
// ============================================================

router.get(
  "/attendance/user/:userId",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { start, end } = req.query;

      if (!start || !end) {
        return res.status(400).json({
          message: "start and end required",
        });
      }

      const result = await pool.query(
        `
        SELECT
          TO_CHAR(d.day, 'YYYY-MM-DD') AS date,

          -- ================================================
          -- FINAL STATUS
          -- DATE-LEVEL ATTENDANCE IS THE SOURCE OF TRUTH.
          -- A leave request can be mixed paid/unpaid, so it must never
          -- overwrite a persisted paid_leave/unpaid_leave day.
          -- ================================================
          CASE
            WHEN ar.id IS NOT NULL
            THEN ${normalizedAttendanceStatusSql("ar")}

            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.paid_days, 0) > 0
            THEN 'paid_leave'

            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.unpaid_days, 0) > 0
            THEN 'unpaid_leave'

            ELSE 'no_record'
          END AS status,

          -- ================================================
          -- ATTENDANCE DATA
          -- ================================================
          ar.check_in_time,
          ar.check_out_time,
          ar.late_minutes,
          ar.production_hours,
          ar.total_break_minutes,
          ar.half_day_slot,
          ar.leave_type AS attendance_leave_type,
          ar.leave_status AS attendance_leave_status,
          ar.is_paid_leave AS attendance_is_paid_leave,
          ar.post_login_idle_minutes,
          ar.misuse_of_time,

          -- ================================================
          -- LEAVE DATA
          -- ================================================
          lr.id AS leave_request_id,
          lr.leave_type AS request_leave_type,
          COALESCE(ar.leave_type, lr.leave_type) AS leave_type,
          COALESCE(ar.leave_status, lr.status) AS leave_status,

          COALESCE(lr.paid_days, 0) AS paid_days,
          COALESCE(lr.unpaid_days, 0) AS unpaid_days,

          -- ================================================
          -- PAID LEAVE FLAG
          -- ================================================
          CASE
            WHEN ar.id IS NOT NULL
            THEN COALESCE(ar.is_paid_leave, false)

            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.paid_days, 0) > 0
            THEN true
            ELSE COALESCE(ar.is_paid_leave, false)
          END AS is_paid_leave,

          -- ================================================
          -- UNPAID LEAVE FLAG
          -- ================================================
          CASE
            WHEN ar.id IS NOT NULL
            THEN LOWER(COALESCE(ar.status, '')) = 'unpaid_leave'

            WHEN lr.id IS NOT NULL
              AND LOWER(COALESCE(lr.status, '')) = 'approved'
              AND COALESCE(lr.unpaid_days, 0) > 0
            THEN true
            ELSE false
          END AS is_unpaid_leave

        FROM generate_series(
          $2::date,
          $3::date,
          INTERVAL '1 day'
        ) AS d(day)

        LEFT JOIN attendance_records ar
          ON ar.user_id = $1
          AND ar.date = d.day::date

        LEFT JOIN LATERAL (
          SELECT *
          FROM leave_requests lr
          WHERE lr.user_id = $1
            AND d.day::date BETWEEN lr.from_date::date AND lr.to_date::date
            AND LOWER(COALESCE(lr.status, '')) = 'approved'
          ORDER BY lr.id DESC
          LIMIT 1
        ) lr ON true

        ORDER BY d.day ASC
        `,
        [userId, start, end]
      );

      const holidaySet =
        await fetchHolidaySetForDateRange(start, end);

      const logsByDate = Object.fromEntries(
        result.rows.map((row) => [
          row.date,
          row,
        ])
      );

      // ======================================================
      // IMPORTANT:
      // LEAVE MUST NOT GO THROUGH withDisplayAttendanceStatus
      // ======================================================

      const response = result.rows.map((row) => {
        if (row.status === "paid_leave") {
          return {
            ...row,
            status: "paid_leave",
            is_paid_leave: true,
            isPaidLeave: true,
          };
        }

        if (row.status === "unpaid_leave") {
          return {
            ...row,
            status: "unpaid_leave",
            is_unpaid_leave: true,
            isUnpaidLeave: true,
          };
        }

        return withDisplayAttendanceStatus(
          row,
          row.date,
          {
            holidaySet,
            logsByDate,
          }
        );
      });

      return res.json(response);

    } catch (err) {
      console.error(
        "GET /attendance/user/:userId ERROR:",
        err
      );

      return res.status(500).json({
        message: err.message,
      });
    }
  }
);



// GET /api/attendance/late-trend
router.get("/attendance/late-trend", verifyToken, async (req, res) => {
  try {
    const { baseDate, branch } = req.query;
    const effectiveBranch = (req.user.role === "MANAGER") ? req.user.branch
      : branch && branch !== "all" ? branch : null;
    const end  = new Date(baseDate);
    const dates = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(end); d.setDate(end.getDate() - (4 - i));
      return d.toISOString().slice(0, 10);
    });
    let q = `SELECT TO_CHAR(a.date,'YYYY-MM-DD') AS date, COUNT(*) AS late
             FROM attendance_records a
             JOIN users u ON a.user_id=u.id
             WHERE a.check_in_time >= TIME '10:15:00'
               AND a.check_in_time < TIME '10:30:00'
               AND a.date=ANY($1::date[])
               AND u.role != 'SUPER_ADMIN'`;
    const p = [dates]; let idx = 2;
    if (effectiveBranch) { q += ` AND u.branch=$${idx}`; p.push(effectiveBranch); }
    q += ` GROUP BY a.date`;
    const result = await pool.query(q, p);
    const map = {}; result.rows.forEach((r) => { map[r.date] = Number(r.late); });
    res.json(dates.map((d) => map[d] || 0));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/paged
router.get("/attendance/paged", verifyToken, async (req, res) => {
  try {
    const { date, department, search, branch, page = 1, limit = 25 } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });
    const pageSize = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * pageSize;
    const effectiveBranch = (req.user.role === "MANAGER") ? req.user.branch
      : branch && branch !== "all" ? branch : null;

    let baseWhere = `u.role NOT IN ('SUPER_ADMIN') AND COALESCE(u.status, 'active') = 'active'`;
    const params = []; let idx = 1;
    if (effectiveBranch) { baseWhere += ` AND u.branch=$${idx}`; params.push(effectiveBranch); idx++; }
    if (department && department !== "all") { baseWhere += ` AND u.department=$${idx}`; params.push(department); idx++; }
    if (search) { baseWhere += ` AND (u.full_name ILIKE $${idx} OR u.department ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${baseWhere}`, params),
      pool.query(
        `SELECT u.id AS user_id, u.full_name, u.department, u.branch,
                a.check_in_time, a.check_out_time, ${normalizedAttendanceStatusSql("a")} AS status, a.late_minutes,
                a.production_hours, a.total_break_minutes,
                a.half_day_slot, a.leave_type, a.leave_status,
                a.post_login_idle_minutes, a.misuse_of_time
         FROM users u
         LEFT JOIN attendance_records a ON a.user_id=u.id AND a.date=$${idx}
         WHERE ${baseWhere}
         ORDER BY u.full_name ASC LIMIT $${idx+1} OFFSET $${idx+2}`,
        [...params, date, pageSize, offset]
      ),
    ]);

    const [year] = date.split("-").map(Number);
    const holidaySet = await fetchHolidaySet(year);
    res.json({
      data: dataRes.rows.map((r) =>
        withDisplayAttendanceStatus(
          {
            ...r,
            date,
            late_minutes: r.late_minutes || 0,
            production_hours: r.production_hours || "0.00",
            total_break_minutes: r.total_break_minutes || 0,
          },
          date,
          { holidaySet }
        )
      ),
      total: Number(countRes.rows[0].total),
      page:  parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(Number(countRes.rows[0].total) / parseInt(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/departments
router.get("/departments", verifyToken, async (req, res) => {
  try {
    const { date, branch } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });
    const effectiveBranch = (req.user.role === "MANAGER") ? req.user.branch
      : branch && branch !== "all" ? branch : null;

    let userQuery = `
      SELECT u.id AS user_id, u.full_name, u.department, u.branch, u.role
      FROM users u
      WHERE u.department IS NOT NULL
        AND u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') = 'active'`;
    const params = [];
    if (effectiveBranch) {
      userQuery += " AND u.branch=$1";
      params.push(effectiveBranch);
    }
    userQuery += " ORDER BY u.department, u.full_name";

    const [usersResult, attResult] = await Promise.all([
      pool.query(userQuery, params),
      pool.query(
        `SELECT
           ar.user_id,
           ar.check_in_time,
           ar.check_out_time,
           ${normalizedAttendanceStatusSql("ar")} AS status,
           ar.late_minutes,
           ar.production_hours,
           ar.total_break_minutes,
           ar.half_day_slot,
           ar.leave_type,
           ar.leave_status,
           ar.post_login_idle_minutes,
           ar.misuse_of_time
         FROM attendance_records ar
         WHERE ar.date=$1::date`,
        [date]
      ),
    ]);
    const attMap = new Map(attResult.rows.map((r) => [r.user_id, r]));
    const [year] = date.split("-").map(Number);
    const holidaySet = await fetchHolidaySet(year);
    const departments = new Map();

    for (const user of usersResult.rows) {
      if (!departments.has(user.department)) {
        departments.set(user.department, {
          name: user.department,
          code: user.department ? user.department.replace(/\s/g, "").slice(0, 3).toUpperCase() : "",
          employees: 0,
          present: 0,
          absent: 0,
          leave: 0,
          head: "Not Assigned",
        });
      }
      const dept = departments.get(user.department);
      dept.employees += 1;
      if (user.role === "MANAGER") dept.head = user.full_name;

      const computed = await classifyAttendanceForResponse(user, date, attMap.get(user.user_id), holidaySet);
      if (["full_day", "in_progress", "working"].includes(computed.status)) {
        dept.present += 1;
      } else if (computed.status === "half_day") {
        dept.present += 0.5;
      } else if (computed.status === "leave") {
        dept.leave += 1;
      } else if (computed.status === "absent") {
        dept.absent += 1;
      }
    }

    res.json([...departments.values()].sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/admin/dashboard/attendance
// UNIFIED ADMIN DASHBOARD ATTENDANCE API
// Single source of truth for all attendance data
// ═══════════════════════════════════════════════════════════════════
router.get(
  "/admin/dashboard/attendance",
  verifyToken,
  authorizeRoles(
    "SUPER_ADMIN",
    "OPERATIONAL_MANAGER",
    "MANAGER",
    "SUB_ADMIN"
  ),
  async (req, res) => {
    try {
      const {
        start,
        end,
        branch: requestedBranch,
        today: requestedToday,
      } = req.query;

      const rangeError = validateAttendanceRange(
        start,
        end,
        "date range"
      );

      if (rangeError) {
        return res.status(400).json({
          message: rangeError,
        });
      }

      /*
       * IMPORTANT:
       * Never trust future dates for attendance calculations.
       *
       * Example:
       * Range = Sep 1 → Sep 30
       * Today = Sep 2
       *
       * Calculate only Sep 1 → Sep 2
       */

      const actualToday = formatDateStr(new Date());

      const todayStr =
        requestedToday && requestedToday <= actualToday
          ? requestedToday
          : actualToday;

      const calculationEnd =
        end < todayStr ? end : todayStr;

      const effectiveBranch =
        isBranchRestrictedOperationalRole(req.user)
          ? req.user.branch
          : requestedBranch &&
            requestedBranch !== "all"
          ? requestedBranch
          : null;

      /* =====================================================
         EMPLOYEES
      ===================================================== */

      let employeeQuery = `
        SELECT
          id,
          full_name,
          email,
          role,
          department,
          branch,
          status
        FROM users
        WHERE role != 'SUPER_ADMIN'
          AND COALESCE(status, 'active') = 'active'
      `;

      const employeeParams = [];

      if (effectiveBranch) {
        employeeQuery += ` AND branch = $1`;
        employeeParams.push(effectiveBranch);
      }

      employeeQuery += ` ORDER BY full_name ASC`;

      const employeeResult = await pool.query(
        employeeQuery,
        employeeParams
      );

      const employees = employeeResult.rows;

      /* =====================================================
         ATTENDANCE RECORDS
         Fetch only until calculationEnd
      ===================================================== */

      let attendanceQuery = `
        SELECT
          a.id,
          a.user_id,
          TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
          a.check_in_time,
          a.check_out_time,
          a.status,
          a.late_minutes,
          a.production_hours,
          a.total_break_minutes,
          a.leave_type,
          a.leave_status,
          a.is_paid_leave,
          a.half_day_slot,
          a.branch,
          a.department
        FROM attendance_records a
        WHERE a.date BETWEEN $1::date AND $2::date
      `;

      const attendanceParams = [
        start,
        calculationEnd,
      ];

      if (effectiveBranch) {
        attendanceQuery += ` AND a.branch = $3`;
        attendanceParams.push(effectiveBranch);
      }

      attendanceQuery += `
        ORDER BY a.user_id, a.date
      `;

      const attendanceResult = await pool.query(
        attendanceQuery,
        attendanceParams
      );

      const allRecords = attendanceResult.rows;

      /* =====================================================
         INDEX ATTENDANCE
      ===================================================== */

      const attendanceByUser = new Map();

      allRecords.forEach((record) => {
        if (!attendanceByUser.has(record.user_id)) {
          attendanceByUser.set(record.user_id, []);
        }

        attendanceByUser
          .get(record.user_id)
          .push(record);
      });

      function getRecordForDate(
        userId,
        dateStr
      ) {
        const records =
          attendanceByUser.get(userId) || [];

        return records.find(
          (record) => record.date === dateStr
        );
      }

      /* =====================================================
         HOLIDAYS
      ===================================================== */

      const holidayResult = await pool.query(
        `
        SELECT
          TO_CHAR(date, 'YYYY-MM-DD') AS date,
          name
        FROM company_holidays
        WHERE date BETWEEN $1::date AND $2::date
          AND (
            branch = 'all'
            OR branch IS NULL
            OR (
              $3::text IS NULL
              OR branch = $3::text
            )
          )
        `,
        [
          start,
          calculationEnd,
          effectiveBranch,
        ]
      );

      const holidaySet = new Set(
        holidayResult.rows.map(
          (row) => row.date
        )
      );

      /* =====================================================
         PENDING LEAVES
      ===================================================== */

      let pendingLeavesQuery = `
        SELECT
          lr.id,
          lr.user_id,
          u.full_name,
          lr.leave_type,
          lr.days,
          lr.status
        FROM leave_requests lr
        JOIN users u
          ON lr.user_id = u.id
        WHERE LOWER(lr.status) = 'pending'
      `;

      const pendingLeaveParams = [];

      if (effectiveBranch) {
        pendingLeavesQuery += `
          AND u.branch = $1
        `;

        pendingLeaveParams.push(
          effectiveBranch
        );
      }

      pendingLeavesQuery += `
        ORDER BY lr.created_at DESC
        LIMIT 10
      `;

      const pendingLeaveResult =
        await pool.query(
          pendingLeavesQuery,
          pendingLeaveParams
        );

      const pendingLeaveItems =
        pendingLeaveResult.rows;

      /* =====================================================
         HELPERS
      ===================================================== */

      function isSunday(dateStr) {
        const [year, month, day] =
          dateStr.split("-").map(Number);

        return (
          new Date(
            year,
            month - 1,
            day
          ).getDay() === 0
        );
      }

      function normalizeStatus(status) {
        if (!status) return "absent";

        return String(status)
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_");
      }

      function isLeaveRecord(record) {
        if (!record) return false;

        const status = normalizeStatus(
          record.status
        );

        const leaveType = normalizeStatus(
          record.leave_type
        );

        return (
          status === "leave" ||
          status === "paid_leave" ||
          status === "unpaid_leave" ||
          leaveType === "paid_leave" ||
          leaveType === "unpaid_leave"
        );
      }

      function isPaidLeave(record) {
        if (!record) return false;

        const status = normalizeStatus(
          record.status
        );

        const leaveType = normalizeStatus(
          record.leave_type
        );

        return (
          status === "paid_leave" ||
          leaveType === "paid_leave" ||
          record.is_paid_leave === true
        );
      }

      function isUnpaidLeave(record) {
        if (!record) return false;

        const status = normalizeStatus(
          record.status
        );

        const leaveType = normalizeStatus(
          record.leave_type
        );

        return (
          status === "unpaid_leave" ||
          leaveType === "unpaid_leave" ||
          (
            status === "leave" &&
            !record.is_paid_leave
          )
        );
      }

      function isHalfDay(record) {
        if (!record) return false;

        return (
          normalizeStatus(record.status) ===
          "half_day"
        );
      }

      function isPresentRecord(
        record,
        dateStr
      ) {
        if (!record) return false;

        const status = normalizeStatus(
          record.status
        );

        if (
          [
            "full_day",
            "present",
            "late",
            "working",
            "in_progress",
          ].includes(status)
        ) {
          return true;
        }

        if (status === "half_day") {
          return true;
        }

        if (
          record.check_in_time &&
          dateStr === todayStr
        ) {
          return true;
        }

        return Boolean(
          record.check_in_time &&
          record.check_out_time
        );
      }

      function isWorkingNow(
        record,
        dateStr
      ) {
        if (!record) return false;

        if (dateStr !== todayStr) {
          return false;
        }

        return Boolean(
          record.check_in_time &&
          !record.check_out_time
        );
      }

      function isLate(record) {
        return (
          Number(record?.late_minutes || 0) > 0
        );
      }

      /* =====================================================
         TODAY SUMMARY
      ===================================================== */

      let todayPresent = 0;
      let todayWorking = 0;
      let todayAbsent = 0;
      let todayHalfDay = 0;
      let todayLate = 0;
      let todayPaidLeave = 0;
      let todayUnpaidLeave = 0;

      const todayIsSunday =
        isSunday(todayStr);

      const todayIsHoliday =
        holidaySet.has(todayStr);

      employees.forEach((employee) => {
        const record =
          getRecordForDate(
            employee.id,
            todayStr
          );

        /*
         * Sunday/Holiday should not mark
         * employees as absent.
         */

        if (
          todayIsSunday ||
          todayIsHoliday
        ) {
          return;
        }

        if (
          isPaidLeave(record)
        ) {
          todayPaidLeave += 1;
          return;
        }

        if (
          isUnpaidLeave(record)
        ) {
          todayUnpaidLeave += 1;
          return;
        }

        if (
          isHalfDay(record)
        ) {
          todayHalfDay += 1;

          if (isLate(record)) {
            todayLate += 1;
          }

          return;
        }

        if (
          isWorkingNow(
            record,
            todayStr
          )
        ) {
          todayWorking += 1;

          if (isLate(record)) {
            todayLate += 1;
          }

          return;
        }

        if (
          isPresentRecord(
            record,
            todayStr
          )
        ) {
          todayPresent += 1;

          if (isLate(record)) {
            todayLate += 1;
          }

          return;
        }

        todayAbsent += 1;
      });

      const summary = {
        present: todayPresent,
        working: todayWorking,
        halfDay: todayHalfDay,
        absent: todayAbsent,
        late: todayLate,
        paidLeave: todayPaidLeave,
        unpaidLeave: todayUnpaidLeave,
      };

      /* =====================================================
         CALENDAR
         ONLY ELAPSED DAYS
      ===================================================== */

      const startDate = parseDateStr(start);
      const calculationEndDate =
        parseDateStr(calculationEnd);

      let totalDays = 0;
      let sundays = 0;
      let holidays = 0;

      for (
        let date = new Date(startDate);
        date <= calculationEndDate;
        date.setDate(date.getDate() + 1)
      ) {
        const dateStr =
          formatDateStr(date);

        totalDays += 1;

        if (isSunday(dateStr)) {
          sundays += 1;
        } else if (
          holidaySet.has(dateStr)
        ) {
          holidays += 1;
        }
      }

      const workingDays =
        totalDays - sundays - holidays;

      const calendar = {
        total: totalDays,
        sundays,
        holidays,
        workingDays,
      };

      /* =====================================================
         EMPLOYEE MTD STATS
         ONLY UNTIL TODAY
      ===================================================== */

      const employeeStats = employees.map(
        (employee) => {
          const records =
            attendanceByUser.get(
              employee.id
            ) || [];

          let empFullDays = 0;
          let empHalfDays = 0;
          let empAbsent = 0;
          let empLeave = 0;
          let empLate = 0;
          let empWorkedDays = 0;

          for (
            let date = new Date(startDate);
            date <= calculationEndDate;
            date.setDate(
              date.getDate() + 1
            )
          ) {
            const dateStr =
              formatDateStr(date);

            /*
             * Skip Sunday
             */

            if (isSunday(dateStr)) {
              continue;
            }

            /*
             * Skip holiday
             */

            if (holidaySet.has(dateStr)) {
              continue;
            }

            empWorkedDays += 1;

            const record =
              records.find(
                (row) =>
                  row.date === dateStr
              );

            if (isPaidLeave(record)) {
              empLeave += 1;
              continue;
            }

            if (isUnpaidLeave(record)) {
              empLeave += 1;
              continue;
            }

            if (isHalfDay(record)) {
              empHalfDays += 1;

              if (isLate(record)) {
                empLate += 1;
              }

              continue;
            }

            if (
              isPresentRecord(
                record,
                dateStr
              )
            ) {
              empFullDays += 1;

              if (isLate(record)) {
                empLate += 1;
              }

              continue;
            }

            /*
             * No record on an elapsed
             * working day = absent
             */

            empAbsent += 1;
          }

          const effectivePresent =
            empFullDays +
            empHalfDays * 0.5;

          /*
           * Attendance percentage:
           * Leaves are excluded.
           */

          const attendanceDenominator =
            effectivePresent +
            empAbsent;

          const attPct =
            attendanceDenominator > 0
              ? Math.round(
                  (effectivePresent /
                    attendanceDenominator) *
                    100
                )
              : 0;

          const todayRecord =
            getRecordForDate(
              employee.id,
              todayStr
            );

          const todayLoginTime =
            todayRecord?.check_in_time
              ? formatTime12Hour(
                  todayRecord.check_in_time
                )
              : null;

          const todayBreakMinutes =
            Number(
              todayRecord?.total_break_minutes ||
                0
            );

          return {
            ...employee,

            todayLoginTime,

            todayBreakMinutes,

            stats: {
              present: effectivePresent,

              fullDays: empFullDays,

              half: empHalfDays,

              absent: empAbsent,

              leave: empLeave,

              late: empLate,

              workingDays: empWorkedDays,

              attPct,
            },
          };
        }
      );

      /* =====================================================
         MONTHLY TOTALS
         FIXES NaN IN FRONTEND
      ===================================================== */

      const monthlyTotals =
        employeeStats.reduce(
          (totals, employee) => {
            totals.totalPresent +=
              Number(
                employee.stats.present || 0
              );

            totals.totalAbsent +=
              Number(
                employee.stats.absent || 0
              );

            totals.totalLate +=
              Number(
                employee.stats.late || 0
              );

            totals.totalLeave +=
              Number(
                employee.stats.leave || 0
              );

            totals.totalWorkingDays +=
              Number(
                employee.stats.workingDays || 0
              );

            return totals;
          },
          {
            totalPresent: 0,
            totalAbsent: 0,
            totalLate: 0,
            totalLeave: 0,
            totalWorkingDays: 0,
          }
        );

      /* =====================================================
         BRANCH STATS
      ===================================================== */

      const branchStatsMap = new Map();

      employeeStats.forEach(
        (employee) => {
          const branchName =
            employee.branch || "Unknown";

          if (
            !branchStatsMap.has(
              branchName
            )
          ) {
            branchStatsMap.set(
              branchName,
              {
                name: branchName,
                totalEmployees: 0,
                totalAttendanceUnits: 0,
              }
            );
          }

          const branchStat =
            branchStatsMap.get(
              branchName
            );

          branchStat.totalEmployees += 1;

          branchStat.totalAttendanceUnits +=
            Number(
              employee.stats.present || 0
            );
        }
      );

      const branchStats =
        [...branchStatsMap.values()].map(
          (branch) => ({
            ...branch,

            attendancePercentage:
              branch.totalEmployees > 0 &&
              workingDays > 0
                ? Math.round(
                    (
                      branch.totalAttendanceUnits /
                      (
                        branch.totalEmployees *
                        workingDays
                      )
                    ) *
                      100
                  )
                : 0,
          })
        );

      /* =====================================================
         DAILY TREND
         ONLY ELAPSED DAYS
      ===================================================== */

      const dailySummary = [];

      for (
        let date = new Date(startDate);
        date <= calculationEndDate;
        date.setDate(
          date.getDate() + 1
        )
      ) {
        const dateStr =
          formatDateStr(date);

        if (
          isSunday(dateStr) ||
          holidaySet.has(dateStr)
        ) {
          continue;
        }

        let dayPresent = 0;
        let dayLate = 0;
        let dayAbsent = 0;

        employees.forEach(
          (employee) => {
            const record =
              getRecordForDate(
                employee.id,
                dateStr
              );

            if (
              isLeaveRecord(record)
            ) {
              return;
            }

            if (
              isHalfDay(record)
            ) {
              dayPresent += 0.5;

              if (isLate(record)) {
                dayLate += 1;
              }

              return;
            }

            if (
              isPresentRecord(
                record,
                dateStr
              )
            ) {
              dayPresent += 1;

              if (isLate(record)) {
                dayLate += 1;
              }

              return;
            }

            dayAbsent += 1;
          }
        );

        const dayNum =
          Number(
            dateStr.split("-")[2]
          );

        dailySummary.push({
          date: dateStr,
          day: dayNum,
          present: dayPresent,
          late: dayLate,
          absent: dayAbsent,
        });
      }

      /* =====================================================
         RESPONSE
      ===================================================== */

      res.json({
        summary,

        employees: employeeStats,

        /*
         * Frontend KPI totals
         */

        monthlyStats: monthlyTotals,

        /*
         * Keep individual employee stats
         * if frontend needs them
         */

        employeeMonthlyStats:
          Object.fromEntries(
            employeeStats.map(
              (employee) => [
                employee.id,
                employee.stats,
              ]
            )
          ),

        calendar,

        branchStats,

        dailySummary,

        pendingLeaves:
          pendingLeaveItems.length,

        pendingLeaveItems:
          pendingLeaveItems.slice(0, 5),

        alerts: [],

        metadata: {
          start,
          end,

          calculationEnd,

          today: todayStr,

          branch:
            effectiveBranch || "all",
        },
      });
    } catch (err) {
      console.error(
        "Admin dashboard error:",
        err
      );

      res.status(500).json({
        message: err.message,
      });
    }
  }
);

// GET /api/admin/employees
router.get(
  "/admin/employees",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN"),
  async (req, res) => {
    try {
      const { status = "active" } = req.query;
      const effectiveBranch = isBranchRestrictedOperationalRole(req.user) ? req.user.branch
        : req.query.branch && req.query.branch !== "all" ? req.query.branch : null;
      let query = `SELECT id, full_name, role, department, branch FROM users WHERE role!='SUPER_ADMIN'`;
      const params = []; let idx = 1;
      if (effectiveBranch) { query += ` AND branch=$${idx}`; params.push(effectiveBranch); idx++; }
      if (status && status !== "all") { query += ` AND COALESCE(status, 'active')=$${idx}`; params.push(status); idx++; }
      query += ` ORDER BY full_name`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// GET /api/auth/me
router.get("/auth/me", verifyToken, async (req, res) => {
  try {
    const user = await pool.query(
      "SELECT id, full_name, email, role, branch, department FROM users WHERE id=$1",
      [req.user.id]
    );
    if (!user.rows.length) return res.status(404).json({ message: "User not found" });
    res.json(user.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/employees/list
router.get(
  "/employees/list",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN"),
  async (req, res) => {
    try {
      const { branch, status = "active" } = req.query;

      let query = `
        SELECT id, full_name, email, role, branch, department
        FROM users
        WHERE role != 'SUPER_ADMIN'
      `;

      const params = [];

      if (isBranchRestrictedOperationalRole(req.user)) {
        query += ` AND branch = $1`;
        params.push(req.user.branch);
      } else if (branch && branch !== "all") {
        query += ` AND branch = $1`;
        params.push(branch);
      }

      if (status && status !== "all") {
        query += ` AND COALESCE(status, 'active') = $${params.length + 1}`;
        params.push(status);
      }

      query += ` ORDER BY full_name ASC`;

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      console.error("GET /employees/list error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

console.log("✅ attendanceRoutes.js loaded — policy engine integrated");

export default router;
