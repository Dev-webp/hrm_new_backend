import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// Helper → normalize DB dates safely
function normalizeDate(dateValue) {
    return (dateValue instanceof Date
        ? dateValue.toISOString()
        : String(dateValue)
    ).slice(0, 10);
}

// ======================================================
// GET holidays for a month
// ======================================================
// GET holidays for a month
router.get("/holidays", verifyToken, async (req, res) => {
    try {
        const { year, month } = req.query;
        let query = `SELECT id, name, type, branch, created_by, created_at,
                     TO_CHAR(date, 'YYYY-MM-DD') AS date
                     FROM company_holidays`;
        let params = [];
        if (year && month) {
            query += ` WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2`;
            params = [year, month];
        } else if (year) {
            query += ` WHERE EXTRACT(YEAR FROM date) = $1`;
            params = [year];
        }
        query += ` ORDER BY date ASC`;
        const result = await pool.query(query, params);

        console.log("GET /holidays query:", req.query);
console.log("GET /holidays rows:", result.rows);
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
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { date, name, type = "holiday" } = req.body;

      console.log("POST /holidays called:", req.body);

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
        INSERT INTO company_holidays (date, name, type, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (date)
        DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type
        RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch, created_by, created_at
        `,
        [date, name, type, req.user.id]
      );

      if (type === "holiday") {
        const updateRes = await client.query(
          `
          UPDATE attendance_records
          SET status = 'holiday',
              check_in_time = NULL,
              check_out_time = NULL,
              late_minutes = 0,
              production_hours = 0,
              total_break_minutes = 0,
              holiday_name = $2,
              updated_at = NOW()
          WHERE date = $1
          `,
          [date, name]
        );

        console.log("Holiday applied rows:", updateRes.rowCount);
      }

      await client.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);

      await client.query("COMMIT");

      res.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
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


console.log("✅ Holiday routes loaded");

export default router;