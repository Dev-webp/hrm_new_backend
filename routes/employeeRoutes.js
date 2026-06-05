import express from "express";
import bcrypt from "bcrypt";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

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

// ─────────────────────────────────────────────────────────────
// 1. GET employees – now includes aadhar_number & visible_password
// ─────────────────────────────────────────────────────────────
router.get(
  "/admin/employees",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { branch, department, search } = req.query;
      let query = `
        SELECT id, full_name, email, role, department, branch,
               employee_code, salary, joining_date, status, profile_initials,
               designation, bank_name, bank_account, bank_ifsc,
               aadhar_number,
               -- Only return visible_password for SUPER_ADMIN
               CASE WHEN $1 = 'SUPER_ADMIN' THEN visible_password ELSE NULL END as visible_password
        FROM users
        WHERE role != 'SUPER_ADMIN'
      `;
      const params = [req.user.role];
      const conditions = [];

      if (req.user.role === "MANAGER") {
        conditions.push(`branch = $${params.length + 1}`);
        params.push(req.user.branch);
      } else if (req.user.role === "SUPER_ADMIN" && branch && branch !== "all") {
        conditions.push(`branch = $${params.length + 1}`);
        params.push(branch);
      }

      if (department && department !== "all") {
        conditions.push(`department = $${params.length + 1}`);
        params.push(department);
      }
      if (search) {
        conditions.push(`(full_name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1} OR department ILIKE $${params.length + 1})`);
        params.push(`%${search}%`);
      }
      if (conditions.length) query += " AND " + conditions.join(" AND ");
      query += " ORDER BY id DESC";

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
        `SELECT id, full_name, email, role, department, branch, employee_code,
                salary, joining_date, status, profile_initials,
                designation, bank_name, bank_account, bank_ifsc,
                aadhar_number,
                CASE WHEN $1 = 'SUPER_ADMIN' THEN visible_password ELSE NULL END as visible_password
         FROM users WHERE id = $2`,
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
            designation, bank_name, bank_account, bank_ifsc, employee_code,
            aadhar_number } = req.body;

      if (req.user.role === "MANAGER") {
        branch = req.user.branch;
        role = "EMPLOYEE";
      }

      if (!full_name || !email || !role || !department || !branch || !salary) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ message: "Email already exists" });
      }

      let finalCode = employee_code;
      if (!finalCode) {
        finalCode = await generateEmployeeCode();
      } else {
        const codeCheck = await pool.query("SELECT id FROM users WHERE employee_code = $1", [finalCode]);
        if (codeCheck.rows.length > 0) {
          return res.status(400).json({ message: "Employee ID already exists" });
        }
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
      res.status(500).json({ message: "Failed to create employee" });
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
            designation, bank_name, bank_account, bank_ifsc, aadhar_number } = req.body;

      const empCheck = await pool.query("SELECT branch, role FROM users WHERE id = $1", [id]);
      if (empCheck.rows.length === 0) return res.status(404).json({ message: "Employee not found" });

      if (req.user.role === "MANAGER") {
        if (empCheck.rows[0].branch !== req.user.branch) {
          return res.status(403).json({ message: "Access denied – different branch" });
        }
        branch = req.user.branch;
        role = "EMPLOYEE";
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
      res.status(500).json({ message: "Update failed" });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 5. DELETE employee (unchanged)
// ─────────────────────────────────────────────────────────────
router.delete(
  "/admin/employees/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const empCheck = await pool.query("SELECT branch, role FROM users WHERE id = $1", [id]);
      if (empCheck.rows.length === 0) return res.status(404).json({ message: "Employee not found" });

      if (req.user.role === "MANAGER") {
        if (empCheck.rows[0].branch !== req.user.branch) {
          return res.status(403).json({ message: "Access denied – different branch" });
        }
        if (empCheck.rows[0].role !== "EMPLOYEE") {
          return res.status(400).json({ message: "Managers cannot delete other managers or admins" });
        }
      }

      const result = await pool.query(
        "DELETE FROM users WHERE id = $1 AND role != 'SUPER_ADMIN' RETURNING id",
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Employee not found or cannot delete super admin" });
      res.json({ message: "Employee deleted" });
    } catch (error) {
      res.status(500).json({ message: "Delete failed" });
    }
  }
);

export default router;