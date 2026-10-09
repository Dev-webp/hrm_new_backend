import express from "express";
import bcrypt from "bcrypt";

import { verifyUnifiedIntegration } from "../middleware/integrationAuth.js";
import { pool } from "../middleware/db.js";
import { getComputedAttendanceStatus } from "../utils/computedAttendanceStatus.js";
import { calculateBreakMinutesFromRows } from "../utils/breakMinutes.js";

import {
  classifyAttendanceForResponse,
  fetchHolidaySet,
} from "./attendanceRoutes.js";
import {
  assertAssignableDepartment,
  assertAssignableDepartmentForUpdate,
} from "./departmentRoutes.js";

import {
  ensureEmployeeCodeAvailable,
  generateEmployeeCode,
} from "../utils/employeeCode.js";

const router = express.Router();


function monthRange(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);

  const start = `${yearMonth}-01`;

  const lastDay = new Date(year, month, 0).getDate();

  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  return {
    start,
    end,
    year,
    month,
  };
}

function getInitials(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .map((name) => name[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function cleanDepartmentCode(value) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 30)
        .toUpperCase()
    : "";
}

async function updateDepartmentCodeIfProvided({
  code,
  department,
  branch,
}) {
  const cleanCode = cleanDepartmentCode(code);

  if (!cleanCode) return;

  const current = await pool.query(
    `SELECT id, code
     FROM departments
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       AND (branch = 'All' OR branch = $2)
     ORDER BY CASE WHEN branch = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [department, branch]
  );

  if (!current.rows.length) return;

  if (
    String(current.rows[0].code || "").toUpperCase() ===
    cleanCode
  ) {
    return;
  }

  const duplicate = await pool.query(
    `SELECT id
     FROM departments
     WHERE LOWER(code) = LOWER($1)
       AND id != $2
     LIMIT 1`,
    [cleanCode, current.rows[0].id]
  );

  if (duplicate.rows.length) {
    const error = new Error(
      "Department code already exists"
    );

    error.statusCode = 400;
    throw error;
  }

  await pool.query(
    `UPDATE departments
     SET code = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [cleanCode, current.rows[0].id]
  );
}

/*
|--------------------------------------------------------------------------
| GET ACTIVE EMPLOYEES
|--------------------------------------------------------------------------
*/

router.get(
  "/employees",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          u.id,
          u.employee_code,
          u.full_name,
          u.email,
          u.role,
          u.department,
          u.branch,
          u.designation,
          u.login_access_type,
          u.joining_date,
          u.status,
          u.profile_initials,
          u.invoice_access,
          u.salary,
          u.bank_name,
          u.bank_account,
          u.bank_ifsc,
          u.aadhar_number,
          d.code AS department_code
        FROM users u
        LEFT JOIN LATERAL (
          SELECT code
          FROM departments d
          WHERE LOWER(TRIM(d.name)) =
                LOWER(TRIM(u.department))
            AND (d.branch = 'All' OR d.branch = u.branch)
          ORDER BY
            CASE
              WHEN d.branch = u.branch THEN 0
              ELSE 1
            END
          LIMIT 1
        ) d ON true
        WHERE LOWER(COALESCE(u.status, 'active')) = 'active'
        ORDER BY u.full_name ASC
      `);

      return res.status(200).json({
        success: true,
        employees: result.rows,
      });
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_EMPLOYEES_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to load employees",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| CREATE EMPLOYEE
|--------------------------------------------------------------------------
*/

router.post(
  "/employees",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      let {
        full_name,
        email,
        role,
        department,
        branch,
        salary,
        password,
        designation,
        bank_name,
        bank_account,
        bank_ifsc,
        employee_code,
        department_code,
        aadhar_number,
        joining_date,
      } = req.body;

      full_name = String(full_name || "").trim();
      email = String(email || "").trim().toLowerCase();
      role = String(role || "EMPLOYEE").trim().toUpperCase();
      department = String(department || "").trim();
      branch = String(branch || "").trim();

      if (
        !full_name ||
        !email ||
        !role ||
        !department ||
        !branch ||
        salary === undefined ||
        salary === null ||
        salary === ""
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      await assertAssignableDepartment(
        department,
        branch
      );

      await updateDepartmentCodeIfProvided({
        code: department_code,
        department,
        branch,
      });

      const existing = await pool.query(
        `SELECT id
         FROM users
         WHERE LOWER(email) = LOWER($1)
         LIMIT 1`,
        [email]
      );

      if (existing.rows.length) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }

      let finalEmployeeCode =
        String(employee_code || "").trim();

      if (!finalEmployeeCode) {
        finalEmployeeCode =
          await generateEmployeeCode();
      } else {
        await ensureEmployeeCodeAvailable(
          finalEmployeeCode
        );
      }

      const plainPassword =
        String(password || "").trim() ||
        "Welcome@123";

      const hashedPassword = await bcrypt.hash(
        plainPassword,
        10
      );

      const finalJoiningDate =
        joining_date ||
        new Date().toISOString().split("T")[0];

      const profileInitials =
        getInitials(full_name);

      const result = await pool.query(
        `INSERT INTO users
        (
          full_name,
          email,
          password,
          role,
          department,
          branch,
          employee_code,
          salary,
          joining_date,
          status,
          profile_initials,
          designation,
          bank_name,
          bank_account,
          bank_ifsc,
          aadhar_number,
          visible_password
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17
        )
        RETURNING
          id,
          employee_code,
          full_name,
          email,
          role,
          department,
          branch,
          designation,
          salary,
          joining_date,
          status,
          profile_initials`,
        [
          full_name,
          email,
          hashedPassword,
          role,
          department,
          branch,
          finalEmployeeCode,
          salary,
          finalJoiningDate,
          "active",
          profileInitials,
          designation || null,
          bank_name || null,
          bank_account || null,
          bank_ifsc || null,
          aadhar_number || null,
          plainPassword,
        ]
      );

      return res.status(201).json({
        success: true,
        message: "Employee created successfully",
        employee: result.rows[0],
        hrmsLogin: email,
        hrmsPassword: plainPassword,
      });
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_CREATE_EMPLOYEE_FAILED]",
        error
      );

      if (
        error.code === "23505" &&
        String(error.constraint || "").includes(
          "employee_code"
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Employee ID already exists",
        });
      }

      return res.status(
        error.statusCode || 500
      ).json({
        success: false,
        message:
          error.statusCode
            ? error.message
            : "Failed to create employee",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| UPDATE EMPLOYEE
|--------------------------------------------------------------------------
*/

router.put(
  "/employees/:id",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { id } = req.params;

      let {
        full_name,
        email,
        role,
        department,
        branch,
        salary,
        password,
        designation,
        bank_name,
        bank_account,
        bank_ifsc,
        aadhar_number,
        department_code,
        joining_date,
      } = req.body;

      full_name = String(full_name || "").trim();
      email = String(email || "").trim().toLowerCase();
      role = String(role || "").trim().toUpperCase();
      department = String(department || "").trim();
      branch = String(branch || "").trim();

      const employeeResult = await pool.query(
        `SELECT
          id,
          branch,
          role
         FROM users
         WHERE id = $1`,
        [id]
      );

      if (!employeeResult.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      if (
        !full_name ||
        !email ||
        !role ||
        !department ||
        !branch ||
        salary === undefined ||
        salary === null ||
        salary === ""
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      await assertAssignableDepartmentForUpdate(
        id,
        department,
        branch
      );

      await updateDepartmentCodeIfProvided({
        code: department_code,
        department,
        branch,
      });

      const existingEmail = await pool.query(
        `SELECT id
         FROM users
         WHERE LOWER(email) = LOWER($1)
           AND id != $2
         LIMIT 1`,
        [email, id]
      );

      if (existingEmail.rows.length) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }

      let updateQuery = `
        UPDATE users
        SET
          full_name = $1,
          email = $2,
          role = $3,
          department = $4,
          branch = $5,
          salary = $6,
          profile_initials = $7,
          designation = $8,
          bank_name = $9,
          bank_account = $10,
          bank_ifsc = $11,
          aadhar_number = $12
      `;

      const params = [
        full_name,
        email,
        role,
        department,
        branch,
        salary,
        getInitials(full_name),
        designation || null,
        bank_name || null,
        bank_account || null,
        bank_ifsc || null,
        aadhar_number || null,
      ];

      let paramIndex = 13;

      if (joining_date) {
        updateQuery +=
          `, joining_date = $${paramIndex}`;

        params.push(joining_date);
        paramIndex += 1;
      }

      if (
        password &&
        String(password).trim() !== ""
      ) {
        const hashedPassword =
          await bcrypt.hash(password, 10);

        updateQuery +=
          `, password = $${paramIndex},
             visible_password = $${paramIndex + 1}`;

        params.push(
          hashedPassword,
          String(password)
        );

        paramIndex += 2;
      }

      updateQuery += `
        , updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex}
        RETURNING
          id,
          employee_code,
          full_name,
          email,
          role,
          department,
          branch,
          designation,
          salary,
          joining_date,
          status,
          profile_initials
      `;

      params.push(id);

      const result = await pool.query(
        updateQuery,
        params
      );

      return res.status(200).json({
        success: true,
        message: "Employee updated successfully",
        employee: result.rows[0],
      });
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_UPDATE_EMPLOYEE_FAILED]",
        error
      );

      return res.status(
        error.statusCode || 500
      ).json({
        success: false,
        message:
          error.statusCode
            ? error.message
            : "Failed to update employee",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ACTIVATE / DEACTIVATE EMPLOYEE
|--------------------------------------------------------------------------
*/

router.patch(
  "/employees/:id/status",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const reason =
        String(req.body.reason || "").trim() ||
        null;

      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Status must be active or inactive",
        });
      }

      const employeeResult = await pool.query(
        `SELECT
          id,
          full_name,
          email,
          branch,
          department,
          role,
          COALESCE(status, 'active') AS status
         FROM users
         WHERE id = $1`,
        [id]
      );

      if (!employeeResult.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      const employee = employeeResult.rows[0];

      if (employee.role === "SUPER_ADMIN") {
        return res.status(403).json({
          success: false,
          message:
            "Super admin status cannot be changed",
        });
      }

      if (employee.status === status) {
        return res.status(200).json({
          success: true,
          message: `Employee is already ${status}`,
          employee,
        });
      }

      const updated = await pool.query(
        `UPDATE users
         SET
           status = $1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING
           id,
           full_name,
           email,
           branch,
           department,
           role,
           status`,
        [status, id]
      );

      return res.status(200).json({
        success: true,
        message:
          `Employee marked as ${status}`,
        employee: updated.rows[0],
        reason,
      });
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_EMPLOYEE_STATUS_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update employee status",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| CRM / INVOICE ACCESS
|--------------------------------------------------------------------------
*/

router.patch(
  "/employees/:id/invoice-access",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { invoice_access } = req.body;

      if (typeof invoice_access !== "boolean") {
        return res.status(400).json({
          success: false,
          message:
            "invoice_access must be true or false",
        });
      }

      const employeeResult = await pool.query(
        `SELECT
          id,
          full_name,
          email,
          branch,
          department,
          role,
          invoice_access
         FROM users
         WHERE id = $1`,
        [id]
      );

      if (!employeeResult.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      const updated = await pool.query(
        `UPDATE users
         SET
           invoice_access = $1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING
           id,
           full_name,
           email,
           branch,
           department,
           role,
           invoice_access`,
        [invoice_access, id]
      );

      return res.status(200).json({
        success: true,
        message:
          `Invoice / CRM access ${
            invoice_access
              ? "enabled"
              : "disabled"
          } successfully`,
        employee: updated.rows[0],
      });
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_INVOICE_ACCESS_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update Invoice / CRM access",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ATTENDANCE
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| ATTENDANCE
|--------------------------------------------------------------------------
*/

router.get(
  "/attendance",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const {
        date,
        branch,
        department,
        search,
      } = req.query;

      if (!date) {
        return res.status(400).json({
          success: false,
          message: "date required",
        });
      }

      /*
       * ---------------------------------------------------------------
       * 1. GET ACTIVE EMPLOYEES
       * ---------------------------------------------------------------
       *
       * IMPORTANT:
       * We start from users, not attendance_records.
       * This ensures employees without an attendance record are also
       * returned and classified as Absent / Leave / Holiday / etc.
       */

      let userQuery = `
        SELECT
          u.id AS user_id,
          u.employee_code,
          u.full_name,
          u.email,
          u.department,
          u.branch,
          u.designation,
          u.profile_initials
        FROM users u
        WHERE u.role NOT IN ('SUPER_ADMIN')
          AND COALESCE(u.status, 'active') = 'active'
      `;

      const userParams = [];
      let userParamIndex = 1;

      if (branch && branch !== "all") {
        userQuery += `
          AND u.branch = $${userParamIndex}
        `;

        userParams.push(branch);
        userParamIndex++;
      }

      if (department && department !== "all") {
        userQuery += `
          AND u.department = $${userParamIndex}
        `;

        userParams.push(department);
        userParamIndex++;
      }

      if (search) {
        userQuery += `
          AND (
            u.full_name ILIKE $${userParamIndex}
            OR u.employee_code ILIKE $${userParamIndex}
            OR u.email ILIKE $${userParamIndex}
          )
        `;

        userParams.push(`%${search}%`);
        userParamIndex++;
      }

      userQuery += `
        ORDER BY u.full_name ASC
      `;

      const usersResult = await pool.query(
        userQuery,
        userParams
      );

      /*
       * ---------------------------------------------------------------
       * 2. GET RAW ATTENDANCE + BREAK DATA
       * ---------------------------------------------------------------
       */

      const attResult = await pool.query(
        `SELECT
          ar.user_id,

          ar.check_in_time,
          ar.check_out_time,

          ar.status,
          ar.late_minutes,
          ar.production_hours,
          ar.total_break_minutes,

          ar.half_day_slot,
          ar.leave_type,
          ar.leave_status,

          ar.post_login_idle_minutes,
          ar.misuse_of_time,

          b1.start_time AS break1_in,
          b1.end_time AS break1_out,

          b2.start_time AS break2_in,
          b2.end_time AS break2_out,

          ln.start_time AS lunch_in,
          ln.end_time AS lunch_out,

          b3.start_time AS break3_in,
          b3.end_time AS break3_out,

          b3.duration_minutes AS break3_duration_minutes,
          b3.break3_sessions AS break3_sessions,

          COALESCE(
            (
              SELECT SUM(
                COALESCE(
                  b.duration_minutes,
                  GREATEST(
                    EXTRACT(
                      EPOCH FROM (
                        b.end_time::time -
                        b.start_time::time
                      )
                    ) / 60,
                    0
                  )::int,
                  0
                )
              )
              FROM employee_breaks b
              WHERE b.user_id = ar.user_id
                AND b.date = $1::date
            ),
            ar.total_break_minutes,
            0
          ) AS total_break_minutes

        FROM attendance_records ar

        LEFT JOIN employee_breaks b1
          ON b1.user_id = ar.user_id
         AND b1.date = ar.date
         AND b1.break_type = 'break1'

        LEFT JOIN employee_breaks b2
          ON b2.user_id = ar.user_id
         AND b2.date = ar.date
         AND b2.break_type = 'break2'

        LEFT JOIN employee_breaks ln
          ON ln.user_id = ar.user_id
         AND ln.date = ar.date
         AND ln.break_type = 'lunch'

        LEFT JOIN employee_breaks b3
          ON b3.user_id = ar.user_id
         AND b3.date = ar.date
         AND b3.break_type = 'break3'

        WHERE ar.date = $1::date`,
        [date]
      );

      /*
       * ---------------------------------------------------------------
       * 3. MAP ATTENDANCE BY USER ID
       * ---------------------------------------------------------------
       */

      const attMap = new Map(
        attResult.rows.map((row) => [
          row.user_id,
          row,
        ])
      );

      /*
       * ---------------------------------------------------------------
       * 4. LOAD HOLIDAYS
       * ---------------------------------------------------------------
       */

      const [year] = date
        .split("-")
        .map(Number);

      const holidaySet = await fetchHolidaySet(year);

      /*
       * ---------------------------------------------------------------
       * 5. CLASSIFY EVERY ACTIVE EMPLOYEE
       * ---------------------------------------------------------------
       */

      const rows = [];

      for (const user of usersResult.rows) {
        const att = attMap.get(user.user_id);

        const classified =
          await classifyAttendanceForResponse(
            user,
            date,
            att,
            holidaySet
          );

        rows.push(classified);
      }

      /*
       * ---------------------------------------------------------------
       * 6. RETURN UNIFIED ATTENDANCE RESPONSE
       * ---------------------------------------------------------------
       */

      return res.status(200).json({
        success: true,
        date,
        totalEmployees: rows.length,
        attendanceRecords: attResult.rows.length,
        attendance: rows,
      });

    } catch (error) {
      console.error(
        "================================="
      );

      console.error(
        "[UNIFIED_INTEGRATION_ATTENDANCE_FAILED]"
      );

      console.error(
        "MESSAGE:",
        error.message
      );

      console.error(
        "CODE:",
        error.code
      );

      console.error(
        "DETAIL:",
        error.detail
      );

      console.error(
        "HINT:",
        error.hint
      );

      console.error(
        "STACK:",
        error.stack
      );

      console.error(
        "================================="
      );

      return res.status(500).json({
        success: false,
        message: "Failed to load attendance",
        error: error.message,
      });
    }
  }
);



// ══════════════════════════════════════════════════════════════
// GET /api/integration/attendance-analysis/summary
// Unified Portal → HRMS Attendance Analysis Summary
// ══════════════════════════════════════════════════════════════

router.get(
  "/attendance-analysis/summary",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { month = "2026-05", branch } = req.query;

      console.log(
        "[UNIFIED] Attendance Analysis Summary:",
        { month, branch: branch || "all" }
      );

      const { start, end, year, month: monthNumber } =
        monthRange(month);

      let branchFilter = "";
      const empParams = [];

      if (branch && branch !== "all") {
        empParams.push(branch);
        branchFilter = "AND branch = $1";
      }

      const [empRes, attRes, breakRes, holidayRes] =
        await Promise.all([
          pool.query(
            `SELECT
               id AS user_id,
               full_name,
               department,
               branch,
               role
             FROM users
             WHERE role != 'SUPER_ADMIN'
             ${branchFilter}
             ORDER BY full_name ASC`,
            empParams
          ),

          pool.query(
            `SELECT
               user_id,
               TO_CHAR(date,'YYYY-MM-DD') AS date,
               status,
               check_in_time,
               check_out_time,
               late_minutes,
               production_hours,
               total_break_minutes,
               half_day_slot,
               leave_type,
               leave_status,
               post_login_idle_minutes,
               misuse_of_time
             FROM attendance_records
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),

          pool.query(
            `SELECT
               user_id,
               TO_CHAR(date,'YYYY-MM-DD') AS date,
               break_type,
               start_time,
               end_time,
               duration_minutes,
               break3_sessions
             FROM employee_breaks
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),

          pool.query(
            `SELECT
               TO_CHAR(date,'YYYY-MM-DD') AS date
             FROM company_holidays
             WHERE date BETWEEN $1::date AND $2::date`,
            [start, end]
          ),
        ]);

      const holidaySet = new Set(
        holidayRes.rows.map((row) => row.date)
      );

      const breakRowsByKey = new Map();

      for (const row of breakRes.rows) {
        const key = `${row.user_id}|${row.date}`;

        if (!breakRowsByKey.has(key)) {
          breakRowsByKey.set(key, []);
        }

        breakRowsByKey.get(key).push(row);
      }

      const breakMap = new Map(
        Array.from(breakRowsByKey.entries()).map(
          ([key, rows]) => [
            key,
            calculateBreakMinutesFromRows(rows),
          ]
        )
      );

      const attMap = new Map();

      for (const row of attRes.rows) {
        const key = `${row.user_id}|${row.date}`;

        attMap.set(key, {
          ...row,
          total_break_minutes:
            breakMap.get(key) ??
            Number(row.total_break_minutes || 0),
        });
      }

      const days = Array.from(
        {
          length: new Date(
            year,
            monthNumber,
            0
          ).getDate(),
        },
        (_, index) =>
          `${month}-${String(index + 1).padStart(2, "0")}`
      );

      const employees = empRes.rows.map((emp) => {
        const summary = {
          user_id: emp.user_id,
          full_name: emp.full_name,
          department: emp.department,
          branch: emp.branch,

          full_days: 0,
          half_days: 0,
          present_days: 0,
          late_days: 0,

          avg_break_mins: 0,
          break_exceeded_days: 0,

          absent_days: 0,
          leave_days: 0,
          paid_leave_days: 0,
          unpaid_leave_days: 0,
        };

        let breakTotal = 0;
        let breakDays = 0;

        for (const dateStr of days) {
          const rec =
            attMap.get(
              `${emp.user_id}|${dateStr}`
            ) || {
              date: dateStr,
            };

          const computed =
            getComputedAttendanceStatus(rec, {
              dateStr,
              holidaySet,
              noRecordStatus: "absent",
            });

          if (
            computed.computed_status ===
            "full_day"
          ) {
            summary.full_days += 1;
          } else if (
            computed.computed_status ===
            "half_day"
          ) {
            summary.half_days += 1;
          } else if (
            computed.computed_status ===
            "absent"
          ) {
            summary.absent_days += 1;
          } else if (
            computed.computed_status ===
            "paid_leave"
          ) {
            summary.paid_leave_days += 1;
            summary.leave_days += 1;
          } else if (
            computed.computed_status ===
            "unpaid_leave"
          ) {
            summary.unpaid_leave_days += 1;
            summary.leave_days += 1;
          } else if (
            computed.computed_status ===
            "leave"
          ) {
            summary.leave_days += 1;
          }

          if (
            [
              "full_day",
              "working",
              "in_progress",
            ].includes(
              computed.computed_status
            )
          ) {
            summary.present_days += 1;
          } else if (
            computed.computed_status ===
            "half_day"
          ) {
            summary.present_days += 0.5;
          }

          const checkIn =
            rec.checkIn ??
            rec.check_in_time;

          if (checkIn) {
            const [hours, minutes] =
              String(checkIn)
                .slice(0, 5)
                .split(":")
                .map(Number);

            if (
              !Number.isNaN(hours) &&
              !Number.isNaN(minutes) &&
              hours * 60 + minutes >= 615
            ) {
              summary.late_days += 1;
            }
          }

          const breakMinutes = Number(
            computed.total_break_minutes || 0
          );

          if (breakMinutes > 0) {
            breakTotal += breakMinutes;
            breakDays += 1;
          }

          if (breakMinutes > 60) {
            summary.break_exceeded_days += 1;
          }
        }

        summary.avg_break_mins = breakDays
          ? Math.round(
              breakTotal / breakDays
            )
          : 0;

        return summary;
      });

      const kpi = {
        total_employees:
          employees.length,

        total_present:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.present_days || 0
              ),
            0
          ),

        total_late:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.late_days || 0
              ),
            0
          ),

        total_exceeded:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.break_exceeded_days || 0
              ),
            0
          ),

        total_paid_leave:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.paid_leave_days || 0
              ),
            0
          ),

        total_unpaid_leave:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.unpaid_leave_days || 0
              ),
            0
          ),

        total_leave:
          employees.reduce(
            (sum, employee) =>
              sum +
              Number(
                employee.leave_days || 0
              ),
            0
          ),

        avg_break:
          employees.length
            ? Math.round(
                employees.reduce(
                  (sum, employee) =>
                    sum +
                    Number(
                      employee.avg_break_mins ||
                        0
                    ),
                  0
                ) / employees.length
              )
            : 0,
      };

      return res.status(200).json({
        success: true,
        kpi,
        employees,
        month,
        generatedAt:
          new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "[UNIFIED_ATTENDANCE_ANALYSIS_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load attendance analysis",
        error: error.message,
      });
    }
  }
);


// --------------------------------------------------
// ATTENDANCE ANALYSIS - INDIVIDUAL
// --------------------------------------------------

router.get(
  "/attendance-analysis/individual",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { userId, month } = req.query;

      if (!userId || !month) {
        return res.status(400).json({
          success: false,
          message: "userId and month are required",
        });
      }

      const [year, monthNumber] = month
        .split("-")
        .map(Number);

      if (
        !year ||
        !monthNumber ||
        monthNumber < 1 ||
        monthNumber > 12
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid month. Format: YYYY-MM",
        });
      }

      const start = `${month}-01`;

      const lastDay = new Date(
        year,
        monthNumber,
        0
      ).getDate();

      const end = `${month}-${String(lastDay).padStart(
        2,
        "0"
      )}`;

      console.log(
        "[UNIFIED] Attendance Analysis Individual:",
        {
          userId,
          month,
          start,
          end,
        }
      );

      const [
        employeeRes,
        attendanceRes,
        breakRes,
        holidayRes,
      ] = await Promise.all([
        pool.query(
          `SELECT
             id AS user_id,
             full_name,
             department,
             branch,
             role
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [userId]
        ),

        pool.query(
          `SELECT
             user_id,
             TO_CHAR(date,'YYYY-MM-DD') AS date,
             status,
             check_in_time,
             check_out_time,
             late_minutes,
             production_hours,
             total_break_minutes,
             half_day_slot,
             leave_type,
             leave_status,
             post_login_idle_minutes,
             misuse_of_time
           FROM attendance_records
           WHERE user_id = $1
             AND date BETWEEN $2::date AND $3::date
           ORDER BY date ASC`,
          [userId, start, end]
        ),

        pool.query(
          `SELECT
             user_id,
             TO_CHAR(date,'YYYY-MM-DD') AS date,
             break_type,
             start_time,
             end_time,
             duration_minutes,
             break3_sessions
           FROM employee_breaks
           WHERE user_id = $1
             AND date BETWEEN $2::date AND $3::date
           ORDER BY date ASC`,
          [userId, start, end]
        ),

        pool.query(
          `SELECT
             TO_CHAR(date,'YYYY-MM-DD') AS date
           FROM company_holidays
           WHERE date BETWEEN $1::date AND $2::date`,
          [start, end]
        ),
      ]);

      if (!employeeRes.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      const employee = employeeRes.rows[0];

      const holidaySet = new Set(
        holidayRes.rows.map(
          (row) => row.date
        )
      );

      const breakRowsByDate = new Map();

      for (const row of breakRes.rows) {
        if (!breakRowsByDate.has(row.date)) {
          breakRowsByDate.set(
            row.date,
            []
          );
        }

        breakRowsByDate
          .get(row.date)
          .push(row);
      }

      const attendanceMap = new Map();

      for (const row of attendanceRes.rows) {
        attendanceMap.set(
          row.date,
          row
        );
      }

      const records = [];

      for (
        let day = 1;
        day <= lastDay;
        day++
      ) {
        const dateStr =
          `${month}-${String(day).padStart(2, "0")}`;

        const att =
          attendanceMap.get(dateStr) || {
            user_id: Number(userId),
            date: dateStr,
          };

        const breakRows =
          breakRowsByDate.get(dateStr) || [];

        const breakMinutes =
          calculateBreakMinutesFromRows(
            breakRows
          );

        const record = {
          ...att,
          total_break_minutes:
            breakMinutes ??
            Number(
              att.total_break_minutes || 0
            ),
        };

        const computed =
          getComputedAttendanceStatus(
            record,
            {
              dateStr,
              holidaySet,
              noRecordStatus: "absent",
            }
          );

        records.push({
          date: dateStr,
          checkIn:
            record.check_in_time || null,
          checkOut:
            record.check_out_time || null,

          status:
            computed.computed_status ||
            record.status ||
            "absent",

          computed_status:
            computed.computed_status,

          display_status:
            computed.display_status,

          policy_status:
            computed.policy_status,

          policy_reason:
            computed.policy_reason,

          lateMinutes:
            Number(
              record.late_minutes || 0
            ),

          workHours:
            Number(
              record.production_hours || 0
            ),

          productionHours:
            Number(
              record.production_hours || 0
            ),

          breaks: breakRows,

          breakMins:
            Number(
              computed.total_break_minutes ||
              0
            ),

          breakDetails:
            breakRows,

          leaveType:
            record.leave_type || null,

          leaveStatus:
            record.leave_status || null,

          halfDaySlot:
            record.half_day_slot || null,

          postLoginIdleMinutes:
            Number(
              record.post_login_idle_minutes ||
              0
            ),

          misuseOfTime:
            record.misuse_of_time || null,
        });
      }

      return res.status(200).json({
        success: true,
        employee,
        records,
        month,
      });

    } catch (error) {
      console.error(
        "[UNIFIED_ATTENDANCE_ANALYSIS_INDIVIDUAL_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load individual attendance analysis",
        error: error.message,
      });
    }
  }
);


