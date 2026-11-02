import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";
import { syncOpsUser } from "../utils/opsSync.js";

const router = express.Router();

// ───────────────── Grant / revoke OPS access ─────────────────
// Deliberately separate from PUT /admin/employees/:id so editing an employee's
// profile can never switch OPS access on or off as a side effect. Super admin
// only: OPS holds student and case data.
router.patch(
  "/admin/employees/:id/ops-access",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const value = req.body?.ops_access;

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid employee id" });
      }
      if (typeof value !== "boolean") {
        return res.status(400).json({ message: "ops_access must be true or false" });
      }

      const result = await pool.query(
        `UPDATE users SET ops_access = $1 WHERE id = $2
         RETURNING id, full_name, email, branch, department, ops_access, ops_permissions, employee_code`,
        [value, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Employee not found" });
      }
      const target = result.rows[0];

      // Sync to OPS database when access is granted
      if (value === true) {
        syncOpsUser({
          name: target.full_name,
          email: target.email,
          department: target.department,
          location: target.branch,
          employee_id: target.employee_code,
          permissions: target.ops_permissions || {},
        });
      }

      await logActivity({
        userId: req.user.id,
        userName: req.user.full_name || req.user.email || "unknown",
        role: req.user.role,
        action: "Edit",
        details: `${value ? "Granted" : "Revoked"} OPS access for ${target.email}`,
        ip: getClientIp(req),
        branch: target.branch ?? "all",
        metadata: { entityId: target.id, field: "ops_access", newValue: value },
      });

      return res.json({ id: target.id, ops_access: target.ops_access });
    } catch (error) {
      console.error("[OPS_ACCESS_UPDATE_FAILED]", error.message);
      return res.status(500).json({ message: "Unable to update OPS access" });
    }
  }
);

export default router;
