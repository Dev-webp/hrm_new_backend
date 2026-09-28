import { pool } from './middleware/db.js';
import { applySandwichPolicy } from './utils/sandwichPolicy.js';

async function checkAttendanceEndpoint() {
  try {
    console.log('=== /attendance/self/history VERIFICATION ===\n');

    // User 32, October 2026
    console.log('--- User 32, October 2026 ---');
    const user32Oct = await getAttendanceHistory(32, '2026-10-01', '2026-10-31');
    printSundayRows(user32Oct);
    printAbsentCounter(user32Oct);
    printSandwichResults(user32Oct);

    // User 32, November 2026
    console.log('\n--- User 32, November 2026 ---');
    const user32Nov = await getAttendanceHistory(32, '2026-11-01', '2026-11-30');
    printSundayRows(user32Nov);
    printAbsentCounter(user32Nov);
    printSandwichResults(user32Nov);

    // User 41, October 2026
    console.log('\n--- User 41, October 2026 ---');
    const user41Oct = await getAttendanceHistory(41, '2026-10-01', '2026-10-31');
    printSundayRows(user41Oct);
    printAbsentCounter(user41Oct);
    printSandwichResults(user41Oct);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function getAttendanceHistory(userId, start, end) {
  const result = await pool.query(
    `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
            ar.check_in_time, ar.check_out_time,
            ar.status, ar.late_minutes, ar.production_hours, ar.total_break_minutes,
            ar.half_day_slot, ar.leave_type, ar.leave_status,
            ar.post_login_idle_minutes, ar.misuse_of_time
     FROM attendance_records ar
     WHERE ar.user_id=$1 AND ar.date BETWEEN $2 AND $3
     ORDER BY ar.date ASC`,
    [userId, start, end]
  );

  const holidayResult = await pool.query(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1 AND $2 AND type = 'holiday'`,
    [start, end]
  );
  const holidaySet = new Set(holidayResult.rows.map(r => r.date));

  const userResult = await pool.query(
    `SELECT joining_date FROM users WHERE id = $1`,
    [userId]
  );
  const joiningDate = userResult.rows[0]?.joining_date || null;

  const leaveResult = await pool.query(
    `SELECT id, from_date, to_date, leave_type, status, leave_duration_type
     FROM leave_requests
     WHERE user_id = $1
       AND status = 'approved'
       AND from_date <= $2
       AND to_date >= $3
     ORDER BY from_date`,
    [userId, end, start]
  );

  const attMap = new Map();
  for (const row of result.rows) {
    attMap.set(row.date, row);
  }

  const allDates = [];
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    allDates.push(dateStr);
  }

  const holidayMap = new Map();
  holidaySet.forEach((date) => {
    holidayMap.set(date, { name: 'Holiday' });
  });

  const { sandwichResults } = applySandwichPolicy({
    attMap,
    holidayMap,
    halfDayLeaveMap: new Map(),
    allDates,
    leaves: leaveResult.rows,
  }, {
    todayStr: new Date().toISOString().slice(0, 10),
    joiningDate,
  });

  const sandwichMap = new Map();
  for (const sr of sandwichResults) {
    if (!sandwichMap.has(sr.date)) {
      sandwichMap.set(sr.date, []);
    }
    sandwichMap.get(sr.date).push(sr);
  }

  const rowsWithSandwich = result.rows.map((row) => {
    if (sandwichMap.has(row.date)) {
      row.sandwich = sandwichMap.get(row.date);
    }
    return row;
  });

  const dateSet = new Set(result.rows.map(r => r.date));
  for (const date of allDates) {
    if (!dateSet.has(date) && sandwichMap.has(date)) {
      const sandwichRow = {
        date,
        status: 'sunday',
        check_in_time: null,
        check_out_time: null,
        late_minutes: 0,
        production_hours: 0,
        total_break_minutes: 0,
        half_day_slot: null,
        leave_type: null,
        leave_status: null,
        sandwich: sandwichMap.get(date),
      };
      rowsWithSandwich.push(sandwichRow);
    }
  }

  rowsWithSandwich.sort((a, b) => a.date.localeCompare(b.date));

  return { rows: rowsWithSandwich, sandwichResults };
}

function printSundayRows(data) {
  console.log('Sunday rows with sandwich metadata:');
  const sundays = data.rows.filter(r => {
    const d = new Date(r.date + "T00:00:00");
    return d.getDay() === 0;
  });
  for (const row of sundays) {
    console.log(`  ${row.date}: status=${row.status}, sandwich=${JSON.stringify(row.sandwich || [])}`);
  }
}

function printAbsentCounter(data) {
  const absentCount = data.rows.filter(r => r.status === 'absent' || (r.sandwich && r.sandwich.some(s => s.applied))).length;
  console.log(`Absent counter: ${absentCount}`);
}

function printSandwichResults(data) {
  const applied = data.sandwichResults.filter(s => s.applied);
  console.log(`Sandwich dates (applied): ${JSON.stringify(applied.map(s => ({ date: s.date, reason: s.reason })))}`);
}

checkAttendanceEndpoint();
