// routes/analysisRoutes.js
// ─────────────────────────────────────────────────────────────
// Enterprise Attendance Analysis API — Optimized
// All queries use indexes + materialized view
// ─────────────────────────────────────────────────────────────
import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { formatTime12Hour } from "../utils/timeFormat.js";
import { getComputedAttendanceStatus } from "../utils/computedAttendanceStatus.js";
import { formatDateStr } from "../utils/attendancePolicy.js";
import { calculateBreakMinutesFromRows } from "../utils/breakMinutes.js";
import { computeMonthSandwich } from "../utils/sandwichEngine.js";

const router = express.Router();

// ── In-memory cache (replace with Redis if you add it later) ─
const cache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

function cacheKey(...args) { return args.join("|"); }

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  // Prevent unbounded growth
  if (cache.size > 500) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 100)
      .map(e => e[0]);
    oldest.forEach(k => cache.delete(k));
  }
}

function invalidateCache(pattern) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

// ── Helper: branch guard ──────────────────────────────────────
function effectiveBranch(user, queryBranch) {
  if (user.role === "MANAGER") return user.branch;
  if (queryBranch && queryBranch !== "all") return queryBranch;
  return null;
}

// ── Helper: month date range ──────────────────────────────────
function monthRange(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, year: y, month: m };
}

function shiftDate(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return formatDateStr(date);
}

