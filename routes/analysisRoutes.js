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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { month = "2026-05", branch } = req.query;
      const eb = effectiveBranch(req.user, branch);

      const ck = cacheKey("summary", month, eb || "all");
      const cached = getCache(ck);
      if (cached) return res.json({ ...cached, _cached: true });

      const { start, end, year, month: monthNumber } = monthRange(month);
      const empParams = [];
      let branchFilter = "";
      if (eb) {
        empParams.push(eb);
        branchFilter = "AND branch = $1";
      }

      const [empRes, attRes, breakRes, holidayRes] = await Promise.all([
        pool.query(
          `SELECT id AS user_id, full_name, department, branch, role
           FROM users
           WHERE role != 'SUPER_ADMIN'
           ${branchFilter}
           ORDER BY full_name ASC`,
          empParams
        ),
        pool.query(
          `SELECT
             user_id,
             TO_CHAR(date,'YYYY-MM-DD') AS date,
             status, check_in_time, check_out_time,
             late_minutes, production_hours, total_break_minutes,
             half_day_slot, leave_type, leave_status,
             post_login_idle_minutes, misuse_of_time
           FROM attendance_records
           WHERE date BETWEEN $1::date AND $2::date`,
          [start, end]
        ),
        pool.query(
          `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                  SUM(COALESCE(duration_minutes, 0)) AS total_break_minutes
           FROM employee_breaks
           WHERE date BETWEEN $1::date AND $2::date
           GROUP BY user_id, date`,
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
      const breakMap = new Map(
        breakRes.rows.map((r) => [`${r.user_id}|${r.date}`, Number(r.total_break_minutes || 0)])
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
        `${month}-${String(index + 1).padStart(2, "0")}`
      );

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
          leave_days: 0,
        };
        let breakTotal = 0;
        let breakDays = 0;

        for (const dateStr of days) {
          const rec = attMap.get(`${emp.user_id}|${dateStr}`) || { date: dateStr };
          const computed = getComputedAttendanceStatus(rec, {
            dateStr,
            holidaySet,
            noRecordStatus: "absent",
          });

          if (computed.computed_status === "full_day") summary.full_days += 1;
          else if (computed.computed_status === "half_day") summary.half_days += 1;
          else if (computed.computed_status === "absent") summary.absent_days += 1;
          else if (computed.computed_status === "leave") summary.leave_days += 1;

          if (["full_day", "working", "in_progress"].includes(computed.computed_status)) {
            summary.present_days += 1;
          } else if (computed.computed_status === "half_day") {
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { userId, month } = req.query;
      if (!userId || !month)
        return res.status(400).json({ message: "userId and month required" });

      const ck = cacheKey("individual", userId, month);
      const cached = getCache(ck);
      if (cached) return res.json({ ...cached, _cached: true });

      const { start, end, year, month: m } = monthRange(month);

      // ── Security: MANAGER branch check ───────────────────────
      if (req.user.role === "MANAGER") {
        const check = await pool.query(
          `SELECT branch FROM users WHERE id = $1`, [userId]
        );
        if (!check.rows.length || check.rows[0].branch !== req.user.branch)
          return res.status(403).json({ message: "Cross-branch access denied" });
      }

      // ── Fire all 3 queries in parallel ───────────────────────
      const [attRows, breakRows, holidayRows] = await Promise.all([
        pool.query(
          `SELECT
             TO_CHAR(date,'YYYY-MM-DD') AS date,
             check_in_time, check_out_time, status,
             late_minutes, production_hours,
             total_break_minutes, half_day_slot,
             leave_type, leave_status,
             post_login_idle_minutes, misuse_of_time
           FROM attendance_records
           WHERE user_id = $1 AND date BETWEEN $2 AND $3
           ORDER BY date ASC`,
          [userId, start, end]
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
          `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
           FROM company_holidays
           WHERE EXTRACT(YEAR FROM date) = $1
             AND EXTRACT(MONTH FROM date) = $2`,
          [year, m]
        ),
      ]);

      // ── Build lookup maps (O(n) not O(n²)) ───────────────────
      const attMap = new Map(attRows.rows.map(r => [r.date, r]));
      const holidaySet = new Set(holidayRows.rows.map(r => r.date));

      // Group breaks by date
      const breakMap = new Map();
      for (const b of breakRows.rows) {
        if (!breakMap.has(b.date)) breakMap.set(b.date, {});
        breakMap.get(b.date)[b.break_type] = b;
      }

      // ── Build full month record array ─────────────────────────
      const lastDay = new Date(year, m, 0).getDate();
      const records = [];
      const todayStr = formatDateStr(new Date());

      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${month}-${String(d).padStart(2, "0")}`;
        const dow = new Date(dateStr).getDay();

        // Sunday
        if (dow === 0) {
          records.push(buildEmptyRecord(dateStr, "sunday")); continue;
        }
        // Holiday
        if (holidaySet.has(dateStr)) {
          records.push(buildEmptyRecord(dateStr, "holiday")); continue;
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
        const totalBreak = breakMins.b1 + breakMins.lunch + breakMins.b2 + breakMins.b3;

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
            total_break_minutes: totalBreak,
          },
          {
            dateStr,
            holidaySet,
            noRecordStatus: dateStr > todayStr ? "no_record" : "absent",
          }
        );

        records.push({
          date:      dateStr,
          checkIn,
          checkOut,
          status: computed.computed_status,
          computed_status: computed.computed_status,
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
        });
      }

      const result = { records: safeAnalysisRecords(records), month };
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
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
             ${branchFilter}`,
            empParams
          ),
          pool.query(
            `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                    status, check_in_time, check_out_time,
                    late_minutes, production_hours, total_break_minutes,
                    half_day_slot, leave_type, leave_status,
                    post_login_idle_minutes, misuse_of_time
             FROM attendance_records
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),
          pool.query(
            `SELECT user_id, TO_CHAR(date,'YYYY-MM-DD') AS date,
                    SUM(COALESCE(duration_minutes, 0)) AS total_break_minutes
             FROM employee_breaks
             WHERE date BETWEEN $1::date AND $2::date
             GROUP BY user_id, date`,
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
        const breakMap = new Map(
          breakRes.rows.map((r) => [`${r.user_id}|${r.date}`, Number(r.total_break_minutes || 0)])
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


