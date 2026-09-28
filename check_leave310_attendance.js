import { pool } from './middleware/db.js';

async function checkLeave310Attendance() {
  try {
    console.log('=== ATTENDANCE RECORDS FOR LEAVE 310 ===\n');

    const result = await pool.query(
      `
      SELECT id, date::text AS date_text, date, status, created_at
      FROM attendance_records
      WHERE leave_request_id = 310
      ORDER BY date
      `
    );

    console.log('Rows:', JSON.stringify(result.rows, null, 2));

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLeave310Attendance();
