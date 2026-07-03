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
} from "../utils/attendancePolicy.js";

const router = express.Router();
const OFFICE_END_TIME = "19:00:00";

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

function mapPolicyBucketToStatus(bucket) {
  return policyBucketStatusMap[bucket] || "absent";
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
  return (
    dateStr === todayLocalDateStr() &&
    Boolean(log?.office_in) &&
    !log?.office_out &&
    !hasOfficeEndPassed()
  );
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
    return {
      ...user,
      ...(att || {}),
      status: "in_progress",
      policy_bucket: "in_progress",
      policy_reason: "Checked in; attendance day still in progress",
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

  const policy = classifyDayPolicy({
    dateStr,
    log,
    holidaySet,
    monthlyLateStats,
    logsByDate: logsByDateExtended,
  });
  const status = mapPolicyBucketToStatus(policy.bucket);

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
    policy_bucket: policy.bucket,
    policy_reason: policy.reason,
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

/**
 * Re-classify and persist a single day using the policy engine.
 * Called after check-in, check-out, or break edits.
 */
async function recalcAttendanceForUserDate(userId, dateStr) {
  const [year, month] = dateStr.split("-").map(Number);
  const dim = daysInMonth(year, month);

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
    logsByDateExtended[dateStr] = log;
    if (dateStr >= monthStart && dateStr <= monthEnd) logsByDate[dateStr] = log;
  }
  const result = classifyDayPolicy({
    dateStr,
    log,
    holidaySet,
    monthlyLateStats,
    logsByDate: logsByDateExtended,
  });

  const netMs    = log ? calculateNetWorkMillis(log) : 0;
  const breakMs  = log ? calculateBreakMillis(log) : 0;
  const netHours = netMs / 3_600_000;
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
  const halfDaySlot =
    result.bucket === "half_day"
      ? result.half_day_slot || "INVALID"
      : null;

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
      parseFloat(netHours.toFixed(2)),
      totalBreakMinutes,
      halfDaySlot,
      userId,
      dateStr,
    ]
  );
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

export { recalcAttendanceForUserDate };

