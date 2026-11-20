/**
 * ============================================================
 * PAYROLL ROUTES — VJC OVERSEAS HRMS
 * ============================================================
 * Mount at: /api/payroll
 * Fixes applied:
 *   1. PDF shows correct formula (no double-deduction)
 *   2. Joining date properly fetched and returned
 *   3. Activity logging for payslip generation (logPayslip)
 * ============================================================
 */

import express from "express";
import PDFDocument from "pdfkit";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import {
  calculatePayroll,
  batchCalculatePayroll,
  persistPayslip,
  fmtINR,
} from "./payrollService.js";
import { notifyPayslipGenerated } from "./notificationTriggers.js";
import { logPayslip, getClientIp } from "../utils/activityLogger.js";

const router = express.Router();

// ── Helper: month date range ──────────────────────────────────
function monthRange(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, year: y, month: m };
}

// ── Helper: shift date by days ─────────────────────────────────
function shiftDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Helper: days in month ─────────────────────────────────────
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ── Helper: parse year/month from "YYYY-MM", "YYYY-MM-DD", or Date object ──
function parseYearMonth(monthValue) {
  if (!monthValue) {
    const err = new Error("month is required");
    err.statusCode = 400;
    throw err;
  }

  let monthStr;

  // Handle Date object
  if (monthValue instanceof Date) {
    const year = monthValue.getFullYear();
    const month = monthValue.getMonth() + 1;
    monthStr = `${year}-${String(month).padStart(2, '0')}`;
  } else {
    // Handle string
    monthStr = String(monthValue).trim();
  }

  const match = monthStr.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);

  if (!match) {
    const err = new Error("Invalid month format. Use YYYY-MM, example: 2026-06");
    err.statusCode = 400;
    throw err;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!year || month < 1 || month > 12) {
    const err = new Error("Invalid month value. Month must be 01 to 12");
    err.statusCode = 400;
    throw err;
  }

  return { year, month };
}

function parseUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    const err = new Error("Invalid user_id. user_id must be a positive integer");
    err.statusCode = 400;
    throw err;
  }
  return userId;
}





// ── Helper: safe JSON parse for breakdown column ──────────────
function parseBreakdown(row) {
  if (!row) return row;
  if (row.breakdown && typeof row.breakdown === "string") {
    try { row.breakdown = JSON.parse(row.breakdown); } catch (_) { row.breakdown = {}; }
  }
  return row;
}

// ============================================================
// GET /api/payroll/employees
// ============================================================
router.get(
  "/payroll/employees",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { branch, department, search } = req.query;
      let q = `
        SELECT
          id, full_name, email, department, branch,
          salary, employee_code,
          TO_CHAR(
            COALESCE(joining_date, DATE(created_at)),
            'YYYY-MM-DD'
          ) AS joining_date
        FROM users
        WHERE role IN ('EMPLOYEE','MANAGER','OPERATIONAL_MANAGER','SUB_ADMIN','HR') AND salary > 0
          AND (employment_status = 'ACTIVE' OR employment_status IS NULL)
      `;
      const params = [];
      let idx = 1;
      if (branch && branch !== "all") {
        q += ` AND branch = $${idx}`; params.push(branch); idx++;
      }
      if (department && department !== "all") {
        q += ` AND department = $${idx}`; params.push(department); idx++;
      }
      if (search) {
        q += ` AND (full_name ILIKE $${idx} OR department ILIKE $${idx})`;
        params.push(`%${search}%`); idx++;
      }
      q += " ORDER BY full_name";
      const result = await pool.query(q, params);
      res.json(result.rows);
    } catch (err) {
      console.error("payroll/employees:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// GET /api/payroll/attendance-preview
// ============================================================
router.get(
  "/payroll/attendance-preview",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { user_id, month } = req.query;
      if (!user_id) return res.status(400).json({ message: "user_id required" });
      const userId = parseUserId(user_id);
      const { year, month: m } = parseYearMonth(month);
      const calc = await calculatePayroll(pool, userId, year, m);
      res.json({
        calendar  : calc.calendar,
        attendance: calc.attendance,
        leave     : calc.leave,
        salary    : calc.salary,
        employee  : calc.employee,
        sandwich  : calc.sandwich,
      });
    } catch (err) {
      console.error("payroll/attendance-preview:", err);
      res.status(err.statusCode || 500).json({
        message: err.statusCode ? err.message : "Unable to load payslip attendance preview",
        detail: process.env.NODE_ENV === "production" ? undefined : err.message,
      });
    }
  }
);

