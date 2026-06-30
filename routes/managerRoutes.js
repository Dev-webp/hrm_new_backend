import express from "express";
import bcrypt from "bcrypt";                 // ✅ ADD THIS – was missing
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles, normalizeBranchFilter } from "../middleware/auth.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";
import {
  assertAssignableDepartment,
  assertAssignableDepartmentForUpdate,
} from "./departmentRoutes.js";
import { generateEmployeeCode } from "../utils/employeeCode.js";

const router = express.Router();

function getInitials(fullName) {
  return fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────
// 1. GET all employees of the manager's branch
// ─────────────────────────────────────────────
router.get("/manager/employees", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const requestedBranch = normalizeBranchFilter(req.query.branch);
    const branch = req.user.role === "OPERATIONAL_MANAGER" ? requestedBranch : req.user.branch;
    const { department, search, status = "active" } = req.query;

    let query = `
      SELECT u.id, u.full_name, u.email, u.role, u.department, u.branch, u.employee_code,
             u.salary, u.joining_date, u.status, u.profile_initials, u.designation,
             d.code AS department_code
      FROM users u
      LEFT JOIN LATERAL (
        SELECT code
        FROM departments d
        WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(u.department))
          AND (d.branch = 'All' OR d.branch = u.branch)
        ORDER BY CASE WHEN d.branch = u.branch THEN 0 ELSE 1 END
        LIMIT 1
      ) d ON true
      WHERE u.role = 'EMPLOYEE'
    `;
    let params = [];
    let idx = 1;

    if (branch !== "all") {
      query += ` AND u.branch = $${idx}`;
      params.push(branch);
      idx++;
    }

    if (department && department !== 'all') {
      query += ` AND u.department = $${idx}`;
      params.push(department);
      idx++;
    }
    if (status && status !== "all") {
      query += ` AND COALESCE(u.status, 'active') = $${idx}`;
      params.push(status);
      idx++;
    }
    if (search) {
      query += ` AND (u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.department ILIKE $${idx} OR u.employee_code ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    query += " ORDER BY u.full_name";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch employees" });
  }
});

// ─────────────────────────────────────────────
// 2. CREATE employee – branch forced
// ─────────────────────────────────────────────
router.post("/manager/employees", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { full_name, email, department, salary, password, designation } = req.body;
    const branch = req.user.branch;

    if (!full_name || !email || !department || !salary) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await assertAssignableDepartment(department, branch);

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const employee_code = await generateEmployeeCode();
    const hashedPassword = await bcrypt.hash(password || "Welcome@123", 10);
    const joining_date = new Date().toISOString().split('T')[0];
    const initials = getInitials(full_name);

    const result = await pool.query(
      `INSERT INTO users
       (full_name, email, password, role, department, branch, employee_code, salary, joining_date, status, profile_initials, designation)
       VALUES ($1, $2, $3, 'EMPLOYEE', $4, $5, $6, $7, $8, 'active', $9, $10)
       RETURNING id`,
      [full_name, email, hashedPassword, department, branch, employee_code, salary, joining_date, initials, designation || null]
    );

    res.status(201).json({
      id: result.rows[0].id,
      employee_code,
      hrmsLogin: email,
      hrmsPassword: password || "Welcome@123"
    });
  } catch (err) {
    console.error(err);
    if (err.code === "23505" && String(err.constraint || "").includes("employee_code")) {
      return res.status(400).json({ message: "Employee ID already exists" });
    }
    res
      .status(err.statusCode || 500)
      .json({ message: err.statusCode ? err.message : "Failed to create employee" });
  }
});

// ─────────────────────────────────────────────
// 3. UPDATE employee – with branch ownership check
// ─────────────────────────────────────────────
router.put("/manager/employees/:id", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, department, salary, password, designation } = req.body;
    const branch = req.user.branch;

    const check = await pool.query("SELECT branch FROM users WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (check.rows[0].branch !== branch) {
      return res.status(403).json({ message: "Access denied – different branch" });
    }

    if (!full_name || !email || !department || !salary) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await assertAssignableDepartmentForUpdate(id, department, branch);

    let updateQuery = `
      UPDATE users
      SET full_name = $1, email = $2, department = $3, salary = $4, profile_initials = $5, designation = $6
    `;
    let params = [full_name, email, department, salary, getInitials(full_name), designation || null];
    let paramIndex = 7;

    if (password && password.trim() !== "") {
      const hashed = await bcrypt.hash(password, 10);
      updateQuery += `, password = $${paramIndex}`;
      params.push(hashed);
      paramIndex++;
    }
    updateQuery += ` WHERE id = $${paramIndex}`;
    params.push(id);

    await pool.query(updateQuery, params);
    res.json({ message: "Employee updated successfully" });
  } catch (err) {
    console.error(err);
    res
      .status(err.statusCode || 500)
      .json({ message: err.statusCode ? err.message : "Update failed" });
  }
});

// ─────────────────────────────────────────────
// 4. DELETE employee – with branch ownership check
// ─────────────────────────────────────────────
router.delete("/manager/employees/:id", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { id } = req.params;
    const branch = req.user.branch;

    const check = await pool.query(
      "SELECT id, full_name, email, branch, department, role, status FROM users WHERE id = $1",
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (check.rows[0].branch !== branch) {
      return res.status(403).json({ message: "Access denied – different branch" });
    }
    if (check.rows[0].role !== 'EMPLOYEE') {
      return res.status(400).json({ message: "Cannot mark managers or admins inactive" });
    }

    const result = await pool.query(
      `UPDATE users
       SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND role = 'EMPLOYEE'
       RETURNING id, full_name, email, branch, department, role, status`,
      [id]
    );

    const employee = check.rows[0];
    const editorResult = await pool.query(
      "SELECT id, full_name, email, role, branch FROM users WHERE id = $1",
      [req.user.id]
    );
    const editor = editorResult.rows[0] || {
      id: req.user.id,
      full_name: req.user.full_name || req.user.email || "Unknown user",
      email: req.user.email || null,
      role: req.user.role,
      branch: req.user.branch || "all",
    };

    await logActivity({
      userId: editor.id,
      userName: editor.full_name || editor.email || "Unknown user",
      role: editor.role || req.user.role,
      action: "EMPLOYEE_MARKED_INACTIVE",
      actionType: "UPDATE",
      moduleName: "Employee",
      details: `${editor.full_name || editor.email || "Unknown user"} marked ${employee.full_name} (${employee.email}) inactive.`,
      ip: getClientIp(req),
      branch: employee.branch || editor.branch || "all",
      department: employee.department || null,
      metadata: {
        editedBy: {
          id: editor.id,
          name: editor.full_name || editor.email || "Unknown user",
          email: editor.email || null,
          role: editor.role || req.user.role,
        },
        editedFor: {
          id: employee.id,
          name: employee.full_name,
          email: employee.email,
        },
        oldValues: { status: employee.status || "active" },
        newValues: { status: "inactive" },
      },
    });

    res.json({ message: "Employee marked as inactive", employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to mark employee inactive" });
  }
});
// GET /api/manager/my-payslip
router.get("/manager/my-payslip", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { month } = req.query;
    const userId = req.user.id;
    if (!month) return res.status(400).json({ message: "month required" });

    const result = await pool.query(
      `SELECT p.*, u.full_name, u.department, u.branch, u.employee_code, u.salary as base_salary
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1 AND p.month = $2::date`,
      [userId, month]
    );
    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/manager/my-payslips
router.get("/manager/my-payslips", verifyToken, authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.full_name, u.department, u.branch, u.employee_code, u.salary as base_salary
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
       ORDER BY p.month DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ======================================================
// MANAGER PERSONAL BREAK HISTORY
// ======================================================

router.get(
    "/manager/my-break-history",
    verifyToken,
    authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"),
    async (req, res) => {

        try {

            const userId = req.user.id;
            const { from, to } = req.query;

            if (!from || !to) {
                return res.status(400).json({
                    message: "from and to dates required"
                });
            }

            const result = await pool.query(
                `
                SELECT
                    date,
                    break_type,
                    start_time,
                    end_time,
                    duration_minutes

                FROM employee_breaks

                WHERE user_id = $1
                AND date BETWEEN $2 AND $3

                ORDER BY
                    date DESC,
                    break_type ASC
                `,
                [userId, from, to]
            );

            const formatted = result.rows.map(row => ({
                ...row,

                start_time: row.start_time
                    ? formatTimeDisplay(row.start_time)
                    : "",

                end_time: row.end_time
                    ? formatTimeDisplay(row.end_time)
                    : ""
            }));

            res.json(formatted);

        } catch (err) {

            console.error(err);

            res.status(500).json({
                message: "Failed to fetch break history"
            });
        }
    }
);

// GET /api/manager/team-payslips
router.get("/manager/team-payslips", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
  try {
    const { month, branch } = req.query;
    const managerBranch = req.user.branch; // security: only own branch
    const result = await pool.query(
      `SELECT p.*, u.full_name, u.department, u.branch, u.employee_code
       FROM payslip_records p
       JOIN users u ON p.user_id = u.id
       WHERE u.branch = $1 AND p.month = $2::date AND u.role = 'EMPLOYEE'
       ORDER BY u.full_name`,
      [managerBranch, month]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

