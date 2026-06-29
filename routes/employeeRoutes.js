import express from "express";
import bcrypt from "bcrypt";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";
import {
  assertAssignableDepartment,
  assertAssignableDepartmentForUpdate,
} from "./departmentRoutes.js";
import {
  ensureEmployeeCodeAvailable,
  generateEmployeeCode,
} from "../utils/employeeCode.js";

const router = express.Router();

function getInitials(fullName) {
  return fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function cleanDepartmentCode(value) {
  return typeof value === "string"
    ? value.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30).toUpperCase()
    : "";
}

async function updateDepartmentCodeIfProvided({ code, department, branch }) {
  const cleanCode = cleanDepartmentCode(code);
  if (!cleanCode) return;

  const current = await pool.query(
    `SELECT id, code FROM departments
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       AND (branch = 'All' OR branch = $2)
     ORDER BY CASE WHEN branch = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [department, branch]
  );

  if (!current.rows.length) return;
  if (String(current.rows[0].code || "").toUpperCase() === cleanCode) return;

  const duplicate = await pool.query(
    "SELECT id FROM departments WHERE LOWER(code) = LOWER($1) AND id != $2 LIMIT 1",
    [cleanCode, current.rows[0].id]
  );
  if (duplicate.rows.length) {
    const err = new Error("Department code already exists");
    err.statusCode = 400;
    throw err;
  }

  await pool.query(
    "UPDATE departments SET code = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
    [cleanCode, current.rows[0].id]
  );
}

// ─────────────────────────────────────────────────────────────
// 1. GET employees – now includes aadhar_number & visible_password
// ─────────────────────────────────────────────────────────────
router.get(
  "/admin/employees",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { branch, department, search, status = "active" } = req.query;
      let query = `
        SELECT u.id, u.full_name, u.email, u.role, u.department, u.branch,
               u.employee_code, u.salary, u.joining_date, u.status, u.profile_initials,
               designation, bank_name, bank_account, bank_ifsc,
               aadhar_number, d.code AS department_code,
               -- Only return visible_password for SUPER_ADMIN
               CASE WHEN $1 = 'SUPER_ADMIN' THEN u.visible_password ELSE NULL END as visible_password
        FROM users u
        LEFT JOIN LATERAL (
          SELECT code
          FROM departments d
          WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(u.department))
            AND (d.branch = 'All' OR d.branch = u.branch)
          ORDER BY CASE WHEN d.branch = u.branch THEN 0 ELSE 1 END
          LIMIT 1
        ) d ON true
        WHERE u.role != 'SUPER_ADMIN'
      `;
      const params = [req.user.role];
      const conditions = [];

      if (req.user.role === "MANAGER") {
        conditions.push(`u.branch = $${params.length + 1}`);
        params.push(req.user.branch);
      } else if (req.user.role === "SUPER_ADMIN" && branch && branch !== "all") {
        conditions.push(`u.branch = $${params.length + 1}`);
        params.push(branch);
      }

      if (department && department !== "all") {
        conditions.push(`u.department = $${params.length + 1}`);
        params.push(department);
      }
      if (status && status !== "all") {
        conditions.push(`COALESCE(u.status, 'active') = $${params.length + 1}`);
        params.push(status);
      }
      if (search) {
        conditions.push(`(u.full_name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 1} OR u.department ILIKE $${params.length + 1} OR u.employee_code ILIKE $${params.length + 1})`);
        params.push(`%${search}%`);
      }
      if (conditions.length) query += " AND " + conditions.join(" AND ");
      query += " ORDER BY u.id DESC";

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 2. GET single employee – includes aadhar & visible password for super admin
// ─────────────────────────────────────────────────────────────
router.get(
  "/admin/employees/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.role, u.department, u.branch, u.employee_code,
                u.salary, u.joining_date, u.status, u.profile_initials,
                u.designation, u.bank_name, u.bank_account, u.bank_ifsc,
                aadhar_number,
                d.code AS department_code,
                CASE WHEN $1 = 'SUPER_ADMIN' THEN u.visible_password ELSE NULL END as visible_password
         FROM users u
         LEFT JOIN LATERAL (
           SELECT code
           FROM departments d
           WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(u.department))
             AND (d.branch = 'All' OR d.branch = u.branch)
           ORDER BY CASE WHEN d.branch = u.branch THEN 0 ELSE 1 END
           LIMIT 1
         ) d ON true
         WHERE u.id = $2`,
        [req.user.role, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Employee not found" });

      const emp = result.rows[0];
      if (req.user.role === "MANAGER" && emp.branch !== req.user.branch) {
        return res.status(403).json({ message: "Access denied – different branch" });
      }
      res.json(emp);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 3. CREATE employee – supports aadhar_number & stores plain password
// ─────────────────────────────────────────────────────────────
router.post(
  "/admin/employees",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      let { full_name, email, role, department, branch, salary, password,
            designation, bank_name, bank_account, bank_ifsc, employee_code, department_code,
            aadhar_number } = req.body;

      if (req.user.role === "MANAGER") {
        branch = req.user.branch;
        role = "EMPLOYEE";
      }

      if (!full_name || !email || !role || !department || !branch || !salary) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      await assertAssignableDepartment(department, branch);
      if (req.user.role === "SUPER_ADMIN") {
        await updateDepartmentCodeIfProvided({ code: department_code, department, branch });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ message: "Email already exists" });
      }

      let finalCode = employee_code;
      if (!finalCode) {
        finalCode = await generateEmployeeCode();
      } else {
        await ensureEmployeeCodeAvailable(finalCode);
      }

      const plainPassword = password && password.trim() !== "" ? password : "Welcome@123";
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      const joining_date = new Date().toISOString().split('T')[0];
      const profile_initials = getInitials(full_name);

      const result = await pool.query(
        `INSERT INTO users
         (full_name, email, password, role, department, branch, employee_code,
          salary, joining_date, status, profile_initials,
          designation, bank_name, bank_account, bank_ifsc,
          aadhar_number, visible_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [full_name, email, hashedPassword, role.toUpperCase(), department, branch, finalCode,
         salary, joining_date, 'active', profile_initials,
         designation || null, bank_name || null, bank_account || null, bank_ifsc || null,
         aadhar_number || null, plainPassword]
      );

      res.status(201).json({
        id: result.rows[0].id,
        employee_code: finalCode,
        hrmsLogin: email,
        hrmsPassword: plainPassword   // return plain password for display
      });
    } catch (error) {
      console.error(error);
      if (error.code === "23505" && String(error.constraint || "").includes("employee_code")) {
        return res.status(400).json({ message: "Employee ID already exists" });
      }
      res
        .status(error.statusCode || 500)
        .json({ message: error.statusCode ? error.message : "Failed to create employee" });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 4. UPDATE employee – supports aadhar & plain password update
// ─────────────────────────────────────────────────────────────
router.put(
  "/admin/employees/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      let { full_name, email, role, department, branch, salary, password,
            designation, bank_name, bank_account, bank_ifsc, aadhar_number, department_code } = req.body;

      const empCheck = await pool.query("SELECT branch, role FROM users WHERE id = $1", [id]);
      if (empCheck.rows.length === 0) return res.status(404).json({ message: "Employee not found" });
      const employee = empCheck.rows[0];

      if (req.user.role === "MANAGER") {
        if (employee.branch !== req.user.branch) {
          return res.status(403).json({ message: "Access denied – different branch" });
        }
        branch = req.user.branch;
        role = "EMPLOYEE";
      }

      if (!full_name || !email || !role || !department || !branch || !salary) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      await assertAssignableDepartmentForUpdate(id, department, branch);
      if (req.user.role === "SUPER_ADMIN") {
        await updateDepartmentCodeIfProvided({ code: department_code, department, branch });
      }

      let updateQuery = `
        UPDATE users
        SET full_name = $1, email = $2, role = $3, department = $4, branch = $5,
            salary = $6, profile_initials = $7,
            designation = $8, bank_name = $9, bank_account = $10, bank_ifsc = $11,
            aadhar_number = $12
      `;
      let params = [full_name, email, role.toUpperCase(), department, branch, salary,
                    getInitials(full_name), designation || null, bank_name || null,
                    bank_account || null, bank_ifsc || null, aadhar_number || null];
      let paramIndex = 13;

      // If password is provided, update both hashed and visible password
      if (password && password.trim() !== "") {
        const hashedPassword = await bcrypt.hash(password, 10);
        updateQuery += `, password = $${paramIndex}, visible_password = $${paramIndex + 1}`;
        params.push(hashedPassword, password);
        paramIndex += 2;
      }

      updateQuery += ` WHERE id = $${paramIndex} RETURNING id`;
      params.push(id);

      const result = await pool.query(updateQuery, params);
      if (result.rows.length === 0) return res.status(404).json({ message: "Employee not found" });
      res.json({ message: "Employee updated successfully" });
    } catch (error) {
      console.error(error);
      res
        .status(error.statusCode || 500)
        .json({ message: error.statusCode ? error.message : "Update failed" });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 5. Mark employee inactive (soft delete)
// ─────────────────────────────────────────────────────────────
// Change status without deleting any employee or related HRMS data.
router.patch(
  "/admin/employees/:id/status",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { status } = req.body;
      const reason = String(req.body.reason || "").trim() || null;
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({ message: "Status must be active or inactive" });
      }
      const employeeResult = await pool.query(
        "SELECT id, full_name, email, branch, department, role, COALESCE(status, 'active') AS status FROM users WHERE id = $1",
        [req.params.id]
      );
      if (!employeeResult.rows.length) return res.status(404).json({ message: "Employee not found" });
      const employee = employeeResult.rows[0];
      if (employee.role === "SUPER_ADMIN") return res.status(403).json({ message: "Super admin status cannot be changed" });
      if (req.user.role === "MANAGER" && (employee.branch !== req.user.branch || employee.role !== "EMPLOYEE")) {
        return res.status(403).json({ message: "Managers can only change employees in their branch" });
      }
      if (employee.status === status) return res.json({ message: `Employee is already ${status}`, employee });

      const updated = await pool.query(
        `UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING id, full_name, email, branch, department, role, status`,
        [status, employee.id]
      );
      const editorResult = await pool.query(
        "SELECT id, full_name, email, role, branch FROM users WHERE id = $1",
        [req.user.id]
      );
      const editor = editorResult.rows[0] || req.user;
      await logActivity({
        userId: editor.id,
        userName: editor.full_name || editor.email || "Unknown user",
        role: editor.role || req.user.role,
        action: "EMPLOYEE_STATUS_CHANGED",
        actionType: "employee_status_changed",
        moduleName: "Employee",
        details: `${employee.full_name} changed from ${employee.status} to ${status}${reason ? `. Reason: ${reason}` : ""}.`,
        ip: getClientIp(req),
        branch: employee.branch || editor.branch || "all",
        department: employee.department || null,
        metadata: {
          changedBy: editor.full_name || editor.email || "Unknown user",
          changedEmployee: employee.full_name,
          employeeId: employee.id,
          oldStatus: employee.status,
          newStatus: status,
          reason,
        },
      });
      res.json({ message: `Employee marked as ${status}`, employee: updated.rows[0] });
    } catch (error) {
      console.error("Employee status update failed:", error);
      res.status(500).json({ message: "Failed to update employee status" });
    }
  }
);

router.delete(
  "/admin/employees/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const empCheck = await pool.query(
        "SELECT id, full_name, email, branch, department, role, status FROM users WHERE id = $1",
        [id]
      );
      if (empCheck.rows.length === 0) return res.status(404).json({ message: "Employee not found" });
      const employee = empCheck.rows[0];

      if (req.user.role === "MANAGER") {
        if (empCheck.rows[0].branch !== req.user.branch) {
          return res.status(403).json({ message: "Access denied – different branch" });
        }
        if (employee.role !== "EMPLOYEE") {
          return res.status(400).json({ message: "Managers cannot mark other managers or admins inactive" });
        }
      }

      const result = await pool.query(
        `UPDATE users
         SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND role != 'SUPER_ADMIN'
         RETURNING id, full_name, email, branch, department, role, status`,
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Employee not found or cannot mark super admin inactive" });

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
        actionType: "employee_status_changed",
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
          reason: null,
        },
      });

      res.json({ message: "Employee marked as inactive", employee: result.rows[0] });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark employee inactive" });
    }
  }
);

export default router;
