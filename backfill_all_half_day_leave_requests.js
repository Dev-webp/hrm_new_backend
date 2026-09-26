import { pool } from "./middleware/db.js";
import { halfDaySlotForSession } from "./utils/leaveRequestPolicy.js";

async function backfillAllHalfDayLeaveRequests() {
  const isDryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  
  console.log("==============================================");
  console.log("HALF-DAY LEAVE REQUEST BACKFILL");
  console.log("==============================================");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "APPLY CHANGES"}`);
  console.log("");

  try {
    // Find all attendance_records where linked leave_request indicates half-day
    // but attendance_records.status is not half_day
    const result = await pool.query(
      `
      SELECT 
        ar.id as attendance_id,
        ar.user_id,
        u.full_name,
        u.employee_code,
        ar.date::text as date,
        ar.status as current_status,
        ar.half_day_slot as current_half_day_slot,
        ar.leave_request_id,
        lr.id as leave_id,
        lr.leave_duration_type,
        lr.half_day_session,
        lr.paid_days,
        lr.unpaid_days,
        lr.leave_type,
        lr.status as leave_status
      FROM attendance_records ar
      LEFT JOIN leave_requests lr ON ar.leave_request_id = lr.id
      LEFT JOIN users u ON ar.user_id = u.id
      WHERE ar.leave_request_id IS NOT NULL
        AND lr.status = 'approved'
        AND (
          lr.leave_duration_type = 'half_day' 
          OR lr.paid_days = 0.5 
          OR lr.unpaid_days = 0.5
        )
        AND ar.status != 'half_day'
      ORDER BY ar.date DESC, u.full_name
      `
    );

    const rows = result.rows;
    console.log(`Found ${rows.length} records to correct\n`);

    if (rows.length === 0) {
      console.log("No records need correction. Exiting.");
      return;
    }

    let correctedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const newHalfDaySlot = halfDaySlotForSession(row.half_day_session);
      
      // Determine if this should actually be half_day
      // If leave_duration_type is explicitly 'half_day', always set to half_day
      // If only paid_days/unpaid_days is 0.5 but duration_type is 'full_day', this might be a different case
      const shouldBeHalfDay = row.leave_duration_type === 'half_day';
      
      if (!shouldBeHalfDay) {
        console.log(`[SKIP] ${row.full_name} (${row.employee_code}) - ${row.date}`);
        console.log(`  Reason: leave_duration_type='${row.leave_duration_type}' (not explicitly half_day)`);
        console.log(`  Paid Days: ${row.paid_days}, Unpaid Days: ${row.unpaid_days}`);
        console.log(`  This appears to be a full-day request with partial payment, not a half-day request\n`);
        skippedCount++;
        continue;
      }

      console.log(`[${isDryRun ? "DRY RUN" : "APPLY"}] ${row.full_name} (${row.employee_code}) - ${row.date}`);
      console.log(`  Current Status: ${row.current_status}, Half Day Slot: ${row.current_half_day_slot}`);
      console.log(`  New Status: half_day, New Half Day Slot: ${newHalfDaySlot}`);
      console.log(`  Leave Duration: ${row.leave_duration_type}, Session: ${row.half_day_session}`);
      console.log(`  Leave ID: ${row.leave_id}, Attendance ID: ${row.attendance_id}`);

      if (!isDryRun) {
        await pool.query(
          `
          UPDATE attendance_records
          SET 
            status = 'half_day',
            half_day_slot = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          `,
          [newHalfDaySlot, row.attendance_id]
        );
        console.log(`  ✓ UPDATED`);
        correctedCount++;
      } else {
        console.log(`  [DRY RUN - would update]`);
        correctedCount++;
      }
      console.log("");
    }

    console.log("==============================================");
    console.log("SUMMARY");
    console.log("==============================================");
    console.log(`Total records examined: ${rows.length}`);
    console.log(`Records to correct: ${correctedCount}`);
    console.log(`Records skipped (full-day with partial payment): ${skippedCount}`);
    console.log(`Mode: ${isDryRun ? "DRY RUN (no changes applied)" : "APPLIED"}`);
    console.log("==============================================");

    if (!isDryRun) {
      console.log("\n✅ Backfill completed successfully.");
    } else {
      console.log("\n⚠️  This was a dry run. Run with --apply to apply changes:");
      console.log("   node backfill_all_half_day_leave_requests.js --apply");
    }

  } catch (error) {
    console.error("ERROR:", error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

backfillAllHalfDayLeaveRequests().catch(console.error);
