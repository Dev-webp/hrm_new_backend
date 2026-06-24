/**
 * Server-side policy enforcement (DB reads/writes).
 */
import { pool } from "../middleware/db.js";
import { loadPolicyConfig } from "../utils/policyConfig.js";
import {
  classifyDayPolicy,
  calculateNetWorkMillis,
  evaluateLateLogin,
  buildMonthlyLateStats,
  resolveHalfDaySlot,
  formatDateStr,
  calculateLateMinutes,
} from "../utils/attendancePolicy.js";
import { emitNotification } from "../socketManager.js";

const statusMap = {
  full_day: "full_day",
  half_day: "half_day",
  leave: "leave",
  holiday: "holiday",
  absent: "absent",
};

export async function upsertMonthlyLateCount(userId, year, month, permittedLateCount) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  await pool.query(
    `INSERT INTO employee_monthly_summary (user_id, month, late_login_count, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, month) DO UPDATE SET
       late_login_count = EXCLUDED.late_login_count,
       updated_at = NOW()`,
    [userId, monthKey, permittedLateCount]
  );
}

export async function persistDayClassification(userId, dateStr, result, extras = {}) {
  const legacyStatus = statusMap[result.bucket] || "absent";
  const lateMinutes = extras.lateMinutes ?? 0;
  const netHours = result.net_hours ?? 0;
  const halfSlot = extras.halfDaySlot ?? null;
  const totalBreakMinutes = Number(result.total_break_minutes || 0);

  await pool.query(
    `UPDATE attendance_records SET
       status = $1,
       late_minutes = $2,
       production_hours = $3,
       half_day_slot = $4,
       total_break_minutes = $5,
       updated_at = NOW()
     WHERE user_id = $6 AND date = $7`,
    [
      legacyStatus,
      lateMinutes,
      parseFloat(netHours.toFixed(2)),
      halfSlot,
      totalBreakMinutes,
      userId,
      dateStr,
    ]
  );

  if (extras.misuseOfTime) {
    await pool.query(
      `UPDATE attendance_records SET misuse_of_time = TRUE, status = 'half_day'
       WHERE user_id = $1 AND date = $2`,
      [userId, dateStr]
    );
  }
}

/**
 * Classify one day and persist (used by recalc + cron).
 */
export async function classifyAndPersistUserDate(
  userId,
  dateStr,
  log,
  holidaySet,
  monthlyLateStats,
  logsByDateExtended,
  rowExtras = {}
) {
  const cfg = await loadPolicyConfig();

  let result = classifyDayPolicy({
    dateStr,
    log,
    holidaySet,
    monthlyLateStats,
    logsByDate: logsByDateExtended,
    policyConfig: cfg,
  });

  if (rowExtras.misuse_of_time) {
    result = {
      bucket: "half_day",
      reason: "Manager flagged misuse of time",
      net_hours: result.net_hours,
      flags: [...(result.flags || []), "misuse_of_time"],
    };
  }

  const lateMinutes = calculateLateMinutes(log?.office_in);

  const halfDaySlot = log ? resolveHalfDaySlot(log) : null;
  const slotForDb =
    result.bucket === "half_day" && halfDaySlot !== "INVALID"
      ? halfDaySlot
      : result.bucket === "half_day"
      ? "INVALID"
      : null;

  await persistDayClassification(userId, dateStr, result, {
    lateMinutes,
    halfDaySlot: slotForDb,
    misuseOfTime: rowExtras.misuse_of_time,
  });

  return { result, lateMinutes, halfDaySlot: slotForDb };
}

export async function checkDepartmentBreakCoverage(department, branch, date, excludeUserId) {
  const activeBreaks = await pool.query(
    `SELECT COUNT(DISTINCT eb.user_id) AS on_break
     FROM employee_breaks eb
     JOIN users u ON u.id = eb.user_id
     WHERE eb.date = $1
       AND u.department = $2
       AND u.branch = $3
       AND u.status = 'active'
       AND u.role != 'SUPER_ADMIN'
       AND eb.start_time IS NOT NULL
       AND eb.end_time IS NULL`,
    [date, department, branch]
  );

  const loggedIn = await pool.query(
    `SELECT COUNT(DISTINCT a.user_id) AS cnt
     FROM attendance_records a
     JOIN users u ON u.id = a.user_id
     WHERE a.date = $1
       AND u.department = $2
       AND u.branch = $3
       AND u.status = 'active'
       AND u.role != 'SUPER_ADMIN'
       AND a.check_in_time IS NOT NULL
       AND (a.check_out_time IS NULL OR a.check_out_time > a.check_in_time)`,
    [date, department, branch]
  );

  const deptTotal = Number(loggedIn.rows[0]?.cnt || 0);
  const onBreak = Number(activeBreaks.rows[0]?.on_break || 0);

  const remaining = deptTotal - onBreak;
  if (deptTotal < 1) return { allowed: true, remaining: 1 };
  if (remaining < 1) {
    return {
      allowed: false,
      message:
        "At least one team member must remain. Coordinate before taking a break.",
      deptTotal,
      onBreak,
    };
  }
  return { allowed: true, remaining, deptTotal, onBreak };
}

