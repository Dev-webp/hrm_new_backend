// notificationTriggers.js
// Import emitNotification from socketManager and call these helpers
// from your existing route handlers (attendanceRoutes, leaveRoutes, etc.)
//
// HOW TO USE:
//   import { notifyCheckin, notifyCheckout, notifyLateLogin,
//            notifyLeaveApply, notifyLeaveStatus,
//            notifyBreakExceeded, notifyPayslipGenerated } from "./notificationTriggers.js";
//
// Then call them AFTER the DB operation succeeds.

import { emitNotification } from "../socketManager.js";

// ─── ATTENDANCE ──────────────────────────────────────────────────────────────

/**
 * Call inside POST /api/attendance/checkin  (after INSERT)
 * @param {Object} user  - { id, full_name, branch, department }
 * @param {string} checkInTime - "HH:MM:SS"
 * @param {number} lateMinutes
 * @param {number} recordId - attendance_records.id
 */
export async function notifyCheckin(user, checkInTime, lateMinutes, recordId) {
  const time = checkInTime ? checkInTime.slice(0, 5) : "--:--";
  const lateNote = lateMinutes > 0 ? ` ⚠️ ${lateMinutes} min LATE` : "";

  await emitNotification({
    userId: user.id,
    actionType: "checkin",
    description: `${user.full_name} checked in at ${time}${lateNote} — ${user.branch}`,
    relatedId: recordId,
    targetRole: "BOTH",
    branch: user.branch,
  });
}

/**
 * Call inside POST /api/attendance/checkout  (after UPDATE)
 */
export async function notifyCheckout(user, checkOutTime, productionHours, recordId) {
  const time = checkOutTime ? checkOutTime.slice(0, 5) : "--:--";

  const hours = Number(productionHours || 0);

  await emitNotification({
    userId: user.id,
    actionType: "checkout",
    description: `${user.full_name} checked out at ${time} — ${hours.toFixed(1)} hrs production — ${user.branch}`,
    relatedId: recordId,
    targetRole: "BOTH",
    branch: user.branch,
  });
}
/**
 * Call after computing status when lateMinutes > 0 on checkin
 */
export async function notifyLateLogin(user, lateMinutes, recordId) {
  await emitNotification({
    userId: user.id,
    actionType: "late_login",
    description: `🔴 Late Login: ${user.full_name} is ${lateMinutes} min late — ${user.branch} / ${user.department}`,
    relatedId: recordId,
    targetRole: "BOTH",
    branch: user.branch,
  });
}

// ─── LEAVE ───────────────────────────────────────────────────────────────────

/**
 * Call inside POST /api/leaves  (after INSERT)
 * @param {Object} user  - the applicant
 * @param {Object} leave - { id, leave_type, from_date, to_date, days }
 */
export async function notifyLeaveApply(user, leave) {
  await emitNotification({
    userId: user.id,
    actionType: "leave_request",
    description: `📋 Leave Request: ${user.full_name} applied for ${leave.leave_type} leave (${leave.days} day${leave.days > 1 ? "s" : ""}) — ${leave.from_date} to ${leave.to_date}`,
    relatedId: leave.id,
    targetRole: "BOTH",
    branch: user.branch,
  });
}

/**
 * Call inside PUT /api/leaves/:id  (after status update)
 * @param {Object} updatedBy - manager/admin who changed the status
 * @param {Object} leave     - { id, leave_type, days, user_id, user_name, branch }
 * @param {string} newStatus - 'approved' | 'rejected'
 */
export async function notifyLeaveStatus(updatedBy, leave, newStatus) {
  const emoji = newStatus === "approved" ? "✅" : "❌";
  await emitNotification({
    userId: leave.user_id,
    actionType: "leave_status",
    description: `${emoji} Leave ${newStatus.toUpperCase()}: ${leave.user_name}'s ${leave.leave_type} leave was ${newStatus} by ${updatedBy.full_name}`,
    relatedId: leave.id,
    targetRole: "BOTH",
    branch: leave.branch,
  });
}

// ─── BREAKS ──────────────────────────────────────────────────────────────────

/**
 * Call after saving breaks when total > 60 min
 * @param {Object} user          - { id, full_name, branch, department }
 * @param {number} totalMinutes  - total break minutes today
 */
export async function notifyBreakExceeded(user, totalMinutes) {
  await emitNotification({
    userId: user.id,
    actionType: "break_update",
    description: `⏰ Break Exceeded: ${user.full_name} used ${totalMinutes} min breaks today (limit: 60 min) — ${user.branch}`,
    targetRole: "BOTH",
    branch: user.branch,
  });
}

/**
 * Call on break start / end for a record
 */
export async function notifyBreakUpdate(user, breakType, action, breakId) {
  const labels = { break1: "Break 1", lunch: "Lunch", break2: "Break 2", break3: "Break 3" };
  const label = labels[breakType] || breakType;
  await emitNotification({
    userId: user.id,
    actionType: "break_update",
    description: `☕ ${user.full_name} ${action === "start" ? "started" : "ended"} ${label} — ${user.branch}`,
    relatedId: breakId,
    targetRole: "MANAGER",
    branch: user.branch,
  });
}

// ─── PAYROLL ─────────────────────────────────────────────────────────────────

/**
 * Call inside POST /api/payroll/generate  (after INSERT)
 * @param {Object} generatedBy - admin who generated it
 * @param {Object} payslip     - { id, user_id, user_name, month, net_pay }
 */
export async function notifyPayslipGenerated(generatedBy, payslip) {
  const month = new Date(payslip.month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  await emitNotification({
    userId: payslip.user_id,
    actionType: "payslip_generated",
    description: `💰 Payslip Generated: ${payslip.user_name} — ₹${Number(payslip.net_pay).toLocaleString("en-IN")} for ${month}`,
    relatedId: payslip.id,
    targetRole: "SUPER_ADMIN",
  });
}

/**
 * Call when payment status is toggled to 'paid'
 */
export async function notifyPayslipPaid(adminUser, payslip) {
  const month = new Date(payslip.month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  await emitNotification({
    userId: payslip.user_id,
    actionType: "payslip_paid",
    description: `✅ Salary Paid: ${payslip.user_name} — ₹${Number(payslip.net_pay).toLocaleString("en-IN")} for ${month}`,
    relatedId: payslip.id,
    targetRole: "SUPER_ADMIN",
  });
}