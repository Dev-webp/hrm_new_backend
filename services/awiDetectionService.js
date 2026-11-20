/**
 * AWI Detection Service
 * Automatically detects employees and subadmins absent without leave request
 * and creates AWI cases with notifications at 12 PM
 */

import { pool } from '../middleware/db.js';

/**
 * Check for employees and subadmins absent without leave request for a specific date
 * @param {string} date - Date to check (format: YYYY-MM-DD)
 */
async function detectAbsentEmployees(date = null) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const checkDate = date || new Date().toISOString().split('T')[0];
    
    console.log(`🔍 Checking for absent employees on ${checkDate}...`);
    
    // Find employees and subadmins who are absent (no attendance record and no approved leave)
    const result = await client.query(`
      SELECT u.id, u.email, u.full_name, u.branch, u.department
      FROM users u
      WHERE u.status = 'active'
        AND u.role IN ('EMPLOYEE', 'SUBADMIN')
        AND NOT EXISTS (
          SELECT 1 FROM attendance_records ar
          WHERE ar.user_id = u.id AND ar.date = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests lr
          WHERE lr.user_id = u.id
            AND lr.status = 'approved'
            AND lr.from_date <= $1
            AND lr.to_date >= $1
        )
    `, [checkDate]);
    
    const absentEmployees = result.rows;
    console.log(`Found ${absentEmployees.length} absent employees/subadmins`);
    
    // Create AWI cases for each absent employee
    for (const employee of absentEmployees) {
      // Check if AWI case already exists for this employee and date
      const existingCase = await client.query(
        'SELECT id FROM awi_cases WHERE user_id = $1 AND date = $2',
        [employee.id, checkDate]
      );
      
      if (existingCase.rows.length === 0) {
        // Create new AWI case
        await client.query(`
          INSERT INTO awi_cases (
            user_id, date, initial_status, final_status, reason,
            notified_employee, notified_manager, created_at
          ) VALUES ($1, $2, 'absence_unverified', 'absence_unverified', 
            'Absent without leave request', true, true, CURRENT_TIMESTAMP)
        `, [employee.id, checkDate]);
        
        console.log(`✅ Created AWI case for ${employee.full_name} (${employee.email})`);
      }
    }
    
    await client.query('COMMIT');
    
    return {
      date: checkDate,
      total_absent: absentEmployees.length,
      cases_created: absentEmployees.length,
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error detecting absent employees:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get pending AWI cases that need admin attention
 * @param {string} date - Date to check (optional)
 */
async function getPendingAWICases(date = null) {
  try {
    const checkDate = date || new Date().toISOString().split('T')[0];
    
    const result = await pool.query(`
      SELECT ac.*, u.email, u.full_name, u.branch, u.department
      FROM awi_cases ac
      JOIN users u ON ac.user_id = u.id
      WHERE ac.date = $1
        AND ac.final_status = 'absence_unverified'
      ORDER BY ac.created_at
    `, [checkDate]);
    
    return result.rows;
  } catch (error) {
    console.error('Error fetching pending AWI cases:', error);
    throw error;
  }
}

/**
 * Send notification to admin about pending AWI cases
 * @param {Array} cases - Array of AWI cases
 */
async function sendAdminNotification(cases) {
  if (cases.length === 0) {
    console.log('No pending AWI cases to notify');
    return;
  }
  
  console.log(`📢 Sending notification to admin about ${cases.length} pending AWI cases`);
  
  // Get admin users
  const adminResult = await pool.query(
    "SELECT id, email, full_name FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN')"
  );
  
  const admins = adminResult.rows;
  
  // Create notification for each admin
  for (const admin of admins) {
    await pool.query(`
      INSERT INTO notifications (
        user_id, action_type, description, created_at, is_read, target_role
      ) VALUES ($1, 'AWI_ALERT', $2, CURRENT_TIMESTAMP, false, 'SUPER_ADMIN')
    `, [
      admin.id,
      `${cases.length} AWI cases pending review. Employees/subadmins absent without leave request on ${new Date().toLocaleDateString()}. Please review and classify.`
    ]);
  }
  
  console.log(`✅ Notifications sent to ${admins.length} admin(s)`);
}

/**
 * Run the daily AWI detection and notification
 * This should be scheduled to run at 12 PM daily
 */
async function runDailyAWIDetection() {
  try {
    console.log('🚀 Starting daily AWI detection...');
    
    const today = new Date().toISOString().split('T')[0];
    
    // Detect absent employees and create AWI cases
    const detectionResult = await detectAbsentEmployees(today);
    
    // Get pending AWI cases
    const pendingCases = await getPendingAWICases(today);
    
    // Send notifications to admin
    if (pendingCases.length > 0) {
      await sendAdminNotification(pendingCases);
    }
    
    console.log('✅ Daily AWI detection completed');
    
    return {
      ...detectionResult,
      pending_cases: pendingCases.length,
    };
    
  } catch (error) {
    console.error('Error in daily AWI detection:', error);
    throw error;
  }
}

export {
  detectAbsentEmployees,
  getPendingAWICases,
  sendAdminNotification,
  runDailyAWIDetection,
};