// --------------------------------------------------
// ATTENDANCE ANALYSIS - TRENDS
// --------------------------------------------------

router.get(
  "/attendance-analysis/trends",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { branch, months = 6 } = req.query;

      const parsedMonths = Number(months);

      if (
        !Number.isInteger(parsedMonths) ||
        parsedMonths < 1 ||
        parsedMonths > 24
      ) {
        return res.status(400).json({
          success: false,
          message: "months must be an integer between 1 and 24",
        });
      }

      const params = new URLSearchParams();

      params.append("months", String(parsedMonths));

      if (branch && branch !== "all") {
        params.append("branch", branch);
      }

      console.log(
        "[UNIFIED] Attendance Analysis Trends:",
        {
          branch: branch || "all",
          months: parsedMonths,
        }
      );

      /*
       * Reuse the existing HRMS trends logic.
       *
       * The existing /api/attendance-analysis/trends
       * endpoint already calculates:
       *   - present
       *   - absent
       *   - leave
       *   - late
       *   - average break
       *   - exceeded
       */

      const [year, month] = new Date()
        .toISOString()
        .slice(0, 7)
        .split("-")
        .map(Number);

      const trendResults = [];

      for (let i = parsedMonths - 1; i >= 0; i--) {
        const date = new Date(
          year,
          month - 1 - i,
          1
        );

        const yearMonth =
          `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, "0")}`;

        const start =
          `${yearMonth}-01`;

        const lastDay =
          new Date(
            date.getFullYear(),
            date.getMonth() + 1,
            0
          ).getDate();

        const end =
          `${yearMonth}-${String(lastDay).padStart(
            2,
            "0"
          )}`;

        const employeeParams = [];

        if (branch && branch !== "all") {
          employeeParams.push(branch);
        }

        const usersQuery = `
          SELECT
            id AS user_id,
            full_name,
            branch,
            role
          FROM users
          WHERE role != 'SUPER_ADMIN'
          ${
            branch && branch !== "all"
              ? "AND branch = $1"
              : ""
          }
          ORDER BY full_name ASC
        `;

        const usersRes = await pool.query(
          usersQuery,
          employeeParams
        );

        const userIds =
          usersRes.rows.map(
            (user) => user.user_id
          );

        if (!userIds.length) {
          trendResults.push({
            month: yearMonth,
            present: 0,
            absent: 0,
            leave: 0,
            late: 0,
            avg_break: 0,
            exceeded: 0,
          });

          continue;
        }

        const attendanceRes =
          await pool.query(
            `
            SELECT
              user_id,
              date,
              status,
              check_in_time,
              check_out_time,
              late_minutes,
              production_hours,
              total_break_minutes,
              leave_type,
              leave_status
            FROM attendance_records
            WHERE user_id = ANY($1::int[])
              AND date BETWEEN $2::date AND $3::date
            ORDER BY date ASC
            `,
            [
              userIds,
              start,
              end,
            ]
          );

        const breakRes =
          await pool.query(
            `
            SELECT
              user_id,
              date,
              break_type,
              start_time,
              end_time,
              duration_minutes,
              break3_sessions
            FROM employee_breaks
            WHERE user_id = ANY($1::int[])
              AND date BETWEEN $2::date AND $3::date
            `,
            [
              userIds,
              start,
              end,
            ]
          );

        const holidayRes =
          await pool.query(
            `
            SELECT
              TO_CHAR(date, 'YYYY-MM-DD') AS date
            FROM company_holidays
            WHERE date BETWEEN $1::date AND $2::date
            `,
            [
              start,
              end,
            ]
          );

        const holidaySet =
          new Set(
            holidayRes.rows.map(
              (row) => row.date
            )
          );

        const attendanceByUser =
          new Map();

        for (
          const row of attendanceRes.rows
        ) {
          const dateStr =
            row.date instanceof Date
              ? row.date
                  .toISOString()
                  .slice(0, 10)
              : String(row.date);

          if (
            !attendanceByUser.has(
              row.user_id
            )
          ) {
            attendanceByUser.set(
              row.user_id,
              new Map()
            );
          }

          attendanceByUser
            .get(row.user_id)
            .set(dateStr, {
              ...row,
              date: dateStr,
            });
        }

        const breaksByUser =
          new Map();

        for (
          const row of breakRes.rows
        ) {
          const dateStr =
            row.date instanceof Date
              ? row.date
                  .toISOString()
                  .slice(0, 10)
              : String(row.date);

          if (
            !breaksByUser.has(
              row.user_id
            )
          ) {
            breaksByUser.set(
              row.user_id,
              new Map()
            );
          }

          if (
            !breaksByUser
              .get(row.user_id)
              .has(dateStr)
          ) {
            breaksByUser
              .get(row.user_id)
              .set(dateStr, []);
          }

          breaksByUser
            .get(row.user_id)
            .get(dateStr)
            .push(row);
        }

        let present = 0;
        let absent = 0;
        let leave = 0;
        let late = 0;
        let exceeded = 0;

        let totalBreakMinutes = 0;
        let breakDays = 0;

        for (
          const userId of userIds
        ) {
          const attendanceMap =
            attendanceByUser.get(
              userId
            ) || new Map();

          const userBreaks =
            breaksByUser.get(
              userId
            ) || new Map();

          for (
            let day = 1;
            day <= lastDay;
            day++
          ) {
            const dateStr =
              `${yearMonth}-${String(day).padStart(
                2,
                "0"
              )}`;

            const att =
              attendanceMap.get(
                dateStr
              ) || {
                user_id: userId,
                date: dateStr,
                status: "absent",
              };

            const breakRows =
              userBreaks.get(
                dateStr
              ) || [];

            const breakMinutes =
              calculateBreakMinutesFromRows(
                breakRows
              );

            const record = {
              ...att,
              total_break_minutes:
                breakMinutes ??
                Number(
                  att.total_break_minutes ||
                    0
                ),
            };

            const computed =
              getComputedAttendanceStatus(
                record,
                {
                  dateStr,
                  holidaySet,
                  noRecordStatus:
                    "absent",
                }
              );

            const status =
              String(
                computed.computed_status ||
                  record.status ||
                  ""
              ).toLowerCase();

            if (
              status === "present" ||
              status === "full_day"
            ) {
              present++;
            }

            if (
              status === "absent"
            ) {
              absent++;
            }

            if (
              status.includes("leave")
            ) {
              leave++;
            }

            if (
              Number(
                record.late_minutes || 0
              ) > 0
            ) {
              late++;
            }

            if (
              status.includes(
                "exceeded"
              )
            ) {
              exceeded++;
            }

            if (
              Number(
                record.total_break_minutes ||
                  0
              ) > 0
            ) {
              totalBreakMinutes +=
                Number(
                  record.total_break_minutes ||
                    0
                );

              breakDays++;
            }
          }
        }

        trendResults.push({
          month: yearMonth,
          present,
          absent,
          leave,
          late,
          avg_break:
            breakDays > 0
              ? Number(
                  (
                    totalBreakMinutes /
                    breakDays
                  ).toFixed(2)
                )
              : 0,
          exceeded,
        });
      }

      return res.status(200).json({
        success: true,
        trends: trendResults,
      });

    } catch (error) {
      console.error(
        "[UNIFIED_ATTENDANCE_ANALYSIS_TRENDS_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load attendance analysis trends",
        error: error.message,
      });
    }
  }
);