// ============================================================
// POST /api/payroll/generate
// ============================================================
router.post(
  "/payroll/generate",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { user_id, month, incentives = 0, deductions = 0, tax = 0 } = req.body;
      console.log(`[PAYROLL GENERATE] Received values:`, { user_id, month, incentives, deductions, tax });
      
      if (!user_id || !month)
        return res.status(400).json({ message: "user_id and month are required" });

      const { year, month: m } = parseYearMonth(month);
      const userId = parseUserId(user_id);
      const calc = await calculatePayroll(pool, userId, year, m, {
        incentives       : Number(incentives),
        manualDeductions : Number(deductions),
        tax              : Number(tax),
      });
      
      console.log(`[PAYROLL GENERATE] Calculated salary:`, calc.salary);
      
      // Force manual update to preserve preview values even if they are 0
      const saved = await persistPayslip(pool, calc, { 
        incentives, 
        deductions, 
        tax,
        forceManualUpdate: true 
      });
      
      console.log(`[PAYROLL GENERATE] Saved payslip:`, {
        id: saved.id,
        incentives: saved.incentives,
        deductions: saved.deductions,
        tax: saved.tax,
        net_pay: saved.net_pay
      });

      // ✅ Activity log: payslip generated
      try {
        await logPayslip(
          req.user,
          {
            user_name: calc.employee.full_name,
            net_pay: calc.salary.netPay,
            id: saved.id,
            month: saved.month || month,
          },
          getClientIp(req)
        );
      } catch (logErr) {
        console.error("Failed to log payslip generation (single):", logErr.message);
      }

      // Notification (optional, real‑time)
      notifyPayslipGenerated(req.user, {
        id       : saved.id,
        user_id,
        user_name: calc.employee.full_name,
        month    : saved.month,
        net_pay  : calc.salary.netPay,
      }).catch(console.error);

      res.status(201).json({ ...saved, breakdown: calc });
    } catch (err) {
      console.error("payroll/generate:", err);
      res.status(err.statusCode || 500).json({ message: err.message });
    }
  }
);

// ============================================================
// DELETE /api/payroll/:id
// ============================================================
router.delete(
  "/payroll/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "DELETE FROM payslip_records WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Payslip not found" });
      }
      res.json({ message: "Payslip deleted successfully", payslip: result.rows[0] });
    } catch (err) {
      console.error("payroll/delete:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// POST /api/payroll/batch-generate
// ============================================================
router.post(
  "/payroll/batch-generate",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { month, branch, department } = req.body;
      if (!month) return res.status(400).json({ message: "month required" });

      const { year, month: m } = parseYearMonth(month);
      const batchResult = await batchCalculatePayroll(pool, year, m, { branch, department });

      const saved = [];
      for (const calc of batchResult.results) {
        try {
          const s = await persistPayslip(pool, calc, {});
          saved.push(s.id);

          // ✅ Activity log for each generated payslip (batch)
          try {
            await logPayslip(
              req.user,
              {
                user_name: calc.employee.full_name,
                net_pay: calc.salary.netPay,
                id: s.id,
                month: s.month || month,
              },
              getClientIp(req)
            );
          } catch (logErr) {
            console.error(`Failed to log batch payslip for user ${calc.employee.id}:`, logErr.message);
          }
        } catch (e) {
          batchResult.errors.push({ userId: calc.employee.id, error: e.message });
        }
      }

      res.json({
        message  : `Batch complete: ${saved.length} generated, ${batchResult.errors.length} failed`,
        generated: saved.length,
        failed   : batchResult.errors.length,
        errors   : batchResult.errors,
      });
    } catch (err) {
      console.error("payroll/batch-generate:", err);
      res.status(err.statusCode || 500).json({ message: err.message });
    }
  }
);

