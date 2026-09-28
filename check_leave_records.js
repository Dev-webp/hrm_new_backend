import { pool } from './middleware/db.js';

async function checkLeaveRecords() {
  try {
    await pool.query('SET default_transaction_read_only = on');
    
    // Check October 2026 leave records for user 32
    console.log('=== October 2026 leave records for user 32 ===');
    const octLeaves = await pool.query(
      `SELECT from_date, to_date, leave_type, status, requested_days 
       FROM leave_requests 
       WHERE user_id = $1 
       AND (from_date <= '2026-10-31' AND to_date >= '2026-10-01')
       ORDER BY from_date`,
      [32]
    );
    console.log(JSON.stringify(octLeaves.rows, null, 2));
    
    // Check October 2026 attendance records for user 32
    console.log('\n=== October 2026 attendance records for user 32 ===');
    const octAtt = await pool.query(
      `SELECT date, status, check_in_time, check_out_time 
       FROM attendance_records 
       WHERE user_id = $1 
       AND date BETWEEN '2026-10-01' AND '2026-10-31'
       ORDER BY date`,
      [32]
    );
    console.log(JSON.stringify(octAtt.rows, null, 2));
    
    // Check November 2026 leave records for user 32
    console.log('\n=== November 2026 leave records for user 32 ===');
    const novLeaves = await pool.query(
      `SELECT from_date, to_date, leave_type, status, requested_days 
       FROM leave_requests 
       WHERE user_id = $1 
       AND (from_date <= '2026-11-30' AND to_date >= '2026-11-01')
       ORDER BY from_date`,
      [32]
    );
    console.log(JSON.stringify(novLeaves.rows, null, 2));
    
    // Check November 2026 attendance records for user 32
    console.log('\n=== November 2026 attendance records for user 32 ===');
    const novAtt = await pool.query(
      `SELECT date, status, check_in_time, check_out_time 
       FROM attendance_records 
       WHERE user_id = $1 
       AND date BETWEEN '2026-11-01' AND '2026-11-30'
       ORDER BY date`,
      [32]
    );
    console.log(JSON.stringify(novAtt.rows, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLeaveRecords();