// --------------------------------------------------
// ATTENDANCE - BREAKS
// --------------------------------------------------

router.get(
  "/breaks",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const {
        date,
        from,
        to,
        branch,
        userId,
      } = req.query;

      console.log(
        "================================="
      );

      console.log(
        "[UNIFIED] Breaks Integration Request:",
        {
          date,
          from,
          to,
          branch,
          userId,
        }
      );

      console.log(
        "================================="
      );

      /*
       * ============================================================
       * VALIDATE DATE
       * ============================================================
       */

      if (!date && (!from || !to)) {
        return res.status(400).json({
          success: false,
          message:
            "date or from/to date range is required",
        });
      }

      /*
       * ============================================================
       * 1. LOAD ACTIVE EMPLOYEES
       * ============================================================
       */

      const employeeParams = [];

      const employeeConditions = [
        "u.role != 'SUPER_ADMIN'",
        "LOWER(COALESCE(u.status, 'active')) = 'active'",
      ];

      /*
       * Branch filter
       */

      if (
        branch &&
        branch !== "all"
      ) {
        employeeParams.push(branch);

        employeeConditions.push(
          `u.branch = $${employeeParams.length}`
        );
      }

      /*
       * User filter
       */

      if (userId) {
        const numericUserId =
          Number(userId);

        if (
          !Number.isInteger(
            numericUserId
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid userId",
          });
        }

        employeeParams.push(
          numericUserId
        );

        employeeConditions.push(
          `u.id = $${employeeParams.length}`
        );
      }

      console.log(
        "[UNIFIED BREAKS] Loading employees..."
      );

      /*
       * ============================================================
       * EMPLOYEE QUERY
       * ============================================================
       */

      const employeesResult =
        await pool.query(
          `
          SELECT
            u.id AS user_id,
            u.employee_code,
            u.full_name,
            u.email,
            u.department,
            u.branch,
            u.designation,
            u.role
          FROM users u
          WHERE ${employeeConditions.join(
            " AND "
          )}
          ORDER BY u.full_name ASC
          `,
          employeeParams
        );

      const employees =
        employeesResult.rows;

      console.log(
        "[UNIFIED BREAKS] Employees loaded:",
        employees.length
      );

      /*
       * ============================================================
       * NO EMPLOYEES
       * ============================================================
       */

      if (!employees.length) {
        return res.status(200).json({
          success: true,
          date: date || null,
          from: from || null,
          to: to || null,
          totalEmployees: 0,
          breakRecords: 0,
          breaks: [],
        });
      }

      /*
       * ============================================================
       * 2. LOAD BREAK RECORDS
       * ============================================================
       */

      const breakParams = [];

      const breakConditions = [];

      const employeeIds =
        employees.map(
          (employee) =>
            employee.user_id
        );

      /*
       * Employee IDs
       */

      breakParams.push(
        employeeIds
      );

      breakConditions.push(
        `eb.user_id = ANY($${breakParams.length}::int[])`
      );

      /*
       * Date filter
       */

      if (date) {
        breakParams.push(
          date
        );

        breakConditions.push(
          `eb.date = $${breakParams.length}::date`
        );
      } else {
        /*
         * From date
         */

        breakParams.push(
          from
        );

        const fromIndex =
          breakParams.length;

        breakConditions.push(
          `eb.date >= $${fromIndex}::date`
        );

        /*
         * To date
         */

        breakParams.push(
          to
        );

        const toIndex =
          breakParams.length;

        breakConditions.push(
          `eb.date <= $${toIndex}::date`
        );
      }

      console.log(
        "[UNIFIED BREAKS] Loading break records..."
      );

      /*
       * ============================================================
       * BREAK QUERY
       * ============================================================
       */

      const breaksResult =
        await pool.query(
          `
          SELECT
            eb.id,
            eb.user_id,
            TO_CHAR(
              eb.date,
              'YYYY-MM-DD'
            ) AS date,
            eb.break_type,
            eb.start_time,
            eb.end_time,
            eb.duration_minutes,
            eb.break3_sessions
          FROM employee_breaks eb
          WHERE ${breakConditions.join(
            " AND "
          )}
          ORDER BY
            eb.date ASC,
            eb.user_id ASC,
            eb.break_type ASC
          `,
          breakParams
        );

      console.log(
        "[UNIFIED BREAKS] Break records loaded:",
        breaksResult.rows.length
      );

      /*
       * ============================================================
       * 3. GROUP BREAKS BY EMPLOYEE + DATE
       * ============================================================
       */

      const breaksByEmployee =
        new Map();

      for (
        const row of breaksResult.rows
      ) {
        if (
          !breaksByEmployee.has(
            row.user_id
          )
        ) {
          breaksByEmployee.set(
            row.user_id,
            new Map()
          );
        }

        const employeeDates =
          breaksByEmployee.get(
            row.user_id
          );

        if (
          !employeeDates.has(
            row.date
          )
        ) {
          employeeDates.set(
            row.date,
            []
          );
        }

        employeeDates
          .get(row.date)
          .push(row);
      }

      /*
       * ============================================================
       * 4. BUILD RESPONSE
       * ============================================================
       */

      const responseRows = [];

      for (
        const employee of employees
      ) {
        const employeeDates =
          breaksByEmployee.get(
            employee.user_id
          ) || new Map();

        /*
         * ----------------------------------------------------------
         * SINGLE DATE
         * ----------------------------------------------------------
         */

        if (date) {
          const rows =
            employeeDates.get(
              date
            ) || [];

          const totalBreakMinutes =
            rows.reduce(
              (
                total,
                row
              ) =>
                total +
                Number(
                  row.duration_minutes ||
                    0
                ),
              0
            );

          responseRows.push({
            user_id:
              employee.user_id,

            employee_code:
              employee.employee_code,

            full_name:
              employee.full_name,

            email:
              employee.email,

            department:
              employee.department,

            branch:
              employee.branch,

            designation:
              employee.designation,

            role:
              employee.role,

            date,

            breaks:
              rows,

            total_break_minutes:
              totalBreakMinutes,
          });

          continue;
        }

        /*
         * ----------------------------------------------------------
         * DATE RANGE
         * ----------------------------------------------------------
         */

        for (
          const [
            dateKey,
            rows,
          ] of employeeDates
        ) {
          const totalBreakMinutes =
            rows.reduce(
              (
                total,
                row
              ) =>
                total +
                Number(
                  row.duration_minutes ||
                    0
                ),
              0
            );

          responseRows.push({
            user_id:
              employee.user_id,

            employee_code:
              employee.employee_code,

            full_name:
              employee.full_name,

            email:
              employee.email,

            department:
              employee.department,

            branch:
              employee.branch,

            designation:
              employee.designation,

            role:
              employee.role,

            date:
              dateKey,

            breaks:
              rows,

            total_break_minutes:
              totalBreakMinutes,
          });
        }
      }

      /*
       * ============================================================
       * SUCCESS RESPONSE
       * ============================================================
       */

      console.log(
        "================================="
      );

      console.log(
        "[UNIFIED BREAKS] SUCCESS",
        {
          date,
          from,
          to,
          totalEmployees:
            employees.length,
          breakRecords:
            breaksResult.rows.length,
          responseRows:
            responseRows.length,
        }
      );

      console.log(
        "================================="
      );

      return res.status(200).json({
        success: true,

        date:
          date || null,

        from:
          from || null,

        to:
          to || null,

        totalEmployees:
          employees.length,

        breakRecords:
          breaksResult.rows.length,

        breaks:
          responseRows,
      });
    } catch (error) {
      console.error(
        "================================="
      );

      console.error(
        "[UNIFIED_INTEGRATION_BREAKS_FAILED]"
      );

      console.error(
        "MESSAGE:",
        error.message
      );

      console.error(
        "CODE:",
        error.code
      );

      console.error(
        "DETAIL:",
        error.detail
      );

      console.error(
        "HINT:",
        error.hint
      );

      console.error(
        "STACK:",
        error.stack
      );

      console.error(
        "================================="
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load breaks",
        error:
          error.message,
      });
    }
  }
);




