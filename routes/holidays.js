import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import * as XLSX from "xlsx";
import multer from "multer";
import { Readable } from "stream";

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

// Helper → normalize DB dates safely
function normalizeDate(dateValue) {
    return (dateValue instanceof Date
        ? dateValue.toISOString()
        : String(dateValue)
    ).slice(0, 10);
}

// ======================================================
// BULK DOWNLOAD holidays as CSV (MUST be before /holidays/:date)
// ======================================================
router.get(
  "/holidays/download",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    try {
      const { year, branch } = req.query;

      let query = `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch
                   FROM company_holidays`;
      const params = [];
      const conditions = [];

      if (year) {
        conditions.push(`EXTRACT(YEAR FROM date) = $${params.length + 1}`);
        params.push(year);
      }

      if (branch && branch !== "all") {
        conditions.push(`branch = $${params.length + 1}`);
        params.push(branch);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += ` ORDER BY date ASC`;

      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "No holidays found for the specified criteria" });
      }

      // Generate CSV manually with proper escaping
      // Use ="" to force Excel to treat dates as text (prevents auto-formatting)
      const headers = ['Date', 'Holiday Name', 'Type', 'Branch'];
      const csvRows = result.rows.map(row => {
        const date = `="${row.date || ''}"`;
        const name = `"${(row.name || '').replace(/"/g, '""')}"`;
        const type = row.type || 'holiday';
        const branch = row.branch || 'all';
        return `${date},${name},${type},${branch}`;
      });
      
      const csvContent = headers.join(',') + '\n' + csvRows.join('\n');

      // Add BOM (Byte Order Mark) for Excel UTF-8 compatibility
      const bom = '\uFEFF';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="holidays_${year || 'all'}.csv"`);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(bom + csvContent);
    } catch (err) {
      console.error("GET /holidays/download error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ======================================================
// GET holidays for a month
// ======================================================
// GET holidays for a month
router.get("/holidays", verifyToken, async (req, res) => {
    try {
        const { year, month } = req.query;
        let branch = req.query.branch;
        if (!["SUPER_ADMIN", "OPERATIONAL_MANAGER", "HR"].includes(req.user.role)) {
            const userResult = await pool.query(
                "SELECT branch FROM users WHERE id = $1",
                [req.user.id]
            );
            branch = userResult.rows[0]?.branch;
        }
        let query = `SELECT id, name, type, branch, created_by, created_at,
                     TO_CHAR(date, 'YYYY-MM-DD') AS date
                     FROM company_holidays`;
        let params = [];
        const conditions = [];
        if (year && month) {
            conditions.push(`EXTRACT(YEAR FROM date) = $${params.length + 1}`);
            params.push(year);
            conditions.push(`EXTRACT(MONTH FROM date) = $${params.length + 1}`);
            params.push(month);
        } else if (year) {
            conditions.push(`EXTRACT(YEAR FROM date) = $${params.length + 1}`);
            params.push(year);
        }
        if (branch) {
            conditions.push(`(branch = 'all' OR branch = $${params.length + 1})`);
            params.push(branch);
        }
        if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;
        query += ` ORDER BY date ASC`;
        const result = await pool.query(query, params);

        res.json(result.rows); // date is now always "YYYY-MM-DD" string
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ======================================================
// POST create/update holiday
// ======================================================
// POST create/update holiday


router.post(
  "/holidays",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { date, name, type = "holiday", branch = "all" } = req.body;

      if (!date || !name) {
        return res.status(400).json({ message: "date and name required" });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date must be YYYY-MM-DD format" });
      }

      if (new Date(date + "T00:00:00").getDay() === 0) {
        return res.status(400).json({ message: "Sunday is already a default holiday" });
      }

      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO company_holidays (date, name, type, branch, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (date)
        DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          branch = EXCLUDED.branch
        RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch, created_by, created_at
        `,
        [date, name, type, branch, req.user.id]
      );

      if (type === "holiday") {
        let attendanceQuery = `
          UPDATE attendance_records
          SET status = 'holiday',
              check_in_time = NULL,
              check_out_time = NULL,
              late_minutes = 0,
              production_hours = 0,
              total_break_minutes = 0,
              holiday_name = $2,
              leave_status = NULL,
              leave_type = NULL,
              updated_at = NOW()
          WHERE date = $1
        `;
        let attendanceParams = [date, name];

        // If branch is specified, only update that branch
        if (branch && branch !== "all") {
          attendanceQuery += ` AND branch = $3`;
          attendanceParams.push(branch);
        }

        const updateRes = await client.query(attendanceQuery, attendanceParams);
      }

      await client.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);

      await client.query("COMMIT");

      res.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("POST /holidays rollback failed:", rollbackErr);
      });
      console.error("POST /holidays error:", err);
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  }
);

