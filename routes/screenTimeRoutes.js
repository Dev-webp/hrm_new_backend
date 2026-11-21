import express from 'express';

const router = express.Router();

// Verify token middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  // Add your JWT verification logic here
  // For now, just pass through
  next();
};

// POST /api/screen-time - Record screen time
router.post('/screen-time', verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const { user_id, date, total_seconds } = req.body;
    
    if (!user_id || !date || total_seconds === undefined) {
      return res.status(400).json({ message: 'user_id, date, and total_seconds are required' });
    }

    const query = `
      INSERT INTO screen_time_records (user_id, date, total_seconds)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        total_seconds = screen_time_records.total_seconds + $3,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [user_id, date, total_seconds]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error recording screen time:', error);
    res.status(500).json({ message: 'Failed to record screen time' });
  }
});

// GET /api/screen-time - Get screen time for a user
router.get('/screen-time', verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const { user_id, start_date, end_date } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    let query = `
      SELECT * FROM screen_time_records
      WHERE user_id = $1
    `;
    const params = [user_id];

    if (start_date && end_date) {
      query += ` AND date BETWEEN $2 AND $3`;
      params.push(start_date, end_date);
    }

    query += ` ORDER BY date DESC`;

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching screen time:', error);
    res.status(500).json({ message: 'Failed to fetch screen time' });
  }
});

// GET /api/screen-time/summary - Get screen time summary
router.get('/screen-time/summary', verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const { user_id, start_date, end_date } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    let query = `
      SELECT 
        COUNT(*) as total_days,
        SUM(total_seconds) as total_seconds,
        AVG(total_seconds) as avg_seconds
      FROM screen_time_records
      WHERE user_id = $1
    `;
    const params = [user_id];

    if (start_date && end_date) {
      query += ` AND date BETWEEN $2 AND $3`;
      params.push(start_date, end_date);
    }

    const result = await pool.query(query, params);
    
    const summary = result.rows[0];
    
    // Convert seconds to hours and minutes
    const totalHours = Math.floor(summary.total_seconds / 3600);
    const totalMinutes = Math.floor((summary.total_seconds % 3600) / 60);
    const avgHours = Math.floor(summary.avg_seconds / 3600);
    const avgMinutes = Math.floor((summary.avg_seconds % 3600) / 60);

    res.json({
      success: true,
      data: {
        total_days: summary.total_days,
        total_seconds: summary.total_seconds,
        total_hours: totalHours,
        total_minutes: totalMinutes,
        avg_seconds: summary.avg_seconds,
        avg_hours: avgHours,
        avg_minutes: avgMinutes,
      }
    });
  } catch (error) {
    console.error('Error fetching screen time summary:', error);
    res.status(500).json({ message: 'Failed to fetch screen time summary' });
  }
});

export default router;
