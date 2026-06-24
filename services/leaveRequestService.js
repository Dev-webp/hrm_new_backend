import { pool } from "../middleware/db.js";
import { getProfessionalLeaveBalance, isEarnedLeaveType } from "../utils/leavePolicy.js";
import { resolveLeaveBalanceUsage, resolveLeaveRequest } from "../utils/leaveRequestPolicy.js";

export async function createValidatedLeaveRequest(userId, payload) {
  const {
    leave_type,
    from_date,
    to_date,
    reason,
    leave_duration_type = "full_day",
    half_day_session = null,
  } = payload;

  if (!leave_type) throw new Error("leave_type is required");

  const userResult = await pool.query(
    `SELECT branch FROM users WHERE id = $1`,
    [userId]
  );
  if (!userResult.rows.length) throw new Error("User not found");

  const branch = userResult.rows[0].branch;
  const holidayResult = await pool.query(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1 AND $2
       AND type = 'holiday'
       AND (LOWER(COALESCE(branch, 'all')) = 'all' OR branch = $3)`,
    [from_date, to_date, branch]
  );
  const holidayDates = new Set(holidayResult.rows.map((row) => row.date));

  const { requestedDays, halfDaySession } = resolveLeaveRequest({
    fromDate: from_date,
    toDate: to_date,
    leaveDurationType: leave_duration_type,
    halfDaySession: half_day_session,
    holidayDates,
  });

  let paidDays = 0;
  let unpaidDays = 0;
  let availableBalance = 0;
  const isPaid = isEarnedLeaveType(leave_type);
  if (isPaid) {
    const balance = await getProfessionalLeaveBalance(userId, new Date(`${from_date}T00:00:00`));
    availableBalance = Number(balance.paid_leave_balance || 0);
  }
  ({ paidDays, unpaidDays } = resolveLeaveBalanceUsage({
    isPaid,
    requestedDays,
    availableBalance,
  }));

  const result = await pool.query(
    `INSERT INTO leave_requests (
       user_id, leave_type, from_date, to_date, days, requested_days,
       leave_duration_type, half_day_session, reason, status,
       leave_category, is_paid_leave, paid_days, unpaid_days, balance_at_application
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      userId,
      leave_type,
      from_date,
      to_date,
      Math.ceil(requestedDays),
      requestedDays,
      leave_duration_type,
      halfDaySession,
      reason || null,
      isPaid ? "Paid" : "Unpaid",
      isPaid,
      paidDays,
      unpaidDays,
      availableBalance,
    ]
  );

  return result.rows[0];
}
