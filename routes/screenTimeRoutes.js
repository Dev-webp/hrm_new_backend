
import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";

const router = express.Router();

// Validate YYYY-MM-DD dates
const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
};

// Validate optional date range
const validateDateRange = (start_date, end_date) => {
  if (!start_date && !end_date) return true;
  if (!start_date || !end_date) return false;

  return isValidDate(start_date) &&
    isValidDate(end_date) &&
    start_date <= end_date;
};

// POST /api/screen-time
// Record authenticated employee's screen time
router.post("/screen-time", verifyToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { user_id, date, total_seconds } = req.body;

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid authenticated user" });
    }

    // Prevent one employee from recording another employee's time
    if (user_id !== undefined && Number(user_id) !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ message: "Valid date is required (YYYY-MM-DD)" });
    }

    if (
      !Number.isSafeInteger(total_seconds) ||
      total_seconds < 0 ||
      total_seconds > 86400
    ) {
      return res.status(400).json({
        message: "total_seconds must be an integer between 0 and 86400"
      });
    }

    const query = `
      INSERT INTO screen_time_records
        (user_id, date, total_seconds)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        total_seconds = screen_time_records.total_seconds + $3,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      date,
      total_seconds
    ]);

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error recording screen time:", error);
    return res.status(500).json({
      message: "Failed to record screen time"
    });
  }
});

// GET /api/screen-time
// Get authenticated employee's screen time
router.get("/screen-time", verifyToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { user_id, start_date, end_date } = req.query;

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid authenticated user" });
    }

    if (user_id !== undefined && Number(user_id) !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!validateDateRange(start_date, end_date)) {
      return res.status(400).json({
        message: "Invalid date range"
      });
    }

    let query = `
      SELECT *
      FROM screen_time_records
      WHERE user_id = $1
    `;

    const params = [userId];

    if (start_date && end_date) {
      query += " AND date BETWEEN $2 AND $3";
      params.push(start_date, end_date);
    }

    query += " ORDER BY date DESC";

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error("Error fetching screen time:", error);
    return res.status(500).json({
      message: "Failed to fetch screen time"
    });
  }
});

// GET /api/screen-time/summary
// Get authenticated employee's screen time summary
router.get("/screen-time/summary", verifyToken, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { user_id, start_date, end_date } = req.query;

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid authenticated user" });
    }

    if (user_id !== undefined && Number(user_id) !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!validateDateRange(start_date, end_date)) {
      return res.status(400).json({
        message: "Invalid date range"
      });
    }

    let query = `
      SELECT
        COUNT(*) AS total_days,
        COALESCE(SUM(total_seconds), 0) AS total_seconds,
        COALESCE(AVG(total_seconds), 0) AS avg_seconds
      FROM screen_time_records
      WHERE user_id = $1
    `;

    const params = [userId];

    if (start_date && end_date) {
      query += " AND date BETWEEN $2 AND $3";
      params.push(start_date, end_date);
    }

    const result = await pool.query(query, params);
    const summary = result.rows[0];

    const totalSeconds = Number(summary.total_seconds);
    const avgSeconds = Number(summary.avg_seconds);

    return res.json({
      success: true,
      data: {
        total_days: Number(summary.total_days),
        total_seconds: totalSeconds,
        total_hours: Math.floor(totalSeconds / 3600),
        total_minutes: Math.floor((totalSeconds % 3600) / 60),
        avg_seconds: avgSeconds,
        avg_hours: Math.floor(avgSeconds / 3600),
        avg_minutes: Math.floor((avgSeconds % 3600) / 60)
      }
    });

  } catch (error) {
    console.error("Error fetching screen time summary:", error);
    return res.status(500).json({
      message: "Failed to fetch screen time summary"
    });
  }
});

export default router;