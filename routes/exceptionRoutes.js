/**
 * Exception Request API Routes
 * Handles requests for genuine emergencies (hospitalization, connectivity failure, etc.)
 */

import express from 'express';
import { pool } from '../middleware/db.js';

const router = express.Router();

/**
 * GET /api/exceptions
 * Get exception requests with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      user_id,
      status,
      manager_id,
      exception_type,
      start_date,
      end_date,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT er.*, 
             u.email, u.full_name, u.branch, u.department,
             m.email as manager_email, m.full_name as manager_name
      FROM exception_requests er
      JOIN users u ON er.user_id = u.id
      LEFT JOIN users m ON er.manager_id = m.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND er.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND er.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (manager_id) {
      query += ` AND er.manager_id = $${paramIndex}`;
      params.push(manager_id);
      paramIndex++;
    }

    if (exception_type) {
      query += ` AND er.exception_type = $${paramIndex}`;
      params.push(exception_type);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND er.created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND er.created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` ORDER BY er.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching exception requests:', error);
    res.status(500).json({ error: 'Failed to fetch exception requests' });
  }
});

/**
 * GET /api/exceptions/:id
 * Get single exception request by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT er.*, 
              u.email, u.full_name, u.branch, u.department, u.manager_id,
              m.email as manager_email, m.full_name as manager_name
       FROM exception_requests er
       JOIN users u ON er.user_id = u.id
       LEFT JOIN users m ON er.manager_id = m.id
       WHERE er.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exception request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching exception request:', error);
    res.status(500).json({ error: 'Failed to fetch exception request' });
  }
});

/**
 * POST /api/exceptions
 * Create a new exception request
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      user_id,
      date,
      exception_type, // hospitalization, emergency, connectivity_failure, approved_retroactive_leave
      reason,
      supporting_document_path,
      medical_certificate_path,
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

    // Insert exception request
    const result = await client.query(
      `INSERT INTO exception_requests
       (user_id, date, exception_type, reason, supporting_document_path, medical_certificate_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, date, exception_type, reason, supporting_document_path, medical_certificate_path]
    );

    // Update AWI case if exists to mark as exception
    await client.query(
      `UPDATE awi_cases
       SET is_exception = true,
           exception_reason = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND date = $3`,
      [reason, user_id, date]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating exception request:', error);
    res.status(500).json({ error: 'Failed to create exception request' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/exceptions/:id/manager-decision
 * Manager approves or rejects exception request
 */
router.put('/:id/manager-decision', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      status, // 'approved' or 'rejected'
      manager_decision,
      manager_id,
    } = req.body;

    // Get exception request
    const reqResult = await client.query(
      'SELECT * FROM exception_requests WHERE id = $1',
      [id]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Exception request not found' });
    }

    const exception = reqResult.rows[0];

    // Update exception request
    const result = await client.query(
      `UPDATE exception_requests
       SET status = $1,
           manager_decision = $2,
           manager_id = $3,
           manager_decision_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, manager_decision, manager_id, id]
    );

    // If approved, update AWI case
    if (status === 'approved') {
      await client.query(
        `UPDATE awi_cases
         SET final_status = 'authorized_absence',
             is_exception = true,
             exception_approved_by = $1,
             resolved_at = CURRENT_TIMESTAMP,
             resolved_by = $1,
             deduction_days = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND date = $3`,
        [manager_id, exception.user_id, exception.date]
      );

      // Update attendance status
      await client.query(
        `UPDATE attendance_records
         SET status = 'authorized_absence', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND date = $2`,
        [exception.user_id, exception.date]
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
 * PUT /api/exceptions/:id/hr-decision
 * HR approves or rejects exception request (if manager approved and HR review needed)
 */
router.put('/:id/hr-decision', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      status, // 'approved' or 'rejected'
      hr_decision,
      hr_id,
    } = req.body;

    // Get exception request
    const reqResult = await client.query(
      'SELECT * FROM exception_requests WHERE id = $1',
      [id]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Exception request not found' });
    }

    const exception = reqResult.rows[0];

    // Update exception request
    const result = await client.query(
      `UPDATE exception_requests
       SET status = $1,
           hr_decision = $2,
           hr_id = $3,
           hr_decision_date = CURRENT_TIMESTAMP,
           approved_by = $3,
           approved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [status, hr_decision, hr_id, id]
    );

    // If approved, update AWI case
    if (status === 'approved') {
      await client.query(
        `UPDATE awi_cases
         SET final_status = 'authorized_absence',
             is_exception = true,
             exception_approved_by = $1,
             resolved_at = CURRENT_TIMESTAMP,
             resolved_by = $1,
             deduction_days = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND date = $3`,
        [hr_id, exception.user_id, exception.date]
      );

      // Update attendance status
      await client.query(
        `UPDATE attendance_records
         SET status = 'authorized_absence', updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND date = $2`,
        [exception.user_id, exception.date]
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating HR decision:', error);
    res.status(500).json({ error: 'Failed to update HR decision' });
  } finally {
    client.release();
  }
});

export default router;
