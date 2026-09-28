import { pool } from './middleware/db.js';

async function checkLeaveDayCounts() {
  try {
    console.log('=== LEAVE DAY COUNTS ===\n');

    // Leave 307
    console.log('--- Leave 307 ---');
    const result307 = await pool.query(
      `
      SELECT id, user_id, from_date::text, to_date::text, requested_days, paid_days, unpaid_days, leave_type, leave_duration_type
      FROM leave_requests
      WHERE id = 307
      `
    );
    console.log(JSON.stringify(result307.rows[0], null, 2));

    // Leave 310
    console.log('\n--- Leave 310 ---');
    const result310 = await pool.query(
      `
      SELECT id, user_id, from_date::text, to_date::text, requested_days, paid_days, unpaid_days, leave_type, leave_duration_type
      FROM leave_requests
      WHERE id = 310
      `
    );
    console.log(JSON.stringify(result310.rows[0], null, 2));

    // Find a Fri-Mon leave
    console.log('\n--- Finding Fri-Mon leave ---');
    const resultFriMon = await pool.query(
      `
      SELECT id, user_id, from_date::text, to_date::text, requested_days, paid_days, unpaid_days, leave_type, leave_duration_type
      FROM leave_requests
      WHERE status = 'approved'
        AND EXTRACT(DOW FROM from_date) = 5  -- Friday
        AND EXTRACT(DOW FROM to_date) = 1    -- Monday
      LIMIT 1
      `
    );
    if (resultFriMon.rows.length > 0) {
      console.log(JSON.stringify(resultFriMon.rows[0], null, 2));
    } else {
      console.log('No Fri-Mon leave found');
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkLeaveDayCounts();
