// Recalculate attendance status based on punch data
// This script fixes records that have punch data but incorrect status

import { pool } from "./middleware/db.js";
import { getComputedAttendanceStatus } from "./utils/computedAttendanceStatus.js";

async function recalcAttendanceFromPunch() {
  try {
    console.log("Starting attendance recalculation from punch data...");

    // Fetch all holidays
    const holidaysResult = await pool.query(
      "SELECT date FROM company_holidays ORDER BY date"
    );
    // Normalize holiday dates to YYYY-MM-DD format
    const holidaySet = new Set(holidaysResult.rows.map(h => {
      const dateObj = new Date(h.date);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }));

    // Find all attendance records that:
    // 1. Have punch data (check_in_time or check_out_time)
    // 2. Status is not correctly reflecting the punch data

    const result = await pool.query(
      `
      SELECT 
        id,
        user_id,
        date,
        check_in_time,
        check_out_time,
        status,
        leave_type,
        is_paid_leave,
        leave_request_id,
        half_day_slot,
        total_break_minutes,
        late_minutes,
        production_hours
      FROM attendance_records
      WHERE (check_in_time IS NOT NULL OR check_out_time IS NOT NULL)
      ORDER BY user_id, date
      `
    );

    console.log(`Found ${result.rows.length} records with punch data...`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const record of result.rows) {
      // Convert date to local date string for proper calculation
      // The database stores dates as UTC timestamps (e.g., "2026-09-27T18:30:00.000Z")
      // This represents September 28 in IST timezone (UTC+5:30)
      // To get the local date, we add 5.5 hours (330 minutes)
      const dateObj = new Date(record.date);
      const localDate = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
      const year = localDate.getFullYear();
      const month = String(localDate.getMonth() + 1).padStart(2, "0");
      const day = String(localDate.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD
      
      // Calculate the correct status based on punch data
      const computed = getComputedAttendanceStatus(record, {
        dateStr,
        holidaySet,
        noRecordStatus: "absent"
      });

      const oldStatus = record.status;
      const newStatus = computed.computed_status;

      // Debug: Show comparison
      if (oldStatus !== newStatus) {
        console.log(`Updating record ${record.user_id} on ${dateStr}: ${oldStatus} -> ${newStatus}`);
      } else {
        // Debug: Show why it's being skipped for specific records
        if (record.user_id === 3 && dateStr === '2026-09-28') {
          console.log(`DEBUG record ${record.user_id} on ${dateStr}:`, {
            oldStatus,
            newStatus,
            check_in: record.check_in_time,
            check_out: record.check_out_time,
            computed
          });
        }
      }

      // Only update if status has changed
      if (oldStatus !== newStatus) {
        
        await pool.query(
          `
          UPDATE attendance_records
          SET status = $1,
              late_minutes = $2,
              production_hours = $3,
              total_break_minutes = $4,
              half_day_slot = $5,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $6
          `,
          [
            newStatus,
            computed.late_minutes,
            computed.production_hours,
            computed.total_break_minutes,
            computed.half_day_slot || record.half_day_slot,
            record.id
          ]
        );

        fixedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(`\nRecalculation completed:`);
    console.log(`- Fixed: ${fixedCount} records`);
    console.log(`- Skipped: ${skippedCount} records (no change needed)`);

  } catch (error) {
    console.error("Error recalculating attendance from punch data:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

recalcAttendanceFromPunch();