export async function handleProxyAttempt({
  subjectUserId,
  loggedByUserId,
  dateStr,
  recordedBy,
  ipAddress,
}) {
  const markProxyAttempt = async (uid) => {
    await pool.query(
      `INSERT INTO attendance_records
         (user_id, date, branch, department, extra_break_ins, extra_break_outs, proxy_attempt)
       SELECT id, $2, branch, department, '[]', '[]', TRUE
       FROM users WHERE id = $1
       ON CONFLICT (user_id, date) DO UPDATE SET
         proxy_attempt = TRUE,
         updated_at = NOW()`,
      [uid, dateStr]
    );
  };

  await markProxyAttempt(subjectUserId);
  if (loggedByUserId !== subjectUserId) {
    await markProxyAttempt(loggedByUserId);
  }

  for (const uid of [subjectUserId, loggedByUserId]) {
    if (!uid) continue;
    await pool.query(
      `INSERT INTO violation_records
         (user_id, violation_type, violation_date, recorded_by, action_taken, related_user_id, metadata)
       VALUES ($1, 'PROXY_LOG', $2, $3, 'Recorded for HR disciplinary review', $4, $5)`,
      [
        uid,
        dateStr,
        recordedBy,
        uid === subjectUserId ? loggedByUserId : subjectUserId,
        JSON.stringify({ ipAddress }),
      ]
    );
  }

  const users = await pool.query(
    `SELECT id, full_name, branch FROM users WHERE id = ANY($1::int[])`,
    [[subjectUserId, loggedByUserId]]
  );

  for (const u of users.rows) {
    await emitNotification({
      userId: u.id,
      actionType: "proxy_violation",
      description: `PROXY ATTENDANCE: ${u.full_name} - recorded for HR disciplinary review on ${dateStr}`,
      targetRole: "BOTH",
      branch: u.branch,
    });
  }
}

export async function recordDressCodeViolation(employeeId, dateStr, recordedBy, reason) {
  await pool.query(
    `INSERT INTO violation_records
       (user_id, violation_type, violation_date, recorded_by, action_taken)
     VALUES ($1, 'DRESS_CODE', $2, $3, $4)`,
    [employeeId, dateStr, recordedBy, reason || "Dress code violation"]
  );

}

export async function runDailyAttendanceRecalc(targetDateStr) {
  const cfg = await loadPolicyConfig();
  const records = await pool.query(
    `SELECT DISTINCT user_id FROM attendance_records WHERE date = $1`,
    [targetDateStr]
  );

  let updated = 0;
  for (const row of records.rows) {
    const userId = row.user_id;
    const [year, month] = targetDateStr.split("-").map(Number);

    const att = await pool.query(
      `SELECT * FROM attendance_records WHERE user_id = $1 AND date = $2`,
      [userId, targetDateStr]
    );
    if (!att.rows.length) continue;

    const r = att.rows[0];
    const log = {
      office_in: r.check_in_time,
      office_out: r.check_out_time,
      leave_type: r.leave_type,
      leave_status: r.leave_status,
    };

    const holidayRes = await pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date FROM company_holidays
       WHERE EXTRACT(YEAR FROM date) = $1`,
      [year]
    );
    const holidaySet = new Set(holidayRes.rows.map((h) => h.date));

    const dim = new Date(year, month, 0).getDate();
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${dim}`;

    const monthLogs = await pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, check_in_time AS office_in,
              check_out_time AS office_out, leave_type, leave_status
       FROM attendance_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [userId, monthStart, monthEnd]
    );
    const logsByDate = {};
    for (const l of monthLogs.rows) logsByDate[l.date] = l;

    const monthlyLateStats = buildMonthlyLateStats(
      logsByDate,
      dim,
      year,
      month,
      cfg
    );

    await classifyAndPersistUserDate(
      userId,
      targetDateStr,
      log,
      holidaySet,
      monthlyLateStats,
      logsByDate,
      { misuse_of_time: r.misuse_of_time }
    );

    await upsertMonthlyLateCount(
      userId,
      year,
      month,
      monthlyLateStats.permitted_late_count
    );
    updated++;
  }

  try {
    await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_attendance`);
  } catch (_) {
    await pool.query(`REFRESH MATERIALIZED VIEW mv_monthly_attendance`);
  }

  return { updated, date: targetDateStr };
}
