import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken } from "../middleware/auth.js";
import { calculateLateMinutes, evaluateLateLogin } from "../utils/attendancePolicy.js";
import { recalcAttendanceForUserDate } from "./attendanceRoutes.js";

const router = express.Router();
const STANDARD_BREAK_TYPES = ["break1", "lunch", "break2", "break3"];
const MAX_DAILY_BREAK_SESSIONS = 6;
const MAX_BREAK_MINUTES = 60;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getRequestedBreakTypes(breaks = {}) {
  const requested = STANDARD_BREAK_TYPES.filter((breakType) =>
    breakType === "break3"
      ? hasOwn(breaks, "break3") || hasOwn(breaks, "break3Sessions")
      : hasOwn(breaks, breakType)
  );
  return [...new Set(requested)];
}

function emptyBreakGroup() {
  return {
    break1: {},
    lunch: {},
    break2: {},
    break3: {},
    break3Sessions: [],
  };
}

function normalizeBreak3Sessions(breaks = {}) {
  if (Array.isArray(breaks.break3Sessions)) {
    return breaks.break3Sessions
      .filter((item) => item?.start || item?.end)
      .map((item, index) => ({ ...item, number: item.number || index + 1 }));
  }
  const b3 = breaks.break3 || {};
  return b3.start || b3.end ? [{ ...b3, number: 1 }] : [];
}

function buildBreak3Aggregate(sessions = []) {
  const normalized = sessions.slice(0, MAX_DAILY_BREAK_SESSIONS);
  const first = normalized.find((item) => item.start);
  const completed = normalized.filter((item) => item.start && item.end);
  const active = normalized.find((item) => item.start && !item.end);
  const total = completed.reduce((sum, item) => sum + calcDuration(item.start, item.end), 0);
  return {
    start: first?.start || "",
    end: active ? "" : completed.at(-1)?.end || "",
    duration_minutes: total,
    duration: total,
  };
}

function assignBreakToGroup(grouped, row) {
  const payload = {
    start: row.start_time ? formatTime(row.start_time) : "",
    end: row.end_time ? formatTime(row.end_time) : "",
    duration_minutes: row.duration_minutes || 0,
    duration: row.duration_minutes || 0,
  };
  grouped[row.break_type] = payload;
  if (row.break_type === "break3") {
    const sessions = Array.isArray(row.break3_sessions) ? row.break3_sessions : [];
    grouped.break3Sessions = sessions
      .filter((item) => item?.start || item?.end)
      .slice(0, MAX_DAILY_BREAK_SESSIONS)
      .map((item, index) => ({ ...item, number: item.number || index + 1 }));
    if (!grouped.break3Sessions.length && (payload.start || payload.end)) {
      grouped.break3Sessions = [{ ...payload, number: 1 }];
    }
  }
}

function validateBreakPolicy(breaks) {
  const break3Sessions = normalizeBreak3Sessions(breaks);
  let activeCount = 0;
  let totalMinutes = 0;
  let totalSessions = 0;
  for (const breakType of ["break1", "lunch", "break2"]) {
    const b = breaks[breakType] || {};
    if (!b?.start && !b?.end) continue;
    totalSessions++;
    if (b.start && !b.end) activeCount++;
    if (b.start && b.end) totalMinutes += calcDuration(b.start, b.end);
  }
  for (const session of break3Sessions) {
    totalSessions++;
    if (session.start && !session.end) activeCount++;
    if (session.start && session.end) totalMinutes += calcDuration(session.start, session.end);
  }

  if (totalSessions > MAX_DAILY_BREAK_SESSIONS) {
    return "Maximum 6 total break sessions are allowed per day.";
  }
  if (activeCount > 1) {
    return "End the current break before starting another break.";
  }
  return "";
}

