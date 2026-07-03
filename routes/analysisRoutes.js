// routes/analysisRoutes.js
// ─────────────────────────────────────────────────────────────
// Enterprise Attendance Analysis API — Optimized
// All queries use indexes + materialized view
// ─────────────────────────────────────────────────────────────
import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { formatTime12Hour } from "../utils/timeFormat.js";

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

function normalizeAttendanceStatus(att) {
  return att?.status || "absent";
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
      const daysInSelectedMonth = new Date(year, monthNumber, 0).getDate();

      const params = [start, end];
      let branchFilter = "";
      let daysParamIndex = 3;

      if (eb) {
        params.push(eb);
        branchFilter = "AND branch = $3";
        daysParamIndex = 4;
      }

      params.push(daysInSelectedMonth);

      const attAggQ = `
        WITH emp AS (
          SELECT id, full_name, department, branch, role
          FROM users
          WHERE role != 'SUPER_ADMIN'
          ${branchFilter}
        ),
       att AS (
  SELECT
    a.user_id,
    COUNT(*) FILTER (
      WHERE ${normalizedAttendanceStatusSql("a")} = 'full_day' OR ${normalizedAttendanceStatusSql("a")} = 'present'
    ) AS full_days,

    COUNT(*) FILTER (
      WHERE ${normalizedAttendanceStatusSql("a")} = 'half_day'
    ) AS half_days,

    COUNT(*) FILTER (
      WHERE a.check_in_time >= TIME '10:15:00'
        AND a.check_in_time < TIME '10:30:00'
    ) AS late_days,

    COALESCE(
      ROUND(AVG(COALESCE(br.total_break_minutes, 0))),
      0
    ) AS avg_break_mins,

    COUNT(*) FILTER (
      WHERE COALESCE(br.total_break_minutes, 0) > 60
    ) AS break_exceeded_days

  FROM attendance_records a

  LEFT JOIN (
    SELECT
      user_id,
      date,
      SUM(COALESCE(duration_minutes, 0)) AS total_break_minutes
    FROM employee_breaks
    WHERE date BETWEEN $1::date AND $2::date
    GROUP BY user_id, date
  ) br
    ON br.user_id = a.user_id
   AND br.date = a.date

  WHERE a.date BETWEEN $1::date AND $2::date
  GROUP BY a.user_id
)
        SELECT
          emp.id AS user_id,
          emp.full_name,
          emp.department,
          emp.branch,
          COALESCE(att.full_days,0) AS full_days,
          COALESCE(att.half_days,0) AS half_days,
          COALESCE(att.full_days,0) + COALESCE(att.half_days,0) AS present_days,
          COALESCE(att.late_days,0) AS late_days,
          COALESCE(att.avg_break_mins,0) AS avg_break_mins,
          COALESCE(att.break_exceeded_days,0) AS break_exceeded_days,
          GREATEST(
            $${daysParamIndex} - (COALESCE(att.full_days,0) + COALESCE(att.half_days,0)),
            0
          ) AS absent_days
        FROM emp
        LEFT JOIN att ON att.user_id = emp.id
        ORDER BY emp.full_name ASC
      `;

      const empRes = await pool.query(attAggQ, params);

      const kpi = {
        total_employees: empRes.rows.length,
        total_present: empRes.rows.reduce(
          (s, e) => s + Number(e.present_days || 0),
          0
        ),
        total_late: empRes.rows.reduce(
          (s, e) => s + Number(e.late_days || 0),
          0
        ),
        total_exceeded: empRes.rows.reduce(
          (s, e) => s + Number(e.break_exceeded_days || 0),
          0
        ),
        avg_break: empRes.rows.length
          ? Math.round(
              empRes.rows.reduce(
                (s, e) => s + Number(e.avg_break_mins || 0),
                0
              ) / empRes.rows.length
            )
          : 0,
      };

      const result = {
        kpi,
        employees: empRes.rows,
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
             total_break_minutes
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
      const todayStr = new Date().toISOString().slice(0, 10);

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

        records.push({
          date:      dateStr,
          checkIn,
          checkOut,
          status:    att ? normalizeAttendanceStatus(att) : (dateStr > todayStr ? "no_record" : "absent"),
          lateMinutes: att?.late_minutes  || 0,
          workHours,
          breaks:    totalBreak,
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

      let q = `
        SELECT
          TO_CHAR(month_start, 'YYYY-MM')       AS month,
          SUM(full_days + half_days)             AS present,
          SUM(absent_days)                       AS absent,
          SUM(late_days)                         AS late,
          ROUND(AVG(avg_break_mins))             AS avg_break,
          SUM(break_exceeded_days)               AS exceeded
        FROM mv_monthly_attendance
        WHERE month_start >= DATE_TRUNC('month', NOW()) - INTERVAL '${parseInt(months) - 1} months'
      `;
      const p = [];
      if (eb) { q += ` AND branch = $1`; p.push(eb); }
      q += ` GROUP BY month_start ORDER BY month_start ASC`;

      const result = await pool.query(q, p);
      const data = { trends: result.rows };
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


