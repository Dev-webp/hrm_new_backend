import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";

const router = express.Router();

router.get("/admin-dashboard", verifyToken, authorizeRoles("SUPER_ADMIN"), (req, res) => {
  res.json({ message: "Welcome Super Admin", stats: { employees: 240, managers: 12, departments: 8, payroll: "₹18,40,000" } });
});
// ======================================================
// ★ DASHBOARD SUMMARY — Single endpoint for admin.html
// GET /api/dashboard/summary?month=YYYY-MM&branch=X&today=YYYY-MM-DD
//
// Returns everything the dashboard needs in 3 parallel DB queries.
// Replaces: /attendance/stats + /leaves + /admin/employees
//           + N×/attendance/employee/:id
// ======================================================
router.get("/dashboard/summary", verifyToken, authorizeRoles("SUPER_ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { month, branch, today } = req.query;
    if (!month || !today)
      return res.status(400).json({ message: "month and today required" });

    const effectiveBranch =
      req.user.role === "MANAGER"
        ? req.user.branch
        : branch && branch !== "all"
        ? branch
        : null;

    const [y, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    const branchFilter = effectiveBranch ? `AND u.branch = '${effectiveBranch.replace(/'/g, "''")}'` : "";

    // Fire 4 queries in parallel
    const [todayRows, monthKpi, leaveRows, deptRows] = await Promise.all([

      // 1. Today's attendance — for welcome banner
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE a.status IN ('full_day','half_day')) AS present,
          COUNT(*) FILTER (WHERE a.status = 'absent' OR a.status IS NULL) AS absent,
          COUNT(*) FILTER (WHERE a.late_minutes > 0 AND a.status != 'absent') AS late,
          COUNT(u.id) AS total
        FROM users u
        LEFT JOIN attendance_records a ON a.user_id = u.id AND a.date = $1
        WHERE u.role != 'SUPER_ADMIN'
          AND COALESCE(u.status, 'active') = 'active'
        ${branchFilter}
      `, [today]),

      // 2. Month KPIs — from materialized view (fast)
      pool.query(`
        SELECT
          COUNT(DISTINCT user_id) AS total_employees,
          COALESCE(SUM(full_days + half_days), 0) AS total_present,
          COALESCE(SUM(late_days), 0) AS total_late,
          COALESCE(SUM(absent_days), 0) AS total_absent,
          COALESCE(SUM(break_exceeded_days), 0) AS total_exceeded,
          COALESCE(ROUND(AVG(avg_break_mins)), 0) AS avg_break
        FROM mv_monthly_attendance
        WHERE month_start = $1
        ${effectiveBranch ? `AND branch = $2` : ""}
      `, effectiveBranch ? [monthStart, effectiveBranch] : [monthStart]),

      // 3. Pending leaves count
      pool.query(`
        SELECT COUNT(*) AS pending
        FROM leave_requests l
        JOIN users u ON l.user_id = u.id
        WHERE l.status = 'pending'
          AND u.role != 'SUPER_ADMIN'
        ${branchFilter}
      `, []),

      // 4. Department attendance today (leaderboard)
      pool.query(`
        SELECT
          u.department,
          COUNT(u.id) AS total,
          COUNT(a.user_id) FILTER (WHERE a.status IN ('full_day','half_day')) AS present
        FROM users u
        LEFT JOIN attendance_records a ON a.user_id = u.id AND a.date = $1
        WHERE u.role != 'SUPER_ADMIN' AND u.department IS NOT NULL
          AND COALESCE(u.status, 'active') = 'active'
        ${branchFilter}
        GROUP BY u.department
        ORDER BY present DESC
      `, [today])
    ]);

    res.json({
      today: todayRows.rows[0],
      monthKpi: monthKpi.rows[0],
      pendingLeaves: Number(leaveRows.rows[0].pending),
      departments: deptRows.rows.map(r => ({
        name: r.department,
        total: Number(r.total),
        present: Number(r.present),
        pct: Number(r.total) > 0 ? Math.round((Number(r.present) / Number(r.total)) * 100) : 0
      }))
    });
  } catch (err) {
    console.error("dashboard/summary error:", err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/manager-dashboard", verifyToken, authorizeRoles("MANAGER"), (req, res) => {
  res.json({ message: "Welcome Manager", stats: { teamMembers: 24, attendance: "96%", pendingLeaves: 4, tasks: 18 } });
});

router.get("/employee-dashboard", verifyToken, authorizeRoles("EMPLOYEE"), (req, res) => {
  res.json({ message: "Welcome Employee", stats: { attendance: "98%", leaves: 10, salary: "₹45,000", tasks: 5 } });
});

export default router;