async function applyBreakAttendancePolicy(userId, date) {
  const totalResult = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(duration_minutes, 0)), 0)::int AS total_break_minutes
     FROM employee_breaks
     WHERE user_id = $1 AND date = $2::date`,
    [userId, date]
  );
  const totalBreakMinutes = Number(totalResult.rows[0]?.total_break_minutes || 0);
  const breakExceeded = totalBreakMinutes > MAX_BREAK_MINUTES;

  const attendanceResult = await pool.query(
    `UPDATE attendance_records
     SET total_break_minutes = $1,
         status = CASE
           WHEN $2::boolean AND COALESCE(status, '') NOT IN ('leave', 'holiday', 'sunday') THEN 'half_day'
           ELSE status
         END,
         half_day_slot = CASE
           WHEN $2::boolean AND COALESCE(status, '') NOT IN ('leave', 'holiday', 'sunday') THEN COALESCE(half_day_slot, 'INVALID')
           ELSE half_day_slot
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $3 AND date = $4::date
     RETURNING status, total_break_minutes, half_day_slot`,
    [totalBreakMinutes, breakExceeded, userId, date]
  );

  return {
    total_break_minutes: totalBreakMinutes,
    remaining_break_minutes: Math.max(0, MAX_BREAK_MINUTES - totalBreakMinutes),
    break_exceeded: breakExceeded,
    break_status: breakExceeded ? "EXCEEDED" : "WITHIN_LIMIT",
    attendance_status: attendanceResult.rows[0]?.status || null,
    attendance: attendanceResult.rows[0] || null,
    warning: breakExceeded ? "Break limit exceeded. Attendance marked as Half Day." : null,
  };
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// ATTENDANCE: monthly history (for employeeattendance.html)
// GET /api/employee/attendance-history?userId=X&month=YYYY-MM-DD
// ──────────────────────────────────────────────
router.get("/employee/attendance-history", verifyToken, async (req, res) => {
  try {

    // ALWAYS use logged-in user id
    const userId = req.user.id;

    const { month } = req.query;

    if (!month) {
      return res.status(400).json({
        message: "month required"
      });
    }

    const startDate = month.slice(0, 7) + "-01";

    const endDate = new Date(
      new Date(startDate).getFullYear(),
      new Date(startDate).getMonth() + 1,
      0
    )
      .toISOString()
      .slice(0, 10);

    const result = await pool.query(
      `
      SELECT
        date::text,
        check_in_time,
        check_out_time,
        status,
        late_minutes
      FROM attendance_records
      WHERE user_id = $1
      AND date BETWEEN $2 AND $3
      ORDER BY date ASC
      `,
      [userId, startDate, endDate]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: err.message
    });
  }
});

// CHECK IN
router.post("/employee/check-in", verifyToken, async (req, res) => {

  try {

    const userId = req.user.id;

    const now = new Date();

    const date = now.toISOString().slice(0,10);

    const currentTime =
      now.toTimeString().split(' ')[0];

    const userResult = await pool.query(
      `SELECT branch, department
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    // Already checked in
    const existing = await pool.query(
      `SELECT * FROM attendance_records
       WHERE user_id = $1
       AND date = $2`,
      [userId, date]
    );

    if (existing.rows.length) {

      return res.status(400).json({
        message: "Already checked in today"
      });
    }

    const lateMinutes = calculateLateMinutes(currentTime);
    const status = evaluateLateLogin({ office_in: currentTime }).is_late ? 'late' : 'present';

    const result = await pool.query(
      `
      INSERT INTO attendance_records
      (
        user_id,
        date,
        check_in_time,
        status,
        late_minutes,
        branch,
        department
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        userId,
        date,
        currentTime,
        status,
        lateMinutes,
        user.branch,
        user.department
      ]
    );

    res.json(result.rows[0]);

  } catch(err) {

    console.error("POST /employee/check-in error:", err);

    res.status(500).json({
      message: err.message
    });
  }
});

// CHECK OUT
router.post("/employee/check-out", verifyToken, async (req, res) => {

  try {

    const userId = req.user.id;

    const now = new Date();

    const date = now.toISOString().slice(0,10);

    const currentTime =
      now.toTimeString().split(' ')[0];

    const existing = await pool.query(
      `
      SELECT *
      FROM attendance_records
      WHERE user_id = $1
      AND date = $2
      `,
      [userId, date]
    );

    if (!existing.rows.length) {

      return res.status(400).json({
        message: "Check-in required first"
      });
    }

    const record = existing.rows[0];

    if (record.check_out_time) {

      return res.status(400).json({
        message: "Already checked out"
      });
    }

    await pool.query(
      `
      UPDATE attendance_records
      SET check_out_time = $1
      WHERE user_id = $2
      AND date = $3
      `,
      [currentTime, userId, date]
    );

    await recalcAttendanceForUserDate(userId, date);

    const result = await pool.query(
      `
      SELECT *
      FROM attendance_records
      WHERE user_id = $1
      AND date = $2
      `,
      [userId, date]
    );

    res.json(result.rows[0]);

  } catch(err) {

    console.error("POST /employee/check-out error:", err);

    res.status(500).json({
      message: err.message
    });
  }
});


// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// ATTENDANCE: monthly summary/rate
// GET /api/employee/attendance-summary?month=YYYY-MM-DD&userId=X
// ──────────────────────────────────────────────
router.get("/employee/attendance-summary", verifyToken, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId || req.user.id);
    if (["EMPLOYEE", "OPERATIONAL_MANAGER", "SUB_ADMIN"].includes(req.user.role) && userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: "month required" });

    const startDate = month.slice(0, 7) + "-01";
    const endDate = new Date(
      new Date(startDate).getFullYear(),
      new Date(startDate).getMonth() + 1,
      0
    )
      .toISOString()
      .slice(0, 10);

    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE date::date <= CURRENT_DATE) AS working_days,
         COUNT(*) FILTER (WHERE status IN ('present','late')) AS present_days,
         COUNT(*) FILTER (
           WHERE check_in_time >= TIME '10:15:00'
             AND check_in_time < TIME '10:30:00'
         ) AS late_days
       FROM attendance_records
       WHERE user_id = $1
         AND date BETWEEN $2 AND $3`,
      [userId, startDate, endDate]
    );
    const row = result.rows[0];
    const workingDays = parseInt(row.working_days) || 1;
    const presentDays = parseInt(row.present_days) || 0;
    res.json({
      rate: Math.round((presentDays / workingDays) * 100),
      presentDays,
      workingDays,
      lateDays: parseInt(row.late_days) || 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// LEAVES: employee's own leave requests
// GET /api/employee/my-leaves?userId=X
// ──────────────────────────────────────────────
router.get("/employee/my-leaves", verifyToken, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId || req.user.id);
    if (["EMPLOYEE", "OPERATIONAL_MANAGER", "SUB_ADMIN"].includes(req.user.role) && userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const result = await pool.query(
      `SELECT id, leave_type, from_date::text, to_date::text, days, reason, status, created_at
       FROM leave_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// PAYSLIP: employee's own payslip for a month
// GET /api/employee/my-payslip?month=YYYY-MM-DD&userId=X
// ──────────────────────────────────────────────
router.get("/employee/my-payslip", verifyToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: "month required" });
    const requestedMonth = String(month).slice(0, 7) + "-01";
    const requestedYear = Number(requestedMonth.slice(0, 4));

    const result = await pool.query(
      `SELECT
         p.*,
         p.user_id AS employee_id,
         u.employee_code,
         EXTRACT(YEAR FROM p.month)::int AS year,
         p.payment_status AS status,
         p.created_at AS generated_at,
         CONCAT('/api/payroll/payslip/', p.id, '/download') AS pdf_url,
         u.full_name, u.department, u.branch, u.email
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
         AND p.month = $2::date
         AND EXTRACT(YEAR FROM p.month)::int = $3
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [userId, requestedMonth, requestedYear]
    );

    console.log("[EmployeePayslip] GET /employee/my-payslip", {
      loggedInUserId: userId,
      requestedMonth,
      requestedYear,
      sqlResultCount: result.rows.length,
      returnedPayslipCount: result.rows.length ? 1 : 0,
      pdfPath: result.rows[0]?.pdf_url || null,
    });

    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("[EmployeePayslip] GET /employee/my-payslip error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// PAYSLIP: all payslips for an employee
// GET /api/employee/my-payslips?userId=X
// ──────────────────────────────────────────────
router.get("/employee/my-payslips", verifyToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const result = await pool.query(
      `SELECT
         p.*,
         p.user_id AS employee_id,
         u.employee_code,
         EXTRACT(YEAR FROM p.month)::int AS year,
         p.payment_status AS status,
         p.created_at AS generated_at,
         CONCAT('/api/payroll/payslip/', p.id, '/download') AS pdf_url,
         u.full_name, u.department, u.branch, u.email
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
       ORDER BY p.month DESC, p.created_at DESC`,
      [userId]
    );

    console.log("[EmployeePayslip] GET /employee/my-payslips", {
      loggedInUserId: userId,
      requestedMonth: req.query.month || null,
      requestedYear: req.query.year || null,
      sqlResultCount: result.rows.length,
      returnedPayslipCount: result.rows.length,
      pdfPath: result.rows[0]?.pdf_url || null,
    });

    res.json(result.rows);
  } catch (err) {
    console.error("[EmployeePayslip] GET /employee/my-payslips error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// BREAKS: employee's own breaks for a date
// Reuses the existing /api/breaks route via query param userId
// This is a convenience alias that auto-injects the user's own id
// GET /api/employee/my-breaks?date=YYYY-MM-DD
// ──────────────────────────────────────────────
router.get("/employee/my-breaks", verifyToken, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: "date required" });

    const result = await pool.query(
      `SELECT break_type, start_time, end_time, duration_minutes, break3_sessions
       FROM employee_breaks
       WHERE user_id = $1 AND date = $2
       ORDER BY break_type`,
      [req.user.id, date]
    );

    // Build grouped object matching what frontend expects
    const grouped = emptyBreakGroup();
    result.rows.forEach((row) => {
      assignBreakToGroup(grouped, row);
    });

    res.json({
      id: req.user.id,
      ...grouped,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



// ──────────────────────────────────────────────
// BREAK HISTORY
// GET /api/employee/my-breaks-history
// ──────────────────────────────────────────────

router.get(
  "/employee/my-breaks-history",
  verifyToken,
  async (req, res) => {

    try {

      const result = await pool.query(
        `
        SELECT
          date::text,
          break_type,
          start_time,
          end_time,
          duration_minutes,
          break3_sessions
        FROM employee_breaks
        WHERE user_id = $1
        ORDER BY date DESC
        `,
        [req.user.id]
      );

      const grouped = {};

      result.rows.forEach(row => {

        if (!grouped[row.date]) {

          grouped[row.date] = {
            date: row.date,
            ...emptyBreakGroup(),
            total: 0
          };
        }

        assignBreakToGroup(grouped[row.date], row);

        grouped[row.date].total +=
          row.duration_minutes || 0;
      });

      res.json(
        Object.values(grouped)
          .sort((a,b)=>
            new Date(b.date)-new Date(a.date)
          )
      );

    } catch(err) {

      res.status(500).json({
        message: err.message
      });
    }
  }
);

// ──────────────────────────────────────────────
// BREAKS: employee updates their own breaks
// PUT /api/employee/my-breaks
// Body: { date, breaks: { break1: {start, end}, lunch, break2, break3Sessions: [] } }
// ──────────────────────────────────────────────
router.put("/employee/my-breaks", verifyToken, async (req, res) => {
  try {
    const { date, breaks } = req.body;
    if (!date || !breaks) return res.status(400).json({ message: "date and breaks required" });

    const policyError = validateBreakPolicy(breaks);
    if (policyError) {
      return res.status(400).json({ message: policyError });
    }
    const requestedBreakTypes = getRequestedBreakTypes(breaks);
    const break3Sessions = requestedBreakTypes.includes("break3")
      ? normalizeBreak3Sessions(breaks)
      : [];
    const break3Aggregate = buildBreak3Aggregate(break3Sessions);

    for (const breakType of requestedBreakTypes) {
      const b = breakType === "break3" ? break3Aggregate : breaks[breakType] || {};
      const start = b.start || null;
      const end = b.end || null;
      const duration = breakType === "break3"
        ? break3Aggregate.duration_minutes
        : start && end ? calcDuration(start, end) : 0;

      await pool.query(
        `INSERT INTO employee_breaks (user_id, date, break_type, start_time, end_time, duration_minutes, break3_sessions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, date, break_type)
         DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           duration_minutes = EXCLUDED.duration_minutes,
           break3_sessions = EXCLUDED.break3_sessions`,
        [
          req.user.id,
          date,
          breakType,
          start ? convertTo24(start) : null,
          end ? convertTo24(end) : null,
          duration,
          breakType === "break3" ? JSON.stringify(break3Sessions) : null,
        ]
      );
    }

    try {
      await recalcAttendanceForUserDate(req.user.id, date);
    } catch (recalcErr) {
      console.warn("Employee break recalc attendance warning:", recalcErr.message);
    }

    const breakPolicy = await applyBreakAttendancePolicy(req.user.id, date);
    res.json({
      message: breakPolicy.warning || "Breaks saved",
      ...breakPolicy,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// PROFILE: get own profile
// GET /api/employee/profile
// ──────────────────────────────────────────────
router.get("/employee/profile", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, department, branch,
              employee_code, salary, joining_date, status, profile_initials
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────
function convertTo24(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2];
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}:00`;
}

function formatTime(time24) {

  if (!time24) return "";

  // Convert postgres TIME object/string safely
  const timeString = String(time24);

  const parts = timeString.split(":");

  if (parts.length < 2) return "";

  let hour = parseInt(parts[0]);

  const minute = parts[1];

  const ampm = hour >= 12 ? "PM" : "AM";

  hour = hour % 12 || 12;

  return `${hour}:${minute} ${ampm}`;
}


function calcDuration(s, e) {
  const toMin = (t) => {
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return 0;
    let h = parseInt(m[1]);
    if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
    if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
    return h * 60 + parseInt(m[2]);
  };
  return Math.max(0, toMin(e) - toMin(s));
}

export default router;