// ======================================================
// GET working days
// MUST stay BEFORE /holidays/:date
// ======================================================
router.get("/holidays/working-days", verifyToken, async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                message: "year and month required"
            });
        }

        const daysInMonth = new Date(year, month, 0).getDate();

        const holidays = await pool.query(
            `
            SELECT date
            FROM company_holidays
            WHERE EXTRACT(YEAR FROM date) = $1
            AND EXTRACT(MONTH FROM date) = $2
            `,
            [year, month]
        );

        // ✅ Normalize holiday dates
        const holidaySet = new Set(
            holidays.rows.map(h => normalizeDate(h.date))
        );

        let workingDays = 0;
        let sundayCount = 0;

        for (let d = 1; d <= daysInMonth; d++) {

            const ds =
                `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            const dow = new Date(ds + "T00:00:00").getDay();

            // Sunday
            if (dow === 0) {
                sundayCount++;
                continue;
            }

            // Holiday
            if (holidaySet.has(ds)) {
                continue;
            }

            workingDays++;
        }

        res.json({
            workingDays,
            sundayCount,
            holidayCount: holidaySet.size,
            totalDays: daysInMonth
        });

    } catch (err) {
        console.error("GET /holidays/working-days error:", err);
        res.status(500).json({ message: err.message });
    }
});

// ======================================================
// DELETE holiday
// ======================================================

router.delete(
  "/holidays/:date",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { date } = req.params;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      await client.query("BEGIN");

      // Get holiday info before deleting
      const holidayResult = await client.query(
        "SELECT name, type, branch FROM company_holidays WHERE date = $1",
        [date]
      );

      if (holidayResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Holiday not found" });
      }

      const holiday = holidayResult.rows[0];

      // Delete the holiday
      await client.query("DELETE FROM company_holidays WHERE date = $1", [date]);

      // If it was a full day holiday, remove holiday status from attendance
      if (holiday.type === "holiday") {
        let attendanceQuery = `
          UPDATE attendance_records
          SET status = CASE
            WHEN check_in_time IS NOT NULL THEN 'present'
            ELSE 'absent'
          END,
              holiday_name = NULL,
              leave_status = NULL,
              leave_type = NULL,
              updated_at = NOW()
          WHERE date = $1 AND status = 'holiday'
        `;
        let attendanceParams = [date];

        // If branch was specified, only update that branch
        if (holiday.branch && holiday.branch !== "all") {
          attendanceQuery += ` AND branch = $2`;
          attendanceParams.push(holiday.branch);
        }

        await client.query(attendanceQuery, attendanceParams);
      }

      await client.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);
      await client.query("COMMIT");

      res.json({ message: "Holiday deleted successfully" });
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("DELETE /holidays rollback failed:", rollbackErr);
      });
      console.error("DELETE /holidays error:", err);
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  }
);

// ======================================================
// BULK UPLOAD holidays from CSV/Excel
// ======================================================
router.post(
  "/holidays/bulk-upload",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"),
  upload.single('file'),
  async (req, res) => {
    const client = await pool.connect();

    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      let holidays = [];

      // Parse CSV file
      if (req.file.originalname.endsWith('.csv')) {
        const csvContent = req.file.buffer.toString('utf-8');
        const records = [];

        await new Promise((resolve, reject) => {
          const stream = Readable.from(csvContent);
          stream
            .pipe(csv())
            .on('data', (row) => records.push(row))
            .on('end', resolve)
            .on('error', reject);
        });

        holidays = records.map(row => ({
          date: row['Date'] || row['date'] || row['Date (YYYY-MM-DD)'],
          name: row['Name'] || row['name'] || row['Holiday Name'],
          type: row['Type'] || row['type'] || row['Type (holiday/optional)'] || 'holiday',
          branch: row['Branch'] || row['branch'] || row['Branch (all/Hyderabad/Bangalore)'] || 'all'
        }));
      }
      // Parse Excel file
      else if (req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        holidays = jsonData.map(row => ({
          date: row['Date'] || row['date'] || row['Date (YYYY-MM-DD)'],
          name: row['Name'] || row['name'] || row['Holiday Name'],
          type: row['Type'] || row['type'] || row['Type (holiday/optional)'] || 'holiday',
          branch: row['Branch'] || row['branch'] || row['Branch (all/Hyderabad/Bangalore)'] || 'all'
        }));
      } else {
        return res.status(400).json({ message: "Unsupported file format" });
      }

      // Validate holidays
      const validHolidays = [];
      const errors = [];

      for (let i = 0; i < holidays.length; i++) {
        const holiday = holidays[i];

        if (!holiday.date || !holiday.name) {
          errors.push({ row: i + 1, error: "Missing date or name" });
          continue;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date)) {
          errors.push({ row: i + 1, error: "Invalid date format (must be YYYY-MM-DD)" });
          continue;
        }

        // Check for Sunday
        if (new Date(holiday.date + "T00:00:00").getDay() === 0) {
          errors.push({ row: i + 1, error: "Sunday is already a default holiday" });
          continue;
        }

        // Validate branch
        if (!['all', 'Hyderabad', 'Bangalore'].includes(holiday.branch)) {
          errors.push({ row: i + 1, error: "Invalid branch (must be all, Hyderabad, or Bangalore)" });
          continue;
        }

        // Validate type
        if (!['holiday', 'optional'].includes(holiday.type)) {
          errors.push({ row: i + 1, error: "Invalid type (must be holiday or optional)" });
          continue;
        }

        validHolidays.push(holiday);
      }

      if (errors.length > 0) {
        return res.status(400).json({
          message: "Validation errors found",
          errors,
          validCount: validHolidays.length,
          errorCount: errors.length
        });
      }

      await client.query("BEGIN");

      const results = {
        imported: [],
        duplicates: [],
        updated: []
      };

      for (const holiday of validHolidays) {
        // Check for duplicates
        const existing = await client.query(
          "SELECT id, name, type, branch FROM company_holidays WHERE date = $1",
          [holiday.date]
        );

        if (existing.rows.length > 0) {
          // Check if it's an exact duplicate
          const existingHoliday = existing.rows[0];
          if (existingHoliday.name === holiday.name &&
              existingHoliday.type === holiday.type &&
              existingHoliday.branch === holiday.branch) {
            results.duplicates.push(holiday);
          } else {
            // Update existing holiday
            await client.query(
              `UPDATE company_holidays
               SET name = $1, type = $2, branch = $3, created_by = $4
               WHERE date = $5`,
              [holiday.name, holiday.type, holiday.branch, req.user.id, holiday.date]
            );
            results.updated.push(holiday);

            // Update attendance if it's a holiday
            if (holiday.type === "holiday") {
              let attendanceQuery = `
                UPDATE attendance_records
                SET status = 'holiday',
                    check_in_time = NULL,
                    check_out_time = NULL,
                    late_minutes = 0,
                    production_hours = 0,
                    total_break_minutes = 0,
                    holiday_name = $1,
                    leave_status = NULL,
                    leave_type = NULL,
                    updated_at = NOW()
                WHERE date = $2
              `;
              let attendanceParams = [holiday.name, holiday.date];

              if (holiday.branch && holiday.branch !== "all") {
                attendanceQuery += ` AND branch = $3`;
                attendanceParams.push(holiday.branch);
              }

              await client.query(attendanceQuery, attendanceParams);
            }
          }
        } else {
          // Insert new holiday
          const result = await client.query(
            `INSERT INTO company_holidays (date, name, type, branch, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch`,
            [holiday.date, holiday.name, holiday.type, holiday.branch, req.user.id]
          );
          results.imported.push(result.rows[0]);

          // Update attendance if it's a holiday
          if (holiday.type === "holiday") {
            let attendanceQuery = `
              UPDATE attendance_records
              SET status = 'holiday',
                  check_in_time = NULL,
                  check_out_time = NULL,
                  late_minutes = 0,
                  production_hours = 0,
                  total_break_minutes = 0,
                  holiday_name = $1,
                  leave_status = NULL,
                  leave_type = NULL,
                  updated_at = NOW()
              WHERE date = $2
            `;
            let attendanceParams = [holiday.name, holiday.date];

            if (holiday.branch && holiday.branch !== "all") {
              attendanceQuery += ` AND branch = $3`;
              attendanceParams.push(holiday.branch);
            }

            await client.query(attendanceQuery, attendanceParams);
          }
        }
      }

      await client.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);
      await client.query("COMMIT");

      res.json({
        message: "Bulk upload completed",
        results: {
          imported: results.imported.length,
          updated: results.updated.length,
          duplicates: results.duplicates.length,
          importedDetails: results.imported,
          updatedDetails: results.updated,
          duplicateDetails: results.duplicates
        }
      });
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("POST /holidays/bulk-upload rollback failed:", rollbackErr);
      });
      console.error("POST /holidays/bulk-upload error:", err);
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  }
);

// ======================================================
// ANNUAL ROLLOVER - Generate next year's holidays for review
// ======================================================
router.post(
  "/holidays/rollover",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    try {
      const { fromYear, toYear } = req.body;

      if (!fromYear || !toYear) {
        return res.status(400).json({ message: "fromYear and toYear are required" });
      }

      // Get holidays from the source year with their dates
      const sourceHolidays = await pool.query(
        `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch
         FROM company_holidays
         WHERE EXTRACT(YEAR FROM date) = $1
         ORDER BY date ASC`,
        [fromYear]
      );

      if (sourceHolidays.rows.length === 0) {
        return res.status(404).json({ message: "No holidays found in the source year" });
      }

      const rolloverHolidays = [];
      const conflicts = [];

      for (const holiday of sourceHolidays.rows) {
        // Calculate the corresponding date in the target year
        const dateParts = holiday.date.split('-');
        const targetDate = `${toYear}-${dateParts[1]}-${dateParts[2]}`;

        // Check if the target date already exists
        const existing = await pool.query(
          "SELECT id, name FROM company_holidays WHERE date = $1",
          [targetDate]
        );

        if (existing.rows.length > 0) {
          conflicts.push({
            date: targetDate,
            existingName: existing.rows[0].name,
            proposedName: holiday.name
          });
        } else {
          rolloverHolidays.push({
            date: targetDate,
            name: holiday.name,
            type: holiday.type,
            branch: holiday.branch
          });
        }
      }

      res.json({
        message: "Rollover preview generated",
        fromYear,
        toYear,
        proposed: rolloverHolidays,
        conflicts,
        total: rolloverHolidays.length,
        conflictCount: conflicts.length
      });
    } catch (err) {
      console.error("POST /holidays/rollover error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ======================================================
// CONFIRM ANNUAL ROLLOVER - Apply the rollover after review
// ======================================================
router.post(
  "/holidays/rollover/confirm",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "HR"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { holidays } = req.body;

      if (!holidays || !Array.isArray(holidays) || holidays.length === 0) {
        return res.status(400).json({ message: "holidays array is required" });
      }

      await client.query("BEGIN");

      const results = {
        imported: [],
        conflicts: []
      };

      for (const holiday of holidays) {
        // Check for duplicates again (in case something changed)
        const existing = await client.query(
          "SELECT id FROM company_holidays WHERE date = $1",
          [holiday.date]
        );

        if (existing.rows.length > 0) {
          results.conflicts.push(holiday);
        } else {
          const result = await client.query(
            `INSERT INTO company_holidays (date, name, type, branch, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch`,
            [holiday.date, holiday.name, holiday.type, holiday.branch, req.user.id]
          );
          results.imported.push(result.rows[0]);

          // Update attendance if it's a holiday
          if (holiday.type === "holiday") {
            let attendanceQuery = `
              UPDATE attendance_records
              SET status = 'holiday',
                  check_in_time = NULL,
                  check_out_time = NULL,
                  late_minutes = 0,
                  production_hours = 0,
                  total_break_minutes = 0,
                  holiday_name = $1,
                  leave_status = NULL,
                  leave_type = NULL,
                  updated_at = NOW()
              WHERE date = $2
            `;
            let attendanceParams = [holiday.name, holiday.date];

            if (holiday.branch && holiday.branch !== "all") {
              attendanceQuery += ` AND branch = $3`;
              attendanceParams.push(holiday.branch);
            }

            await client.query(attendanceQuery, attendanceParams);
          }
        }
      }

      await client.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);
      await client.query("COMMIT");

      res.json({
        message: "Annual rollover completed",
        results: {
          imported: results.imported.length,
          conflicts: results.conflicts.length,
          importedDetails: results.imported,
          conflictDetails: results.conflicts
        }
      });
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr) => {
        console.error("POST /holidays/rollover/confirm rollback failed:", rollbackErr);
      });
      console.error("POST /holidays/rollover/confirm error:", err);
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  }
);

console.log("✅ Holiday routes loaded");

export default router;
