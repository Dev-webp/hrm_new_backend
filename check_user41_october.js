import { pool } from './middleware/db.js';

async function checkUser41October() {
  try {
    await pool.query('SET default_transaction_read_only = on');
    console.log('Read-only mode enabled');
    
    console.log('\n=== User 41 October 2026 Leave Requests ===');
    const leaves = await pool.query(
      `SELECT id, from_date, to_date, leave_type, status, requested_days 
       FROM leave_requests 
       WHERE user_id = 41 
       AND (from_date <= '2026-10-31' AND to_date >= '2026-10-01')
       ORDER BY from_date`
    );
    console.log(JSON.stringify(leaves.rows, null, 2));
    
    console.log('\n=== User 41 October 2026 Attendance Records ===');
    const att = await pool.query(
      `SELECT date, status, check_in_time, check_out_time, leave_type, leave_status 
       FROM attendance_records 
       WHERE user_id = 41 
       AND date BETWEEN '2026-10-01' AND '2026-10-31'
       ORDER BY date`
    );
    console.log(JSON.stringify(att.rows, null, 2));
    
    console.log('\n=== User 41 Joining Date ===');
    const user = await pool.query(
      `SELECT id, full_name, joining_date FROM users WHERE id = 41`
    );
    console.log(JSON.stringify(user.rows[0], null, 2));
    
    console.log('\n=== October 2026 Holidays ===');
    const holidays = await pool.query(
      `SELECT date, name FROM company_holidays 
       WHERE date BETWEEN '2026-10-01' AND '2026-10-31'
       ORDER BY date`
    );
    console.log(JSON.stringify(holidays.rows, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUser41October();
