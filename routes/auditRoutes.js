// backend/routes/auditRoutes.js
import express from 'express';
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { createAuditLog, getClientIp, getDeviceInfo } from '../utils/activityLogger.js';

const router = express.Router();

// ✅ MUST be before /:id — otherwise Express matches "stats" as an id param
router.get('/stats/summary', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    let branchClause = '';
    const params = [];

    if (user.role === 'MANAGER') {
      branchClause = 'WHERE branch = $1';
      params.push(user.branch);
    } else if (user.role === 'EMPLOYEE') {
      branchClause = 'WHERE user_id = $1';
      params.push(user.id);
    }

    // Build each query independently so param indices are always $1
    const branchWhere  = branchClause || '';
    const andOrWhere   = branchClause ? 'AND' : 'WHERE';

    const [totalRes, todayRes, criticalRes, uniqueRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM audit_logs ${branchWhere}`, params),
      pool.query(
        `SELECT COUNT(*) FROM audit_logs ${branchWhere} ${andOrWhere} created_at::date = CURRENT_DATE`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM audit_logs ${branchWhere} ${andOrWhere} action_type IN ('DELETE_EMPLOYEE','UPDATE_PAYROLL','UPDATE_SETTINGS','DELETE_AUDIT_LOG')`,
        params
      ),
      pool.query(`SELECT COUNT(DISTINCT user_id) FROM audit_logs ${branchWhere}`, params),
    ]);

    res.json({
      total:       parseInt(totalRes.rows[0].count),
      today:       parseInt(todayRes.rows[0].count),
      critical:    parseInt(criticalRes.rows[0].count),
      uniqueUsers: parseInt(uniqueRes.rows[0].count),
    });
  } catch (err) {
    console.error('[AuditRoutes] GET /stats/summary', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// GET /api/audit-logs
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    const {
      page = 1, limit = 50,
      module: moduleFilter, action: actionFilter,
      status: statusFilter, userId: userIdFilter,
      branch: branchFilter, startDate, endDate, search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let idx = 1;

    if (user.role === 'EMPLOYEE') {
      conditions.push(`user_id = $${idx++}`);
      params.push(user.id);
    } else if (user.role === 'MANAGER') {
      conditions.push(`branch = $${idx++}`);
      params.push(user.branch);
    }

    if (moduleFilter)  { conditions.push(`module_name = $${idx++}`);  params.push(moduleFilter); }
    if (actionFilter)  { conditions.push(`action_type = $${idx++}`);  params.push(actionFilter); }
    if (statusFilter)  { conditions.push(`status = $${idx++}`);       params.push(statusFilter); }

    if (userIdFilter && user.role === 'SUPER_ADMIN') {
      conditions.push(`user_id = $${idx++}`);
      params.push(parseInt(userIdFilter));
    }
    if (branchFilter && user.role === 'SUPER_ADMIN') {
      conditions.push(`branch = $${idx++}`);
      params.push(branchFilter);
    }
    if (startDate) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(new Date(startDate));
    }
    if (endDate) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(new Date(endDate + 'T23:59:59'));
    }
    if (search) {
      conditions.push(
        `(user_name ILIKE $${idx} OR target_name ILIKE $${idx} OR action_type ILIKE $${idx} OR module_name ILIKE $${idx})`
      );
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_logs ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      data: dataResult.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('[AuditRoutes] GET /', err);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// ✅ /:id routes AFTER named routes
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM audit_logs WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Log not found' });
    const log = result.rows[0];
    if (req.user.role === 'EMPLOYEE' && log.user_id !== req.user.id)
      return res.status(403).json({ message: 'Access denied' });
    res.json(log);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch log' });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    const log = await createAuditLog({
      ...req.body,
      performedBy: user.full_name || user.name,
      userId: user.id,
      role: user.role,
      ipAddress: getClientIp(req),
      deviceInfo: getDeviceInfo(req),
      branch: user.branch,
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create log' });
  }
});

router.delete('/:id', verifyToken, authorizeRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM audit_logs WHERE id = $1', [req.params.id]);
    await createAuditLog({
      performedBy: req.user.full_name || req.user.name,
      userId: req.user.id,
      role: req.user.role,
      module: 'Audit Logs',
      action: 'DELETE_AUDIT_LOG',
      targetId: parseInt(req.params.id),
      targetName: `Audit Log #${req.params.id}`,
      ipAddress: getClientIp(req),
      deviceInfo: getDeviceInfo(req),
      status: 'SUCCESS',
      branch: req.user.branch,
    });
    res.json({ message: 'Log deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete log' });
  }
});

export default router;