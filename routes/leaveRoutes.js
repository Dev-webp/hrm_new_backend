import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles, canAccessAllBranches, normalizeBranchFilter } from "../middleware/auth.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";

import {
  evaluateLeaveOnApproval,
  getProfessionalLeaveBalance,
  deductApprovedLeaveSplit,
} from "../utils/leavePolicy.js";
import {
  notifyLeaveApply,
  notifyLeaveDeleted,
  notifyLeaveStatus,
} from "./notificationTriggers.js";
import { createValidatedLeaveRequest } from "../services/leaveRequestService.js";
import {
  attendanceStatusForLeave,
  halfDaySlotForSession,
} from "../utils/leaveRequestPolicy.js";
import { recalcAttendanceForUserDate } from "./attendanceRoutes.js";

const router = express.Router();

function sameNumber(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) < 0.001;
}

async function buildApprovalPreview(leave, includeSundayPenalty = false) {
  const fromDate = new Date(leave.from_date);
  if (Number.isNaN(fromDate.getTime())) throw new Error("Invalid leave from_date");

  const balance = await getProfessionalLeaveBalance(leave.user_id, fromDate);
  const requestedDays = Number(leave.requested_days ?? leave.days ?? 0);
  const employeeUsePaidLeave = leave.use_paid_leave === true || leave.use_paid_leave === "true";
  const availablePaid = Number(balance.paid_leave_balance || 0);
  const paidDays = employeeUsePaidLeave ? Math.min(requestedDays, availablePaid) : 0;
  const unpaidDays = Math.max(0, requestedDays - paidDays);
  const remainingPaidBalance = Math.max(0, availablePaid - paidDays);
  const finalCategory = paidDays > 0 ? "Paid" : "Unpaid";
  const canApprove = true;

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
  reasons.push(employeeUsePaidLeave ? "Employee chose to use paid leave" : "Employee chose not to use paid leave");
  if (!reasons.length) reasons.push("Normal leave approval");

  return {
    leave_request_id: leave.id,
    employee_name: leave.full_name,
    employee_id: leave.employee_code || leave.user_id,
    employee_code: leave.employee_code || null,
    department: leave.department || null,
    branch: leave.branch || null,
    leave_type: leave.leave_type,
    leave_category: finalCategory,
    leave_duration_type: leave.leave_duration_type || "full_day",
    half_day_session: leave.half_day_session || null,
    requested_days: requestedDays,
    current_status: leave.status,
    applied_date: leave.created_at,
    reason: leave.reason?.trim() || "No reason provided.",
    use_paid_leave: employeeUsePaidLeave,
    employee_use_paid_leave: employeeUsePaidLeave,
    available_paid_balance: availablePaid,
    paid_days: paidDays,
    unpaid_days: unpaidDays,
    remaining_paid_balance: remainingPaidBalance,
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
    `SELECT l.*, u.full_name, u.branch, u.department, u.employee_code
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
  const durationType = leave.leave_duration_type || "full_day";
  const attendanceStatus = attendanceStatusForLeave(durationType);
  const halfDaySlot = halfDaySlotForSession(leave.half_day_session);
  const from = new Date(String(leave.from_date).slice(0, 10));
  const to = new Date(String(leave.to_date).slice(0, 10));
  const userResult = await pool.query(
    "SELECT branch, department FROM users WHERE id = $1",
    [leave.user_id]
  );
  const user = userResult.rows[0] || {};
  let paidRemaining = Number(deduction.paid_days || 0);

  const holidays = await pool.query(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1 AND $2
       AND type = 'holiday'
       AND (LOWER(COALESCE(branch, 'all')) = 'all' OR branch = $3)`,
    [leave.from_date, leave.to_date, user.branch]
  );
  const holidayDates = new Set(holidays.rows.map((row) => row.date));

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    if (d.getDay() === 0 || holidayDates.has(dateStr)) continue;

    const dayWeight = durationType === "half_day" ? 0.5 : 1;
    const isPaid = paidRemaining > 0;
    const paidForDay = isPaid ? Math.min(dayWeight, paidRemaining) : 0;
    paidRemaining = Math.max(0, paidRemaining - paidForDay);

    await pool.query(
      `INSERT INTO attendance_records (
         user_id, date, status, leave_type, leave_status, is_paid_leave,
         leave_request_id, half_day_slot, branch, department
       )
       VALUES ($1,$2,$3,$4,'approved',$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, date) DO UPDATE SET
         status = EXCLUDED.status,
         leave_type = EXCLUDED.leave_type,
         leave_status = EXCLUDED.leave_status,
         is_paid_leave = EXCLUDED.is_paid_leave,
         leave_request_id = EXCLUDED.leave_request_id,
         half_day_slot = EXCLUDED.half_day_slot,
         updated_at = CURRENT_TIMESTAMP`,
      [
        leave.user_id,
        dateStr,
        attendanceStatus,
        isPaid ? "Paid" : "Unpaid",
        isPaid,
        leave.id,
        halfDaySlot,
        user.branch || leave.branch || null,
        user.department || leave.department || null,
      ]
    );
  }
}

