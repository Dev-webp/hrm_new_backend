import { pool } from './middleware/db.js';
import { applySandwichPolicy } from './utils/sandwichPolicy.js';

async function checkUser41November() {
  try {
    console.log('=== USER 41 NOVEMBER 2026 INVESTIGATION ===\n');

    // Get leave requests
    const leaveResult = await pool.query(
      `
      SELECT id, user_id, from_date::text, to_date::text, from_date, to_date,
             leave_type, status, leave_duration_type, requested_days
      FROM leave_requests
      WHERE user_id = 41
        AND status = 'approved'
        AND from_date <= '2026-11-30'
        AND to_date >= '2026-11-01'
      ORDER BY leave_requests.from_date
      `
    );

    console.log('Leave requests:', JSON.stringify(leaveResult.rows, null, 2));

    // Get attendance records
    const attResult = await pool.query(
      `
      SELECT id, user_id, date::text AS date_text, date, status, leave_status, leave_request_id
      FROM attendance_records
      WHERE user_id = 41
        AND date BETWEEN '2026-11-01' AND '2026-11-30'
      ORDER BY date
      `
    );

    console.log('\nAttendance records:', JSON.stringify(attResult.rows, null, 2));

    // Get holidays
    const holidayResult = await pool.query(
      `
      SELECT date::text AS date_text, date, name, type
      FROM company_holidays
      WHERE date BETWEEN '2026-11-01' AND '2026-11-30'
        AND type = 'holiday'
      ORDER BY date
      `
    );

    console.log('\nHolidays:', JSON.stringify(holidayResult.rows, null, 2));

    // Get user joining date
    const userResult = await pool.query(
      `SELECT joining_date FROM users WHERE id = 41`
    );
    const joiningDate = userResult.rows[0]?.joining_date || null;
    console.log('\nUser joining date:', joiningDate);

    // Build attendance map
    const attMap = new Map();
    for (const row of attResult.rows) {
      attMap.set(row.date_text, row);
    }

    // Build holiday set
    const holidaySet = new Set(holidayResult.rows.map(h => h.date_text));

    // Build all dates for November
    const allDates = [];
    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-11-${String(day).padStart(2, '0')}`;
      allDates.push(dateStr);
    }

    // Build holiday map
    const holidayMap = new Map();
    holidayResult.rows.forEach(h => {
      holidayMap.set(h.date_text, h);
    });

    // Apply sandwich policy
    const { sandwichResults } = applySandwichPolicy({
      attMap,
      holidayMap,
      halfDayLeaveMap: new Map(),
      allDates,
      leaves: leaveResult.rows,
    }, {
      todayStr: '2026-09-28',
      joiningDate,
    });

    console.log('\n=== SANDWICH RESULTS ===');
    console.log(JSON.stringify(sandwichResults, null, 2));

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUser41November();