router.get(
  "/attendance-analysis/summary",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const {
        month,
        branch,
      } = req.query;

      if (!month) {
        return res.status(400).json({
          success: false,
          message:
            "month is required. Format: YYYY-MM",
        });
      }

      /*
       * Existing HRMS attendance-analysis
       * calculation/query should be used here.
       *
       * IMPORTANT:
       * Keep the existing HRMS calculation logic
       * if this endpoint already exists.
       */

      // return your existing analysis result

    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_ATTENDANCE_ANALYSIS_SUMMARY_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load attendance analysis summary",
      });
    }
  }
);



router.get(
  "/attendance-analysis/individual",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const {
        userId,
        month,
      } = req.query;

      if (
        !userId ||
        !month
      ) {
        return res.status(400).json({
          success: false,
          message:
            "userId and month are required",
        });
      }

      /*
       * Existing HRMS individual
       * attendance-analysis logic goes here.
       */

    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_ATTENDANCE_ANALYSIS_INDIVIDUAL_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load individual attendance analysis",
      });
    }
  }
);


router.get(
  "/attendance-analysis/trends",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const {
        branch,
        months = 6,
      } = req.query;

      /*
       * Existing HRMS attendance trend
       * calculation/query goes here.
       */

    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_ATTENDANCE_ANALYSIS_TRENDS_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load attendance analysis trends",
      });
    }
  }
);


