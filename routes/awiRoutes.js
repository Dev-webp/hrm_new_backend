/**
 * AWI (Absence Without Intimation) API Routes
 * Handles absence verification, classification, and management
 */

import express from 'express';
import { pool } from '../middleware/db.js';
import * as awiPolicyService from '../services/awiPolicyService.js';

const router = express.Router();

/**
 * GET /api/awi/policy
 * Get AWI policy configuration
 */
router.get('/policy', async (req, res) => {
  try {
    const { branch } = req.query;
    const policy = await awiPolicyService.getPolicy(branch);
    res.json(policy);
  } catch (error) {
    console.error('Error fetching AWI policy:', error);
    res.status(500).json({ error: 'Failed to fetch AWI policy' });
  }
});

/**
 * GET /api/awi/policies
 * Get all AWI policy configurations (admin only)
 */
router.get('/policies', async (req, res) => {
  try {
    const policies = await awiPolicyService.getAllPolicies();
    res.json(policies);
  } catch (error) {
    console.error('Error fetching AWI policies:', error);
    res.status(500).json({ error: 'Failed to fetch AWI policies' });
  }
});

/**
 * PUT /api/awi/policy
 * Update AWI policy configuration (admin only)
 */
router.put('/policy', async (req, res) => {
  try {
    const updatedBy = req.user?.email || 'admin';
    const policy = await awiPolicyService.updatePolicy(req.body, updatedBy);
    res.json(policy);
  } catch (error) {
    console.error('Error updating AWI policy:', error);
    res.status(500).json({ error: 'Failed to update AWI policy' });
  }
});

/**
 * GET /api/awi/cases
 * Get AWI cases with optional filters
 */
