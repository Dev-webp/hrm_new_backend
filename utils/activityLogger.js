// utils/activityLogger.js
import { pool } from "../middleware/db.js";
import { getIO }  from "../socketManager.js";
import {
  formatProductionHours,
  formatTime12Hour,
} from "./timeFormat.js";

// ═══════════════════════════════════════════════════════════
// AUDIT LOG (audit_logs table — field-level change trail)
// ═══════════════════════════════════════════════════════════
export function getClientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "0.0.0.0"
  );
}

export function getDeviceInfo(req) {
  return req.headers["user-agent"] || "Unknown";
}

export async function createAuditLog({
  performedBy,
  userId,
  role,
  module,
  action,
  targetId     = null,
  targetName   = null,
  fieldChanged = null,
  oldValue     = null,
  newValue     = null,
  reason       = null,
  ipAddress    = "0.0.0.0",
  deviceInfo   = null,
  status       = "SUCCESS",
  branch       = null,
}) {
  try {
    const result = await pool.query(
      `INSERT INTO audit_logs
         (user_id, user_name, user_role, module_name, action_type,
          target_id, target_name, field_changed, old_value, new_value,
          reason, ip_address, device_info, status, branch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [userId, performedBy, role, module, action,
       targetId, targetName, fieldChanged, oldValue, newValue,
       reason, ipAddress, deviceInfo, status, branch]
    );
    const log = result.rows[0];
    const io = getIO();
    if (io) {
      io.to("role:SUPER_ADMIN").emit("new_audit_log", log);
      if (branch && branch !== "all")
        io.to(`branch:${branch}`).emit("new_audit_log", log);
    }
    return log;
  } catch (err) {
    console.error("❌ createAuditLog error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// ACTIVITY LOG (activity_logs table — operational feed)
// ═══════════════════════════════════════════════════════════
const SEVERITY_MAP = {
  Login: "info",         Logout: "info",        Create: "info",
  Edit: "warning",       Delete: "critical",    Approve: "info",
  Reject: "warning",     System: "info",        CheckIn: "info",
  CheckOut: "info",      LateLogin: "warning",  LeaveApply: "info",
  LeaveApprove: "info",  LeaveReject: "warning", BreakStart: "info",
  BreakEnd: "info",      BreakExceeded: "warning", PayslipGen: "info",
  PayslipPaid: "info",   SettingsUpdate: "warning", FailedLogin: "critical",
  Suspicious: "critical", ATTENDANCE_EDITED: "warning", BREAK_EDITED: "warning",
  EMPLOYEE_MARKED_INACTIVE: "warning", EMPLOYEE_STATUS_CHANGED: "warning",
  LEAVE_CHANGED: "warning",
};

function sanitizeStr(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
    .slice(0, 1000);
}

function sanitizeIP(ip) {
  if (!ip || typeof ip !== "string") return "0.0.0.0";
  const raw = ip.split(",")[0].trim();
  if (/^[\d.:a-fA-F]+$/.test(raw)) return raw.slice(0, 64);
  return "0.0.0.0";
}

const recentKeys = new Map();
const DEDUP_WINDOW_MS = 2000;

function isDuplicate(key) {
  const last = recentKeys.get(key);
  const now  = Date.now();
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentKeys.set(key, now);
  if (recentKeys.size > 500)
    for (const [k, t] of recentKeys.entries())
      if (now - t > DEDUP_WINDOW_MS * 10) recentKeys.delete(k);
  return false;
}

export async function logActivity({
  userId = null, userName = "system", role = "SYSTEM",
  action, details, ip = "0.0.0.0", branch = "all", metadata = {},
  actionType = null, moduleName = null, department = null,
}) {
  try {
    const safeUser    = sanitizeStr(userName);
    const safeRole    = sanitizeStr(role).slice(0, 50);
    const safeAction  = sanitizeStr(action).slice(0, 100);
    const safeDetails = sanitizeStr(details);
    const safeIP      = sanitizeIP(ip);
    const safeBranch  = sanitizeStr(branch).slice(0, 100);
    const safeActionType = actionType ? sanitizeStr(actionType).slice(0, 100) : null;
    const safeModuleName = moduleName ? sanitizeStr(moduleName).slice(0, 100) : null;
    const safeDepartment = department ? sanitizeStr(department).slice(0, 100) : null;
    const severity    = SEVERITY_MAP[safeAction] ?? "info";

    if (isDuplicate(`${userId}:${safeAction}:${safeDetails}`)) return;

    const result = await pool.query(
      `INSERT INTO activity_logs
         (user_id, user_name, role, action, action_type, module_name, details,
          ip_address, branch, department, severity, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [userId, safeUser, safeRole, safeAction, safeActionType,
       safeModuleName, safeDetails, safeIP, safeBranch, safeDepartment,
       severity, JSON.stringify(metadata)]
    );
    const log = result.rows[0];

    const io = getIO();
    if (io) {
      io.to("role:SUPER_ADMIN").emit("new_audit_log", log);
      if (safeBranch && safeBranch !== "all")
        io.to(`branch:${safeBranch}`).emit("new_audit_log", log);
    }
    return log;
  } catch (err) {
    console.error("❌ activityLogger error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// CONVENIENCE WRAPPERS
// ═══════════════════════════════════════════════════════════
export const logLogin = (user, ip) =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Login", details: `${user.full_name} logged in`,
    ip, branch: user.branch ?? "all" });

export const logLogout = (user, ip) =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Logout", details: `${user.full_name} ended session`,
    ip, branch: user.branch ?? "all" });

