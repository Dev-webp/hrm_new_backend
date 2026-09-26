// Backfill script: Fix half-day leave requests displaying as full-day leave
// This script corrects attendance_records where a half-day leave request was synced
// but the attendance status shows full-day paid/unpaid leave instead of half_day

import { pool } from "./middleware/db.js";
import { halfDaySlotForSession } from "./utils/leaveRequestPolicy.js";

async function backfillHalfDayLeaveRequests(apply = false) {
  try {
    console.log("==============================================");
    console.log("HALF-DAY LEAVE REQUEST BACKFILL");
    console.log("Mode:", apply ? "APPLY CHANGES" : "DRY RUN (no changes)");
    console.log("==============================================\n");

    // Step 1: Find all approved half-day leave requests
    const halfDayLeaves = await pool.query(
      `
      SELECT
        lr.id,
        lr.user_id,
        u.employee_code,
        lr.from_date,
        lr.to_date,
        lr.leave_duration_type,
        lr.half_day_session,
        lr.paid_days,
        lr.unpaid_days,
        lr.status
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id = u.id
      WHERE lr.status = 'approved'
        AND lr.leave_duration_type = 'half_day'
      ORDER BY lr.user_id, lr.from_date
      `
    );

    console.log(`Found ${halfDayLeaves.rows.length} approved half-day leave requests\n`);

    // Step 2: For each leave request, check corresponding attendance_records by leave_request_id
    const corrections = [];

    for (const leave of halfDayLeaves.rows) {
      // Check attendance records linked to this leave request
      const attendance = await pool.query(
        `
        SELECT
          id,
          user_id,
          date::date,
          status,
          leave_type,
          is_paid_leave,
          leave_request_id,
          half_day_slot
        FROM attendance_records
        WHERE leave_request_id = $1
        `,
        [leave.id]
      );

      for (const record of attendance.rows) {
        // Check if this is a mismatch: leave request is half-day but attendance shows full-day OR present/absent
        const isMismatch = (
          (record.status === 'paid_leave' || record.status === 'unpaid_leave' ||
           record.status === 'present' || record.status === 'absent') &&
          leave.leave_duration_type === 'half_day'
        );

        if (isMismatch) {
          const halfDaySlot = halfDaySlotForSession(leave.half_day_session);

          corrections.push({
            user_id: leave.user_id,
            employee_code: leave.employee_code,
            date: record.date,
            attendance_id: record.id,
            old_status: record.status,
            old_half_day_slot: record.half_day_slot,
            new_status: 'half_day',
            new_half_day_slot: halfDaySlot,
            leave_request_id: leave.id,
            leave_type: record.leave_type,
            is_paid_leave: record.is_paid_leave,
            half_day_session: leave.half_day_session,
          });
        }
      }
    }

    console.log(`Found ${corrections.length} attendance records needing correction\n`);

    if (corrections.length === 0) {
      console.log("No corrections needed. All records are already correct.");
      return;
    }

    // Print before/after table
    console.log("==============================================");
    console.log("CORRECTIONS TO APPLY:");
    console.log("==============================================\n");
    console.table(corrections);

    if (!apply) {
      console.log("\n==============================================");
      console.log("DRY RUN COMPLETE - NO CHANGES MADE");
      console.log("Run with --apply to execute corrections");
      console.log("==============================================");
      return;
    }

    // Apply corrections
    console.log("\n==============================================");
    console.log("APPLYING CORRECTIONS...");
    console.log("==============================================\n");

    let applied = 0;
    for (const correction of corrections) {
      await pool.query(
        `
        UPDATE attendance_records
        SET
          status = $1,
          half_day_slot = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [correction.new_status, correction.new_half_day_slot, correction.attendance_id]
      );

      console.log(`Updated: User ${correction.employee_code} (${correction.user_id}) on ${correction.date} - ${correction.old_status} -> ${correction.new_status} (${correction.new_half_day_slot})`);
      applied++;
    }

    console.log(`\n==============================================`);
    console.log(`SUCCESS: ${applied} records corrected`);
    console.log("==============================================");

  } catch (error) {
    console.error("ERROR:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Check for --apply flag
const apply = process.argv.includes('--apply');

backfillHalfDayLeaveRequests(apply).catch(console.error);
