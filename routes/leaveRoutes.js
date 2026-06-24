import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";

import {
  evaluateLeaveOnApproval,
  getProfessionalLeaveBalance,
  deductApprovedLeave,
} from "../utils/leavePolicy.js";
import {
  notifyLeaveApply,
  notifyLeaveStatus,
} from "./notificationTriggers.js";
import { createValidatedLeaveRequest } from "../services/leaveRequestService.js";
import {
  attendanceStatusForLeave,
  halfDaySlotForSession,
} from "../utils/leaveRequestPolicy.js";

const router = express.Router();

function sameNumber(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) < 0.001;
}

async function buildApprovalPreview(leave, includeSundayPenalty = false) {
  const fromDate = new Date(leave.from_date);
  if (Number.isNaN(fromDate.getTime())) throw new Error("Invalid leave from_date");

  const balance = await getProfessionalLeaveBalance(leave.user_id, fromDate);
  const requestedDays = Number(leave.requested_days ?? leave.days ?? 0);
  const finalCategory =
    leave.leave_category ||
    (leave.leave_type === "Paid" || leave.leave_type === "Earned" ? "Paid" : "Unpaid");
  const availablePaid = Number(balance.paid_leave_balance || 0);
  const canApprove = finalCategory !== "Paid" || availablePaid >= requestedDays;
  const paidDays = finalCategory === "Paid" && canApprove ? requestedDays : 0;
  const unpaidDays = finalCategory === "Unpaid" ? requestedDays : 0;

  const monthLeaves = await pool.query(
    `SELECT id, from_date FROM leave_requests
     WHERE user_id = $1 AND status = 'approved'
       AND EXTRACT(YEAR FROM from_date) = $2
       AND EXTRACT(MONTH FROM from_date) = $3`,
    [leave.user_id, fromDate.getFullYear(), fromDate.getMonth() + 1]
  );
  const flags = evaluateLeaveOnApproval(leave, monthLeaves.rows, {});
  const sundayPenalty = Boolean(includeSundayPenalty);
  const penaltyDays = Number(flags.penalty_days || 0) + (sundayPenalty ? 1 : 0);
  const reasons = [];
  if (flags.is_sudden) reasons.push("Sudden leave penalty applied");
  if (flags.sat_mon_exceeded) reasons.push("Saturday/Monday monthly limit exceeded");
  if (sundayPenalty) reasons.push("Sunday penalty included");
  if (!reasons.length) reasons.push("Normal leave approval");

  return {
    leave_request_id: leave.id,
    employee_name: leave.full_name,
    leave_type: leave.leave_type,
    leave_duration_type: leave.leave_duration_type || "full_day",
    half_day_session: leave.half_day_session || null,
    requested_days: requestedDays,
    available_paid_balance: availablePaid,
    paid_days: paidDays,
    unpaid_days: unpaidDays,
    salary_deduction_days: unpaidDays,
    include_sunday_penalty: sundayPenalty,
    sudden_leave_penalty: Boolean(flags.is_sudden),
    penalty_days: penaltyDays,
    policy_reason: reasons.join("; "),
    final_category: finalCategory,
    can_approve: canApprove,
    from_date: leave.from_date,
    to_date: leave.to_date,
  };
}

async function getScopedLeave(req, id) {
  const result = await pool.query(
    `SELECT l.*, u.full_name, u.branch
     FROM leave_requests l JOIN users u ON u.id = l.user_id
     WHERE l.id = $1`,
    [id]
  );
  if (!result.rows.length) return { error: { status: 404, message: "Leave not found" } };
  const leave = result.rows[0];
  if (req.user.role === "MANAGER" && leave.branch !== req.user.branch) {
    return { error: { status: 403, message: "Access denied - different branch" } };
  }
  return { leave };
}

