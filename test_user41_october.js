import { pool } from './middleware/db.js';

async function testUser41October() {
  try {
    console.log('=== USER 41 OCTOBER 2026 ENDPOINT TEST ===\n');

    const result = await pool.query(
      `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
              ar.check_in_time, ar.check_out_time,
              ar.status, ar.late_minutes, ar.production_hours, ar.total_break_minutes,
              ar.half_day_slot, ar.leave_type, ar.leave_status,
              ar.post_login_idle_minutes, ar.misuse_of_time
       FROM attendance_records ar
       WHERE ar.user_id=41 AND ar.date BETWEEN '2026-10-01' AND '2026-10-31'
       ORDER BY ar.date ASC`
    );

    const holidayResult = await pool.query(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
       FROM company_holidays
       WHERE date BETWEEN '2026-10-01' AND '2026-10-31' AND type = 'holiday'`
    );
    const holidaySet = new Set(holidayResult.rows.map(r => r.date));

    const userResult = await pool.query(
      `SELECT joining_date FROM users WHERE id = 41`
    );
    const joiningDate = userResult.rows[0]?.joining_date || null;

    const leaveResult = await pool.query(
      `SELECT id, from_date, to_date, leave_type, status, leave_duration_type
       FROM leave_requests
       WHERE user_id = 41
         AND status = 'approved'
         AND from_date <= '2026-10-31'
         AND to_date >= '2026-10-01'
       ORDER BY from_date`
    );

    const attMap = new Map();
    for (const row of result.rows) {
      attMap.set(row.date, row);
    }

    const allDates = [];
    const startDate = new Date('2026-10-01T00:00:00');
    const endDate = new Date('2026-10-31T00:00:00');
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      allDates.push(dateStr);
    }

    const holidayMap = new Map();
    holidaySet.forEach((date) => {
      holidayMap.set(date, { name: 'Holiday' });
    });

    const { applySandwichPolicy } = await import('./utils/sandwichPolicy.js');
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
    let syntheticCount = 0;
    for (const date of allDates) {
      if (!dateSet.has(date) && sandwichMap.has(date)) {
        const sandwichResults = sandwichMap.get(date);
        const isSundayWithAppliedSandwich = sandwichResults.some(s => s.applied === true);
        const dayOfWeek = new Date(date + "T00:00:00").getDay();

        if (dayOfWeek === 0 && isSundayWithAppliedSandwich) {
          syntheticCount++;
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
            sandwich: sandwichResults,
          };
          rowsWithSandwich.push(sandwichRow);
        }
      }
    }

    rowsWithSandwich.sort((a, b) => a.date.localeCompare(b.date));

    console.log('Total rows:', rowsWithSandwich.length);
    console.log('Synthetic rows:', syntheticCount);
    console.log('\n=== Oct 3-5 ===');
    for (const row of rowsWithSandwich.filter(r => ['2026-10-03', '2026-10-04', '2026-10-05'].includes(r.date))) {
      console.log(JSON.stringify(row, null, 2));
    }
    console.log('\n=== Oct 10 ===');
    const oct10 = rowsWithSandwich.find(r => r.date === '2026-10-10');
    console.log(oct10 ? JSON.stringify(oct10, null, 2) : 'No row');
    console.log('\n=== Oct 17 ===');
    const oct17 = rowsWithSandwich.find(r => r.date === '2026-10-17');
    console.log(oct17 ? JSON.stringify(oct17, null, 2) : 'No row');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testUser41October();
