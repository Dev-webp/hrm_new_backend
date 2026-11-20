/**
 * Leave Extension Request API Routes
 * Handles requests to extend approved leave
 */

import express from 'express';
import { pool } from '../middleware/db.js';

const router = express.Router();

/**
 * GET /api/leave-extensions
 * Get leave extension requests with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      user_id,
      status,
      manager_id,
      start_date,
      end_date,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT ler.*, 
             u.email, u.full_name, u.branch, u.department,
             lr.requested_start_date, lr.requested_end_date, lr.leave_type,
             m.email as manager_email, m.full_name as manager_name
      FROM leave_extension_requests ler
      JOIN users u ON ler.user_id = u.id
      LEFT JOIN leave_requests lr ON ler.leave_request_id = lr.id
      LEFT JOIN users m ON ler.manager_id = m.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND ler.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND ler.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (manager_id) {
      query += ` AND ler.manager_id = $${paramIndex}`;
      params.push(manager_id);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND ler.created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND ler.created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` ORDER BY ler.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leave extension requests:', error);
    res.status(500).json({ error: 'Failed to fetch leave extension requests' });
  }
});

/**
 * GET /api/leave-extensions/:id
 * Get single leave extension request by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ler.*, 
              u.email, u.full_name, u.branch, u.department, u.manager_id,
              lr.requested_start_date, lr.requested_end_date, lr.leave_type,
              m.email as manager_email, m.full_name as manager_name
       FROM leave_extension_requests ler
       JOIN users u ON ler.user_id = u.id
       LEFT JOIN leave_requests lr ON ler.leave_request_id = lr.id
       LEFT JOIN users m ON ler.manager_id = m.id
       WHERE ler.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave extension request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching leave extension request:', error);
    res.status(500).json({ error: 'Failed to fetch leave extension request' });
  }
});

/**
 * POST /api/leave-extensions
 * Create a new leave extension request
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      leave_request_id,
      user_id,
      original_end_date,
      requested_end_date,
      extension_days,
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

    // Insert leave extension request
    const result = await client.query(
      `INSERT INTO leave_extension_requests
       (leave_request_id, user_id, original_end_date, requested_end_date, extension_days, reason, supporting_document_path, manager_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [leave_request_id, user_id, original_end_date, requested_end_date, extension_days, reason, supporting_document_path, manager_id]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating leave extension request:', error);
    res.status(500).json({ error: 'Failed to create leave extension request' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/leave-extensions/:id/manager-decision
 * Manager approves or rejects leave extension
 */
router.put('/:id/manager-decision', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status, // 'APPROVED' or 'REJECTED'
      manager_decision,
      manager_id,
    } = req.body;

    const result = await pool.query(
      `UPDATE leave_extension_requests
       SET status = $1,
           manager_decision = $2,
           manager_id = $3,
           manager_decision_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, manager_decision, manager_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave extension request not found' });
    }

    // If approved, update the original leave request end date
    if (status === 'APPROVED') {
      const extension = result.rows[0];
      await pool.query(
        `UPDATE leave_requests
         SET requested_end_date = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [extension.requested_end_date, extension.leave_request_id]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating manager decision:', error);
    res.status(500).json({ error: 'Failed to update manager decision' });
  }
});

/**
 * PUT /api/leave-extensions/:id/hr-decision
 * HR approves or rejects leave extension (if manager approved and HR review needed)
 */
router.put('/:id/hr-decision', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status, // 'APPROVED' or 'REJECTED'
      hr_decision,
      hr_id,
    } = req.body;

    const result = await pool.query(
      `UPDATE leave_extension_requests
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
      return res.status(404).json({ error: 'Leave extension request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating HR decision:', error);
    res.status(500).json({ error: 'Failed to update HR decision' });
  }
});

export default router;
