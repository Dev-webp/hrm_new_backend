import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

import {
  evaluateLeaveOnApproval,
  getProfessionalLeaveBalance,
  deductApprovedLeave,
} from "../utils/leavePolicy.js";
import {
  notifyLeaveApply,
  notifyLeaveStatus,
} from "./notificationTriggers.js";

const router = express.Router();

/* ✅ GET leave balance */
router.get(
  "/leaves/my/balance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    try {
      const now = new Date();
      const year = Number(req.query.year || now.getFullYear());
      const month = Number(req.query.month || now.getMonth() + 1);

      const targetDate = new Date(year, month - 1, 1);

      const balance = await getProfessionalLeaveBalance(
        req.user.id,
        targetDate
      );

      res.json(balance);
    } catch (error) {
      console.error("Leave balance fetch error:", error);
      res.status(500).json({
        message: "Failed to fetch leave balance",
        error: error.message,
      });
    }
  }
);

/* ✅ GET my leaves */
router.get(
  "/leaves/my",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT 
          id,
          leave_type,
          from_date,
          to_date,
          days,
          reason,
          status,
          approved_by,
          approved_at,
          rejection_reason
        FROM leave_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("My leaves fetch error:", error);
      res.status(500).json({
        message: "Failed to fetch your leaves",
        error: error.message,
      });
    }
  }
);

/* ✅ IMPORTANT: GET all leaves for Admin / Manager */
router.get(
  "/leaves",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { date, branch, status } = req.query;

      let query = `
        SELECT 
          l.id,
          l.user_id,
          u.full_name,
          u.branch,
          l.leave_type,
          l.from_date,
          l.to_date,
          l.days,
          l.reason,
          l.status,
          l.created_at,
          l.approved_by,
          l.approved_at,
          l.rejection_reason
        FROM leave_requests l
        JOIN users u ON u.id = l.user_id
        WHERE 1 = 1
      `;

      const values = [];
      let index = 1;

      if (req.user.role === "MANAGER") {
        query += ` AND u.branch = $${index}`;
        values.push(req.user.branch);
        index++;
      }

      if (req.user.role === "SUPER_ADMIN" && branch && branch !== "all") {
        query += ` AND u.branch = $${index}`;
        values.push(branch);
        index++;
      }

      if (date) {
        query += ` AND $${index}::date BETWEEN l.from_date::date AND l.to_date::date`;
        values.push(date);
        index++;
      }

      if (status && status !== "all") {
        query += ` AND l.status = $${index}`;
        values.push(status);
        index++;
      }

      query += ` ORDER BY l.created_at DESC`;

      const result = await pool.query(query, values);
      res.json(result.rows);
    } catch (error) {
      console.error("Fetch leave requests error:", error);
      res.status(500).json({
        message: "Failed to fetch leave requests",
        error: error.message,
      });
    }
  }
);

/* ✅ Approval preview */
router.get(
  "/leaves/:id/approval-preview",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const leaveRes = await pool.query(
        `
        SELECT 
          l.*,
          u.full_name,
          u.branch
        FROM leave_requests l
        JOIN users u ON u.id = l.user_id
        WHERE l.id = $1
        `,
        [id]
      );

      if (!leaveRes.rows.length) {
        return res.status(404).json({ message: "Leave not found" });
      }

      const leave = leaveRes.rows[0];

      if (req.user.role === "MANAGER" && leave.branch !== req.user.branch) {
        return res.status(403).json({
          message: "Access denied – different branch",
        });
      }

      const fromDateObj = new Date(leave.from_date);

      if (Number.isNaN(fromDateObj.getTime())) {
        return res.status(400).json({
          message: "Invalid leave from_date",
          from_date: leave.from_date,
        });
      }

      const balance = await getProfessionalLeaveBalance(
        leave.user_id,
        fromDateObj
      );

      const requestedDays = Number(leave.days || 0);

      const leaveCategory =
        leave.leave_category ||
        (leave.leave_type === "Paid" || leave.leave_type === "Earned"
          ? "Paid"
          : "Unpaid");

      let availablePaid = 0;

      if (leaveCategory === "Paid") {
        availablePaid = Number(balance.paid_leave_balance || 0);
      }

      const paidDays = Math.min(availablePaid, requestedDays);
      const unpaidDays = Math.max(0, requestedDays - paidDays);

      res.json({
        leave_id: leave.id,
        employee_name: leave.full_name,
        leave_type: leave.leave_type,
        leave_category: leaveCategory,
        requested_days: requestedDays,
        available_paid_balance: availablePaid,
        paid_days: paidDays,
        unpaid_days: unpaidDays,
        salary_deduction_days: unpaidDays,
        from_date: leave.from_date,
        to_date: leave.to_date,
      });
    } catch (error) {
      console.error("Approval preview error:", error);
      res.status(500).json({
        message: "Failed to fetch approval preview",
        error: error.message,
      });
    }
  }
);

