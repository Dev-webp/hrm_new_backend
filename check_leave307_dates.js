import { pool } from './middleware/db.js';

async function checkLeave307Dates() {
  try {
    console.log('=== ACTUAL STORED DATES FOR LEAVE 307 ===\n');

    const result = await pool.query(
      `
      SELECT 
        id,
        user_id,
        from_date::text AS from_date_text,
        to_date::text AS to_date_text,
        from_date,
        to_date,
        leave_type,
        status,
        requested_days
      FROM leave_requests
      WHERE id = 307
      `
    );

    console.log('Raw result:', JSON.stringify(result.rows[0], null, 2));

    const row = result.rows[0];
    console.log('\n=== INTERPRETATION ===');
    console.log('from_date::text:', row.from_date_text);
    console.log('to_date::text:', row.to_date_text);
    console.log('from_date (as JS Date):', row.from_date);
    console.log('to_date (as JS Date):', row.to_date);

    // Check attendance records
    console.log('\n=== ATTENDANCE RECORDS FOR LEAVE 307 ===');
    const attResult = await pool.query(
      `
      SELECT 
        id,
        user_id,
        date::text AS date_text,
        date,
        status,
        leave_request_id
      FROM attendance_records
      WHERE leave_request_id = 307
      ORDER BY date
      `
    );

    console.log('Attendance rows:', JSON.stringify(attResult.rows, null, 2));

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLeave307Dates();
