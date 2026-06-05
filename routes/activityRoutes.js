// backend/routes/activityRoutes.js
import express from 'express';
import { pool } from '../middleware/db.js';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// ✅ 1. STATS — must be FIRST (before any /:id style routes)
router.get('/stats/summary', verifyToken, authorizeRoles('SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const user = req.user;
    const { branch: branchFilter } = req.query;
    const params = [];
    let branchClause = '';

    if (user.role === 'MANAGER') {
      branchClause = `WHERE (branch = $1 OR branch = 'all')`;
      params.push(user.branch);
    } else if (branchFilter && branchFilter !== 'all') {
      branchClause = `WHERE (branch = $1 OR branch = 'all')`;
      params.push(branchFilter);
    }

    const andOrWhere = branchClause ? 'AND' : 'WHERE';

    const [totalRes, uniqueRes, criticalRes, failedRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM activity_logs ${branchClause}`, params),
      pool.query(`SELECT COUNT(DISTINCT user_id) FROM activity_logs ${branchClause}`, params),
      pool.query(`SELECT COUNT(*) FROM activity_logs ${branchClause} ${andOrWhere} severity = 'critical'`, params),
      pool.query(`SELECT COUNT(*) FROM activity_logs ${branchClause} ${andOrWhere} action = 'FailedLogin'`, params),
    ]);

    res.json({
      total:        parseInt(totalRes.rows[0].count),
      uniqueUsers:  parseInt(uniqueRes.rows[0].count),
      critical:     parseInt(criticalRes.rows[0].count),
      failedLogins: parseInt(failedRes.rows[0].count),
    });
  } catch (err) {
    console.error('[ActivityRoutes] GET /stats/summary', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// ✅ 2. GET BY ID — must be before GET / in Express matching
router.get('/:id', verifyToken, authorizeRoles('SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // Make sure id is a number to avoid matching "stats" as an id
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid log ID' });

    const result = await pool.query('SELECT * FROM activity_logs WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Log not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch log' });
  }
});

// ✅ 3. LIST (paginated) — last
router.get('/', verifyToken, authorizeRoles('SUPER_ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const user = req.user;
    const {
      page = 1, limit = 20,
      action: actionFilter,
      severity: severityFilter,
      branch: branchFilter,
      startDate, endDate,
      search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let idx = 1;

    if (user.role === 'MANAGER') {
      conditions.push(`(branch = $${idx} OR branch = 'all')`);
      params.push(user.branch); idx++;
    } else if (branchFilter && branchFilter !== 'all') {
      conditions.push(`(branch = $${idx} OR branch = 'all')`);
      params.push(branchFilter); idx++;
    }

    if (actionFilter)   { conditions.push(`action = $${idx++}`);   params.push(actionFilter); }
    if (severityFilter) { conditions.push(`severity = $${idx++}`); params.push(severityFilter); }
    if (startDate) {
      conditions.push(`timestamp >= $${idx++}`);
      params.push(new Date(startDate));
    }
    if (endDate) {
      conditions.push(`timestamp <= $${idx++}`);
      params.push(new Date(endDate + 'T23:59:59'));
    }
    if (search) {
      conditions.push(`(user_name ILIKE $${idx} OR details ILIKE $${idx} OR action ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM activity_logs ${where}`, params),
      pool.query(
        `SELECT * FROM activity_logs ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit), offset]
      ),
    ]);

    res.json({
      data:       dataResult.rows,
      total:      parseInt(countResult.rows[0].count),
      page:       parseInt(page),
      limit:      parseInt(limit),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)),
    });
  } catch (err) {
    console.error('[ActivityRoutes] GET /', err);
    res.status(500).json({ message: 'Failed to fetch activity logs' });
  }
});

export default router;