/* ✅ Approve / Reject leave */
router.put(
  "/leaves/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        status,
        rejection_reason,
        include_sunday_penalty = false,
      } = req.body;

      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const leaveCheck = await pool.query(
        `
        SELECT 
          l.*,
          u.full_name,
          u.branch
        FROM leave_requests l
        JOIN users u ON u.id = l.user_id
        WHERE l.id = $1
        `,
        [id]
      );

      if (!leaveCheck.rows.length) {
        return res.status(404).json({ message: "Leave not found" });
      }

      const leave = leaveCheck.rows[0];

      if (req.user.role === "MANAGER" && leave.branch !== req.user.branch) {
        return res.status(403).json({
          message: "Access denied – different branch",
        });
      }

      let updateFields = `
        status = $1,
        updated_at = CURRENT_TIMESTAMP
      `;

      const params = [status];
      let paramIndex = 2;

      if (status === "approved") {
        const fromDateObj = new Date(leave.from_date);

        if (Number.isNaN(fromDateObj.getTime())) {
          return res.status(400).json({
            message: "Invalid leave from_date",
            from_date: leave.from_date,
          });
        }

        const year = fromDateObj.getFullYear();
        const month = fromDateObj.getMonth() + 1;

        const leaveCategory =
          leave.leave_category ||
          (leave.leave_type === "Paid" || leave.leave_type === "Earned"
            ? "Paid"
            : "Unpaid");

        const monthSatMonLeaves = await pool.query(
          `
          SELECT id, from_date
          FROM leave_requests
          WHERE user_id = $1
            AND status = 'approved'
            AND EXTRACT(YEAR FROM from_date) = $2
            AND EXTRACT(MONTH FROM from_date) = $3
          `,
          [leave.user_id, year, month]
        );

        const policyFlags = evaluateLeaveOnApproval(
          leave,
          monthSatMonLeaves.rows,
          {}
        );

        const deduction = await deductApprovedLeave(
          leave.user_id,
          Number(leave.days || 1),
          leave.leave_type,
          fromDateObj
        );
if (leaveCategory === "Unpaid") {
  deduction.paid_days = 0;
  deduction.unpaid_days = Number(leave.days || 0);
}
        let finalPenaltyDays = Number(policyFlags.penalty_days || 0);

        if (include_sunday_penalty === true) {
          finalPenaltyDays += 1;
        }

        updateFields += `
          , approved_by = $${paramIndex}
          , approved_at = CURRENT_TIMESTAMP
          , rejection_reason = NULL
          , leave_category = $${paramIndex + 1}
          , is_paid_leave = $${paramIndex + 2}
          , paid_days = $${paramIndex + 3}
          , unpaid_days = $${paramIndex + 4}
          , penalty_applied = $${paramIndex + 5}
          , penalty_days = $${paramIndex + 6}
          , include_sunday_penalty = $${paramIndex + 7}
          , policy_reason = $${paramIndex + 8}
        `;

        params.push(
          req.user.id,
          leaveCategory,
          deduction.paid_days > 0,
          deduction.paid_days,
          deduction.unpaid_days,
          finalPenaltyDays > 0,
          finalPenaltyDays,
          include_sunday_penalty,
          policyFlags.penalty_applied
            ? "1+1 policy applied: sudden leave or Saturday/Monday abuse"
            : "Normal leave approval"
        );

        paramIndex += 9;
      }

      if (status === "rejected") {
        updateFields += `
          , rejection_reason = $${paramIndex}
        `;

        params.push(rejection_reason || null);
        paramIndex++;
      }

      updateFields += ` WHERE id = $${paramIndex}`;
      params.push(id);

      await pool.query(
        `UPDATE leave_requests SET ${updateFields}`,
        params
      );

      res.json({ message: "Leave status updated" });

      try {
        await notifyLeaveStatus(
          req.user,
          {
            id: leave.id,
            leave_type: leave.leave_type,
            days: leave.days,
            user_id: leave.user_id,
            user_name: leave.full_name,
            branch: leave.branch,
          },
          status
        );
      } catch (notifyError) {
        console.error("Leave notification error:", notifyError);
      }
    } catch (error) {
      console.error("Update leave error:", error);
      res.status(500).json({
        message: "Failed to update leave",
        error: error.message,
      });
    }
  }
);

/* ✅ Create leave request */
router.post("/leaves", verifyToken, async (req, res) => {
  try {
    const { user_id, leave_type, from_date, to_date, days, reason } = req.body;

    if (req.user.role !== "SUPER_ADMIN" && req.user.id !== user_id) {
      return res.status(403).json({
        message: "Access denied – you can only request leaves for yourself",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO leave_requests
        (user_id, leave_type, from_date, to_date, days, reason, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
      `,
      [user_id, leave_type, from_date, to_date, days, reason]
    );

    res.status(201).json(result.rows[0]);

    try {
      const applicant = await pool.query(
        `
        SELECT id, full_name, branch
        FROM users
        WHERE id = $1
        `,
        [user_id]
      );

      if (applicant.rows[0]) {
        await notifyLeaveApply(applicant.rows[0], result.rows[0]);
      }
    } catch (notifyError) {
      console.error("Leave apply notification error:", notifyError);
    }
  } catch (error) {
    console.error("Create leave error:", error);
    res.status(500).json({
      message: "Failed to create leave request",
      error: error.message,
    });
  }
});

export default router;