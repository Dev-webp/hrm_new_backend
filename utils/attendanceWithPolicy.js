import { pool } from "../middleware/db.js";
import { applySandwichPolicy } from "./sandwichPolicy.js";
import { toDateStr } from "./dateHelper.js";
import { withComputedAttendanceStatus, getComputedAttendanceStatus } from "./computedAttendanceStatus.js";

async function fetchHolidaySetForDateRange(startDate, endDate) {
  const res = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1::date AND $2::date`,
    [startDate, endDate]
  );
  return new Set(res.rows.map((r) => r.date));
}

function withDisplayAttendanceStatus(row = {}, dateStr = null, context = {}) {
  return withComputedAttendanceStatus(row, { ...context, dateStr });
}

/**
 * Shared service function to fetch attendance with sandwich policy applied.
 * Used by /attendance/self/history, /attendance/user/:userId, and /attendance/range/summary/user/:userId
 *
 * @param {number} userId - User ID to fetch attendance for
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {object} options - Optional parameters
 * @param {string} options.todayStr - Today's date string (for sandwich policy)
 * @returns {Promise<object>} Object with rows, sandwich array, and summary counters
 */
export async function getAttendanceWithPolicy(userId, fromDate, toDate, options = {}) {
  const { todayStr = toDateStr(new Date()) } = options;

  // Fetch attendance records
  const attResult = await pool.query(
    `SELECT TO_CHAR(ar.date,'YYYY-MM-DD') AS date,
            ar.check_in_time, ar.check_out_time,
            ar.status,
            ar.late_minutes, ar.production_hours, ar.total_break_minutes,
            ar.half_day_slot, ar.leave_type, ar.leave_status,
            ar.post_login_idle_minutes, ar.misuse_of_time
     FROM attendance_records ar
     WHERE ar.user_id=$1 AND ar.date BETWEEN $2 AND $3
     ORDER BY ar.date ASC`,
    [userId, fromDate, toDate]
  );

  // Fetch user's joining_date for sandwich policy
  const userResult = await pool.query(
    `SELECT joining_date FROM users WHERE id = $1`,
    [userId]
  );
  const joiningDate = userResult.rows[0]?.joining_date || null;

  // Fetch approved leave requests for this user in the date range
  const leaveResult = await pool.query(
    `SELECT id, from_date, to_date, leave_type, status, leave_duration_type,
            paid_days, unpaid_days
     FROM leave_requests
     WHERE user_id = $1
       AND status = 'approved'
       AND from_date <= $2
       AND to_date >= $3
     ORDER BY from_date`,
    [userId, toDate, fromDate]
  );

  // Fetch holidays for the date range
  const holidaySet = await fetchHolidaySetForDateRange(fromDate, toDate);

  // Build attendance map
  const attMap = new Map();
  for (const row of attResult.rows) {
    attMap.set(row.date, row);
  }

  // Build allDates from the full date range (not just dates with attendance records)
  const allDates = [];
  const startDate = new Date(fromDate + "T00:00:00");
  const endDate = new Date(toDate + "T00:00:00");
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    allDates.push(dateStr);
  }

  // Build holiday map
  const holidayMap = new Map();
  holidaySet.forEach((date) => {
    holidayMap.set(date, { name: 'Holiday' });
  });

  // Apply sandwich policy
  const { sandwichResults } = applySandwichPolicy({
    attMap,
    holidayMap,
    halfDayLeaveMap: new Map(),
    allDates,
    leaves: leaveResult.rows,
  }, {
    todayStr,
    joiningDate,
  });

  // Create a date -> sandwich result map
  const sandwichMap = new Map();
  for (const sr of sandwichResults) {
    if (!sandwichMap.has(sr.date)) {
      sandwichMap.set(sr.date, []);
    }
    sandwichMap.get(sr.date).push(sr);
  }

  // Add sandwich metadata to attendance rows
  const logsByDate = Object.fromEntries(attResult.rows.map((row) => [row.date, row]));
  const rowsWithSandwich = attResult.rows.map((row) => {
    const rowWithStatus = withDisplayAttendanceStatus(row, row.date, { holidaySet, logsByDate });

    if (sandwichMap.has(row.date)) {
      rowWithStatus.sandwich = sandwichMap.get(row.date);
    }

    return rowWithStatus;
  });

  // Add synthetic rows for dates without attendance records but with sandwich results
  // Only create synthetic rows for Sundays with applied=true
  const dateSet = new Set(attResult.rows.map(r => r.date));
  for (const date of allDates) {
    if (!dateSet.has(date) && sandwichMap.has(date)) {
      const sandwichResults = sandwichMap.get(date);
      // Check if this is a Sunday with applied sandwich
      const isSundayWithAppliedSandwich = sandwichResults.some(s => s.applied === true);
      const dayOfWeek = new Date(date + "T00:00:00").getDay();

      if (dayOfWeek === 0 && isSundayWithAppliedSandwich) {
        // This date has no attendance record but has an applied sandwich result
        // Create a minimal row for it
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

  // Sort by date
  rowsWithSandwich.sort((a, b) => a.date.localeCompare(b.date));

  // Calculate summary counters
  let present = 0;
  let absent = 0;
  let late = 0;
  let halfDay = 0;
  let leave = 0;
  let sandwichPenaltyCount = 0;

  for (const row of rowsWithSandwich) {
    const status = row.status?.toLowerCase();

    if (status === 'present' || status === 'full_day') {
      present++;
    } else if (status === 'half_day') {
      halfDay++;
    } else if (status === 'absent') {
      absent++;
    } else if (status === 'paid_leave' || status === 'unpaid_leave' || status === 'leave') {
      leave++;
    }

    if (row.late_minutes > 0) {
      late++;
    }

    // Count sandwich penalties
    if (row.sandwich && row.sandwich.some(s => s.applied === true)) {
      sandwichPenaltyCount++;
    }
  }

  return {
    rows: rowsWithSandwich,
    sandwich: sandwichResults,
    summary: {
      present,
      absent,
      late,
      halfDay,
      leave,
      sandwichPenaltyCount,
      total: rowsWithSandwich.length,
    },
  };
}
