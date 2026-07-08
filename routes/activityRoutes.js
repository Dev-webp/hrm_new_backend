// backend/routes/activityRoutes.js
import express from 'express';
import { pool } from '../middleware/db.js';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();
const ACTIVITY_TYPES = new Set([
  'attendance_changed', 'leave_changed', 'break_changed',
  'payslip_generated', 'employee_status_changed',
]);

function parseLogIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000);
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function activityCountFor(user) {
  const params = [];
  let where = '';
  if (user.role === 'MANAGER') {
    params.push(user.branch);
    where = `WHERE (branch = $1 OR branch = 'all')`;
  }
  const result = await pool.query(`SELECT COUNT(*) AS count FROM activity_logs ${where}`, params);
  return Number(result.rows[0]?.count || 0);
}

// ✅ 1. STATS — must be FIRST (before any /:id style routes)
router.get('/stats/summary', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
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

// GET /api/activity-logs/count
router.get('/count', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role === 'MANAGER') {
      params.push(req.user.branch);
      where = `WHERE (branch = $1 OR branch = 'all')`;
    }
    const result = await pool.query(`SELECT COUNT(*) AS count FROM activity_logs ${where}`, params);
    res.json({ count: Number(result.rows[0]?.count || 0) });
  } catch (err) {
    console.error('[ActivityRoutes] GET /count', err);
    res.status(500).json({ message: 'Failed to fetch activity log count' });
  }
});

router.delete('/selected', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const ids = parseLogIds(req.body?.ids);
    if (!ids.length) return res.status(400).json({ message: 'Select at least one activity log' });
    const params = [ids];
    let scope = '';
    if (req.user.role === 'MANAGER') {
      params.push(req.user.branch);
      scope = `AND branch = $2`;
    }
    const result = await pool.query(
      `DELETE FROM activity_logs WHERE id = ANY($1::int[]) ${scope} RETURNING id`,
      params
    );
    res.json({ success: true, deletedCount: result.rowCount, count: await activityCountFor(req.user) });
  } catch (err) {
    console.error('[ActivityRoutes] DELETE /selected', err);
    res.status(500).json({ message: 'Failed to delete selected activity logs' });
  }
});

router.delete('/range', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const { fromDate, toDate } = req.body || {};
    if (!isDateOnly(fromDate) || !isDateOnly(toDate) || fromDate > toDate) {
      return res.status(400).json({ message: 'Enter a valid From and To date range' });
    }
    const params = [fromDate, toDate];
    let scope = '';
    if (req.user.role === 'MANAGER') {
      params.push(req.user.branch);
      scope = `AND branch = $3`;
    }
    const result = await pool.query(
      `DELETE FROM activity_logs
       WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
       ${scope} RETURNING id`,
      params
    );
    res.json({ success: true, deletedCount: result.rowCount, count: await activityCountFor(req.user) });
  } catch (err) {
    console.error('[ActivityRoutes] DELETE /range', err);
    res.status(500).json({ message: 'Failed to delete activity logs by date range' });
  }
});

router.delete('/:id', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid log ID' });
    }
    const params = [id];
    let scope = '';
    if (req.user.role === 'MANAGER') {
      params.push(req.user.branch);
      scope = `AND branch = $2`;
    }
    const result = await pool.query(`DELETE FROM activity_logs WHERE id = $1 ${scope} RETURNING id`, params);
    if (!result.rows.length) return res.status(404).json({ message: 'Log not found' });
    res.json({ success: true, id, count: await activityCountFor(req.user) });
  } catch (err) {
    console.error('[ActivityRoutes] DELETE /:id', err);
    res.status(500).json({ message: 'Failed to delete activity log' });
  }
});

// ✅ 2. GET BY ID — must be before GET / in Express matching
router.get('/:id', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    // Make sure id is a number to avoid matching "stats" as an id
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid log ID' });

    const params = [id];
    let scope = '';
    if (req.user.role === 'MANAGER') {
      params.push(req.user.branch);
      scope = `AND (branch = $2 OR branch = 'all')`;
    }
    const result = await pool.query(`SELECT * FROM activity_logs WHERE id = $1 ${scope}`, params);
    if (!result.rows.length) return res.status(404).json({ message: 'Log not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch log' });
  }
});

// ✅ 3. LIST (paginated) — last
router.get('/', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const user = req.user;
    const {
      page = 1, limit = 20,
      action: actionFilter,
      severity: severityFilter,
      branch: branchFilter,
      date, startDate, endDate, fromDate, toDate,
      search,
      sort = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const offset = (pageNum - 1) * limitNum;
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

    if (actionFilter) {
      if (ACTIVITY_TYPES.has(actionFilter)) {
        conditions.push(`action_type = $${idx++}`);
      } else {
        conditions.push(`action = $${idx++}`);
      }
      params.push(actionFilter);
    }
    if (severityFilter) { conditions.push(`severity = $${idx++}`); params.push(severityFilter); }
    const effectiveStartDate = startDate || fromDate;
    const effectiveEndDate = endDate || toDate;
    if ((effectiveStartDate && !isDateOnly(effectiveStartDate)) ||
        (effectiveEndDate && !isDateOnly(effectiveEndDate)) ||
        (date && !isDateOnly(date))) {
      return res.status(400).json({ message: 'Dates must use YYYY-MM-DD' });
    }
    if (effectiveStartDate && effectiveEndDate && effectiveStartDate > effectiveEndDate) {
      return res.status(400).json({ message: 'fromDate cannot be after toDate' });
    }
    if (date) {
      conditions.push(`created_at::date = $${idx++}::date`);
      params.push(date);
    } else if (effectiveStartDate) {
      conditions.push(`created_at >= $${idx++}::date`);
      params.push(effectiveStartDate);
    }
    if (!date && effectiveEndDate) {
      conditions.push(`created_at < ($${idx++}::date + INTERVAL '1 day')`);
      params.push(effectiveEndDate);
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
        `SELECT * FROM activity_logs ${where} ORDER BY created_at ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limitNum, offset]
      ),
    ]);

    res.json({
      data:       dataResult.rows,
      total:      parseInt(countResult.rows[0].count),
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum),
    });
  } catch (err) {
    console.error('[ActivityRoutes] GET /', err);
    res.status(500).json({ message: 'Failed to fetch activity logs' });
  }
});

export default router;

