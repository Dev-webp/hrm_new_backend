import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";

const router = express.Router();

function normalizedAttendanceStatusSql(alias = "a") {
  return `
    CASE
      WHEN ${alias}.status IS NULL THEN 'absent'
      WHEN LOWER(REPLACE(REPLACE(TRIM(${alias}.status), ' ', '_'), '-', '_')) = 'present_working' THEN 'working'
      WHEN LOWER(REPLACE(REPLACE(TRIM(${alias}.status), ' ', '_'), '-', '_')) = 'paid_leave' THEN 'leave'
      ELSE LOWER(REPLACE(REPLACE(TRIM(${alias}.status), ' ', '_'), '-', '_'))
    END
  `;
}

function liveAttendanceStatusSql(alias = "a") {
  const statusSql = normalizedAttendanceStatusSql(alias);
  return `
    CASE
      WHEN ${alias}.check_in_time IS NOT NULL
        AND ${alias}.check_out_time IS NULL
        AND ${statusSql} NOT IN ('holiday', 'leave')
      THEN CASE WHEN ${statusSql} = 'absent' THEN 'working' ELSE ${statusSql} END
      ELSE ${statusSql}
    END
  `;
}

function livePresentSql(alias = "a") {
  return `${liveAttendanceStatusSql(alias)} IN ('full_day','half_day','present','working','in_progress','leave')`;
}

function liveAbsentSql(alias = "a") {
  return `(
    ${alias}.user_id IS NULL
    OR (
      ${liveAttendanceStatusSql(alias)} = 'absent'
      AND NOT (${alias}.check_in_time IS NOT NULL AND ${alias}.check_out_time IS NULL)
    )
  )`;
}

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
router.get("/dashboard/summary", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
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

    const deptBranchFilter = effectiveBranch ? `WHERE branch = 'All' OR branch = '${effectiveBranch.replace(/'/g, "''")}'` : "";

    // Fire queries in parallel
    const [todayRows, monthKpi, leaveRows, deptRows, deptCountRows] = await Promise.all([

      // 1. Today's attendance — for welcome banner
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ${livePresentSql("a")}) AS present,
          COUNT(*) FILTER (WHERE ${liveAbsentSql("a")}) AS absent,
          COUNT(*) FILTER (
            WHERE a.check_in_time >= TIME '10:15:00'
          ) AS late,
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
          COUNT(a.user_id) FILTER (WHERE ${livePresentSql("a")}) AS present
        FROM users u
        LEFT JOIN attendance_records a ON a.user_id = u.id AND a.date = $1
        WHERE u.role != 'SUPER_ADMIN' AND u.department IS NOT NULL
          AND COALESCE(u.status, 'active') = 'active'
        ${branchFilter}
        GROUP BY u.department
        ORDER BY present DESC
      `, [today]),

      // 5. Managed department count from source table
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active
        FROM departments
        ${deptBranchFilter}
      `)
    ]);

    res.json({
      today: todayRows.rows[0],
      monthKpi: monthKpi.rows[0],
      pendingLeaves: Number(leaveRows.rows[0].pending),
      departmentCount: Number(deptCountRows.rows[0]?.total || 0),
      activeDepartmentCount: Number(deptCountRows.rows[0]?.active || 0),
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