// ============================================================
// GET /api/payroll/payslips
// ============================================================
router.get(
  "/payroll/payslips",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { branch, department, search, month, page = 1, limit = 50 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const offset = (pageNum - 1) * limitNum;

      let q = `
        SELECT
          p.id, p.user_id, p.month, p.basic_salary, p.earned_basic,
          p.incentives, p.deductions, p.tax, p.net_pay,
          p.working_days, p.present_days, p.payment_status,
          p.breakdown, p.created_at, p.unpaid_leave_days,
          p.half_days, p.paid_sundays, p.unpaid_sundays, p.holidays,
          p.auth_awi, p.unauth_awi, p.full_days, p.absent_days,
          p.paid_leave, p.total_paid_days, p.late_login_count,
          p.awi_deduction_days, p.awi_deduction,
          u.full_name, u.department, u.branch,
          u.employee_code, u.salary AS monthly_ctc
        FROM payslip_records p
        JOIN users u ON p.user_id = u.id
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;

      if (branch && branch !== "all") {
        q += ` AND u.branch = $${idx}`; params.push(branch); idx++;
      }
      if (department && department !== "all") {
        q += ` AND u.department = $${idx}`; params.push(department); idx++;
      }
      if (search) {
        q += ` AND (u.full_name ILIKE $${idx} OR u.department ILIKE $${idx})`;
        params.push(`%${search}%`); idx++;
      }
      if (month) {
        q += ` AND p.month = $${idx}::date`;
        params.push(month.length === 7 ? month + "-01" : month); idx++;
      }

      const countQ = q.replace(
        /SELECT[\s\S]+?FROM payslip_records/,
        "SELECT COUNT(*) AS total FROM payslip_records"
      );
      const [countRes, dataRes] = await Promise.all([
        pool.query(countQ, params),
        pool.query(
          q + ` ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limitNum, offset]
        ),
      ]);

      const payslipsWithDetails = dataRes.rows;

      res.json({
        data : payslipsWithDetails,
        total: Number(countRes.rows[0]?.total || 0),
        page : pageNum,
        limit: limitNum,
        pages: Math.ceil(Number(countRes.rows[0]?.total || 0) / limitNum),
      });
    } catch (err) {
      console.error("payroll/payslips:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// GET /api/payroll/payslip/:id
// ============================================================
router.get(
  "/payroll/payslip/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "HR"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           p.*,
           u.full_name, u.department, u.branch, u.employee_code,
           u.salary AS monthly_ctc,
           TO_CHAR(COALESCE(u.joining_date, DATE(u.created_at)),'YYYY-MM-DD') AS joining_date
         FROM payslip_records p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = $1`,
        [req.params.id]
      );
      if (!result.rows.length)
        return res.status(404).json({ message: "Payslip not found" });
      const payslip = parseBreakdown(result.rows[0]);
      if (
        ["OPERATIONAL_MANAGER", "MANAGER", "HR"].includes(req.user.role) &&
        Number(payslip.user_id) !== Number(req.user.id)
      ) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(payslip);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// PUT /api/payroll/payslip/:id/status
// ============================================================
router.put(
  "/payroll/payslip/:id/status",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { payment_status } = req.body;
      if (!["paid", "unpaid"].includes(payment_status))
        return res.status(400).json({ message: "Invalid payment_status" });
      await pool.query(
        "UPDATE payslip_records SET payment_status=$1 WHERE id=$2",
        [payment_status, req.params.id]
      );
      res.json({ success: true, payment_status });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// PUT /api/payroll/payslip/:id/adjustments
// ============================================================
router.put(
  "/payroll/payslip/:id/adjustments",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { incentives, deductions, tax } = req.body;
      const { id } = req.params;
      
      // Validate inputs
      const numIncentives = Number(incentives) || 0;
      const numDeductions = Number(deductions) || 0;
      const numTax = Number(tax) || 0;
      
      // Get current payslip to recalculate net pay
      const current = await pool.query(
        "SELECT basic_salary, earned_basic, working_days FROM payslip_records WHERE id = $1",
        [id]
      );
      
      if (!current.rows.length) {
        return res.status(404).json({ message: "Payslip not found" });
      }
      
      const basicSalary = Number(current.rows[0].basic_salary);
      const workingDays = Number(current.rows[0].working_days);
      const dailyRate = basicSalary / (workingDays || 30);
      const earnedBasic = dailyRate * workingDays;
      const netPay = earnedBasic + numIncentives - numDeductions - numTax;
      
      // Update the payslip
      await pool.query(
        `UPDATE payslip_records 
         SET incentives = $1, deductions = $2, tax = $3, earned_basic = $4, net_pay = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [numIncentives, numDeductions, numTax, earnedBasic, netPay, id]
      );
      
      res.json({ 
        success: true, 
        incentives: numIncentives,
        deductions: numDeductions,
        tax: numTax,
        net_pay: netPay
      });
    } catch (err) {
      console.error("payslip adjustments error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ============================================================
// GET /api/payroll/payslip/:id/download   — PDF
// ============================================================
router.get(
  "/payroll/payslip/:id/download",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER", "MANAGER", "SUB_ADMIN", "EMPLOYEE", "HR"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT
           p.*,
           u.full_name, u.department, u.branch,
           u.employee_code, u.email,
           TO_CHAR(COALESCE(u.joining_date, DATE(u.created_at)),'YYYY-MM-DD') AS joining_date,
           u.salary AS monthly_ctc
         FROM payslip_records p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = $1`,
        [id]
      );
      if (!result.rows.length)
        return res.status(404).json({ message: "Payslip not found" });

      const p = parseBreakdown(result.rows[0]);
      if (
        ["EMPLOYEE", "MANAGER", "OPERATIONAL_MANAGER", "SUB_ADMIN", "HR"].includes(req.user.role) &&
        Number(p.user_id) !== Number(req.user.id)
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Dynamically recalculate attendance and salary based on current data
      const { year, month: m } = parseYearMonth(p.month);
      const calc = await calculatePayroll(pool, p.user_id, year, m, {
        incentives: Number(p.incentives || 0),
        manualDeductions: Number(p.deductions || 0),
        tax: Number(p.tax || 0),
      });

      // Use dynamically calculated breakdown
      const bd = calc;

      const monthLabel = new Date(p.month).toLocaleDateString("en-IN", {
        month: "long", year: "numeric",
      });

      const doc = new PDFDocument({ margin: 50, size: "A4" });

const isPreview = req.query.preview === "true";
const safeMonthLabel = monthLabel.replace(/\s+/g, "_");

res.setHeader("Content-Type", "application/pdf");
res.setHeader("Cache-Control", "no-store");

res.setHeader(
  "Content-Disposition",
  isPreview
    ? `inline; filename="payslip_${id}_${safeMonthLabel}.pdf"`
    : `attachment; filename="payslip_${id}_${safeMonthLabel}.pdf"`
);

doc.pipe(res);


      // ── Header bar ──────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 100).fill("#ff8c00");
      doc.fontSize(26).fillColor("#000000").font("Helvetica-Bold")
         .text("VJC OVERSEAS", 50, 22, { align: "left" });
      doc.fontSize(10).fillColor("#000000").font("Helvetica")
         .text("IMMIGRATION & VISA CONSULTANTS", 50, 52);
      doc.fontSize(12).fillColor("#ffffff")
         .text(`SALARY SLIP — ${monthLabel.toUpperCase()}`, 50, 68);

      const statusX = doc.page.width - 160;
      doc.roundedRect(statusX, 28, 110, 28, 6)
         .fill(p.payment_status === "paid" ? "#15803d" : "#92400e");
      doc.fontSize(11).fillColor("#ffffff").font("Helvetica-Bold")
         .text(
           p.payment_status === "paid" ? "✓  PAID" : "⏳  UNPAID",
           statusX, 37, { width: 110, align: "center" }
         );

      doc.y = 110;

      // ── Employee details ─────────────────────────────────────
      const labelColor = "#6b7280";
      const valueColor = "#111827";
      const tblW = doc.page.width - 100;

      doc.fontSize(11).fillColor("#000000").font("Helvetica-Bold")
         .text("EMPLOYEE DETAILS", 50, doc.y);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
         .strokeColor("#FF8C00").lineWidth(1).stroke();
      doc.moveDown(0.5);

      const dStart = doc.y;
      const col1 = 50, col2 = 300;

      function detailRow(label, value, x, y) {
        doc.fontSize(8).fillColor(labelColor).font("Helvetica").text(label, x, y);
        doc.fontSize(10).fillColor(valueColor).font("Helvetica-Bold")
           .text(String(value || "—"), x, y + 12, { width: 220 });
      }

      detailRow("EMPLOYEE NAME",       p.full_name,            col1, dStart);
      detailRow("EMPLOYEE ID",         p.employee_code || "—", col2, dStart);
      detailRow("DEPARTMENT",          p.department,            col1, dStart + 38);
      detailRow("BRANCH",              p.branch,                col2, dStart + 38);
      detailRow("JOINING DATE",        p.joining_date,          col1, dStart + 76);
      detailRow("EXPERIENCE",          `${bd.leave?.daysCompleted || 0} days`, col2, dStart + 76);
      detailRow("PAID LEAVE ELIGIBLE",
        bd.leave?.eligible ? "✓ YES (After 90 days)" : `✗ NOT YET (${bd.leave?.daysCompleted || 0}/90 days)`,
        col1, dStart + 114);
      detailRow("EMAIL",               p.email || "—",          col2, dStart + 114);

      doc.y = dStart + 160;

      // ── Attendance table ─────────────────────────────────────
      doc.fontSize(11).fillColor("#000000").font("Helvetica-Bold")
         .text("ATTENDANCE SUMMARY", 50, doc.y);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
         .strokeColor("#FF8C00").stroke();
      doc.moveDown(0.5);

      const attHeaders = ["Description", "Days", "Description", "Days"];
      const attData = [
        ["Total Days in Month",   bd.calendar?.totalDaysInMonth   ?? "—", "Working Days",     bd.calendar?.workingDaysCount  ?? "—"],
        ["Sundays (Paid)",        bd.sandwich?.paidSundays?.length ?? "—", "Company Holidays",  bd.calendar?.holidayCount     ?? "—"],
        ["Full Days Present",     bd.attendance?.fullDays           ?? "—", "Half Days",         bd.attendance?.halfDays         ?? "—"],
        ["Absent Days",           bd.attendance?.absentDays         ?? "—", "Approved Leaves",   bd.attendance?.formalLeaveCount ?? "0"],
        ["Paid Leaves Used",      "0", "Unpaid Leaves",     bd.leave?.unpaidLeaveDays  ?? "—"],
        ["Late Logins",           bd.attendance?.lateLogins         ?? "—", "Late Half Days",    bd.attendance?.lateLoginHalfDays ?? "—"],
      ];

      const colW = [200, 60, 200, 60];
      let tblY   = doc.y;
      const rowH = 22;

      doc.rect(50, tblY, tblW, rowH).fill("#FF8C00");
      let cx = 58;
      attHeaders.forEach((h, i) => {
        doc.fontSize(8).fillColor("#000000").font("Helvetica-Bold")
           .text(h, cx, tblY + 7, { width: colW[i] });
        cx += colW[i];
      });
      tblY += rowH;

      attData.forEach((row, ri) => {
        doc.rect(50, tblY, tblW, rowH).fill(ri % 2 === 0 ? "#f9f9f9" : "#ffffff");
        cx = 58;
        row.forEach((cell, ci) => {
          const isVal = ci % 2 === 1;
          doc.fontSize(9)
             .fillColor(isVal ? "#111" : "#374151")
             .font(isVal ? "Helvetica-Bold" : "Helvetica")
             .text(String(cell), cx, tblY + 7, { width: colW[ci] });
          cx += colW[ci];
        });
        tblY += rowH;
      });

      doc.y = tblY + 16;

      // ── Salary breakdown ─────────────────────────────────────
      doc.fontSize(11).fillColor("#000000").font("Helvetica-Bold")
         .text("SALARY BREAKDOWN", 50, doc.y);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
         .strokeColor("#000000").stroke();
      doc.moveDown(0.5);

const salaryRows = [
  ["Monthly CTC / Salary", `₹ ${fmtINR(bd.employee?.monthly_salary || p.basic_salary)}`, null],
  [`Daily Rate (÷ ${bd.calendar?.totalDaysInMonth || "?"} calendar days)`, `₹ ${fmtINR(bd.salary?.dailyRate || 0)}`, null],
  ["Unpaid / Absent Days", `${bd.leave?.unpaidLeaveDays || 0} days`, "deduction"],
  ["Leave Deduction", `- ₹ ${fmtINR(0)}`, "deduction"],
  ["─── EARNINGS ───", "", "section"],
  ["Salary After Leave Deduction", `₹ ${fmtINR(bd.salary?.grossPay || 0)}`, "earning"],
  ["Incentives", `+ ₹ ${fmtINR(bd.salary?.incentives || 0)}`, "earning"],
  ["Gross Pay", `₹ ${fmtINR(bd.salary?.grossPay || 0)}`, "gross"],
  ["─── DEDUCTIONS ───", "", "section"],
  ["Total Deductions", `- ₹ ${fmtINR(bd.salary?.totalDeductions || 0)}`, "deduction"],
  ["Tax (TDS)", `- ₹ ${fmtINR(bd.salary?.tax || 0)}`, "deduction"],
];

      let sY = doc.y;
      const leftW = 340, rightW = 150;

      salaryRows.forEach((row, ri) => {
        const [label, value, type] = row;
        if (type === "section") {
          doc.rect(50, sY, tblW, 18).fill("#FF8C00");
          doc.fontSize(8).fillColor("#000000").font("Helvetica-Bold")
             .text(label, 58, sY + 5);
          sY += 18;
          return;
        }
        doc.rect(50, sY, tblW, 20).fill(ri % 2 === 0 ? "#f9fafb" : "#ffffff");
        const vColor = type === "earning" ? "#000000"
                     : type === "deduction" ? "#dc2626"
                     : type === "gross" ? "#92400e"
                     : "#111827";
        doc.fontSize(9).fillColor("#374151").font("Helvetica")
           .text(label, 58, sY + 5, { width: leftW });
        doc.fontSize(9).fillColor(vColor).font("Helvetica-Bold")
           .text(value, 58 + leftW, sY + 5, { width: rightW, align: "right" });
        sY += 20;
      });

      // Net pay box
      sY += 8;
      doc.rect(50, sY, tblW, 40).fill("#FF8C00");
      doc.fontSize(12).fillColor("#000000").font("Helvetica-Bold")
         .text("NET SALARY (TAKE HOME)", 62, sY + 13);
      doc.fontSize(16).fillColor("#000000").font("Helvetica-Bold")
         .text(`₹ ${fmtINR(bd.salary?.netPay || p.net_pay)}`, 62, sY + 10,
           { width: tblW - 24, align: "right" });

      doc.y = sY + 60;

      if (!bd.leave?.eligible) {
        doc.fontSize(8).fillColor("#6b7280").font("Helvetica")
           .text(
             `ℹ Paid leave benefit available after completing 90 days from joining ` +
             `(${p.joining_date}). Currently ${bd.leave?.daysCompleted || 0} day(s) completed.`,
             50, doc.y, { width: tblW }
           );
        doc.moveDown(0.4);
      }

      // ── Footer ──────────────────────────────────────────────
      doc.moveDown(2);
      doc.moveTo(50, doc.y - 10).lineTo(doc.page.width - 50, doc.y - 10)
         .strokeColor("#e5e7eb").stroke();
      doc.fontSize(8).fillColor("#9ca3af").font("Helvetica")
         .text(
           "This is a computer-generated payslip and does not require a physical signature.\n" +
           "For discrepancies, please contact the HR department.",
           50, doc.y, { align: "center", width: tblW }
         );

      doc.end();
    } catch (err) {
      console.error("payroll/download:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  }
);

router.post('/migrate-payslip-columns', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add unpaid leave days column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric(5,1) DEFAULT 0
    `);

    // Add leave deduction column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS leave_deduction numeric(10,2) DEFAULT 0
    `);

    // Add penalty days column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS penalty_days numeric(5,1) DEFAULT 0
    `);

    // Add penalty deduction column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS penalty_deduction numeric(10,2) DEFAULT 0
    `);

    // Add AWI deduction days column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS awi_deduction_days numeric(5,1) DEFAULT 0
    `);

    // Add AWI deduction amount column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS awi_deduction numeric(10,2) DEFAULT 0
    `);

    // Add late login count column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS late_login_count integer DEFAULT 0
    `);

    // Add late login penalty column
    await client.query(`
      ALTER TABLE payslip_records
      ADD COLUMN IF NOT EXISTS late_login_penalty numeric(10,2) DEFAULT 0
    `);

    await client.query('COMMIT');

    res.json({
      message: 'Migration executed successfully',
      columns_added: [
        'unpaid_leave_days',
        'leave_deduction',
        'penalty_days',
        'penalty_deduction',
        'awi_deduction_days',
        'awi_deduction',
        'late_login_count',
        'late_login_penalty'
      ]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  } finally {
    client.release();
  }
});

export default router;

