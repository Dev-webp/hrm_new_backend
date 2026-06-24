import { pool } from "../middleware/db.js";

export const SAT_MON_LIMIT_PER_MONTH = 1;

function toDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function isSaturdayOrMondayLeaveDay(dateValue) {
  const dateStr = toDateOnly(dateValue);
  if (!dateStr) return false;

  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();

  return day === 1 || day === 6;
}

export function computeOnePlusOnePenalty(leaveDays) {
  const days = Number(leaveDays || 0);

  return {
    penalty_applied: days > 0,
    penalty_days: days,
  };
}

export function evaluateLeaveOnApproval(
  leave,
  monthSatMonLeaves = [],
  policyConfig = {}
) {
  const satMonLimit = policyConfig.satMonLimit ?? SAT_MON_LIMIT_PER_MONTH;

  const fromDate = toDateOnly(leave.from_date);
  const appliedDate = toDateOnly(leave.created_at || leave.applied_on);

  const isSudden = fromDate && appliedDate && fromDate === appliedDate;
  const isSatMon = isSaturdayOrMondayLeaveDay(fromDate);

  const satMonUsed = monthSatMonLeaves.filter((l) => {
    return l.id !== leave.id && isSaturdayOrMondayLeaveDay(l.from_date);
  }).length;

  const satMonExceeded = isSatMon && satMonUsed >= satMonLimit;
  const applyPenalty = isSudden || satMonExceeded;

  const penalty = applyPenalty
    ? computeOnePlusOnePenalty(leave.requested_days ?? leave.days ?? 1)
    : { penalty_applied: false, penalty_days: 0 };

  return {
    is_sudden: Boolean(isSudden),
    is_sat_mon: isSatMon,
    sat_mon_exceeded: satMonExceeded,
    penalty_applied: penalty.penalty_applied,
    penalty_days: penalty.penalty_days,
  };
}

export function isEarnedLeaveType(leaveType) {
  const t = String(leaveType || "").toLowerCase().trim();
  return t === "paid" || t === "earned";
}

function getYearMonth(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

function capAtCurrentMonth(date = new Date()) {
  const requested = new Date(date);
  const now = new Date();
  const requestedMonth = new Date(requested.getFullYear(), requested.getMonth(), 1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return requestedMonth > currentMonth ? currentMonth : requested;
}

function monthsCompleted(joiningDate, targetDate = new Date()) {
  if (!joiningDate) return 0;

  const join = new Date(joiningDate);

  return (
    (targetDate.getFullYear() - join.getFullYear()) * 12 +
    (targetDate.getMonth() - join.getMonth())
  );
}

async function getPolicyNumber(key, fallback) {
  const result = await pool.query(
    `SELECT config_value FROM policy_config WHERE config_key = $1`,
    [key]
  );

  return result.rows.length ? Number(result.rows[0].config_value) : fallback;
}

export async function ensureMonthlyPaidLeaveCredit(userId, targetDate = new Date()) {
  targetDate = capAtCurrentMonth(targetDate);
  const { year, month } = getYearMonth(targetDate);

  const userRes = await pool.query(
    `SELECT joining_date FROM users WHERE id = $1`,
    [userId]
  );

  if (!userRes.rows.length) {
    throw new Error("User not found");
  }

  const probationMonths = await getPolicyNumber("paid_leave_probation_months", 3);
  const monthlyCredit = await getPolicyNumber("paid_leave_per_month", 1);

  const completedMonths = monthsCompleted(
    userRes.rows[0].joining_date,
    targetDate
  );

  const eligible = completedMonths >= probationMonths;
  const credit = eligible ? monthlyCredit : 0;

  await pool.query(
    `
    INSERT INTO leave_balance (
      user_id,
      year,
      month,
      paid_leave_credited,
      paid_leave_used,
      unpaid_leave_used,
      balance,
      accrual_date,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 0, 0, $4, CURRENT_DATE, NOW(), NOW())
    ON CONFLICT (user_id, year, month)
    DO NOTHING
    `,
    [userId, year, month, credit]
  );

  return {
    eligible,
    probationMonths,
    monthlyCredit: credit,
  };
}

export async function getProfessionalLeaveBalance(userId, targetDate = new Date()) {
  targetDate = capAtCurrentMonth(targetDate);
  const { year, month } = getYearMonth(targetDate);

  const creditInfo = await ensureMonthlyPaidLeaveCredit(userId, targetDate);

  const result = await pool.query(
    `
    SELECT
      COALESCE(SUM(paid_leave_credited), 0) AS total_credited,
      COALESCE(SUM(paid_leave_used), 0) AS paid_used,
      COALESCE(SUM(unpaid_leave_used), 0) AS unpaid_used
    FROM leave_balance
    WHERE user_id = $1
      AND (
        year < $2
        OR (year = $2 AND month <= $3)
      )
    `,
    [userId, year, month]
  );

  const row = result.rows[0];

  const totalCredited = Number(row.total_credited || 0);
  const paidUsed = Number(row.paid_used || 0);
  const unpaidUsed = Number(row.unpaid_used || 0);
  const available = Math.max(0, totalCredited - paidUsed);

  return {
    year,
    month,
    eligible: creditInfo.eligible,
    probationMonths: creditInfo.probationMonths,
    current_month_credit: creditInfo.monthlyCredit,
    total_paid_credited: totalCredited,
    paid_used: paidUsed,
    unpaid_used: unpaidUsed,
    carry_forward: Math.max(0, available - creditInfo.monthlyCredit),
    paid_leave_balance: available,
  };
}

export async function deductApprovedLeave(userId, days, leaveType, targetDate = new Date()) {
  targetDate = capAtCurrentMonth(targetDate);
  const { year, month } = getYearMonth(targetDate);
  const requestedDays = Number(days || 0);

  await ensureMonthlyPaidLeaveCredit(userId, targetDate);

  if (isEarnedLeaveType(leaveType)) {
    const balance = await getProfessionalLeaveBalance(userId, targetDate);

    if (requestedDays > balance.paid_leave_balance) {
      throw new Error(
        `Insufficient paid leave balance. Available: ${balance.paid_leave_balance}`
      );
    }

    const remainingBalance = Math.max(0, balance.paid_leave_balance - requestedDays);

    await pool.query(
      `
      UPDATE leave_balance
      SET
        paid_leave_used = COALESCE(paid_leave_used, 0) + $1,
        balance = $5,
        updated_at = NOW()
      WHERE user_id = $2
        AND year = $3
        AND month = $4
      `,
      [requestedDays, userId, year, month, remainingBalance]
    );

    return {
      paid_days: requestedDays,
      unpaid_days: 0,
    };
  }

  await pool.query(
    `
    UPDATE leave_balance
    SET
      unpaid_leave_used = COALESCE(unpaid_leave_used, 0) + $1,
      updated_at = NOW()
    WHERE user_id = $2
      AND year = $3
      AND month = $4
    `,
    [requestedDays, userId, year, month]
  );

  return {
    paid_days: 0,
    unpaid_days: requestedDays,
  };
}
