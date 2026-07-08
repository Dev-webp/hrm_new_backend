import { pool } from "../middleware/db.js";
import { recalcAttendanceForUserDate } from "../routes/attendanceRoutes.js";

async function main() {
  const records = await pool.query(
    `SELECT
       user_id,
       TO_CHAR(date, 'YYYY-MM-DD') AS date,
       status AS before_status
     FROM attendance_records
     ORDER BY date, user_id`
  );

  let changed = 0;

  for (const row of records.rows) {
    await recalcAttendanceForUserDate(row.user_id, row.date, {
      source: "attendance_policy_backfill",
    });

    const after = await pool.query(
      `SELECT
         status AS after_status,
         production_hours,
         late_minutes,
         total_break_minutes
       FROM attendance_records
       WHERE user_id = $1 AND date = $2::date`,
      [row.user_id, row.date]
    );

    const afterRow = after.rows[0] || {};
    if (String(row.before_status || "") !== String(afterRow.after_status || "")) {
      changed += 1;
      console.log("[AttendanceBackfillChanged]", {
        user_id: row.user_id,
        date: row.date,
        before_status: row.before_status || null,
        after_status: afterRow.after_status || null,
        production_hours: Number(afterRow.production_hours || 0),
        late_minutes: Number(afterRow.late_minutes || 0),
        total_break_minutes: Number(afterRow.total_break_minutes || 0),
      });
    }
  }

  console.log("[AttendanceBackfillComplete]", {
    scanned: records.rowCount,
    changed,
  });
}

main()
  .catch((error) => {
    console.error("[AttendanceBackfillFailed]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
