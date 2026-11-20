/**
 * AWI Salary Deduction Service
 * Calculates salary deductions based on AWI classifications
 */

import { pool } from '../middleware/db.js';

/**
 * Calculate total deduction days for an employee in a given month
 * @param {number} userId - User ID
 * @param {string} month - Month in format 'YYYY-MM'
 */
async function calculateMonthlyDeductions(userId, month) {
  try {
    const result = await pool.query(
      `SELECT 
         SUM(deduction_days) as total_deduction_days,
         COUNT(*) as incident_count,
         COUNT(CASE WHEN final_status = 'authorized_absence' THEN 1 END) as authorized_count,
         COUNT(CASE WHEN final_status = 'unauthorized_absence' THEN 1 END) as unauthorized_count
       FROM awi_cases
       WHERE user_id = $1
         AND TO_CHAR(date, 'YYYY-MM') = $2
         AND final_status IN ('authorized_absence', 'unauthorized_absence')`,
      [userId, month]
    );

    return result.rows[0] || {
      total_deduction_days: 0,
      incident_count: 0,
      authorized_count: 0,
      unauthorized_count: 0,
    };
  } catch (error) {
    console.error('Error calculating monthly deductions:', error);
    throw error;
  }
}

/**
 * Get AWI deduction summary for payroll calculation
 * @param {string} month - Month in format 'YYYY-MM'
 * @param {string} branch - Optional branch filter
 */
async function getMonthlyDeductionSummary(month, branch = null) {
  try {
    let query = `
      SELECT 
        u.id as user_id,
        u.email,
        u.full_name,
        u.branch,
        u.department,
        u.daily_salary,
        COALESCE(SUM(ac.deduction_days), 0) as total_deduction_days,
        COUNT(CASE WHEN ac.final_status = 'authorized_absence' THEN 1 END) as authorized_count,
        COUNT(CASE WHEN ac.final_status = 'unauthorized_absence' THEN 1 END) as unauthorized_count,
        COALESCE(SUM(ac.deduction_days) * u.daily_salary, 0) as total_deduction_amount
      FROM users u
      LEFT JOIN awi_cases ac ON u.id = ac.user_id 
        AND TO_CHAR(ac.date, 'YYYY-MM') = $1
        AND ac.final_status IN ('authorized_absence', 'unauthorized_absence')
      WHERE 1=1
    `;
    const params = [month];
    let paramIndex = 2;

    if (branch) {
      query += ` AND u.branch = $${paramIndex}`;
      params.push(branch);
      paramIndex++;
    }

    query += `
      GROUP BY u.id, u.email, u.full_name, u.branch, u.department, u.daily_salary
      ORDER BY u.branch, u.department, u.full_name
    `;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error getting monthly deduction summary:', error);
    throw error;
  }
}

/**
 * Apply AWI deductions to payroll
 * This function should be called during payroll calculation
 * @param {number} userId - User ID
 * @param {string} month - Month in format 'YYYY-MM'
 * @param {number} dailySalary - Daily salary rate
 */
async function calculateDeductionAmount(userId, month, dailySalary) {
  try {
    const deductions = await calculateMonthlyDeductions(userId, month);
    const totalDeductionDays = Number(deductions.total_deduction_days) || 0;
    const deductionAmount = totalDeductionDays * dailySalary;

    return {
      total_deduction_days: totalDeductionDays,
      authorized_count: deductions.authorized_count,
      unauthorized_count: deductions.unauthorized_count,
      deduction_amount: deductionAmount,
      breakdown: {
        authorized_days: deductions.authorized_count,
        authorized_amount: deductions.authorized_count * dailySalary,
        unauthorized_days: deductions.unauthorized_count,
        unauthorized_amount: deductions.unauthorized_count * dailySalary * 2, // 2 days deduction for unauthorized
      },
    };
  } catch (error) {
    console.error('Error calculating deduction amount:', error);
    throw error;
  }
}

/**
 * Generate AWI deduction report for a specific employee
 * @param {number} userId - User ID
 * @param {string} month - Month in format 'YYYY-MM'
 */
async function generateEmployeeDeductionReport(userId, month) {
  try {
    const result = await pool.query(
      `SELECT 
         ac.date,
         ac.initial_status,
         ac.final_status,
         ac.employee_explanation,
         ac.manager_response,
         ac.hr_decision,
         ac.deduction_days,
         ac.resolved_at,
         ac.resolved_by,
         ac.is_exception,
         ac.exception_reason
       FROM awi_cases ac
       WHERE ac.user_id = $1
         AND TO_CHAR(ac.date, 'YYYY-MM') = $2
         AND ac.final_status IN ('authorized_absence', 'unauthorized_absence')
       ORDER BY ac.date`,
      [userId, month]
    );

    return result.rows;
  } catch (error) {
    console.error('Error generating employee deduction report:', error);
    throw error;
  }
}

/**
 * Get AWI statistics for dashboard
 * @param {string} month - Month in format 'YYYY-MM'
 * @param {string} branch - Optional branch filter
 */
async function getAWIStatistics(month, branch = null) {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_cases,
        COUNT(CASE WHEN final_status = 'absence_unverified' THEN 1 END) as pending_cases,
        COUNT(CASE WHEN final_status = 'authorized_absence' THEN 1 END) as authorized_cases,
        COUNT(CASE WHEN final_status = 'unauthorized_absence' THEN 1 END) as unauthorized_cases,
        COUNT(CASE WHEN final_status = 'regularized' THEN 1 END) as regularized_cases,
        COUNT(CASE WHEN is_exception = true THEN 1 END) as exception_cases,
        SUM(deduction_days) as total_deduction_days,
        AVG(deduction_days) as avg_deduction_days
      FROM awi_cases ac
      JOIN users u ON ac.user_id = u.id
      WHERE TO_CHAR(ac.date, 'YYYY-MM') = $1
    `;
    const params = [month];
    let paramIndex = 2;

    if (branch) {
      query += ` AND u.branch = $${paramIndex}`;
      params.push(branch);
      paramIndex++;
    }

    const result = await pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting AWI statistics:', error);
    throw error;
  }
}

export {
  calculateMonthlyDeductions,
  getMonthlyDeductionSummary,
  calculateDeductionAmount,
  generateEmployeeDeductionReport,
  getAWIStatistics,
};