async function syncApprovedLeaveAttendance(leave, deduction) {
  const isPaid = Number(deduction.paid_days || 0) > 0;
  const durationType = leave.leave_duration_type || "full_day";
  const attendanceStatus = attendanceStatusForLeave(durationType);
  const halfDaySlot = halfDaySlotForSession(leave.half_day_session);
  const leaveLabel = isPaid ? "Paid" : "Unpaid";

  await pool.query(
    `INSERT INTO attendance_records (
       user_id, date, status, leave_type, leave_status, is_paid_leave,
       leave_request_id, half_day_slot, branch, department
     )
     SELECT l.user_id, dates.day::date, $2, $3, 'approved', $4,
            l.id, $5, u.branch, u.department
     FROM leave_requests l
     JOIN users u ON u.id = l.user_id
     CROSS JOIN LATERAL generate_series(l.from_date, l.to_date, interval '1 day') dates(day)
     WHERE l.id = $1
       AND EXTRACT(DOW FROM dates.day) <> 0
       AND NOT EXISTS (
         SELECT 1 FROM company_holidays h
         WHERE h.date = dates.day::date
           AND h.type = 'holiday'
           AND (LOWER(COALESCE(h.branch, 'all')) = 'all' OR h.branch = u.branch)
       )
     ON CONFLICT (user_id, date) DO UPDATE SET
       status = EXCLUDED.status,
       leave_type = EXCLUDED.leave_type,
       leave_status = EXCLUDED.leave_status,
       is_paid_leave = EXCLUDED.is_paid_leave,
       leave_request_id = EXCLUDED.leave_request_id,
       half_day_slot = EXCLUDED.half_day_slot,
       updated_at = CURRENT_TIMESTAMP`,
    [leave.id, attendanceStatus, leaveLabel, isPaid, halfDaySlot]
  );
}

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
          requested_days,
          leave_duration_type,
          half_day_session,
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
          l.requested_days,
          l.leave_duration_type,
          l.half_day_session,
          l.paid_days,
          l.unpaid_days,
          l.reason,
          l.status,
          l.created_at,
          l.approved_by,
          approver.full_name AS approved_by_name,
          l.approved_at,
          l.rejection_reason
        FROM leave_requests l
        JOIN users u ON u.id = l.user_id
        LEFT JOIN users approver ON approver.id = l.approved_by
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

// GET /api/leave/pending-count
router.get(
  "/leave/pending-count",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const params = [];
      let branchClause = "";
      if (req.user.role === "MANAGER") {
        params.push(req.user.branch);
        branchClause = "AND u.branch = $1";
      }
      const result = await pool.query(
        `SELECT COUNT(*) AS count
         FROM leave_requests l
         JOIN users u ON u.id = l.user_id
         WHERE l.status = 'pending' ${branchClause}`,
        params
      );
      res.json({ count: Number(result.rows[0]?.count || 0) });
    } catch (error) {
      console.error("Pending leave count error:", error);
      res.status(500).json({ message: "Failed to fetch pending leave count" });
    }
  }
);

