import express from "express";
import bcrypt from "bcrypt";                 // ✅ ADD THIS – was missing
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Helper functions
async function generateEmployeeCode() {
  const result = await pool.query(
    "SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS INTEGER)) as max_code FROM users WHERE employee_code LIKE 'VJC%'"
  );
  let nextNum = (result.rows[0].max_code || 1000) + 1;
  return `VJC${nextNum}`;
}

function getInitials(fullName) {
  return fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────
// 1. GET all employees of the manager's branch
// ─────────────────────────────────────────────
router.get("/manager/employees", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
  try {
    const branch = req.user.branch;
    const { department, search } = req.query;

    let query = `
      SELECT id, full_name, email, role, department, branch, employee_code,
             salary, joining_date, status, profile_initials
      FROM users
      WHERE branch = $1 AND role = 'EMPLOYEE'
    `;
    let params = [branch];
    let idx = 2;

    if (department && department !== 'all') {
      query += ` AND department = $${idx}`;
      params.push(department);
      idx++;
    }
    if (search) {
      query += ` AND (full_name ILIKE $${idx} OR email ILIKE $${idx} OR department ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    query += " ORDER BY full_name";

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
router.post("/manager/employees", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
  try {
    const { full_name, email, department, salary, password } = req.body;
    const branch = req.user.branch;

    if (!full_name || !email || !department || !salary) {
      return res.status(400).json({ message: "Missing required fields" });
    }

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
       (full_name, email, password, role, department, branch, employee_code, salary, joining_date, status, profile_initials)
       VALUES ($1, $2, $3, 'EMPLOYEE', $4, $5, $6, $7, $8, 'active', $9)
       RETURNING id`,
      [full_name, email, hashedPassword, department, branch, employee_code, salary, joining_date, initials]
    );

    res.status(201).json({
      id: result.rows[0].id,
      employee_code,
      hrmsLogin: email,
      hrmsPassword: password || "Welcome@123"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create employee" });
  }
});

// ─────────────────────────────────────────────
// 3. UPDATE employee – with branch ownership check
// ─────────────────────────────────────────────
router.put("/manager/employees/:id", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, department, salary, password } = req.body;
    const branch = req.user.branch;

    const check = await pool.query("SELECT branch FROM users WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (check.rows[0].branch !== branch) {
      return res.status(403).json({ message: "Access denied – different branch" });
    }

    let updateQuery = `
      UPDATE users
      SET full_name = $1, email = $2, department = $3, salary = $4, profile_initials = $5
    `;
    let params = [full_name, email, department, salary, getInitials(full_name)];
    let paramIndex = 6;

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
    res.status(500).json({ message: "Update failed" });
  }
});

// ─────────────────────────────────────────────
// 4. DELETE employee – with branch ownership check
// ─────────────────────────────────────────────
router.delete("/manager/employees/:id", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
  try {
    const { id } = req.params;
    const branch = req.user.branch;

    const check = await pool.query("SELECT branch, role FROM users WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }
    if (check.rows[0].branch !== branch) {
      return res.status(403).json({ message: "Access denied – different branch" });
    }
    if (check.rows[0].role !== 'EMPLOYEE') {
      return res.status(400).json({ message: "Cannot delete managers or admins" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ message: "Employee deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
});
// GET /api/manager/my-payslip
router.get("/manager/my-payslip", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
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
router.get("/manager/my-payslips", verifyToken, authorizeRoles("MANAGER"), async (req, res) => {
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
    authorizeRoles("MANAGER"),
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