export const logFailedLogin = (email, ip) =>
  logActivity({ userId: null, userName: email, role: "UNKNOWN",
    action: "FailedLogin", details: `Failed login attempt for ${email}`,
    ip, branch: "all", metadata: { email } });

export const logCreate = (user, entity, entityId, extra = {}, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Create", details: `Created ${entity}`,
    ip, branch: user.branch ?? "all", metadata: { entityId, ...extra } });

export const logEdit = (user, entity, entityId, extra = {}, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Edit", details: `Updated ${entity}`,
    ip, branch: user.branch ?? "all", metadata: { entityId, ...extra } });

export const logDelete = (user, entity, entityId, extra = {}, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Delete", details: `Deleted ${entity} #${entityId}`,
    ip, branch: user.branch ?? "all", metadata: { entityId, ...extra } });

export const logApprove = (user, entity, entityId, extra = {}, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Approve", details: `Approved ${entity}`,
    ip, branch: user.branch ?? "all", metadata: { entityId, ...extra } });

export const logReject = (user, entity, entityId, extra = {}, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "Reject", details: `Rejected ${entity}`,
    ip, branch: user.branch ?? "all", metadata: { entityId, ...extra } });

export const logSystem = (details, metadata = {}) =>
  logActivity({ userId: null, userName: "system", role: "SYSTEM",
    action: "System", details, ip: "127.0.0.1", branch: "all", metadata });

export const logCheckin = (user, time, lateMinutes, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "CheckIn",
    details: `${user.full_name} checked in at ${formatTime12Hour(time)}${lateMinutes > 0 ? ` (${lateMinutes}m late)` : ""}`,
    ip, branch: user.branch ?? "all", metadata: { time, lateMinutes } });

export const logCheckout = (user, time, productionHours, ip = "0.0.0.0") =>
  logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "CheckOut",
    details: `${user.full_name} checked out at ${formatTime12Hour(time)} — ${formatProductionHours(productionHours)} production`,
    ip, branch: user.branch ?? "all", metadata: { time, productionHours } });

export const logLeaveApply = (user, leave, ip = "0.0.0.0") => {
  const requestedDays = Number(leave.requested_days ?? leave.days ?? 0);
  return logActivity({ userId: user.id, userName: user.full_name, role: user.role,
    action: "LeaveApply",
    details: `${user.full_name} applied ${leave.leave_type} leave (${requestedDays} day${requestedDays > 1 ? "s" : ""})`,
    ip, branch: user.branch ?? "all",
    metadata: { leaveId: leave.id, leave_type: leave.leave_type } });
};

export const logPayslip = (admin, payslip, ip = "0.0.0.0") =>
  logActivity({ userId: admin.id, userName: admin.full_name, role: admin.role,
    action: "PayslipGen",
    actionType: "payslip_generated", moduleName: "Payroll",
    details: `Payslip generated for ${payslip.user_name} — ₹${Number(payslip.net_pay).toLocaleString("en-IN")}`,
    ip, branch: admin.branch ?? "all", metadata: {
      payslipId: payslip.id,
      employeeName: payslip.user_name,
      month: payslip.month || null,
      netPay: Number(payslip.net_pay),
      generatedBy: admin.full_name || admin.email || "Unknown user",
    } });