// GET /api/manager-leaves/pending-count
router.get(
  "/manager-leaves/pending-count",
  verifyToken,
  authorizeRoles("MANAGER"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) AS count
         FROM leave_requests l
         JOIN users u ON u.id = l.user_id
         WHERE l.status = 'pending' AND u.branch = $1`,
        [req.user.branch]
      );
      res.json({ count: Number(result.rows[0]?.count || 0) });
    } catch (error) {
      console.error("Manager pending leave count error:", error);
      res.status(500).json({ message: "Failed to fetch manager pending leave count" });
    }
  }
);

/* ✅ Approval preview */
router.get(
  "/leave/:id/approval-preview",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const scoped = await getScopedLeave(req, req.params.id);
      if (scoped.error) return res.status(scoped.error.status).json({ message: scoped.error.message });
      const preview = await buildApprovalPreview(
        scoped.leave,
        req.query.include_sunday_penalty === "true"
      );
      res.json(preview);
    } catch (error) {
      console.error("Approval preview error:", error);
      res.status(500).json({ message: "Failed to fetch approval preview", error: error.message });
    }
  }
);

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

      const requestedDays = Number(leave.requested_days ?? leave.days ?? 0);

      const leaveCategory =
        leave.leave_category ||
        (leave.leave_type === "Paid" || leave.leave_type === "Earned"
          ? "Paid"
          : "Unpaid");

      let availablePaid = 0;

      if (leaveCategory === "Paid") {
        availablePaid = Number(balance.paid_leave_balance || 0);
      }

      const canApprove = leaveCategory !== "Paid" || availablePaid >= requestedDays;
      const paidDays = leaveCategory === "Paid" && canApprove ? requestedDays : 0;
      const unpaidDays = leaveCategory === "Unpaid" ? requestedDays : 0;

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
        can_approve: canApprove,
        leave_duration_type: leave.leave_duration_type || "full_day",
        half_day_session: leave.half_day_session,
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
const changeLeaveStatus = async (req, res) => {
    try {
      const { id } = req.params;

      const {
        status,
        rejection_reason,
        include_sunday_penalty = false,
        paid_days,
        unpaid_days,
        salary_deduction_days,
        leave_category,
        penalty_days,
      } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be approved or rejected" });
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

      if (leave.status !== "pending") {
        return res.status(400).json({ message: `Leave is already ${leave.status}` });
      }

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
      let deduction = null;
      let approvedPreview = null;

      if (status === "approved") {
        const fromDateObj = new Date(leave.from_date);

        if (Number.isNaN(fromDateObj.getTime())) {
          return res.status(400).json({
            message: "Invalid leave from_date",
            from_date: leave.from_date,
          });
        }

        approvedPreview = await buildApprovalPreview(leave, include_sunday_penalty === true);
        if (!approvedPreview.can_approve) {
          return res.status(400).json({
            message: `Insufficient paid leave balance. Available: ${approvedPreview.available_paid_balance}`,
          });
        }

        const submittedCalculations = [
          [paid_days, approvedPreview.paid_days, "paid_days"],
          [unpaid_days, approvedPreview.unpaid_days, "unpaid_days"],
          [salary_deduction_days, approvedPreview.salary_deduction_days, "salary_deduction_days"],
          [penalty_days, approvedPreview.penalty_days, "penalty_days"],
        ];
        for (const [submitted, calculated, field] of submittedCalculations) {
          if (submitted !== undefined && !sameNumber(submitted, calculated)) {
            return res.status(409).json({ message: `${field} changed; refresh the approval preview` });
          }
        }
        if (leave_category && leave_category !== approvedPreview.final_category) {
          return res.status(409).json({ message: "leave_category changed; refresh the approval preview" });
        }

        deduction = await deductApprovedLeave(
          leave.user_id,
          approvedPreview.requested_days,
          leave.leave_type,
          fromDateObj
        );

        updateFields += `
          , approved_by = $${paramIndex}
          , approved_at = CURRENT_TIMESTAMP
          , rejection_reason = NULL
          , leave_category = $${paramIndex + 1}
          , is_paid_leave = $${paramIndex + 2}
          , paid_days = $${paramIndex + 3}
          , unpaid_days = $${paramIndex + 4}
          , salary_deduction_days = $${paramIndex + 5}
          , penalty_applied = $${paramIndex + 6}
          , penalty_days = $${paramIndex + 7}
          , include_sunday_penalty = $${paramIndex + 8}
          , policy_reason = $${paramIndex + 9}
        `;

        params.push(
          req.user.id,
          approvedPreview.final_category,
          approvedPreview.paid_days > 0,
          approvedPreview.paid_days,
          approvedPreview.unpaid_days,
          approvedPreview.salary_deduction_days,
          approvedPreview.penalty_days > 0,
          approvedPreview.penalty_days,
          approvedPreview.include_sunday_penalty,
          approvedPreview.policy_reason
        );

        paramIndex += 10;
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

      if (status === "approved") {
        await syncApprovedLeaveAttendance(leave, deduction);
      }

      const actorResult = await pool.query(
        "SELECT id, full_name, email, role, branch FROM users WHERE id = $1",
        [req.user.id]
      );
      const actor = actorResult.rows[0] || req.user;
      const changeReason = status === "rejected"
        ? (rejection_reason || "No rejection reason supplied")
        : (approvedPreview?.policy_reason || "Leave request approved");

      await logActivity({
        userId: actor.id,
        userName: actor.full_name || actor.email || "Unknown user",
        role: actor.role || req.user.role,
        action: "LEAVE_CHANGED",
        actionType: "leave_changed",
        moduleName: "Leave",
        details: `Leave for ${leave.full_name} changed from ${leave.status} to ${status}. Reason: ${changeReason}.`,
        ip: getClientIp(req),
        branch: leave.branch || actor.branch || "all",
        metadata: {
          employeeName: leave.full_name,
          employeeId: leave.user_id,
          leaveId: leave.id,
          oldStatus: leave.status,
          newStatus: status,
          changedBy: actor.full_name || actor.email || "Unknown user",
          paidDays: approvedPreview?.paid_days || 0,
          unpaidDays: approvedPreview?.unpaid_days || 0,
          salaryDeductionDays: approvedPreview?.salary_deduction_days || 0,
          reason: changeReason,
        },
      });

      res.json({
        message: "Leave status updated",
        leave_request_id: leave.id,
        status,
        calculation: approvedPreview,
      });

      try {
        await notifyLeaveStatus(
          req.user,
          {
            id: leave.id,
            leave_type: leave.leave_type,
            days: Number(leave.requested_days ?? leave.days),
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
      const isBalanceError = /Insufficient paid leave balance/i.test(error.message);
      res.status(isBalanceError ? 400 : 500).json({
        message: "Failed to update leave",
        error: error.message,
      });
    }
};

router.patch(
  "/leave/:id/status",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  changeLeaveStatus
);

router.put(
  "/leaves/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  changeLeaveStatus
);

/* ✅ Create leave request */
router.post("/leaves", verifyToken, async (req, res) => {
  try {
    const { user_id } = req.body;

    if (req.user.role !== "SUPER_ADMIN" && req.user.id !== user_id) {
      return res.status(403).json({
        message: "Access denied – you can only request leaves for yourself",
      });
    }

    const leave = await createValidatedLeaveRequest(user_id, req.body);
    res.status(201).json(leave);

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
        await notifyLeaveApply(applicant.rows[0], leave);
      }
    } catch (notifyError) {
      console.error("Leave apply notification error:", notifyError);
    }
  } catch (error) {
    console.error("Create leave error:", error);
    const isValidationError = /required|must|cannot|invalid|Insufficient|no working days/i.test(error.message);
    res.status(isValidationError ? 400 : 500).json({
      message: isValidationError ? error.message : "Failed to create leave request",
      error: error.message,
    });
  }
});

export default router;
