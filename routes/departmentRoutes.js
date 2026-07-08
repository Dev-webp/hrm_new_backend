import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function makeCode(name) {
  return cleanText(name).replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
}

function normalizeBranch(branch) {
  const clean = cleanText(branch);
  return clean || "All";
}

async function ensureUniqueDepartment({ name, code, excludeId = null }) {
  const params = [name.toLowerCase(), code.toLowerCase()];
  let query = `
    SELECT id, name, code FROM departments
    WHERE (LOWER(name) = $1 OR LOWER(code) = $2)
  `;
  if (excludeId) {
    params.push(excludeId);
    query += ` AND id != $${params.length}`;
  }
  const result = await pool.query(query, params);
  if (!result.rows.length) return null;
  const duplicate = result.rows[0];
  if (duplicate.name.toLowerCase() === name.toLowerCase()) {
    return "Department name already exists";
  }
  return "Department code already exists";
}

async function validateAssignableDepartment(departmentName, branch) {
  const name = cleanText(departmentName);
  if (!name) return "Department is required";
  const result = await pool.query(
    `SELECT id FROM departments
     WHERE LOWER(name) = LOWER($1)
       AND status = 'active'
       AND (branch = 'All' OR branch = $2)
     LIMIT 1`,
    [name, normalizeBranch(branch)]
  );
  return result.rows.length ? null : "Select an active department";
}

export async function assertAssignableDepartment(departmentName, branch) {
  const error = await validateAssignableDepartment(departmentName, branch);
  if (error) {
    const err = new Error(error);
    err.statusCode = 400;
    throw err;
  }
}

export async function assertAssignableDepartmentForUpdate(userId, departmentName, branch) {
  const error = await validateAssignableDepartment(departmentName, branch);
  if (!error) return;

  const existing = await pool.query("SELECT department FROM users WHERE id = $1", [userId]);
  const currentDepartment = cleanText(existing.rows[0]?.department);
  if (
    currentDepartment &&
    currentDepartment.toLowerCase() === cleanText(departmentName).toLowerCase()
  ) {
    return;
  }

  const err = new Error(error);
  err.statusCode = 400;
  throw err;
}

