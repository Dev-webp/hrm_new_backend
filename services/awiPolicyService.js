/**
 * AWI (Absence Without Intimation) Policy Service
 * Handles policy configuration, validation, and enforcement
 */

import { pool } from '../middleware/db.js';

/**
 * Get AWI policy configuration for a branch
 * @param {string} branch - Branch name (defaults to 'all' if not found)
 */
async function getPolicy(branch = 'all') {
  try {
    // First try to get branch-specific policy
    let result = await pool.query(
      'SELECT * FROM awi_policy_config WHERE branch = $1',
      [branch]
    );

    // If no branch-specific policy, get default (all)
    if (result.rows.length === 0) {
      result = await pool.query(
        'SELECT * FROM awi_policy_config WHERE branch = $1',
        ['all']
      );
    }

    if (result.rows.length === 0) {
      // Return default values if no policy exists
      return {
        branch: 'all',
        verification_cutoff_hours: 24,
        auto_cutoff_hours: 72,
        warning_threshold: 3,
        authorized_deduction_days: 1.0,
        unauthorized_deduction_days: 2.0,
        escalation_to_hr: true,
        escalation_to_management: false,
      };
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching AWI policy:', error);
    throw error;
  }
}

/**
 * Update AWI policy configuration
 * @param {object} policyData - Policy configuration data
 * @param {string} updatedBy - Email of user making the update
 */
async function updatePolicy(policyData, updatedBy) {
  try {
    const {
      branch = 'all',
      verification_cutoff_hours,
      auto_cutoff_hours,
      warning_threshold,
      authorized_deduction_days,
      unauthorized_deduction_days,
      escalation_to_hr,
      escalation_to_management,
    } = policyData;

    const result = await pool.query(
      `UPDATE awi_policy_config
       SET verification_cutoff_hours = $1,
           auto_cutoff_hours = $2,
           warning_threshold = $3,
           authorized_deduction_days = $4,
           unauthorized_deduction_days = $5,
           escalation_to_hr = $6,
           escalation_to_management = $7,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $8
       WHERE branch = $9
       RETURNING *`,
      [
        verification_cutoff_hours,
        auto_cutoff_hours,
        warning_threshold,
        authorized_deduction_days,
        unauthorized_deduction_days,
        escalation_to_hr,
        escalation_to_management,
        updatedBy,
        branch,
      ]
    );

    if (result.rows.length === 0) {
      // Insert new policy if it doesn't exist
      const insertResult = await pool.query(
        `INSERT INTO awi_policy_config
         (branch, verification_cutoff_hours, auto_cutoff_hours, warning_threshold,
          authorized_deduction_days, unauthorized_deduction_days,
          escalation_to_hr, escalation_to_management, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          branch,
          verification_cutoff_hours,
          auto_cutoff_hours,
          warning_threshold,
          authorized_deduction_days,
          unauthorized_deduction_days,
          escalation_to_hr,
          escalation_to_management,
          updatedBy,
        ]
      );
      return insertResult.rows[0];
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error updating AWI policy:', error);
    throw error;
  }
}

/**
 * Check if an absence should be classified as unauthorized
 * based on the cutoff time
 * @param {Date} absenceDate - The date of absence
 * @param {string} branch - Branch name
 */
async function shouldAutoClassifyAsUnauthorized(absenceDate, branch = 'all') {
  try {
    const policy = await getPolicy(branch);
    const absenceDateTime = new Date(absenceDate);
    const now = new Date();
    const hoursSinceAbsence = (now - absenceDateTime) / (1000 * 60 * 60);

    return hoursSinceAbsence > policy.auto_cutoff_hours;
  } catch (error) {
    console.error('Error checking auto-classification:', error);
    return false;
  }
}

/**
 * Check if an absence is still within verification cutoff
 * @param {Date} absenceDate - The date of absence
 * @param {string} branch - Branch name
 */
async function isWithinVerificationCutoff(absenceDate, branch = 'all') {
  try {
    const policy = await getPolicy(branch);
    const absenceDateTime = new Date(absenceDate);
    const now = new Date();
    const hoursSinceAbsence = (now - absenceDateTime) / (1000 * 60 * 60);

    return hoursSinceAbsence <= policy.verification_cutoff_hours;
  } catch (error) {
    console.error('Error checking verification cutoff:', error);
    return false;
  }
}

/**
 * Check if employee should be escalated for repeated AWI
 * @param {number} userId - User ID
 * @param {string} branch - Branch name
 */
async function shouldEscalateEmployee(userId, branch = 'all') {
  try {
    const policy = await getPolicy(branch);
    
    // Count AWI incidents in the last 90 days
    const result = await pool.query(
      `SELECT COUNT(*) as incident_count
       FROM awi_cases
       WHERE user_id = $1
         AND final_status = 'unauthorized_absence'
         AND date >= CURRENT_DATE - INTERVAL '90 days'`,
      [userId]
    );

    const incidentCount = parseInt(result.rows[0].incident_count);
    return incidentCount >= policy.warning_threshold;
  } catch (error) {
    console.error('Error checking escalation eligibility:', error);
    return false;
  }
}

/**
 * Calculate deduction days based on absence type and verbal informed status
 * @param {string} absenceType - 'authorized_absence' or 'unauthorized_absence'
 * @param {boolean} verballyInformed - Whether employee was verbally informed to admin
 * @param {string} branch - Branch name
 */
async function calculateDeductionDays(absenceType, verballyInformed = false, branch = 'all') {
  try {
    const policy = await getPolicy(branch);
    
    // If verbally informed, apply 1 day deduction
    if (verballyInformed) {
      return 1.0; // 1 day deduction
    }
    
    // If not verbally informed and unauthorized, apply 1+1 deduction (2 days)
    if (absenceType === 'unauthorized_absence') {
      return policy.unauthorized_deduction_days; // 2.0 days (1+1)
    } else if (absenceType === 'authorized_absence') {
      return policy.authorized_deduction_days; // 1.0 day
    }
    
    return 0;
  } catch (error) {
    console.error('Error calculating deduction days:', error);
    return 0;
  }
}

/**
 * Get all policy configurations (for admin)
 */
async function getAllPolicies() {
  try {
    const result = await pool.query(
      'SELECT * FROM awi_policy_config ORDER BY branch'
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching all AWI policies:', error);
    throw error;
  }
}

export {
  getPolicy,
  updatePolicy,
  shouldAutoClassifyAsUnauthorized,
  isWithinVerificationCutoff,
  shouldEscalateEmployee,
  calculateDeductionDays,
  getAllPolicies,
};