async function recalcLeaveAttendanceDates(leave, source) {
  const from = new Date(String(leave.from_date).slice(0, 10));
  const to = new Date(String(leave.to_date).slice(0, 10));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    await recalcAttendanceForUserDate(leave.user_id, dateStr, { source });
  }
}

/* ✅ GET leave balance */
router.get(
  "/leaves/my/balance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN", "EMPLOYEE"),
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN", "EMPLOYEE"),
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
          use_paid_leave,
          balance_at_application,
          paid_days,
          unpaid_days,
          remaining_paid_balance,
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
  "/leaves/approved-monthly",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { userId, month } = req.query;

      if (!userId || !month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "userId and month=YYYY-MM are required" });
      }

      const [year, monthNumber] = month.split("-").map(Number);
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;

      const targetUser = await pool.query(
        "SELECT id, branch FROM users WHERE id = $1 AND role != 'SUPER_ADMIN'",
        [userId]
      );

      if (!targetUser.rows.length) {
        return res.status(404).json({ message: "User not found" });
      }

      if (req.user.role === "MANAGER" && targetUser.rows[0].branch !== req.user.branch) {
        return res.status(403).json({ message: "Managers can only view leaves in their own branch" });
      }

      const result = await pool.query(
        `
        SELECT
          l.id,
          l.user_id,
          u.full_name,
          u.branch,
          u.department,
          l.leave_type,
          l.from_date,
          l.to_date,
          l.days,
          l.requested_days,
          l.leave_duration_type,
          l.half_day_session,
          l.use_paid_leave,
          l.balance_at_application,
          l.paid_days,
          l.unpaid_days,
          l.remaining_paid_balance,
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
        WHERE l.user_id = $1
          AND l.status = 'approved'
          AND l.from_date <= $3
          AND l.to_date >= $2
        ORDER BY l.from_date ASC, l.created_at DESC
        `,
        [userId, monthStart, monthEnd]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Monthly approved leaves fetch error:", error);
      res.status(500).json({ message: "Failed to fetch monthly approved leaves" });
    }
  }
);