router.get("/departments", verifyToken, async (req, res) => {
  try {
    const { branch, status, search, date } = req.query;
    const params = [];
    const conditions = [];

    if (req.user.role === "MANAGER") {
      conditions.push(`d.status = 'active'`);
      conditions.push(`(d.branch = 'All' OR d.branch = $${params.length + 1})`);
      params.push(req.user.branch || normalizeBranch(branch));
    } else {
      if (branch && branch !== "all") {
        conditions.push(`(d.branch = 'All' OR d.branch = $${params.length + 1})`);
        params.push(branch);
      }
      if (status && status !== "all") {
        conditions.push(`d.status = $${params.length + 1}`);
        params.push(status);
      }
    }

    if (search) {
      conditions.push(`(d.name ILIKE $${params.length + 1} OR d.code ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const attendanceJoin = date
      ? `LEFT JOIN attendance_records a
         ON a.user_id = u.id
        AND a.date = $${params.length + 1}::date`
      : "";
    const attendanceColumns = date
      ? `,
         COALESCE(SUM(CASE
           WHEN LOWER(COALESCE(a.status, '')) IN ('full_day', 'present', 'half_day', 'working', 'in_progress')
           THEN 1 ELSE 0
         END), 0)::int AS present,
         COALESCE(SUM(CASE
           WHEN LOWER(COALESCE(a.status, '')) = 'absent'
           THEN 1 ELSE 0
         END), 0)::int AS absent`
      : `,
         0::int AS present,
         0::int AS absent`;
    const queryParams = date ? [...params, date] : params;

    const result = await pool.query(
      `SELECT
         d.id, d.name, d.code, d.description, d.branch, d.status,
         d.created_by, d.created_at, d.updated_at,
         COUNT(u.id)::int AS employees
         ${attendanceColumns}
       FROM departments d
       LEFT JOIN users u
         ON LOWER(TRIM(u.department)) = LOWER(TRIM(d.name))
        AND u.role != 'SUPER_ADMIN'
        AND COALESCE(u.status, 'active') != 'deleted'
       ${attendanceJoin}
       ${where}
       GROUP BY d.id
       ORDER BY d.status ASC, d.name ASC`,
      queryParams
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch departments failed:", error);
    res.status(500).json({ message: "Failed to fetch departments" });
  }
});

router.get("/departments/active", verifyToken, async (req, res) => {
  try {
    const branch = req.user.role === "MANAGER" ? req.user.branch : req.query.branch;
    const params = [];
    const conditions = ["d.status = 'active'"];
    if (branch && branch !== "all") {
      conditions.push(`(d.branch = 'All' OR d.branch = $${params.length + 1})`);
      params.push(branch);
    }
    const result = await pool.query(
      `SELECT d.id, d.name, d.code, d.description, d.branch, d.status,
              COUNT(u.id)::int AS employees
       FROM departments d
       LEFT JOIN users u ON LOWER(TRIM(u.department)) = LOWER(TRIM(d.name))
        AND u.role != 'SUPER_ADMIN'
       WHERE ${conditions.join(" AND ")}
       GROUP BY d.id
       ORDER BY d.name ASC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Fetch active departments failed:", error);
    res.status(500).json({ message: "Failed to fetch active departments" });
  }
});

router.post("/departments", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const name = cleanText(req.body.name);
    const code = cleanText(req.body.code) || makeCode(name);
    const branch = normalizeBranch(req.body.branch);
    const description = cleanText(req.body.description) || null;
    const status = cleanText(req.body.status) || "active";

    if (!name) return res.status(400).json({ message: "Department name is required" });
    if (!code) return res.status(400).json({ message: "Department code is required" });
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ message: "Status must be active or inactive" });
    }

    const duplicateError = await ensureUniqueDepartment({ name, code });
    if (duplicateError) return res.status(400).json({ message: duplicateError });

    const result = await pool.query(
      `INSERT INTO departments (name, code, description, branch, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      [name, code, description, branch, status, req.user.id || null]
    );
    res.status(201).json({ message: "Department created", department: result.rows[0] });
  } catch (error) {
    console.error("Create department failed:", error);
    res.status(500).json({ message: "Failed to create department" });
  }
});

router.put("/departments/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = cleanText(req.body.name);
    const code = cleanText(req.body.code) || makeCode(name);
    const branch = normalizeBranch(req.body.branch);
    const description = cleanText(req.body.description) || null;
    const status = cleanText(req.body.status) || "active";

    if (!name) return res.status(400).json({ message: "Department name is required" });
    if (!code) return res.status(400).json({ message: "Department code is required" });
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ message: "Status must be active or inactive" });
    }

    const existing = await pool.query("SELECT * FROM departments WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ message: "Department not found" });

    const duplicateError = await ensureUniqueDepartment({ name, code, excludeId: id });
    if (duplicateError) return res.status(400).json({ message: duplicateError });

    const previousName = existing.rows[0].name;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE departments
         SET name = $1, code = $2, description = $3, branch = $4, status = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [name, code, description, branch, status, id]
      );
      if (previousName.toLowerCase() !== name.toLowerCase()) {
        await client.query(
          `UPDATE users SET department = $1, updated_at = CURRENT_TIMESTAMP
           WHERE LOWER(TRIM(department)) = LOWER(TRIM($2))`,
          [name, previousName]
        );
      }
      await client.query("COMMIT");
      res.json({ message: "Department updated", department: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("Update department rollback failed:", rollbackErr);
      });
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update department failed:", error);
    res.status(500).json({ message: "Failed to update department" });
  }
});

router.patch("/departments/:id/status", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const status = cleanText(req.body.status);
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ message: "Status must be active or inactive" });
    }

    const result = await pool.query(
      `UPDATE departments SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Department not found" });
    res.json({ message: `Department marked ${status}`, department: result.rows[0] });
  } catch (error) {
    console.error("Department status update failed:", error);
    res.status(500).json({ message: "Failed to update department status" });
  }
});

router.delete("/departments/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const existing = await pool.query("SELECT id, name FROM departments WHERE id = $1", [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ message: "Department not found" });

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))
         AND role != 'SUPER_ADMIN'`,
      [existing.rows[0].name]
    );
    if (count.rows[0].count > 0) {
      return res.status(400).json({
        message: "Cannot delete department while employees are assigned to it",
      });
    }

    await pool.query("DELETE FROM departments WHERE id = $1", [req.params.id]);
    res.json({ message: "Department deleted" });
  } catch (error) {
    console.error("Delete department failed:", error);
    res.status(500).json({ message: "Failed to delete department" });
  }
});

export default router;