function normalizeLeaveApprovalMetadata(row) {
  const approvedByUserId =
    row.approved_by_user_id ?? row.approved_by ?? null;

  const approvedByName =
    row.approved_by_name ||
    row.approver_name ||
    null;

  const approvedByRole =
    row.approved_by_role ||
    row.approver_role ||
    null;

  const approvedAt =
    row.approved_at || null;

  return {
    ...row,
    approved_by_user_id: approvedByUserId,
    approved_by_name: approvedByName,
    approved_by_role: approvedByRole,
    approvedByUserId,
    approvedBy: approvedByName,
    approvedRole: approvedByRole,
    approvedAt,
  };
}

router.get(
  "/leaves/approved-monthly",
  verifyUnifiedIntegration,
  async (req, res) => {
    try {
      const { userId, month } = req.query;

      if (
        !userId ||
        !month ||
        !/^\d{4}-\d{2}$/.test(month)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "userId and month=YYYY-MM are required",
        });
      }

      const [year, monthNumber] =
        month.split("-").map(Number);

      const monthStart = `${month}-01`;

      const monthEnd = `${month}-${String(
        new Date(year, monthNumber, 0).getDate()
      ).padStart(2, "0")}`;

      const targetUser = await pool.query(
        `
        SELECT id, branch
        FROM users
        WHERE id = $1
          AND role != 'SUPER_ADMIN'
        `,
        [userId]
      );

      if (!targetUser.rows.length) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
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
          COALESCE(
            l.approved_by_user_id,
            l.approved_by
          ) AS approved_by_user_id,
          COALESCE(
            l.approved_by_name,
            approver.full_name
          ) AS approved_by_name,
          COALESCE(
            l.approved_by_role,
            approver.role
          ) AS approved_by_role,
          l.approved_at,
          l.rejection_reason
        FROM leave_requests l
        JOIN users u
          ON u.id = l.user_id
        LEFT JOIN users approver
          ON approver.id =
             COALESCE(
               l.approved_by_user_id,
               l.approved_by
             )
        WHERE l.user_id = $1
          AND l.status = 'approved'
          AND l.from_date <= $3
          AND l.to_date >= $2
        ORDER BY
          l.from_date ASC,
          l.created_at DESC
        `,
        [userId, monthStart, monthEnd]
      );

      return res.status(200).json(
        result.rows.map(normalizeLeaveApprovalMetadata)
      );
    } catch (error) {
      console.error(
        "[UNIFIED_INTEGRATION_APPROVED_MONTHLY_LEAVES_FAILED]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch monthly approved leaves",
      });
    }
  }
);

export default router;