function normalizedAttendanceStatusSql(alias = "a") {
  return `COALESCE(${alias}.status, 'absent')`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isLateLoginRecord(rec = {}) {
  const minutes = timeToMinutes(rec.checkIn ?? rec.check_in_time);
  return minutes !== null && minutes >= 10 * 60 + 15;
}

function safeAnalysisRecord(rec) {
  return {
    ...rec,
    date: rec?.date || "",
    status: rec?.status || "absent",
    checkIn: rec?.checkIn ?? rec?.check_in_time ?? "--",
    checkOut: rec?.checkOut ?? rec?.check_out_time ?? "--",
    lateMinutes: Number(rec?.lateMinutes ?? rec?.late_minutes ?? 0) || 0,
    workHours: parseFloat(rec?.workHours ?? rec?.production_hours) || 0,
    breaks: Number(rec?.breaks ?? rec?.total_break_minutes ?? 0) || 0,
    breakMins: {
      b1: Number(rec?.breakMins?.b1) || 0,
      lunch: Number(rec?.breakMins?.lunch) || 0,
      b2: Number(rec?.breakMins?.b2) || 0,
      b3: Number(rec?.breakMins?.b3) || 0,
      b3Count: Number(rec?.breakMins?.b3Count) || 0,
      b3History: Array.isArray(rec?.breakMins?.b3History) ? rec.breakMins.b3History : [],
    },
    breakDetails: {
      b1: {
        in: rec?.breakDetails?.b1?.in || "--",
        out: rec?.breakDetails?.b1?.out || "--",
      },
      lunch: {
        in: rec?.breakDetails?.lunch?.in || "--",
        out: rec?.breakDetails?.lunch?.out || "--",
      },
      b2: {
        in: rec?.breakDetails?.b2?.in || "--",
        out: rec?.breakDetails?.b2?.out || "--",
      },
      b3: {
        in: rec?.breakDetails?.b3?.in || "--",
        out: rec?.breakDetails?.b3?.out || "--",
      },
    },
  };
}

function safeAnalysisRecords(records = []) {
  return (records || []).filter(Boolean).map(safeAnalysisRecord);
}

// ══════════════════════════════════════════════════════════════
// GET /api/attendance-analysis/summary
// Returns branch-level KPIs + per-employee stats for one month
// Uses materialized view → typically <50ms
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// GET /api/attendance-analysis/summary
// Returns branch-level KPIs + per-employee stats for one month
// Includes employees with ZERO attendance records
// ══════════════════════════════════════════════════════════════
router.get(
  "/attendance-analysis/summary",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      console.log('=== SUMMARY API CALLED ===', req.query);
      const { month = "2026-05", branch } = req.query;
      const eb = effectiveBranch(req.user, branch);

      const ck = cacheKey("summary", month, eb || "all");
      const cached = getCache(ck);
      // Temporarily disable cache to force fresh data
      // if (cached) return res.json({ ...cached, _cached: true });

      const { start, end, year, month: monthNumber } = monthRange(month);
      const contextStart = shiftDate(start, -2);
      const contextEnd = shiftDate(end, 1);
      const empParams = [];
      let branchFilter = "";
      if (eb) {
        empParams.push(eb);
        branchFilter = "AND branch = $1";
      }

      const [empRes, attRes, breakRes, holidayRes, awiRes, leaveRes] = await Promise.all([
        pool.query(
          `SELECT id AS user_id, full_name, department, branch, role
           FROM users
           WHERE role != 'SUPER_ADMIN'
           AND status = 'active'
           ${branchFilter}
           ORDER BY full_name ASC`,
          empParams
        ),
        pool.query(
          `SELECT
             a.user_id,
             TO_CHAR(a.date,'YYYY-MM-DD') AS date,
             a.status, a.check_in_time, a.check_out_time,
             a.late_minutes, a.production_hours, a.total_break_minutes,
             a.half_day_slot, a.leave_type, a.leave_status,
             lr.leave_duration_type, lr.status AS leave_request_status,
             a.post_login_idle_minutes, a.misuse_of_time
           FROM attendance_records a
           LEFT JOIN leave_requests lr ON lr.id = a.leave_request_id
           WHERE a.date BETWEEN $1::date AND $2::date`,
          [start, end]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                  break_type, start_time, end_time, duration_minutes, break3_sessions
           FROM employee_breaks
           WHERE date BETWEEN $1::date AND $2::date`,
          [start, end]
        ),
        pool.query(
          `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
           FROM company_holidays
           WHERE date BETWEEN $1::date AND $2::date`,
          [start, end]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date, final_status
           FROM awi_cases
           WHERE date BETWEEN $1::date AND $2::date
           AND final_status IN ('authorized_absence', 'unauthorized_absence')`,
          [contextStart, contextEnd]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(lr.from_date,'YYYY-MM-DD') AS date, lr.status, lr.leave_type
           FROM leave_requests lr
           WHERE lr.from_date BETWEEN $1::date AND $2::date
           AND lr.status = 'approved'`,
          [contextStart, contextEnd]
        ),
      ]);

      const holidaySet = new Set(holidayRes.rows.map((r) => r.date));
      const breakRowsByKey = new Map();
      for (const row of breakRes.rows) {
        const key = `${row.user_id}|${row.date}`;
        if (!breakRowsByKey.has(key)) breakRowsByKey.set(key, []);
        breakRowsByKey.get(key).push(row);
      }
      const breakMap = new Map(
        Array.from(breakRowsByKey.entries()).map(([key, rows]) => [key, calculateBreakMinutesFromRows(rows)])
      );
      const awiMap = new Map();
      for (const row of awiRes.rows) {
        const key = `${row.user_id}|${row.date}`;
        awiMap.set(key, row.final_status);
      }
      const leaveMap = new Map();
      for (const row of leaveRes.rows) {
        const key = `${row.user_id}|${row.date}`;
        leaveMap.set(key, { status: row.status, leave_type: row.leave_type });
      }
      const attMap = new Map();
      for (const row of attRes.rows) {
        const key = `${row.user_id}|${row.date}`;
        attMap.set(key, {
          ...row,
          total_break_minutes: breakMap.get(key) ?? Number(row.total_break_minutes || 0),
        });
      }

      const days = Array.from({ length: new Date(year, monthNumber, 0).getDate() }, (_, index) =>
        `${month}-${String(index + 1).padStart(2, "0")}`
      );

      // Create holiday map once (outside employee loop for performance)
      const holidayMap = new Map(holidayRes.rows.map(h => [h.date, { type: 'holiday' }]));
      const todayStr = new Date().toISOString().split('T')[0];

      const employees = empRes.rows.map((emp) => {
        const summary = {
          user_id: emp.user_id,
          full_name: emp.full_name,
          department: emp.department,
          branch: emp.branch,
          full_days: 0,
          half_days: 0,
          present_days: 0,
          late_days: 0,
          avg_break_mins: 0,
          break_exceeded_days: 0,
          absent_days: 0,
          no_record_days: 0,
          leave_days: 0,
          paid_leave_days: 0,
          unpaid_leave_days: 0,
          unpaid_leaves_combined: 0, // unpaid_leave + absent + no_record
          sandwich_sundays: 0,
          authorized_awi_days: 0, // authorized_absence (1 day absent)
          unauthorized_absent_days: 0, // unauthorized_absence (1+1)
          paid_sundays: 0,
          unpaid_sundays: 0,
          holidays: 0,
        };
        let breakTotal = 0;
        let breakDays = 0;

        // Build attendance map for this employee for sandwich calculation
        // Include ALL days in the month (with empty records for no attendance)
        const empAttMap = new Map();
        for (const dateStr of days) {
          const rec = attMap.get(`${emp.user_id}|${dateStr}`);
          if (rec) {
            empAttMap.set(dateStr, rec);
          } else {
            // Add empty record for days without attendance
            empAttMap.set(dateStr, { date: dateStr });
          }
        }

        // NEW SANDWICH POLICY IMPLEMENTATION
        // 1. Find all leaves on Saturday (day 6) and Monday (day 1)
        // 2. First occurrence: Sunday remains paid
        // 3. Second+ occurrence: Sunday becomes unpaid (LOP)
        const unpaidSundays = new Set();
        const qualifyingLeaves = [];

        // Collect all qualifying leaves (Saturday/Monday leaves + AWI + Absent + No Record)
        for (const dateStr of days) {
          const dow = new Date(dateStr).getDay();
          const awiKey = `${emp.user_id}|${dateStr}`;
          const leaveKey = `${emp.user_id}|${dateStr}`;
          const attKey = `${emp.user_id}|${dateStr}`;

          // Check for AWI
          if (awiMap.has(awiKey)) {
            qualifyingLeaves.push({ date: dateStr, dow, type: 'AWI' });
          }
          // Check for approved leave on Saturday or Monday
          else if ((dow === 6 || dow === 1) && leaveMap.has(leaveKey)) {
            qualifyingLeaves.push({ date: dateStr, dow, type: 'LEAVE' });
          }
          // Check for regular absence on Saturday or Monday
          else if ((dow === 6 || dow === 1) && attMap.has(attKey)) {
            const attRec = attMap.get(attKey);
            if (attRec.status === 'absent') {
              qualifyingLeaves.push({ date: dateStr, dow, type: 'ABSENCE' });
            }
          }
          // Check for no record on Saturday or Monday
          else if ((dow === 6 || dow === 1) && !attMap.has(attKey)) {
            qualifyingLeaves.push({ date: dateStr, dow, type: 'NO_RECORD' });
          }
        }

        // Sort qualifying leaves by date
        qualifyingLeaves.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Track Sundays affected by each qualifying leave
        const affectedSundays = new Map(); // Sunday date -> count of qualifying occurrences

        for (const leave of qualifyingLeaves) {
          const leaveDate = new Date(leave.date);
          const leaveDow = leaveDate.getDay();

          // If leave is on Saturday (day 6), check Sunday (day 0, which is leaveDate + 1)
          if (leaveDow === 6) {
            const sundayDate = new Date(leaveDate);
            sundayDate.setDate(sundayDate.getDate() + 1);
            const sundayStr = formatDateStr(sundayDate);
            if (sundayStr.startsWith(month)) {
              affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
            }
          }
          // If leave is on Monday (day 1), check Sunday (day 0, which is leaveDate - 1)
          else if (leaveDow === 1) {
            const sundayDate = new Date(leaveDate);
            sundayDate.setDate(sundayDate.getDate() - 1);
            const sundayStr = formatDateStr(sundayDate);
            if (sundayStr.startsWith(month)) {
              affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
            }
          }
        }

        // Mark Sundays as unpaid if they have 2+ qualifying occurrences
        for (const [sundayStr, count] of affectedSundays.entries()) {
          if (count >= 2) {
            unpaidSundays.add(sundayStr);
          }
        }

        if (emp.user_id === 46 || emp.full_name === 'SRIKANTH') {
          console.log(`[SUMMARY] ${emp.full_name} (ID: ${emp.user_id}) - ALL AWI Cases:`, Array.from(awiMap.entries()).filter(([k]) => k.startsWith(emp.user_id + '|')));
          console.log(`[SUMMARY] ${emp.full_name} - ALL Leave Requests:`, Array.from(leaveMap.entries()).filter(([k]) => k.startsWith(emp.user_id + '|')));
          console.log(`[SUMMARY] ${emp.full_name} - Qualifying Leaves:`, qualifyingLeaves);
          console.log(`[SUMMARY] ${emp.full_name} - Affected Sundays:`, Array.from(affectedSundays.entries()));
          console.log(`[SUMMARY] ${emp.full_name} - Unpaid Sundays:`, Array.from(unpaidSundays));
          console.log(`[SUMMARY] ${emp.full_name} - Total Sundays in month:`, days.filter(d => new Date(d).getDay() === 0).length);
        }

        summary.sandwich_sundays = unpaidSundays.size;

        // Count total Sundays
        const totalSundays = days.filter(dateStr => new Date(dateStr).getDay() === 0).length;

        // Paid Sundays = Total Sundays - Sandwich Sundays
        summary.paid_sundays = totalSundays - summary.sandwich_sundays;

        // Count AWI cases directly from awiMap (even if no attendance records exist)
        for (const dateStr of days) {
          const awiKey = `${emp.user_id}|${dateStr}`;
          const awiStatus = awiMap.get(awiKey);
          if (awiStatus === 'authorized_absence') {
            summary.authorized_awi_days += 1;
          } else if (awiStatus === 'unauthorized_absence') {
            summary.unauthorized_absent_days += 1;
          }
        }

        for (const dateStr of days) {
          const rec = attMap.get(`${emp.user_id}|${dateStr}`) || { date: dateStr };
          const computed = getComputedAttendanceStatus(rec, {
            dateStr,
            holidaySet,
            noRecordStatus: "absent",
            halfDayLeaveAsNoRecord: true,
          });

          // Check if there's an AWI case for this day that overrides the computed status
          const awiStatus = awiMap.get(`${emp.user_id}|${dateStr}`);
          let finalStatus = computed.computed_status;
          if (awiStatus === 'authorized_absence' || awiStatus === 'unauthorized_absent') {
            finalStatus = awiStatus;
          }

          // NEW: If no record, no AWI, no leave request, and not Sunday/holiday → treat as unauthorized AWI
          else if (!attMap.has(`${emp.user_id}|${dateStr}`) && !awiStatus && !leaveMap.has(`${emp.user_id}|${dateStr}`)) {
            const dow = new Date(dateStr).getDay();
            if (dow !== 0 && !holidaySet.has(dateStr)) {
              finalStatus = 'unauthorized_absence';
            }
          }

          if (finalStatus === "full_day") summary.full_days += 1;
          else if (finalStatus === "half_day") summary.half_days += 1;
          else if (finalStatus === "absent") summary.absent_days += 1;
          else if (finalStatus === "no_record") summary.no_record_days += 1;
          else if (finalStatus === "paid_leave") {
            summary.paid_leave_days += 1;
            summary.leave_days += 1;
          } else if (finalStatus === "unpaid_leave") {
            summary.unpaid_leave_days += 1;
            summary.leave_days += 1;
          } else if (finalStatus === "leave") {
            summary.leave_days += 1;
          } else if (finalStatus === "authorized_absence") {
            summary.authorized_awi_days += 1;
          } else if (finalStatus === "unauthorized_absence") {
            summary.unauthorized_absent_days += 1;
          } else if (computed.computed_status === "holiday") {
            summary.holidays += 1;
          }

          // Calculate unpaid leaves combined (unpaid + absent + no_record)
          summary.unpaid_leaves_combined = summary.unpaid_leave_days + summary.absent_days + summary.no_record_days;

          if (["full_day", "working", "in_progress"].includes(finalStatus)) {
            summary.present_days += 1;
          } else if (finalStatus === "half_day") {
            summary.present_days += 0.5;
          }
          if (isLateLoginRecord(rec)) summary.late_days += 1;
          if (Number(computed.total_break_minutes || 0) > 0) {
            breakTotal += Number(computed.total_break_minutes || 0);
            breakDays += 1;
          }
          if (Number(computed.total_break_minutes || 0) > 60) summary.break_exceeded_days += 1;
        }

        summary.avg_break_mins = breakDays ? Math.round(breakTotal / breakDays) : 0;
        
        // Debug logging for final counts
        console.log(`[SUMMARY] ${emp.full_name} (ID: ${emp.user_id}) - Final counts:`, {
          full_days: summary.full_days,
          half_days: summary.half_days,
          absent_days: summary.absent_days,
          no_record_days: summary.no_record_days,
          authorized_awi_days: summary.authorized_awi_days,
          unauthorized_absent_days: summary.unauthorized_absent_days,
          paid_leave_days: summary.paid_leave_days,
          unpaid_leave_days: summary.unpaid_leave_days,
        });
        
        return summary;
      });

      const kpi = {
        total_employees: employees.length,
        total_present: employees.reduce(
          (s, e) => s + Number(e.present_days || 0),
          0
        ),
        total_late: employees.reduce(
          (s, e) => s + Number(e.late_days || 0),
          0
        ),
        total_exceeded: employees.reduce(
          (s, e) => s + Number(e.break_exceeded_days || 0),
          0
        ),
        total_paid_leave: employees.reduce((s, e) => s + Number(e.paid_leave_days || 0), 0),
        total_unpaid_leave: employees.reduce((s, e) => s + Number(e.unpaid_leave_days || 0), 0),
        total_leave: employees.reduce((s, e) => s + Number(e.leave_days || 0), 0),
        total_authorized_awi: employees.reduce((s, e) => s + Number(e.authorized_awi_days || 0), 0),
        total_unauthorized_absent: employees.reduce((s, e) => s + Number(e.unauthorized_absent_days || 0), 0),
        total_paid_sundays: employees.reduce((s, e) => s + Number(e.paid_sundays || 0), 0),
        total_unpaid_sundays: employees.reduce((s, e) => s + Number(e.unpaid_sundays || 0), 0),
        total_holidays: employees.reduce((s, e) => s + Number(e.holidays || 0), 0),
        avg_break: employees.length
          ? Math.round(
              employees.reduce(
                (s, e) => s + Number(e.avg_break_mins || 0),
                0
              ) / employees.length
            )
          : 0,
      };

      const result = {
        kpi,
        employees,
        month,
        generatedAt: new Date().toISOString(),
      };

      setCache(ck, result);
      res.json(result);
    } catch (err) {
      console.error("summary error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);
// ══════════════════════════════════════════════════════════════
// GET /api/attendance-analysis/individual
// Single employee full month data — attendance + breaks merged
// Uses indexed queries → typically <30ms
// ══════════════════════════════════════════════════════════════
router.get(
  "/attendance-analysis/individual",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { userId, month } = req.query;
      if (!userId || !month)
        return res.status(400).json({ message: "userId and month required" });

      const ck = cacheKey("individual", userId, month);
      const cached = getCache(ck);
      // Temporarily disable cache to force fresh data
      // if (cached) return res.json({ ...cached, _cached: true });

      const { start, end, year, month: m } = monthRange(month);
      const contextStart = shiftDate(start, -2);
      const contextEnd = shiftDate(end, 1);

      // ── Security: MANAGER branch check ───────────────────────
      if (req.user.role === "MANAGER") {
        const check = await pool.query(
          `SELECT branch FROM users WHERE id = $1`, [userId]
        );
        if (!check.rows.length || check.rows[0].branch !== req.user.branch)
          return res.status(403).json({ message: "Cross-branch access denied" });
      }

      // ── Fetch attendance context plus the displayed month data ──
      const [attRows, breakRows, holidayRows, awiRows, leaveRows, userRows] = await Promise.all([
        pool.query(
          `SELECT
             TO_CHAR(a.date,'YYYY-MM-DD') AS date,
             a.check_in_time, a.check_out_time, a.status,
             a.late_minutes, a.production_hours,
             a.total_break_minutes, a.half_day_slot,
             a.is_paid_leave, a.leave_type, a.leave_status,
             lr.leave_duration_type, lr.status AS leave_request_status,
             a.post_login_idle_minutes, a.misuse_of_time
           FROM attendance_records a
           LEFT JOIN leave_requests lr ON lr.id = a.leave_request_id
           WHERE a.user_id = $1 AND a.date BETWEEN $2 AND $3
           ORDER BY a.date ASC`,
          [userId, contextStart, contextEnd]
        ),
        pool.query(
          `SELECT
             TO_CHAR(date,'YYYY-MM-DD') AS date,
             break_type, start_time, end_time, duration_minutes, break3_sessions
           FROM employee_breaks
           WHERE user_id = $1 AND date BETWEEN $2 AND $3
           ORDER BY date ASC, break_type ASC`,
          [userId, start, end]
        ),
        pool.query(
          `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, type, name
           FROM company_holidays
           WHERE date BETWEEN $1 AND $2
             AND (branch = 'all' OR branch = (SELECT branch FROM users WHERE id = $3))
           ORDER BY date`,
          [contextStart, contextEnd, userId]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date, final_status
           FROM awi_cases
           WHERE user_id = $1 AND date BETWEEN $2 AND $3
           AND final_status IN ('authorized_absence', 'unauthorized_absence')`,
          [userId, start, end]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(from_date,'YYYY-MM-DD') AS date, status, leave_type
           FROM leave_requests
           WHERE user_id = $1 AND from_date BETWEEN $2 AND $3
           AND status = 'approved'`,
          [userId, start, end]
        ),
        pool.query(
          `SELECT id, full_name, joining_date, branch, department, role
           FROM users WHERE id = $1`,
          [userId]
        )
      ]);

      // ── Build lookup maps (O(n) not O(n²)) ───────────────────
      const attMap = new Map(attRows.rows.map(r => [r.date, r]));
      const holidaySet = new Set(holidayRows.rows.map(r => r.date));
      const holidayMap = new Map(holidayRows.rows.map(r => [r.date, { type: r.type, name: r.name }]));
      const awiMap = new Map(awiRows.rows.map(r => [r.date, r.final_status]));
      const leaveMap = new Map(leaveRows.rows.map(r => [r.date, { status: r.status, leave_type: r.leave_type }]));
      const joiningDate = userRows.rows[0]?.joining_date || null;

      // Add virtual attendance records for AWI days (for sandwich calculation)
      for (const [date, awiStatus] of awiMap.entries()) {
        if (!attMap.has(date)) {
          attMap.set(date, {
            date,
            status: awiStatus,
            check_in_time: null,
            check_out_time: null,
            attendance_status: awiStatus
          });
        }
      }

      // Build complete attMap with ALL days in the month (for sandwich calculation)
      const sandwichLastDay = new Date(year, m, 0).getDate();
      const days = [];
      for (let d = 1; d <= sandwichLastDay; d++) {
        days.push(`${month}-${String(d).padStart(2, "0")}`);
      }

      const completeAttMap = new Map();
      for (const dateStr of days) {
        const rec = attMap.get(dateStr);
        if (rec) {
          completeAttMap.set(dateStr, rec);
        } else {
          // Add empty record for days without attendance
          completeAttMap.set(dateStr, { date: dateStr });
        }
      }

      // NEW SANDWICH POLICY IMPLEMENTATION (same as summary endpoint)
      const unpaidSundays = new Set();
      const qualifyingLeaves = [];

      // Collect all qualifying leaves (Saturday/Monday leaves + AWI + Absent + No Record)
      for (const dateStr of days) {
        const dow = new Date(dateStr).getDay();

        // Check for AWI
        if (awiMap.has(dateStr)) {
          qualifyingLeaves.push({ date: dateStr, dow, type: 'AWI' });
        }
        // Check for actual attendance on Saturday or Monday (has check-in/check-out)
        else if ((dow === 6 || dow === 1) && attMap.has(dateStr)) {
          const attRec = attMap.get(dateStr);
          // If employee has actual attendance (check-in AND check-out)
          if (attRec.check_in_time && attRec.check_out_time) {
            // Special case: Saturday half-day with check-out BEFORE 7 PM is a qualifying event
            if (dow === 6 && attRec.status === 'half_day') {
              const checkOutTime = attRec.check_out_time; // Format: "HH:MM:SS"
              const [hours] = checkOutTime.split(':').map(Number);
              // If check-out is before 7 PM (19:00), it's a qualifying event
              if (hours < 19) {
                qualifyingLeaves.push({ date: dateStr, dow, type: 'HALF_DAY_EARLY' });
                continue;
              }
            }
            // Special case: Monday with check-in AFTER 10:30 AM is a qualifying event
            if (dow === 1) {
              const checkInTime = attRec.check_in_time; // Format: "HH:MM:SS"
              const [hours, minutes] = checkInTime.split(':').map(Number);
              // If check-in is after 10:30 AM (10:30:00), it's a qualifying event
              if (hours > 10 || (hours === 10 && minutes > 30)) {
                qualifyingLeaves.push({ date: dateStr, dow, type: 'LATE_LOGIN' });
                continue;
              }
            }
            // Employee worked (full day or late Saturday/Monday) - not a qualifying event
            continue;
          }
          // If employee has only check-in but no check-out, treat as NOT worked (qualifying event)
          // This handles cases like "Absent with check-in" where employee didn't complete the day
          if (attRec.check_in_time && !attRec.check_out_time) {
            qualifyingLeaves.push({ date: dateStr, dow, type: 'ABSENCE' });
          }
          // If status is absent, count as qualifying event
          else if (attRec.status === 'absent') {
            qualifyingLeaves.push({ date: dateStr, dow, type: 'ABSENCE' });
          }
        }
        // Check for approved leave on Saturday or Monday
        // Count as qualifying event if no actual work (no check-in/check-out)
        else if ((dow === 6 || dow === 1) && leaveMap.has(dateStr)) {
          if (!attMap.has(dateStr)) {
            // No attendance record = qualifying event
            qualifyingLeaves.push({ date: dateStr, dow, type: 'LEAVE' });
          } else {
            // Has attendance record - check if actual work was done
            const attRec = attMap.get(dateStr);
            if (!attRec.check_in_time || !attRec.check_out_time) {
              // No actual work = qualifying event (even if status is "On Leave")
              qualifyingLeaves.push({ date: dateStr, dow, type: 'LEAVE' });
            }
            // If employee has check-in AND check-out, they worked - not qualifying event
          }
        }
        // Check for no record on Saturday or Monday
        else if ((dow === 6 || dow === 1) && !attMap.has(dateStr)) {
          qualifyingLeaves.push({ date: dateStr, dow, type: 'NO_RECORD' });
        }
      }

      // Sort qualifying leaves by date
      qualifyingLeaves.sort((a, b) => new Date(a.date) - new Date(b.date));

      // Track Sundays affected by each qualifying leave
      const affectedSundays = new Map(); // Sunday date -> count of qualifying occurrences

      for (const leave of qualifyingLeaves) {
        const leaveDate = new Date(leave.date);
        const leaveDow = leaveDate.getDay();

        // If leave is on Saturday (day 6), check Sunday (day 0, which is leaveDate + 1)
        if (leaveDow === 6) {
          const sundayDate = new Date(leaveDate);
          sundayDate.setDate(sundayDate.getDate() + 1);
          const sundayStr = formatDateStr(sundayDate);
          if (sundayStr.startsWith(month)) {
            affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
          }
        }
        // If leave is on Monday (day 1), check Sunday (day 0, which is leaveDate - 1)
        else if (leaveDow === 1) {
          const sundayDate = new Date(leaveDate);
          sundayDate.setDate(sundayDate.getDate() - 1);
          const sundayStr = formatDateStr(sundayDate);
          if (sundayStr.startsWith(month)) {
            affectedSundays.set(sundayStr, (affectedSundays.get(sundayStr) || 0) + 1);
          }
        }
      }

      // Now recalculate qualifying events for Sunday analysis table
      // This checks actual attendance status to determine if it's a qualifying event
      // Only count qualifying events from the payroll month (not previous/next month)
      const sundayQualifyingEvents = new Map();
      for (const [sundayStr, count] of affectedSundays.entries()) {
        const sundayDate = new Date(sundayStr);
        const saturdayBefore = new Date(sundayDate);
        saturdayBefore.setDate(saturdayBefore.getDate() - 1);
        const saturdayStr = formatDateStr(saturdayBefore);

        const mondayAfter = new Date(sundayDate);
        mondayAfter.setDate(mondayAfter.getDate() + 1);
        const mondayStr = formatDateStr(mondayAfter);

        let qualifyingCount = 0;

        // Check Saturday - only if it's in the same month
        if (saturdayStr.startsWith(month)) {
          if (awiMap.has(saturdayStr)) {
            qualifyingCount++;
          } else if (attMap.has(saturdayStr)) {
            const attRec = attMap.get(saturdayStr);
            // If employee has check-in AND check-out AND status is half_day
            // Check if check-out is BEFORE 7 PM (19:00) to qualify as qualifying event
            if (attRec.check_in_time && attRec.check_out_time && attRec.status === 'half_day') {
              const checkOutTime = attRec.check_out_time; // Format: "HH:MM:SS"
              const [hours] = checkOutTime.split(':').map(Number);
              // If check-out is before 7 PM (19:00), it's a qualifying event
              if (hours < 19) {
                qualifyingCount++;
              }
              // If check-out is after 7 PM, it's not a qualifying event (worked)
            }
            // If employee has check-in AND check-out but NOT half_day, they worked (not qualifying event)
            else if (attRec.check_in_time && attRec.check_out_time) {
              // Not a qualifying event
            }
            // If employee has only check-in but no check-out, treat as NOT worked (qualifying event)
            else if (attRec.check_in_time && !attRec.check_out_time) {
              qualifyingCount++;
            }
            // If status is absent, count as qualifying event
            else if (attRec.status === 'absent') {
              qualifyingCount++;
            }
            // If status is half_day without check-in/check-out, treat as qualifying event
            else if (attRec.status === 'half_day') {
              qualifyingCount++;
            }
          } else if (leaveMap.has(saturdayStr)) {
            qualifyingCount++;
          } else {
            // No record = qualifying event
            qualifyingCount++;
          }
        }

        // Check Monday - only if it's in the same month
        if (mondayStr.startsWith(month)) {
          if (awiMap.has(mondayStr)) {
            qualifyingCount++;
          } else if (attMap.has(mondayStr)) {
            const attRec = attMap.get(mondayStr);
            // If employee has check-in AND check-out
            // Check if check-in is AFTER 10:30 AM to qualify as qualifying event
            if (attRec.check_in_time && attRec.check_out_time) {
              const checkInTime = attRec.check_in_time; // Format: "HH:MM:SS"
              const [hours, minutes] = checkInTime.split(':').map(Number);
              // If check-in is after 10:30 AM (10:30:00), it's a qualifying event
              if (hours > 10 || (hours === 10 && minutes > 30)) {
                qualifyingCount++;
              }
              // If check-in is before or at 10:30 AM, it's not a qualifying event (worked)
            }
            // If employee has only check-in but no check-out, treat as NOT worked (qualifying event)
            else if (attRec.check_in_time && !attRec.check_out_time) {
              qualifyingCount++;
            }
            // If status is absent, count as qualifying event
            else if (attRec.status === 'absent') {
              qualifyingCount++;
            }
            // If status is half_day without check-in/check-out, treat as qualifying event
            else if (attRec.status === 'half_day') {
              qualifyingCount++;
            }
          } else if (leaveMap.has(mondayStr)) {
            qualifyingCount++;
          } else {
            // No record = qualifying event
            qualifyingCount++;
          }
        }

        sundayQualifyingEvents.set(sundayStr, qualifyingCount);
      }

      // Mark Sundays as unpaid using allowance pool system (same as frontend)
      // - First Sunday with 1 qualifying event = Paid (allowance)
      // - Subsequent Sundays with 1 qualifying event = Unpaid (no allowance)
      // - Sundays with 2+ qualifying events = Unpaid
      let firstOneEventSundayPaid = false;

      // Sort Sundays by date to identify the first one
      const sortedSundays = Array.from(affectedSundays.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      // Add ALL Sundays (including those with 0 qualifying events) for complete analysis
      const allSundays = [];
      for (let d = 1; d <= sandwichLastDay; d++) {
        const dateStr = `${month}-${String(d).padStart(2, "0")}`;
        const dow = new Date(dateStr).getDay();
        if (dow === 0) {
          allSundays.push(dateStr);
        }
      }
      allSundays.sort();

      // Detailed logging for Sunday analysis
      if (parseInt(userId) === 31 || parseInt(userId) === 24 || parseInt(userId) === 46 || parseInt(userId) === 37) {
        console.log(`\n════════════════════════════════════════════════════════════════════`);
        console.log(`[SUNDAY ANALYSIS] Employee ID ${userId} - Month ${month}`);
        console.log(`════════════════════════════════════════════════════════════════════`);
        console.log(`| Sunday   | Saturday Before | Monday After  | Qualifying Events | Status |`);
        console.log(`|----------|------------------|----------------|-------------------|---------|`);
      }

      for (const sundayStr of allSundays) {
        const count = affectedSundays.get(sundayStr) || 0;
        const sundayDate = new Date(sundayStr);
        const saturdayBefore = new Date(sundayDate);
        saturdayBefore.setDate(saturdayBefore.getDate() - 1);
        const saturdayStr = formatDateStr(saturdayBefore);

        const mondayAfter = new Date(sundayDate);
        mondayAfter.setDate(mondayAfter.getDate() + 1);
        const mondayStr = formatDateStr(mondayAfter);

        // Get Saturday status
        let saturdayStatus = "present";
        if (awiMap.has(saturdayStr)) {
          saturdayStatus = "AWI";
        } else if (attMap.has(saturdayStr)) {
          const attRec = attMap.get(saturdayStr);
          if (attRec.check_in_time && attRec.check_out_time) {
            // Check if it's a half-day with early check-out (before 7 PM)
            if (attRec.status === 'half_day') {
              const checkOutTime = attRec.check_out_time;
              const [hours] = checkOutTime.split(':').map(Number);
              if (hours < 19) {
                saturdayStatus = "half_day_early (qualifying)";
              } else {
                saturdayStatus = "worked";
              }
            } else {
              // Employee worked - not a qualifying event
              saturdayStatus = "worked";
            }
          } else if (attRec.status === 'absent') {
            saturdayStatus = "absent";
          } else {
            saturdayStatus = "no_record";
          }
        } else if (leaveMap.has(saturdayStr)) {
          saturdayStatus = "leave";
        } else {
          saturdayStatus = "no_record";
        }

        // Get Monday status
        let mondayStatus = "present";
        if (awiMap.has(mondayStr)) {
          mondayStatus = "AWI";
        } else if (attMap.has(mondayStr)) {
          const attRec = attMap.get(mondayStr);
          if (attRec.check_in_time && attRec.check_out_time) {
            // Employee worked - not a qualifying event
            mondayStatus = "worked";
          } else if (attRec.status === 'absent') {
            mondayStatus = "absent";
          } else {
            mondayStatus = "no_record";
          }
        } else if (leaveMap.has(mondayStr)) {
          mondayStatus = "leave";
        } else {
          mondayStatus = "no_record";
        }

        // Use recalculated qualifying count (actual attendance check)
        const actualQualifyingCount = sundayQualifyingEvents.get(sundayStr) || count;

        let status = "Paid";
        if (actualQualifyingCount >= 2) {
          // 2+ qualifying events = unpaid
          unpaidSundays.add(sundayStr);
          status = "Unpaid (2+ events)";
        } else if (actualQualifyingCount === 1) {
          // 1 qualifying event
          if (!firstOneEventSundayPaid) {
            // First Sunday with 1 event = paid (allowance)
            firstOneEventSundayPaid = true;
            status = "Paid (first one-event)";
          } else {
            // Subsequent Sundays with 1 event = unpaid (no allowance)
            unpaidSundays.add(sundayStr);
            status = "Unpaid (subsequent one-event)";
          }
        } else {
          // count === 0 = paid (no action needed)
          status = "Paid (0 events)";
        }

        if (parseInt(userId) === 31 || parseInt(userId) === 24 || parseInt(userId) === 46 || parseInt(userId) === 37) {
          console.log(`| ${sundayStr} | ${saturdayStr.padEnd(16)} | ${mondayStr.padEnd(14)} | ${actualQualifyingCount.toString().padEnd(17)} | ${status.padEnd(7)} |`);
        }
      }

      if (parseInt(userId) === 31 || parseInt(userId) === 24 || parseInt(userId) === 46 || parseInt(userId) === 37) {
        console.log(`════════════════════════════════════════════════════════════════════\n`);
      }

      if (parseInt(userId) === 31 || parseInt(userId) === 24 || parseInt(userId) === 46 || parseInt(userId) === 37) {
        console.log(`[INDIVIDUAL] Employee ID ${userId} - ALL AWI Cases:`, Array.from(awiMap.entries()));
        console.log(`[INDIVIDUAL] Employee ID ${userId} - ALL Leave Requests:`, Array.from(leaveMap.entries()));
        console.log(`[INDIVIDUAL] Employee ID ${userId} - Qualifying Leaves:`, qualifyingLeaves);
        console.log(`[INDIVIDUAL] Employee ID ${userId} - Affected Sundays:`, Array.from(affectedSundays.entries()));
        console.log(`[INDIVIDUAL] Employee ID ${userId} - Unpaid Sundays:`, Array.from(unpaidSundays));
      }

      // Build sandwichByDate map for Sunday records
      const sandwichByDate = new Map();
      for (const dateStr of days) {
        const dow = new Date(dateStr).getDay();
        if (dow === 0) {
          sandwichByDate.set(dateStr, {
            date: dateStr,
            anchorType: 'SUNDAY',
            isSandwich: unpaidSundays.has(dateStr)
          });
        }
      }

      // Group breaks by date
      const breakMap = new Map();
      for (const b of breakRows.rows) {
        if (!breakMap.has(b.date)) breakMap.set(b.date, {});
        breakMap.get(b.date)[b.break_type] = b;
      }

      // ── Build full month record array ─────────────────────────
      const records = [];
      const todayStr = formatDateStr(new Date());

      for (let d = 1; d <= sandwichLastDay; d++) {
        const dateStr = `${month}-${String(d).padStart(2, "0")}`;
        const dow = new Date(dateStr).getDay();

        // Sunday
        if (dow === 0) {
          const sandwichResult = sandwichByDate.get(dateStr);
          records.push({
            date: dateStr,
            checkIn: "--",
            checkOut: "--",
            status: "sunday",
            computed_status: "sunday",
            display_status: sandwichResult?.isSandwich ? "Unpaid Sunday" : "Paid Sunday",
            policy_status: null,
            policy_reason: null,
            lateMinutes: 0,
            workHours: 0,
            productionHours: 0,
            breaks: 0,
            breakMins: { b1: 0, lunch: 0, b2: 0, b3: 0, b3Count: 0, b3History: [] },
            breakDetails: { b1: { in: null, out: null }, lunch: { in: null, out: null }, b2: { in: null, out: null }, b3: { in: null, out: null } },
            half_day_slot: null,
            leave_duration_type: null,
            leave_request_status: null,
            is_paid_leave: null,
            leave_type: null,
            leave_request_id: null,
            sandwich_results: sandwichResult ? [sandwichResult] : [],
            sandwich_rule_applied: sandwichResult?.isSandwich || false,
          });
          continue;
        }
        // Holiday
        if (holidaySet.has(dateStr)) {
          records.push(buildEmptyRecord(dateStr, "holiday")); continue;
        }

        // Check if there's an AWI case for this day - AWI status ALWAYS overrides attendance status
        const awiStatus = awiMap.get(dateStr);
        if (awiStatus) {
          // Create a record for the AWI day (regardless of whether attendance record exists)
          records.push({
            date: dateStr,
            checkIn: "--",
            checkOut: "--",
            status: awiStatus,
            computed_status: awiStatus,
            display_status: awiStatus === 'authorized_absence' ? 'Authorized AWI' : 'Unauthorized Absent',
            policy_status: null,
            policy_reason: null,
            lateMinutes: 0,
            workHours: 0,
            productionHours: 0,
            breaks: 0,
            breakMins: { b1: 0, lunch: 0, b2: 0, b3: 0, b3Count: 0, b3History: [] },
            breakDetails: { b1: { in: null, out: null }, lunch: { in: null, out: null }, b2: { in: null, out: null }, b3: { in: null, out: null } },
            half_day_slot: null,
            leave_duration_type: null,
            leave_request_status: null,
            is_paid_leave: null,
            leave_type: null,
            leave_request_id: null,
            sandwich_results: sandwichByDate.get(dateStr) ? [sandwichByDate.get(dateStr)] : [],
            sandwich_rule_applied: sandwichByDate.get(dateStr)?.isSandwich || false,
          });
          continue;
        }

        // If no attendance record, no AWI, no leave request, and not Sunday/holiday → treat as absent
        const hasAttRecord = attMap.has(dateStr);
        const hasAwi = awiStatus && (awiStatus === 'authorized_absence' || awiStatus === 'unauthorized_absence');
        const hasLeave = leaveMap.has(dateStr);
        
        if (!hasAttRecord && !hasAwi && !hasLeave) {
          const dow = new Date(dateStr).getDay();
          if (dow !== 0 && !holidaySet.has(dateStr)) {
            records.push({
              date: dateStr,
              checkIn: "--",
              checkOut: "--",
              status: 'absent',
              computed_status: 'absent',
              display_status: 'Absent',
              policy_status: null,
              policy_reason: null,
              lateMinutes: 0,
              workHours: 0,
              productionHours: 0,
              breaks: 0,
              breakMins: { b1: 0, lunch: 0, b2: 0, b3: 0, b3Count: 0, b3History: [] },
              breakDetails: { b1: { in: null, out: null }, lunch: { in: null, out: null }, b2: { in: null, out: null }, b3: { in: null, out: null } },
              half_day_slot: null,
              leave_duration_type: null,
              leave_request_status: null,
              is_paid_leave: null,
              leave_type: null,
              leave_request_id: null,
              sandwich_results: sandwichByDate.get(dateStr) ? [sandwichByDate.get(dateStr)] : [],
              sandwich_rule_applied: sandwichByDate.get(dateStr)?.isSandwich || false,
            });
            continue;
          }
        }

        const att = attMap.get(dateStr);
        const dayBreaks = breakMap.get(dateStr) || {};

        const rawCheckIn  = att?.check_in_time  ? att.check_in_time.slice(0,5)  : "--";
        const rawCheckOut = att?.check_out_time ? att.check_out_time.slice(0,5) : "--";
        const checkIn = formatTime12Hour(rawCheckIn);
        const checkOut = formatTime12Hour(rawCheckOut);

        const b1    = dayBreaks.break1 || {};
        const lunch = dayBreaks.lunch  || {};
        const b2    = dayBreaks.break2 || {};
        const b3    = dayBreaks.break3 || {};
        const break3Sessions = Array.isArray(b3.break3_sessions) ? b3.break3_sessions : [];

        const breakMins = {
          b1:    b1.duration_minutes    || 0,
          lunch: lunch.duration_minutes || 0,
          b2:    b2.duration_minutes    || 0,
          b3:    b3.duration_minutes    || 0,
          b3Count: break3Sessions.length,
          b3History: break3Sessions,
        };
        const totalBreak = calculateBreakMinutesFromRows(Object.values(dayBreaks));

        let workHours = 0;
        if (rawCheckIn !== "--" && rawCheckOut !== "--") {
          const [ih, im] = rawCheckIn.split(":").map(Number);
          const [oh, om] = rawCheckOut.split(":").map(Number);
          workHours = Math.max(0, ((oh * 60 + om) - (ih * 60 + im)) / 60);
        }

        const computed = getComputedAttendanceStatus(
          {
            ...(att || {}),
            date: dateStr,
            break1_in: b1.start_time,
            break1_out: b1.end_time,
            lunch_in: lunch.start_time,
            lunch_out: lunch.end_time,
            break2_in: b2.start_time,
            break2_out: b2.end_time,
            break3_in: b3.start_time,
            break3_out: b3.end_time,
            break3_duration_minutes: b3.duration_minutes,
            break3_sessions: b3.break3_sessions,
            total_break_minutes: totalBreak,
          },
          {
            dateStr,
            holidaySet,
            noRecordStatus: dateStr > todayStr ? "no_record" : "absent",
            halfDayLeaveAsNoRecord: true,
          }
        );

        // Override status with AWI status if it exists
        let finalStatus = computed.computed_status;
        if (awiStatus === 'authorized_absence' || awiStatus === 'unauthorized_absent') {
          finalStatus = awiStatus;
        }

        records.push({
          date:      dateStr,
          checkIn,
          checkOut,
          status: finalStatus,
          computed_status: finalStatus,
          display_status: computed.display_status,
          policy_status: computed.policy_status,
          policy_reason: computed.policy_reason,
          lateMinutes: computed.late_minutes || 0,
          workHours: computed.production_hours || workHours,
          productionHours: computed.production_hours || workHours,
          breaks: computed.total_break_minutes || totalBreak,
          breakMins,
          breakDetails: {
            b1:    { in: fmtT(b1.start_time),    out: fmtT(b1.end_time)    },
            lunch: { in: fmtT(lunch.start_time),  out: fmtT(lunch.end_time) },
            b2:    { in: fmtT(b2.start_time),     out: fmtT(b2.end_time)    },
            b3:    { in: fmtT(b3.start_time),     out: fmtT(b3.end_time)    },
          },
          // Add raw attendance fields for frontend status determination
          half_day_slot: att?.half_day_slot || null,
          leave_duration_type: att?.leave_duration_type || null,
          leave_request_status: att?.leave_request_status || att?.leave_status || null,
          is_paid_leave: att?.is_paid_leave || null,
          leave_type: att?.leave_type || null,
          leave_request_id: att?.leave_request_id || null,
          // Add sandwich results for calendar display
          sandwich_results: sandwichByDate.get(dateStr) ? [sandwichByDate.get(dateStr)] : [],
          sandwich_rule_applied: sandwichByDate.get(dateStr)?.isSandwich === true,
        });
      }

      const result = {
        records: safeAnalysisRecords(records),
        contextRecords: attRows.rows,
        holidays: holidayRows.rows,
        joiningDate: userRows.rows[0]?.joining_date || null,
        month,
      };
      setCache(ck, result);
      res.json(result);
    } catch (err) {
      console.error("individual error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// GET /api/attendance-analysis/trends
// 6-month trend data for charts — cached aggressively
// ══════════════════════════════════════════════════════════════
router.get(
  "/attendance-analysis/trends",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { branch, months = 6 } = req.query;
      const eb = effectiveBranch(req.user, branch);
      const ck = cacheKey("trends", eb || "all", months);
      const cached = getCache(ck);
      if (cached) return res.json({ ...cached, _cached: true });

      const monthCount = Math.max(1, parseInt(months, 10) || 6);
      const now = new Date();
      const monthLabels = Array.from({ length: monthCount }, (_, index) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      });

      const trends = [];
      for (const label of monthLabels) {
        const { start, end, year, month: monthNumber } = monthRange(label);
        const empParams = [];
        let branchFilter = "";
        if (eb) {
          empParams.push(eb);
          branchFilter = "AND branch = $1";
        }

        const [empRes, attRes, breakRes, holidayRes] = await Promise.all([
          pool.query(
            `SELECT id AS user_id
             FROM users
             WHERE role != 'SUPER_ADMIN'
             AND status = 'active'
             ${branchFilter}`,
            empParams
          ),
          pool.query(
            `SELECT a.user_id, TO_CHAR(a.date,'YYYY-MM-DD') AS date,
                    a.status, a.check_in_time, a.check_out_time,
                    a.late_minutes, a.production_hours, a.total_break_minutes,
                    a.half_day_slot, a.leave_type, a.leave_status,
                    lr.leave_duration_type, lr.status AS leave_request_status,
                    a.post_login_idle_minutes, a.misuse_of_time
             FROM attendance_records a
             LEFT JOIN leave_requests lr ON lr.id = a.leave_request_id
             WHERE a.date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),
          pool.query(
            `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                    break_type, start_time, end_time, duration_minutes, break3_sessions
             FROM employee_breaks
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),
          pool.query(
            `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
             FROM company_holidays
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),
        ]);

        const holidaySet = new Set(holidayRes.rows.map((r) => r.date));
        const breakRowsByKey = new Map();
        for (const row of breakRes.rows) {
          const key = `${row.user_id}|${row.date}`;
          if (!breakRowsByKey.has(key)) breakRowsByKey.set(key, []);
          breakRowsByKey.get(key).push(row);
        }
        const breakMap = new Map(
          Array.from(breakRowsByKey.entries()).map(([key, rows]) => [key, calculateBreakMinutesFromRows(rows)])
        );
        const attMap = new Map();
        for (const row of attRes.rows) {
          const key = `${row.user_id}|${row.date}`;
          attMap.set(key, {
            ...row,
            total_break_minutes: breakMap.get(key) ?? Number(row.total_break_minutes || 0),
          });
        }

        const days = Array.from({ length: new Date(year, monthNumber, 0).getDate() }, (_, index) =>
          `${label}-${String(index + 1).padStart(2, "0")}`
        );
        const trend = { month: label, present: 0, absent: 0, leave: 0, late: 0, avg_break: 0, exceeded: 0 };
        let breakTotal = 0;
        let breakDays = 0;

        for (const emp of empRes.rows) {
          for (const dateStr of days) {
            const rec = attMap.get(`${emp.user_id}|${dateStr}`) || { date: dateStr };
            const computed = getComputedAttendanceStatus(rec, {
              dateStr,
              holidaySet,
              noRecordStatus: "absent",
              halfDayLeaveAsNoRecord: true,
            });
            if (["full_day", "working", "in_progress"].includes(computed.computed_status)) {
              trend.present += 1;
            } else if (computed.computed_status === "half_day") {
              trend.present += 0.5;
            } else if (computed.computed_status === "leave") {
              trend.leave += 1;
            } else if (computed.computed_status === "absent") {
              trend.absent += 1;
            }
            if (isLateLoginRecord(rec)) trend.late += 1;
            if (Number(computed.total_break_minutes || 0) > 0) {
              breakTotal += Number(computed.total_break_minutes || 0);
              breakDays += 1;
            }
            if (Number(computed.total_break_minutes || 0) > 60) trend.exceeded += 1;
          }
        }

        trend.avg_break = breakDays ? Math.round(breakTotal / breakDays) : 0;
        trends.push(trend);
      }

      const data = { trends };
      setCache(ck, data);
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// POST /api/attendance-analysis/invalidate-cache
// Call this after checkin/checkout/break updates
// ══════════════════════════════════════════════════════════════
router.post(
  "/attendance-analysis/invalidate-cache",
  verifyToken,
  async (req, res) => {
    const { userId, month } = req.body;
    invalidateCache("summary");
    if (userId && month) invalidateCache(`individual|${userId}|${month}`);
    res.json({ message: "Cache invalidated" });
  }
);

// ── Helpers ───────────────────────────────────────────────────
function buildEmptyRecord(dateStr, status) {
  return {
    date: dateStr, checkIn: "--", checkOut: "--",
    status, lateMinutes: 0, workHours: 0,
    breaks: 0,
    breakMins:    { b1: 0, lunch: 0, b2: 0, b3: 0 },
    breakDetails: {
      b1:    { in: "—", out: "—" },
      lunch: { in: "—", out: "—" },
      b2:    { in: "—", out: "—" },
      b3:    { in: "—", out: "—" },
    },
    // Add empty values for consistency
    half_day_slot: null,
    is_paid_leave: null,
    leave_type: null,
    leave_request_id: null,
  };
}

function fmtT(t) {
  if (!t) return "—";
  const s = String(t).slice(0, 5);
  const [h, mi] = s.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(mi).padStart(2,"0")} ${ampm}`;
}

// ── Cache invalidation export (call from checkin/checkout routes) ─
export { invalidateCache };
export default router;
