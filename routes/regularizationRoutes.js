/**
 * Regularization Request API Routes
 * Handles requests to regularize missed punches, late/early entries, etc.
 */

import express from 'express';
import { pool } from '../middleware/db.js';

const router = express.Router();

/**
 * GET /api/regularization
 * Get regularization requests with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      user_id,
      status,
      manager_id,
      start_date,
      end_date,
      type,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT rr.*, 
             u.email, u.full_name, u.branch, u.department,
             ar.check_in_time as original_check_in,
             ar.check_out_time as original_check_out,
             ar.status as original_status,
             m.email as manager_email, m.full_name as manager_name
      FROM regularization_requests rr
      JOIN users u ON rr.user_id = u.id
      LEFT JOIN attendance_records ar ON rr.attendance_record_id = ar.id
      LEFT JOIN users m ON rr.manager_id = m.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND rr.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND rr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (manager_id) {
      query += ` AND rr.manager_id = $${paramIndex}`;
      params.push(manager_id);
      paramIndex++;
    }

    if (type) {
      query += ` AND rr.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND rr.created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND rr.created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` ORDER BY rr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching regularization requests:', error);
    res.status(500).json({ error: 'Failed to fetch regularization requests' });
  }
});

/**
 * GET /api/regularization/:id
 * Get single regularization request by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT rr.*, 
              u.email, u.full_name, u.branch, u.department, u.manager_id,
              ar.check_in_time as original_check_in,
              ar.check_out_time as original_check_out,
              ar.status as original_status,
              m.email as manager_email, m.full_name as manager_name
       FROM regularization_requests rr
       JOIN users u ON rr.user_id = u.id
       LEFT JOIN attendance_records ar ON rr.attendance_record_id = ar.id
       LEFT JOIN users m ON rr.manager_id = m.id
       WHERE rr.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Regularization request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching regularization request:', error);
    res.status(500).json({ error: 'Failed to fetch regularization request' });
  }
});

/**
 * POST /api/regularization
 * Create a new regularization request
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      user_id,
      date,
      type, // missed_punch, late_early, incorrect_hours
      requested_check_in_time,
      requested_check_out_time,
      reason,
      supporting_document_path,
    } = req.body;

    // Get user's manager
    const userResult = await client.query(
      'SELECT manager_id FROM users WHERE id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const manager_id = userResult.rows[0].manager_id;

    // Get attendance record
    const attendanceResult = await client.query(
      'SELECT id FROM attendance_records WHERE user_id = $1 AND date = $2',
      [user_id, date]
    );

    const attendance_record_id = attendanceResult.rows[0]?.id || null;

    // Insert regularization request
    const result = await client.query(
      `INSERT INTO regularization_requests
       (user_id, date, type, requested_check_in_time, requested_check_out_time, reason, supporting_document_path, manager_id, attendance_record_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user_id, date, type, requested_check_in_time, requested_check_out_time, reason, supporting_document_path, manager_id, attendance_record_id]
    );

    // Update attendance status to regularization_pending
    if (attendance_record_id) {
      await client.query(
        `UPDATE attendance_records
         SET status = 'regularization_pending', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [attendance_record_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating regularization request:', error);
    res.status(500).json({ error: 'Failed to create regularization request' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/regularization/:id/manager-decision
 * Manager approves or rejects regularization request
 */
router.put('/:id/manager-decision', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      status, // 'REGULARIZED' or 'REJECTED'
      manager_decision,
      manager_id,
    } = req.body;

    // Get regularization request
    const reqResult = await client.query(
      'SELECT * FROM regularization_requests WHERE id = $1',
      [id]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Regularization request not found' });
    }

    const regularization = reqResult.rows[0];

    // Update regularization request
    const result = await client.query(
      `UPDATE regularization_requests
       SET status = $1,
           manager_decision = $2,
           manager_id = $3,
           manager_decision_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, manager_decision, manager_id, id]
    );

    // If approved, update attendance record
    if (status === 'REGULARIZED' && regularization.attendance_record_id) {
      await client.query(
        `UPDATE attendance_records
         SET check_in_time = $1,
             check_out_time = $2,
             status = 'present',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [regularization.requested_check_in_time, regularization.requested_check_out_time, regularization.attendance_record_id]
      );
    } else if (status === 'REJECTED' && regularization.attendance_record_id) {
      // Reset to original status or mark as absent
      await client.query(
        `UPDATE attendance_records
         SET status = 'absent', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [regularization.attendance_record_id]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating manager decision:', error);
    res.status(500).json({ error: 'Failed to update manager decision' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/regularization/:id/hr-decision
 * HR approves or rejects regularization request (if manager approved and HR review needed)
 */
router.put('/:id/hr-decision', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status, // 'REGULARIZED' or 'REJECTED'
      hr_decision,
      hr_id,
    } = req.body;

    const result = await pool.query(
      `UPDATE regularization_requests
       SET status = $1,
           hr_decision = $2,
           hr_id = $3,
           hr_decision_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, hr_decision, hr_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Regularization request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating HR decision:', error);
    res.status(500).json({ error: 'Failed to update HR decision' });
  }
});

export default router;
