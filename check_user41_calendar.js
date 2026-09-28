import { pool } from './middleware/db.js';
import { applySandwichPolicy } from './utils/sandwichPolicy.js';

async function checkUser41Calendar() {
  try {
    console.log('=== USER 41 OCTOBER 2026 CALENDAR DATA ===\n');

    // Get attendance records
    const attResult = await pool.query(
      `
      SELECT 
        id,
        user_id,
        date::text AS date_text,
        date,
        status,
        leave_status,
        leave_request_id,
        check_in_time,
        check_out_time
      FROM attendance_records
      WHERE user_id = 41
        AND date BETWEEN '2026-10-01' AND '2026-10-31'
      ORDER BY date
      `
    );

    console.log('Attendance records:', JSON.stringify(attResult.rows, null, 2));

    // Get leave requests
    const leaveResult = await pool.query(
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
        leave_duration_type
      FROM leave_requests
      WHERE user_id = 41
        AND status = 'approved'
        AND (
          from_date <= '2026-10-31'
          AND to_date >= '2026-10-01'
        )
      ORDER BY from_date
      `
    );

    console.log('\nLeave requests:', JSON.stringify(leaveResult.rows, null, 2));

    // Get holidays
    const holidayResult = await pool.query(
      `
      SELECT 
        date::text AS date_text,
        date,
        name,
        type
      FROM company_holidays
      WHERE date BETWEEN '2026-10-01' AND '2026-10-31'
        AND type = 'holiday'
      ORDER BY date
      `
    );

    console.log('\nHolidays:', JSON.stringify(holidayResult.rows, null, 2));

    // Get user joining date
    const userResult = await pool.query(
      `
      SELECT 
        id,
        joining_date::text AS joining_date_text,
        joining_date
      FROM users
      WHERE id = 41
      `
    );

    const user = userResult.rows[0];
    console.log('\nUser joining date:', user.joining_date_text);

    // Build attendance map
    const attMap = new Map();
    for (const row of attResult.rows) {
      attMap.set(row.date_text, row);
    }

    // Build holiday set
    const holidaySet = new Set(holidayResult.rows.map(h => h.date_text));

    // Build all dates for October
    const allDates = [];
    for (let day = 1; day <= 31; day++) {
      const dateStr = `2026-10-${String(day).padStart(2, '0')}`;
      allDates.push(dateStr);
    }

    // Apply sandwich policy
    const sandwichData = {
      attMap: attMap,
      holidayMap: new Map(holidayResult.rows.map(h => [h.date_text, h])),
      halfDayLeaveMap: new Map(),
      allDates: allDates,
      leaves: leaveResult.rows,
    };

    const { sandwichResults } = applySandwichPolicy(sandwichData, {
      todayStr: '2026-09-28',
      joiningDate: user.joining_date_text,
    });

    console.log('\n=== SANDWICH RESULTS ===');
    console.log(JSON.stringify(sandwichResults, null, 2));

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUser41Calendar();
