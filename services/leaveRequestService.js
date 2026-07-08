import { pool } from "../middleware/db.js";
import { getProfessionalLeaveBalance } from "../utils/leavePolicy.js";
import { resolveLeaveBalanceUsage, resolveLeaveRequest } from "../utils/leaveRequestPolicy.js";

export async function createValidatedLeaveRequest(userId, payload) {
  const {
    leave_type,
    from_date,
    to_date,
    reason,
    leave_duration_type = "full_day",
    half_day_session = null,
    use_paid_leave = false,
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
  let remainingBalance = 0;
  let availableBalance = 0;
  const usePaidLeave = use_paid_leave === true || use_paid_leave === "true";
  const balance = await getProfessionalLeaveBalance(userId, new Date(`${from_date}T00:00:00`));
  availableBalance = Number(balance.paid_leave_balance || 0);

  ({ paidDays, unpaidDays, remainingBalance } = resolveLeaveBalanceUsage({
    usePaidLeave,
    requestedDays,
    availableBalance,
  }));

  const result = await pool.query(
    `INSERT INTO leave_requests (
       user_id, leave_type, from_date, to_date, days, requested_days,
       leave_duration_type, half_day_session, reason, status,
       leave_category, is_paid_leave, paid_days, unpaid_days, balance_at_application,
       use_paid_leave, remaining_paid_balance
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      userId,
      usePaidLeave ? "Paid" : leave_type,
      from_date,
      to_date,
      Math.ceil(requestedDays),
      requestedDays,
      leave_duration_type,
      halfDaySession,
      reason || null,
      paidDays > 0 ? "Paid" : "Unpaid",
      paidDays > 0,
      paidDays,
      unpaidDays,
      availableBalance,
      usePaidLeave,
      remainingBalance,
    ]
  );

  return result.rows[0];
}