router.get('/cases', async (req, res) => {
  try {
    const {
      user_id,
      status,
      start_date,
      end_date,
      date,
      branch,
      department,
      escalated,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = `
      SELECT ac.*, 
             u.email, u.full_name, u.branch, u.department
      FROM awi_cases ac
      JOIN users u ON ac.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND ac.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND ac.final_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // Support single date parameter (start_date = end_date = date)
    const queryStartDate = date || start_date;
    const queryEndDate = date || end_date;

    if (queryStartDate) {
      query += ` AND ac.date >= $${paramIndex}`;
      params.push(queryStartDate);
      paramIndex++;
    }

    if (queryEndDate) {
      query += ` AND ac.date <= $${paramIndex}`;
      params.push(queryEndDate);
      paramIndex++;
    }

    if (branch) {
      query += ` AND u.branch = $${paramIndex}`;
      params.push(branch);
      paramIndex++;
    }

    if (department) {
      query += ` AND u.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    if (escalated === 'true') {
      query += ` AND (ac.escalated_to_hr = true OR ac.escalated_to_management = true)`;
    }

    query += ` ORDER BY ac.date DESC, ac.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching AWI cases:', error);
    res.status(500).json({ error: 'Failed to fetch AWI cases' });
  }
});

/**
 * GET /api/awi/cases/:id
 * Get single AWI case by ID
 */
router.get('/cases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT ac.*, 
              u.email, u.full_name, u.branch, u.department
       FROM awi_cases ac
       JOIN users u ON ac.user_id = u.id
       WHERE ac.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'AWI case not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching AWI case:', error);
    res.status(500).json({ error: 'Failed to fetch AWI case' });
  }
});

/**
 * POST /api/awi/cases
 * Create a new AWI case
 */
router.post('/cases', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      user_id,
      date,
      initial_status = 'absence_unverified',
      reason,
      employee_explanation,
      is_exception = false,
      exception_reason,
    } = req.body;

    // Check if case already exists
    const existing = await client.query(
      'SELECT id FROM awi_cases WHERE user_id = $1 AND date = $2',
      [user_id, date]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'AWI case already exists for this user and date' });
    }

    // Insert new AWI case
    const result = await client.query(
      `INSERT INTO awi_cases 
       (user_id, date, initial_status, final_status, reason, employee_explanation, is_exception, exception_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user_id, date, initial_status, initial_status, reason, employee_explanation, is_exception, exception_reason]
    );

    // Update attendance status
    await client.query(
      `UPDATE attendance_records
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND date = $3`,
      [initial_status, user_id, date]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating AWI case:', error);
    res.status(500).json({ error: 'Failed to create AWI case' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/awi/cases/:id/classify
 * Classify an AWI case as authorized or unauthorized absence
 */
router.put('/cases/:id/classify', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      final_status, // 'authorized_absence' or 'unauthorized_absence' or 'regularized'
      manager_response,
      hr_decision,
      resolved_by,
      verbally_informed, // Was employee verbally informed to admin?
      verbal_informed_by, // Who provided the verbal information
    } = req.body;

    // Get the AWI case with user info
    const caseResult = await client.query(
      `SELECT ac.*, u.branch 
       FROM awi_cases ac
       JOIN users u ON ac.user_id = u.id
       WHERE ac.id = $1`,
      [id]
    );

    if (caseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'AWI case not found' });
    }

    const awiCase = caseResult.rows[0];

    // Calculate deduction days based on final status and verbal informed status
    const deductionDays = await awiPolicyService.calculateDeductionDays(
      final_status,
      verbally_informed || false,
      awiCase.branch || 'all'
    );

    // Update AWI case with verbal informed tracking
    const updateResult = await client.query(
      `UPDATE awi_cases
       SET final_status = $1,
           manager_response = $2,
           hr_decision = $3,
           deduction_days = $4,
           resolved_at = CURRENT_TIMESTAMP,
           resolved_by = $5,
           updated_at = CURRENT_TIMESTAMP,
           verbally_informed = $6,
           verbal_informed_by = $7,
           verbal_informed_at = CASE WHEN $6 = true THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $8
       RETURNING *`,
      [final_status, manager_response, hr_decision, deductionDays, resolved_by, verbally_informed || false, verbal_informed_by || null, id]
    );

    // Update attendance status
    await client.query(
      `UPDATE attendance_records
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND date = $3`,
      [final_status, awiCase.user_id, awiCase.date]
    );

    // Update user AWI incident count if unauthorized
    if (final_status === 'unauthorized_absence') {
      await client.query(
        `UPDATE users
         SET awi_incident_count = awi_incident_count + 1,
             last_awi_date = $1,
             awi_warning_level = awi_warning_level + 1
         WHERE id = $2`,
        [awiCase.date, awiCase.user_id]
      );
    }

    await client.query('COMMIT');
    res.json(updateResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error classifying AWI case:', error);
    res.status(500).json({ error: 'Failed to classify AWI case' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/awi/cases/:id/explain
 * Employee provides explanation for absence
 */
router.put('/cases/:id/explain', async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_explanation } = req.body;

    const result = await pool.query(
      `UPDATE awi_cases
       SET employee_explanation = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [employee_explanation, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'AWI case not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating AWI explanation:', error);
    res.status(500).json({ error: 'Failed to update AWI explanation' });
  }
});

/**
 * POST /api/awi/cases/:id/escalate
 * Escalate an AWI case to HR or management
 */
router.post('/cases/:id/escalate', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { escalated_to, escalation_reason, escalated_by } = req.body;

    // Get the AWI case
    const caseResult = await client.query(
      'SELECT * FROM awi_cases WHERE id = $1',
      [id]
    );

    if (caseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'AWI case not found' });
    }

    const awiCase = caseResult.rows[0];

    // Update AWI case escalation flags
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (escalated_to === 'hr') {
      updateFields.push(`escalated_to_hr = true`);
      updateFields.push(`escalation_level = escalation_level + 1`);
    } else if (escalated_to === 'management') {
      updateFields.push(`escalated_to_management = true`);
      updateFields.push(`escalation_level = escalation_level + 1`);
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

    const updateQuery = `
      UPDATE awi_cases
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    updateValues.push(id);
    paramIndex++;

    const updateResult = await client.query(updateQuery, updateValues);

    // Create escalation record
    await client.query(
      `INSERT INTO awi_escalations
       (awi_case_id, user_id, escalation_level, escalated_to, escalated_by, escalation_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, awiCase.user_id, updateResult.rows[0].escalation_level, escalated_to, escalated_by, escalation_reason]
    );

    await client.query('COMMIT');
    res.json(updateResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error escalating AWI case:', error);
    res.status(500).json({ error: 'Failed to escalate AWI case' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/awi/summary
 * Get AWI summary for admin dashboard
 */
router.get('/summary', async (req, res) => {
  try {
    const { branch, department, start_date, end_date, date } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Support single date parameter (start_date = end_date = date)
    const queryStartDate = date || start_date;
    const queryEndDate = date || end_date;

    if (queryStartDate) {
      whereClause += ` AND ac.date >= $${paramIndex}`;
      params.push(queryStartDate);
      paramIndex++;
    }

    if (queryEndDate) {
      whereClause += ` AND ac.date <= $${paramIndex}`;
      params.push(queryEndDate);
      paramIndex++;
    }

    if (branch) {
      whereClause += ` AND u.branch = $${paramIndex}`;
      params.push(branch);
      paramIndex++;
    }

    if (department) {
      whereClause += ` AND u.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    const query = `
      SELECT
        COUNT(*) as total_cases,
        COUNT(CASE WHEN ac.final_status = 'absence_unverified' THEN 1 END) as pending_cases,
        COUNT(CASE WHEN ac.final_status = 'authorized_absence' THEN 1 END) as authorized_cases,
        COUNT(CASE WHEN ac.final_status = 'unauthorized_absence' THEN 1 END) as unauthorized_cases,
        COUNT(CASE WHEN ac.final_status = 'regularized' THEN 1 END) as regularized_cases,
        COUNT(CASE WHEN ac.escalated_to_hr = true OR ac.escalated_to_management = true THEN 1 END) as escalated_cases,
        SUM(ac.deduction_days) as total_deduction_days
      FROM awi_cases ac
      JOIN users u ON ac.user_id = u.id
      ${whereClause}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching AWI summary:', error);
    res.status(500).json({ error: 'Failed to fetch AWI summary' });
  }
});

/**
 * GET /api/awi/employee-monthly
 * Get AWI summary for a specific employee for a month
 */
router.get('/employee-monthly', async (req, res) => {
  try {
    const { user_id, month } = req.query;

    if (!user_id || !month) {
      return res.status(400).json({ error: 'user_id and month are required' });
    }

    const [year, monthNum] = month.split('-');
    const startDate = `${year}-${monthNum}-01`;
    // Get last day of the month (handles months with 28, 29, 30, or 31 days)
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${year}-${monthNum}-${lastDay}`;

    const query = `
      SELECT 
        u.full_name as employee_name,
        COUNT(*) as total_cases,
        COUNT(CASE WHEN ac.final_status = 'authorized_absence' THEN 1 END) as authorized_count,
        COUNT(CASE WHEN ac.final_status = 'unauthorized_absence' THEN 1 END) as unauthorized_count,
        COALESCE(SUM(ac.deduction_days), 0) as total_deduction_days
      FROM awi_cases ac
      JOIN users u ON ac.user_id = u.id
      WHERE ac.user_id = $1
        AND ac.date >= $2
        AND ac.date <= $3
        AND ac.final_status IN ('authorized_absence', 'unauthorized_absence')
      GROUP BY u.full_name
    `;

    const result = await pool.query(query, [user_id, startDate, endDate]);

    if (result.rows.length === 0) {
      return res.json({
        employee_name: null,
        total_cases: 0,
        authorized_count: 0,
        unauthorized_count: 0,
        total_deduction_days: 0
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching employee monthly AWI:', error);
    res.status(500).json({ error: 'Failed to fetch employee monthly AWI' });
  }
});

/**
 * POST /api/awi/cleanup-orphaned-unauth
 * Clean up attendance records that have unauthorized_absence status but no corresponding AWI case
 * These should be reverted to 'absent' status
 */
router.post('/cleanup-orphaned-unauth', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find attendance records with unauthorized_absence status that don't have corresponding AWI cases
    const result = await client.query(`
      UPDATE attendance_records ar
      SET status = 'absent', updated_at = CURRENT_TIMESTAMP
      WHERE ar.status = 'unauthorized_absence'
        AND NOT EXISTS (
          SELECT 1 FROM awi_cases ac
          WHERE ac.user_id = ar.user_id AND ac.date = ar.date
            AND ac.final_status = 'unauthorized_absence'
        )
      RETURNING user_id, date, status
    `);

    await client.query('COMMIT');

    res.json({
      message: 'Cleaned up orphaned unauthorized absence records',
      updated_count: result.rows.length,
      updated_records: result.rows
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cleaning up orphaned unauthorized records:', error);
    res.status(500).json({ error: 'Failed to clean up orphaned unauthorized records' });
  } finally {
    client.release();
  }
});

export default router;