async function recalcAttendanceForUserMonth(userId, year, month) {
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
    await recalcAttendanceForUserDate(userId, row.date);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 10 — API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// GET /api/my-attendance?month=YYYY-MM
// Returns current + next month logs (for cross-month Sunday edge cases).
// ───────────────────────────────────────────────────────────────────
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

    // Normalize to array sorted by date
    const rows = Object.values(logs).sort((a, b) => a.date.localeCompare(b.date));

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
    const today     = now.toISOString().slice(0, 10);
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
        const existing = await pool.query(
          `SELECT check_in_time FROM attendance_records WHERE user_id=$1 AND date=$2`,
          [userId, today]
        );
        if (existing.rows[0]?.check_in_time) {
          return res.status(400).json({ message: "Already checked in today" });
        }
        const lateMinutes = calculateLateMinutes(timeStr);
        await pool.query(
          `UPDATE attendance_records
           SET check_in_time=$1,
               check_out_time=NULL,
               status='present',
               late_minutes=$4,
               production_hours=0,
               total_break_minutes=0,
               half_day_slot=NULL,
               updated_at=CURRENT_TIMESTAMP
           WHERE user_id=$2 AND date=$3`,
          [timeStr, userId, today, lateMinutes]
        );

        // Notifications
        const attRow = await pool.query(
          `SELECT id FROM attendance_records WHERE user_id=$1 AND date=$2`,
          [userId, today]
        );
        const attId = attRow.rows[0]?.id;
        await notifyCheckin({ id: userId, full_name, branch, department }, timeStr, lateMinutes, attId);
        if (lateMinutes > 0) {
          await notifyLateLogin({ id: userId, full_name, branch, department }, lateMinutes, attId);
        }
        break;
      }

      case "office_out": {
        const existing = await pool.query(
          `SELECT check_in_time, check_out_time FROM attendance_records WHERE user_id=$1 AND date=$2`,
          [userId, today]
        );
        if (!existing.rows[0]?.check_in_time) {
          return res.status(400).json({ message: "Check in first" });
        }
        if (existing.rows[0]?.check_out_time) {
          return res.status(400).json({ message: "Already checked out" });
        }
        await pool.query(
          `UPDATE attendance_records SET check_out_time=$1 WHERE user_id=$2 AND date=$3`,
          [timeStr, userId, today]
        );
        await recalcAttendanceForUserDate(userId, today);

        const attRow = await pool.query(
          `SELECT id, production_hours FROM attendance_records WHERE user_id=$1 AND date=$2`,
          [userId, today]
        );
        await notifyCheckout(
          { id: userId, full_name, branch, department },
          timeStr,
          attRow.rows[0]?.production_hours || 0,
          attRow.rows[0]?.id
        );
        break;
      }

      // ── Named breaks via employee_breaks table ───────────────
      case "break_in":
      case "break_out": {
        const breakType = "break1";
        const col       = action === "break_in" ? "start_time" : "end_time";
        await pool.query(
          `INSERT INTO employee_breaks (user_id, date, break_type, ${col})
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, date, break_type) DO UPDATE SET ${col}=EXCLUDED.${col}`,
          [userId, today, breakType, timeStr]
        );
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      case "break_in_2":
      case "break_out_2": {
        const breakType = "break2";
        const col       = action === "break_in_2" ? "start_time" : "end_time";
        await pool.query(
          `INSERT INTO employee_breaks (user_id, date, break_type, ${col})
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, date, break_type) DO UPDATE SET ${col}=EXCLUDED.${col}`,
          [userId, today, breakType, timeStr]
        );
        await recalcAttendanceForUserDateIfFinal(userId, today);
        break;
      }

      case "lunch_in":
      case "lunch_out": {
        const col = action === "lunch_in" ? "start_time" : "end_time";
        await pool.query(
          `INSERT INTO employee_breaks (user_id, date, break_type, ${col})
           VALUES ($1,$2,'lunch',$3)
           ON CONFLICT (user_id, date, break_type) DO UPDATE SET ${col}=EXCLUDED.${col}`,
          [userId, today, timeStr]
        );
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
          COALESCE((
            SELECT SUM(COALESCE(b.duration_minutes, 0))
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
            SELECT SUM(COALESCE(b.duration_minutes, 0))
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
    let lateCount = 0;

    for (const user of usersResult.rows) {
      const row = await classifyAttendanceForResponse(
        user,
        date,
        attMap.get(user.user_id),
        holidaySet
      );
      if (["full_day", "half_day", "leave", "in_progress", "working"].includes(row.status)) {
        present += 1;
      }
      if (row.late_login_status === "Late") lateCount += 1;
    }

    const attendanceRate = totalEmployees > 0
      ? Math.round((present / totalEmployees) * 100) : 0;

    res.json({
      attendanceRate: isSunday || isHoliday ? 100 : attendanceRate,
      dailyPresent: present,
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
    const today   = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8);

    const userRes = await pool.query(
      `SELECT branch, department, full_name FROM users WHERE id=$1`, [userId]
    );
    if (!userRes.rows.length) return res.status(404).json({ message: "User not found" });
    const { branch, department, full_name } = userRes.rows[0];

    const existing = await pool.query(
      `SELECT check_in_time FROM attendance_records WHERE user_id=$1 AND date=$2`,
      [userId, today]
    );
    if (existing.rows.length && existing.rows[0].check_in_time) {
      return res.status(400).json({ message: "Already checked in today" });
    }

    const lateMinutes = calculateLateMinutes(timeStr);

    await pool.query(
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
         updated_at=CURRENT_TIMESTAMP`,
      [userId, today, timeStr, branch, department, lateMinutes]
    );

    const attRow = await pool.query(
      `SELECT id FROM attendance_records WHERE user_id=$1 AND date=$2`, [userId, today]
    );
    const attId = attRow.rows[0]?.id;
    await notifyCheckin({ id: userId, full_name, branch, department }, timeStr, lateMinutes, attId);
    if (lateMinutes > 0) {
      await notifyLateLogin({ id: userId, full_name, branch, department }, lateMinutes, attId);
    }

    invalidateCache("summary");
    invalidateCache(`individual|${userId}|${today.slice(0,7)}`);
    scheduleViewRefresh();

    const record = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id=$1 AND date=$2`, [userId, today]
    );
    res.json({ message: "Checked in", record: record.rows[0] });
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
    const today   = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8);

    const existing = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id=$1 AND date=$2`, [userId, today]
    );
    if (!existing.rows.length || !existing.rows[0].check_in_time) {
      return res.status(400).json({ message: "Check in first" });
    }
    if (existing.rows[0].check_out_time) {
      return res.status(400).json({ message: "Already checked out" });
    }

    await pool.query(
      `UPDATE attendance_records SET check_out_time=$1 WHERE user_id=$2 AND date=$3`,
      [timeStr, userId, today]
    );

    await recalcAttendanceForUserDate(userId, today);

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

    res.json({ message: "Checked out", record: record.rows[0] });
  } catch (err) {
    console.error("/attendance/checkout error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/self/today
router.get("/attendance/self/today", verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
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
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/self/history?start=&end=
router.get("/attendance/self/history", verifyToken, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ message: "start and end required" });
    const result = await pool.query(
      `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
              ar.check_in_time, ar.check_out_time, ${normalizedAttendanceStatusSql("ar")} AS status,
              ar.late_minutes, ar.production_hours, ar.total_break_minutes
       FROM attendance_records ar
       WHERE ar.user_id=$1 AND ar.date BETWEEN $2 AND $3
       ORDER BY ar.date ASC`,
      [req.user.id, start, end]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/range?start=&end=
router.get("/attendance/range", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: "start and end required" });
    }

    const effectiveBranch =
      isBranchRestrictedOperationalRole(req.user)
        ? req.user.branch
        : branch && branch !== "all"
        ? branch
        : null;

    let query = `
      SELECT
        u.id AS user_id,
        d.day::date AS date,
        ${normalizedAttendanceStatusSql("a")} AS status,
        COALESCE(a.late_minutes, 0) AS late_minutes,
        u.branch,
        u.department
      FROM generate_series($1::date, $2::date, interval '1 day') d(day)
      CROSS JOIN users u
      LEFT JOIN attendance_records a
        ON a.user_id = u.id
       AND a.date = d.day::date
      WHERE u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') = 'active'
    `;

    const params = [start, end];
    let idx = 3;

    if (effectiveBranch) {
      query += ` AND u.branch = $${idx}`;
      params.push(effectiveBranch);
      idx++;
    }

    query += ` ORDER BY d.day ASC, u.id ASC`;

    const result = await pool.query(query, params);

    res.json(
      result.rows.map((r) => ({
        ...r,
        date: r.date.toISOString
          ? r.date.toISOString().slice(0, 10)
          : String(r.date).slice(0, 10),
      }))
    );
  } catch (err) {
    console.error("GET /attendance/range error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/range/summary?start=&end=&branch=
router.get("/attendance/range/summary", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: "start and end required" });
    }

    const effectiveBranch =
      isBranchRestrictedOperationalRole(req.user)
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
    }

    const query = `
      SELECT
        TO_CHAR(d.day::date, 'YYYY-MM-DD') AS date,

        COUNT(u.id) AS total,

        COUNT(u.id) FILTER (
          WHERE ${normalizedAttendanceStatusSql("a")} = 'full_day'
        ) AS present,

        COUNT(u.id) FILTER (
          WHERE ${normalizedAttendanceStatusSql("a")} = 'half_day'
        ) AS half_day,

        COUNT(u.id) FILTER (
          WHERE ${normalizedAttendanceStatusSql("a")} = 'leave'
        ) AS leave,

        COUNT(u.id) FILTER (
          WHERE a.check_in_time >= TIME '10:15:00'
            AND a.check_in_time < TIME '10:30:00'
        ) AS late,

        COUNT(u.id) FILTER (
          WHERE ${normalizedAttendanceStatusSql("a")} = 'absent'
        ) AS absent

      FROM generate_series($1::date, $2::date, interval '1 day') d(day)

      CROSS JOIN users u

      LEFT JOIN attendance_records a
        ON a.user_id = u.id
       AND a.date = d.day::date

      WHERE u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') = 'active'
      ${branchCondition}

      GROUP BY d.day::date
      ORDER BY d.day::date ASC
    `;

    const result = await pool.query(query, params);

    res.json(
      result.rows.map((r) => ({
        date: r.date,
        present: Number(r.present) || 0,
        halfDay: Number(r.half_day) || 0,
        absent: Number(r.absent) || 0,
        leave: Number(r.leave) || 0,
        late: Number(r.late) || 0,
        total: Number(r.total) || 0,
      }))
    );
  } catch (err) {
    console.error("GET /attendance/range/summary error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/bulk-monthly
router.get("/attendance/bulk-monthly", verifyToken, async (req, res) => {
  try {
    const { start, end, branch } = req.query;
    if (!start || !end) return res.status(400).json({ message: "start and end required" });
    const effectiveBranch = isBranchRestrictedOperationalRole(req.user) ? req.user.branch
      : branch && branch !== "all" ? branch : null;

    let query = `
      SELECT a.user_id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
             a.status, a.late_minutes, a.check_in_time, a.check_out_time,
             a.production_hours, a.total_break_minutes
      FROM attendance_records a JOIN users u ON a.user_id=u.id
      WHERE a.date BETWEEN $1 AND $2 AND u.role!='SUPER_ADMIN'`;
    const params = [start, end]; let idx = 3;
    if (effectiveBranch) { query += ` AND u.branch=$${idx}`; params.push(effectiveBranch); }
    query += ` ORDER BY a.user_id, a.date ASC`;

    const result = await pool.query(query, params);
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.user_id]) grouped[row.user_id] = [];
      grouped[row.user_id].push(row);
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
        return res.status(400).json({ message: "userId and date are required" });
      }

      const reason = String(req.body.reason || "").trim();
      if (reason.length < 5) {
        return res.status(400).json({
          message: "Please enter a reason of at least 5 characters.",
        });
      }

      const hasBodyField = (name) => Object.prototype.hasOwnProperty.call(req.body, name);

      // Safely convert time strings. Empty values clear only the submitted field.
      const toTime = (v) =>
        v && v !== "--" && String(v).trim() !== "" ? String(v).trim() : null;

      const requestedTimes = {
        check_in_time: hasBodyField("check_in_time") ? toTime(req.body.check_in_time) : undefined,
        check_out_time: hasBodyField("check_out_time") ? toTime(req.body.check_out_time) : undefined,
        break1_in: hasBodyField("break1_in") ? toTime(req.body.break1_in) : undefined,
        break1_out: hasBodyField("break1_out") ? toTime(req.body.break1_out) : undefined,
        break2_in: hasBodyField("break2_in") ? toTime(req.body.break2_in) : undefined,
        break2_out: hasBodyField("break2_out") ? toTime(req.body.break2_out) : undefined,
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
      const manualStatus = req.body.status || null;   // null means auto-calculate
      const editSource = String(req.body.source || "").toLowerCase();

      const employeeRes = await client.query(
        `SELECT id, full_name, email, branch, department
         FROM users
         WHERE id = $1`,
        [userId]
      );
      if (!employeeRes.rows.length) {
        return res.status(404).json({ message: "User not found" });
      }
      const employee = employeeRes.rows[0];

      if (!canEditAttendance(req.user, employee)) {
        return res.status(403).json({
          message: "You can only edit attendance for employees in your permitted branch",
        });
      }

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

      const oldRes = await client.query(
        `SELECT id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                check_in_time, check_out_time, status
         FROM attendance_records
         WHERE user_id = $1 AND date = $2::date`,
        [userId, date]
      );
      const oldRecord = oldRes.rows[0] || null;
      const oldValues = {
        check_in_time: oldRecord?.check_in_time || null,
        check_out_time: oldRecord?.check_out_time || null,
        status: oldRecord?.status || null,
      };

      const breakRes = await client.query(
        `SELECT break_type, start_time, end_time
         FROM employee_breaks
         WHERE user_id = $1 AND date = $2::date
           AND break_type IN ('break1', 'break2', 'lunch')`,
        [userId, date]
      );
      const oldBreaks = new Map(breakRes.rows.map((row) => [row.break_type, row]));
      const oldBreakValues = {
        break1_in: oldBreaks.get("break1")?.start_time || null,
        break1_out: oldBreaks.get("break1")?.end_time || null,
        break2_in: oldBreaks.get("break2")?.start_time || null,
        break2_out: oldBreaks.get("break2")?.end_time || null,
        lunch_in: oldBreaks.get("lunch")?.start_time || null,
        lunch_out: oldBreaks.get("lunch")?.end_time || null,
      };
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

      await client.query("BEGIN");

      await client.query(
        `INSERT INTO attendance_history
           (original_attendance_id, date, employee_email, office_in, office_out,
            edited_by_email, edit_reason, snapshot_metadata)
         VALUES ($1, $2::date, $3, $4::time, $5::time, $6, $7, $8::jsonb)`,
        [
          oldRecord?.id || null,
          date,
          employee.email,
          oldValues.check_in_time,
          oldValues.check_out_time,
          req.user.email || req.user.full_name || "unknown",
          reason,
          JSON.stringify({
            oldValues: { ...oldValues, ...oldBreakValues },
            requestedValues: req.body,
          }),
        ]
      );

      // ── 1. Upsert main attendance record ─────────────────────
      await client.query(
        `INSERT INTO attendance_records
           (user_id, date, check_in_time, check_out_time, status,
            extra_break_ins, extra_break_outs)
         VALUES
           ($1, $2::date,
            $3::time,
            $4::time,
            'absent', '[]'::jsonb, '[]'::jsonb)
         ON CONFLICT (user_id, date) DO UPDATE SET
           check_in_time  = EXCLUDED.check_in_time,
           check_out_time = EXCLUDED.check_out_time,
           updated_at     = CURRENT_TIMESTAMP`,
        [userId, date, nextMainValues.check_in_time, nextMainValues.check_out_time]
      );

      const upsertBreak = async (breakType, inKey, outKey) => {
        if (requestedTimes[inKey] === undefined && requestedTimes[outKey] === undefined) return;
        const existing = oldBreaks.get(breakType) || {};
        const nextIn = requestedTimes[inKey] !== undefined ? requestedTimes[inKey] : existing.start_time || null;
        const nextOut = requestedTimes[outKey] !== undefined ? requestedTimes[outKey] : existing.end_time || null;

        await client.query(
          `INSERT INTO employee_breaks (user_id, date, break_type, start_time, end_time)
           VALUES ($1, $2::date, $3, $4::time, $5::time)
           ON CONFLICT (user_id, date, break_type) DO UPDATE SET
             start_time = EXCLUDED.start_time,
             end_time   = EXCLUDED.end_time`,
          [userId, date, breakType, nextIn, nextOut]
        );
      };

      await upsertBreak("break1", "break1_in", "break1_out");
      await upsertBreak("break2", "break2_in", "break2_out");
      await upsertBreak("lunch", "lunch_in", "lunch_out");

      await client.query("COMMIT");

      if (nextMainValues.check_in_time && nextMainValues.check_out_time) {
        const [editYear, editMonth] = date.split("-").map(Number);
        await recalcAttendanceForUserMonth(userId, editYear, editMonth);
      } else if (requestedTimes.check_in_time !== undefined) {
        await pool.query(
          `UPDATE attendance_records
           SET late_minutes = $1, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2 AND date = $3::date`,
          [calculateLateMinutes(nextMainValues.check_in_time), userId, date]
        );
      }

      // ── 6. If admin forced a status, override policy result ───
      if (manualStatus) {
        await pool.query(
          `UPDATE attendance_records SET status = $1 WHERE user_id = $2 AND date = $3`,
          [manualStatus, userId, date]
        );
      }

      // ── 7. Return updated record ──────────────────────────────
      const updated = await pool.query(
        `SELECT
           id, user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
           check_in_time, check_out_time,
           status, late_minutes, production_hours
         FROM attendance_records
         WHERE user_id = $1 AND date = $2::date`,
        [userId, date]
      );

      invalidateCache("summary");
      invalidateCache(`individual|${userId}|${date.slice(0, 7)}`);
      scheduleViewRefresh();

      const updatedRecord = updated.rows[0];
      const newValues = {
        check_in_time: updatedRecord?.check_in_time || null,
        check_out_time: updatedRecord?.check_out_time || null,
        status: updatedRecord?.status || null,
      };

      await logActivity({
        userId: editor.id,
        userName: editor.full_name || editor.email || "Unknown user",
        role: editor.role || req.user.role,
        action: "ATTENDANCE_EDITED",
        actionType: "attendance_changed",
        moduleName: editSource === "calendar" ? "Calendar Attendance Edit" : "Attendance",
        details: `Attendance edited for ${employee.full_name} (${employee.email}) on ${date}. Reason: ${reason}.`,
        ip: getClientIp(req),
        branch: employee.branch || req.user.branch || "all",
        department: employee.department || null,
        metadata: {
          editedBy: {
            id: editor.id,
            name: editor.full_name || editor.email || "Unknown user",
            email: editor.email || null,
            role: editor.role || req.user.role,
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
          editedRecordId: updatedRecord?.id || oldRecord?.id || null,
        },
      });

      await createNotification({
        userId,
        actionType: "attendance_update",
        relatedId: updatedRecord?.id || oldRecord?.id || null,
        targetRole: "EMPLOYEE",
        relatedDate: date,
        reason,
        description:
          `Attendance updated for ${date}. ` +
          `Status: ${newValues.status || "--"}, ` +
          `In: ${formatTime12Hour(newValues.check_in_time)}, ` +
          `Out: ${formatTime12Hour(newValues.check_out_time)}. ` +
          `Reason: ${reason}`,
      });

      res.json({
        message: "Attendance updated successfully",
        data: updatedRecord,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("PUT /attendance/:userId error:", err);
      res.status(500).json({ message: err.message });
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
      const records = await pool.query(
        `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date
         FROM attendance_records WHERE date BETWEEN $1 AND $2 ORDER BY date ASC`,
        [start, end]
      );
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

    for (const user of usersRes.rows) {
      const row = await classifyAttendanceForResponse(user, date, attMap.get(user.user_id), holidaySet);
      if (["full_day", "half_day", "leave", "in_progress", "working"].includes(row.status)) {
        presentMap.set(user.department, (presentMap.get(user.department) || 0) + 1);
      }
    }

    const leaderboard = [];
    for (const [dept, total] of deptTotals.entries()) {
      const present = presentMap.get(dept) || 0;
      leaderboard.push({
        name: dept,
        percent: total > 0 ? Math.round((present / total) * 100) : 0,
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
router.get("/attendance/employee/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ message: "start and end required" });

    const target = await pool.query("SELECT branch, role FROM users WHERE id=$1", [userId]);
    if (!target.rows.length) return res.status(404).json({ message: "User not found" });

    if (req.user.role === "EMPLOYEE" && req.user.id != userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (req.user.role === "MANAGER" && target.rows[0].branch !== req.user.branch) {
      return res.status(403).json({ message: "Cross-branch access denied" });
    }

    // FIX: explicit alias `ar` throughout; JOIN breaks for popup detail
    const result = await pool.query(
      `SELECT
         TO_CHAR(ar.date, 'YYYY-MM-DD')  AS date,
         ar.check_in_time,
         ar.check_out_time,
         ${normalizedAttendanceStatusSql("ar")} AS status,
         ar.late_minutes,
         ar.production_hours,
         ar.total_break_minutes,
         ar.is_paid_leave,
         lr.leave_type,
         lr.leave_category,
         lr.paid_days,
         b1.start_time   AS break1_in,
         b1.end_time     AS break1_out,
         b2.start_time   AS break2_in,
         b2.end_time     AS break2_out,
         ln.start_time   AS lunch_in,
         ln.end_time     AS lunch_out
       FROM attendance_records ar
       LEFT JOIN leave_requests lr
         ON lr.id = ar.leave_request_id
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
       WHERE ar.user_id = $1
         AND ar.date BETWEEN $2::date AND $3::date
       ORDER BY ar.date ASC`,
      [userId, start, end]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /attendance/employee/:userId error:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/attendance/user/:userId (super admin)
router.get(
  "/attendance/user/:userId",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ message: "start and end required" });
      const result = await pool.query(
        `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
                ar.check_in_time, ar.check_out_time, ${normalizedAttendanceStatusSql("ar")} AS status,
                ar.late_minutes, ar.production_hours, ar.total_break_minutes
         FROM attendance_records ar WHERE ar.user_id=$1 AND ar.date BETWEEN $2 AND $3 ORDER BY ar.date ASC`,
        [userId, start, end]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: err.message });
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
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
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
                a.production_hours, a.total_break_minutes
         FROM users u
         LEFT JOIN attendance_records a ON a.user_id=u.id AND a.date=$${idx}
         WHERE ${baseWhere}
         ORDER BY u.full_name ASC LIMIT $${idx+1} OFFSET $${idx+2}`,
        [...params, date, parseInt(limit), offset]
      ),
    ]);

    res.json({
      data: dataRes.rows.map((r) => ({
        ...r,
        status:              r.status              || "absent",
        late_minutes:        r.late_minutes        || 0,
        production_hours:    r.production_hours    || "0.00",
        total_break_minutes: r.total_break_minutes || 0,
      })),
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

    let query = `
      SELECT u.department AS name,
             UPPER(LEFT(REPLACE(u.department,' ',''),3)) AS code,
             COUNT(u.id) AS employees,
             SUM(CASE WHEN ${normalizedAttendanceStatusSql("a")} IN ('full_day','half_day','leave') THEN 1 ELSE 0 END) AS present,
             COUNT(u.id)-SUM(CASE WHEN ${normalizedAttendanceStatusSql("a")} IN ('full_day','half_day','leave') THEN 1 ELSE 0 END) AS absent,
             MAX(CASE WHEN u.role='MANAGER' THEN u.full_name ELSE NULL END) AS head
      FROM users u LEFT JOIN attendance_records a ON u.id=a.user_id AND a.date=$1
      WHERE u.department IS NOT NULL
        AND u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') = 'active'`;
    const params = [date]; let idx = 2;
    if (effectiveBranch) { query += ` AND u.branch=$${idx}`; params.push(effectiveBranch); idx++; }
    query += ` GROUP BY u.department ORDER BY u.department`;

    const result = await pool.query(query, params);
    res.json(result.rows.map((r) => ({
      name:      r.name,
      code:      r.code,
      employees: Number(r.employees),
      present:   Number(r.present),
      absent:    Number(r.absent),
      head:      r.head || "Not Assigned",
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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