router.get(
  "/leaves",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { date, status } = req.query;
      const branch = normalizeBranchFilter(req.query.branch);

      let query = `
        SELECT 
          l.id,
          l.user_id,
          u.full_name,
          u.branch,
          u.department,
          l.leave_type,
          l.from_date,
          l.to_date,
          l.days,
          l.requested_days,
          l.leave_duration_type,
          l.half_day_session,
          l.use_paid_leave,
          l.balance_at_application,
          l.paid_days,
          l.unpaid_days,
          l.remaining_paid_balance,
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

      if (canAccessAllBranches(req.user) && branch && branch !== "all") {
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
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
  authorizeRoles("OPERATIONAL_MANAGER", "MANAGER"),
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
      console.error("Manager pending leave count error:", error);
      res.status(500).json({ message: "Failed to fetch manager pending leave count" });
    }
  }
);

/* ✅ Approval preview */
router.get(
  "/leave/:id/approval-preview",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const scoped = await getScopedLeave(req, req.params.id);
      if (scoped.error) return res.status(scoped.error.status).json({ message: scoped.error.message });
      const preview = await buildApprovalPreview(
        scoped.leave,
        req.query.include_sunday_penalty === "true"
      );
      return res.json(preview);

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

        deduction = await deductApprovedLeaveSplit(
          leave.user_id,
          approvedPreview.paid_days,
          approvedPreview.unpaid_days,
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
          , remaining_paid_balance = $${paramIndex + 10}
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
          approvedPreview.policy_reason,
          approvedPreview.remaining_paid_balance
        );

        paramIndex += 11;
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
        await recalcLeaveAttendanceDates(leave, "leave_approval");
      } else if (status === "rejected") {
        await recalcLeaveAttendanceDates(leave, "leave_rejection");
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
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
  changeLeaveStatus
);

router.put(
  "/leaves/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"),
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

const deleteLeaveRequest = async (req, res) => {
  const { id } = req.params;

  try {
    const leaveResult = await pool.query(
      `
      SELECT l.*, u.full_name, u.email, u.branch, u.department, u.employee_code
      FROM leave_requests l
      JOIN users u ON u.id = l.user_id
      WHERE l.id = $1
      `,
      [id]
    );

    if (!leaveResult.rows.length) {
      return res.status(404).json({ message: "Leave request not found" });
    }

    const leave = leaveResult.rows[0];
    const role = req.user.role;
    const isOwnLeave = Number(leave.user_id) === Number(req.user.id);

    if (role === "EMPLOYEE" || role === "SUB_ADMIN") {
      if (!isOwnLeave) {
        return res.status(403).json({ message: "You can delete only your own leave requests" });
      }
      if (leave.status !== "pending") {
        return res.status(403).json({ message: "Only pending leave requests can be deleted by employees" });
      }
    } else if (role === "MANAGER" && leave.branch !== req.user.branch) {
      return res.status(403).json({ message: "Access denied - different branch" });
    } else if (!["SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    await pool.query("DELETE FROM leave_requests WHERE id = $1", [id]);

    const actorResult = await pool.query(
      "SELECT id, full_name, email, role, branch FROM users WHERE id = $1",
      [req.user.id]
    );
    const actor = actorResult.rows[0] || req.user;

    await logActivity({
      userId: actor.id,
      userName: actor.full_name || actor.email || "Unknown user",
      role: actor.role || role,
      action: "Delete",
      actionType: "leave_changed",
      moduleName: "Leave",
      details: `Leave Request Deleted for ${leave.full_name} (${leave.leave_type}, ${leave.from_date} to ${leave.to_date}).`,
      ip: getClientIp(req),
      branch: leave.branch || actor.branch || "all",
      department: leave.department || null,
      metadata: {
        event: "Leave Request Deleted",
        leaveId: leave.id,
        employeeId: leave.user_id,
        employeeCode: leave.employee_code || null,
        employeeName: leave.full_name,
        deletedBy: actor.full_name || actor.email || "Unknown user",
        deletedByRole: actor.role || role,
        leaveType: leave.leave_type,
        fromDate: leave.from_date,
        toDate: leave.to_date,
        requestedDays: Number(leave.requested_days ?? leave.days ?? 0),
        status: leave.status,
        reason: leave.reason || "No reason provided",
      },
    });

    try {
      await notifyLeaveDeleted(
        actor,
        { id: leave.id, user_id: leave.user_id, branch: leave.branch },
        isOwnLeave && (role === "EMPLOYEE" || role === "SUB_ADMIN")
      );
    } catch (notifyError) {
      console.error("Leave delete notification error:", notifyError);
    }

    const countParams = [];
    let branchClause = "";
    if (role === "MANAGER") {
      countParams.push(req.user.branch);
      branchClause = "AND u.branch = $1";
    }
    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS count
      FROM leave_requests l
      JOIN users u ON u.id = l.user_id
      WHERE l.status = 'pending' ${branchClause}
      `,
      countParams
    );

    res.json({
      message: "Leave request deleted successfully",
      leave_request_id: Number(id),
      pending_count: Number(countResult.rows[0]?.count || 0),
    });
  } catch (error) {
    console.error("Delete leave error:", error);
    res.status(500).json({ message: "Failed to delete leave request", error: error.message });
  }
};

router.delete(
  "/leave/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN", "EMPLOYEE"),
  deleteLeaveRequest
);

router.delete(
  "/leaves/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN", "EMPLOYEE"),
  deleteLeaveRequest
);

export default router;

