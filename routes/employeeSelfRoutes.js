import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// ──────────────────────────────────────────────
// ATTENDANCE: today's record (for dashboard)
// ──────────────────────────────────────────────
router.get("/attendance/self/today", verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id = $1 AND date = $2`,
      [req.user.id, today]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

    // Late logic
    const officeStart = new Date(`${date}T09:00:00`);

    let lateMinutes = 0;
    let status = 'present';

    if (now > officeStart) {

      lateMinutes = Math.floor(
        (now - officeStart) / 60000
      );

      status = 'late';
    }

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

    const result = await pool.query(
      `
      UPDATE attendance_records
      SET check_out_time = $1
      WHERE user_id = $2
      AND date = $3
      RETURNING *
      `,
      [currentTime, userId, date]
    );

    res.json(result.rows[0]);

  } catch(err) {

    res.status(500).json({
      message: err.message
    });
  }
});


// ──────────────────────────────────────────────
// ATTENDANCE: self history with start/end range
// GET /api/attendance/self/history?start=YYYY-MM-DD&end=YYYY-MM-DD
// (used by manager's own history modal too)
// ──────────────────────────────────────────────
router.get("/attendance/self/history", verifyToken, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ message: "start and end required" });

    const result = await pool.query(
      `SELECT
         date::text,
         check_in_time,
         check_out_time,
         status,
         late_minutes
       FROM attendance_records
       WHERE user_id = $1
         AND date BETWEEN $2 AND $3
       ORDER BY date DESC`,
      [req.user.id, start, end]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// ATTENDANCE: monthly summary/rate
// GET /api/employee/attendance-summary?month=YYYY-MM-DD&userId=X
// ──────────────────────────────────────────────
router.get("/employee/attendance-summary", verifyToken, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId || req.user.id);
    if (req.user.role === "EMPLOYEE" && userId !== req.user.id) {
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
         COUNT(*) FILTER (WHERE status = 'late') AS late_days
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
    if (req.user.role === "EMPLOYEE" && userId !== req.user.id) {
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
    const userId = parseInt(req.query.userId || req.user.id);
    if (req.user.role === "EMPLOYEE" && userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: "month required" });

    const result = await pool.query(
      `SELECT p.*, u.full_name, u.department, u.branch, u.employee_code
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1 AND p.month = $2::date`,
      [userId, month]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ──────────────────────────────────────────────
// PAYSLIP: all payslips for an employee
// GET /api/employee/my-payslips?userId=X
// ──────────────────────────────────────────────
router.get("/employee/my-payslips", verifyToken, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId || req.user.id);
    if (req.user.role === "EMPLOYEE" && userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const result = await pool.query(
      `SELECT p.*, u.full_name, u.department, u.branch, u.employee_code
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
       ORDER BY p.month DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
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
      `SELECT break_type, start_time, end_time, duration_minutes
       FROM employee_breaks
       WHERE user_id = $1 AND date = $2
       ORDER BY break_type`,
      [req.user.id, date]
    );

    // Build grouped object matching what frontend expects
    const grouped = { break1: {}, lunch: {}, break2: {}, break3: {} };
    result.rows.forEach((row) => {
      grouped[row.break_type] = {
        start: row.start_time ? formatTime(row.start_time) : "",
        end: row.end_time ? formatTime(row.end_time) : "",
        duration_minutes: row.duration_minutes || 0,
      };
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
          duration_minutes
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
            break1: {},
            lunch: {},
            break2: {},
            break3: {},
            total: 0
          };
        }

        grouped[row.date][row.break_type] = {

          start: row.start_time
            ? formatTime(row.start_time)
            : '',

          end: row.end_time
            ? formatTime(row.end_time)
            : '',

          duration: row.duration_minutes || 0
        };

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
// Body: { date, breaks: { break1: {start, end}, ... } }
// ──────────────────────────────────────────────
router.put("/employee/my-breaks", verifyToken, async (req, res) => {
  try {
    const { date, breaks } = req.body;
    if (!date || !breaks) return res.status(400).json({ message: "date and breaks required" });

    const BREAK_TYPES = ["break1", "lunch", "break2", "break3"];

    for (const breakType of BREAK_TYPES) {
      const b = breaks[breakType] || {};
      const start = b.start || null;
      const end = b.end || null;
      const duration = start && end ? calcDuration(start, end) : 0;

      await pool.query(
        `INSERT INTO employee_breaks (user_id, date, break_type, start_time, end_time, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, date, break_type)
         DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           duration_minutes = EXCLUDED.duration_minutes`,
        [
          req.user.id,
          date,
          breakType,
          start ? convertTo24(start) : null,
          end ? convertTo24(end) : null,
          duration,
        ]
      );
    }
    res.json({ message: "Breaks saved" });
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