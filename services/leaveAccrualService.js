/**
 * Paid leave accrual & balance — thresholds from policy_config.
 */
import { pool } from "../middleware/db.js";
import { loadPolicyConfig } from "../utils/policyConfig.js";
import {
  safeDate,
  monthsSinceJoining,
  getEligibilityDate,
  isPaidLeaveType,
} from "./leaveAccrualPure.js";

export {
  safeDate,
  monthsSinceJoining,
  getEligibilityDate,
  isPaidLeaveType,
};

export async function getPaidLeavePolicy() {
  const cfg = await loadPolicyConfig();
  const probationMonths =
    cfg.paidLeaveProbationMonths ??
    Number(cfg.paid_leave_probation_months ?? cfg.PAID_LEAVE_PROBATION_MONTHS) ??
    cfg.earnedLeaveProbationMonths ??
    Number(cfg.earned_leave_probation_months) ??
    3;
  const perMonth =
    cfg.paidLeavePerMonth ??
    Number(cfg.paid_leave_per_month ?? cfg.PAID_LEAVE_PER_MONTH) ??
    cfg.earnedLeavePerMonth ??
    Number(cfg.earned_leave_per_month) ??
    1;
  return { probationMonths, perMonth };
}

/** @deprecated alias */
export const getEarnedLeavePolicy = getPaidLeavePolicy;

export async function isEligibleForPaidLeave(joiningDate, asOf = new Date()) {
  const { probationMonths } = await getPaidLeavePolicy();
  return monthsSinceJoining(joiningDate, asOf) >= probationMonths;
}

export const isEligibleForEarnedLeave = isEligibleForPaidLeave;

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Cumulative balance through year/month + current month usage.
 */
export async function getLeaveBalance(employeeId, year, month, leaveCategory = null) {
  const y = year ?? new Date().getFullYear();
  const m = month ?? new Date().getMonth() + 1;

  const userRes = await pool.query(
    `SELECT COALESCE(joining_date, DATE(created_at)) AS joining_date
     FROM users
     WHERE id = $1`,
    [employeeId]
  );

  if (!userRes.rows.length) {
    return {
      current_balance: 0,
      sick_available: 0,
      casual_available: 0,
      eligible: false,
    };
  }

  const joiningDate = userRes.rows[0].joining_date;
  const policy = await getPaidLeavePolicy();
  const eligible = await isEligibleForPaidLeave(joiningDate);

 const balRes = await pool.query(
  `SELECT
     COALESCE(SUM(sick_credited), 0) AS sick_credited,
     COALESCE(SUM(sick_used), 0) AS sick_used,
     COALESCE(SUM(casual_credited), 0) AS casual_credited,
     COALESCE(SUM(casual_used), 0) AS casual_used,
     COALESCE(SUM(paid_leave_credited), 0) AS paid_credited,
     COALESCE(SUM(paid_leave_used), 0) AS paid_used,
     COALESCE(SUM(unpaid_leave_used), 0) AS unpaid_used
   FROM leave_balance
   WHERE user_id = $1
     AND (
       year < $2
       OR (year = $2 AND month <= $3)
     )`,
  [employeeId, y, m]
);

  const r = balRes.rows[0];

  const sickAvailable = Math.max(
    0,
    Number(r.sick_credited || 0) - Number(r.sick_used || 0)
  );

  const casualAvailable = Math.max(
    0,
    Number(r.casual_credited || 0) - Number(r.casual_used || 0)
  );

  const totalAvailable = sickAvailable + casualAvailable;

  let selectedAvailable = totalAvailable;
  if (leaveCategory === "Sick") selectedAvailable = sickAvailable;
  if (leaveCategory === "Casual") selectedAvailable = casualAvailable;

  return {
    current_balance: selectedAvailable,
    total_available: totalAvailable,
    sick_available: sickAvailable,
    casual_available: casualAvailable,
    sick_credited: Number(r.sick_credited || 0),
    sick_used: Number(r.sick_used || 0),
    casual_credited: Number(r.casual_credited || 0),
    casual_used: Number(r.casual_used || 0),
    paid_credited: Number(r.paid_credited || 0),
    paid_used: Number(r.paid_used || 0),
    unpaid_used: Number(r.unpaid_used || 0),
    eligible,
    probationMonths: policy.probationMonths,
  };
}



/** Net available (calendar year cumulative through today). */
export async function getEarnedLeaveBalance(employeeId, year = new Date().getFullYear()) {
  const now = new Date();
  const bal = await getLeaveBalance(employeeId, year, now.getMonth() + 1);
  return {
    earned_leave_balance: bal.credited,
    earned_leave_used: bal.used,
    earned_leave_available: bal.current_balance,
    current_balance: bal.current_balance,
    year,
  };
}

export async function accrueMonthlyLeave(employeeId, asOf = new Date()) {
  const userRes = await pool.query(
    `SELECT id, COALESCE(joining_date, DATE(created_at)) AS joining_date, status
     FROM users WHERE id = $1`,
    [employeeId]
  );
  if (!userRes.rows.length || userRes.rows[0].status !== "active") {
    return { accrued: false, reason: "user_not_found_or_inactive" };
  }

  const joiningDate = userRes.rows[0].joining_date;
  const eligible = await isEligibleForPaidLeave(joiningDate, asOf);
  if (!eligible) {
    return {
      accrued: false,
      reason: "probation_not_complete",
      monthsCompleted: monthsSinceJoining(joiningDate, asOf),
    };
  }

  const { perMonth } = await getPaidLeavePolicy();
  const year = asOf.getFullYear();
  const month = asOf.getMonth() + 1;
  const todayStr = asOf.toISOString().slice(0, 10);

  const existing = await pool.query(
    `SELECT id, accrual_date, last_accrual_date
     FROM leave_balance
     WHERE user_id = $1 AND year = $2 AND month = $3`,
    [employeeId, year, month]
  );

  const accrualMark =
    existing.rows[0]?.accrual_date || existing.rows[0]?.last_accrual_date;
  if (
    existing.rows.length &&
    accrualMark &&
    String(accrualMark).slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`
  ) {
    const bal = await getLeaveBalance(employeeId, year, month);
    return { accrued: false, reason: "already_accrued_this_month", balance: bal.current_balance };
  }

  await pool.query(
    `INSERT INTO leave_balance
       (user_id, year, month, earned_leave_balance, earned_leave_credited,
        earned_leave_used, balance, accrual_date, last_accrual_date, updated_at)
     VALUES ($1, $2, $3, $4, $4, 0, $4, $5, $5, NOW())
     ON CONFLICT (user_id, year, month) DO UPDATE SET
       earned_leave_balance = leave_balance.earned_leave_balance + EXCLUDED.earned_leave_balance,
       earned_leave_credited = COALESCE(leave_balance.earned_leave_credited, 0) + EXCLUDED.earned_leave_credited,
       balance = GREATEST(0,
         COALESCE(leave_balance.earned_leave_credited, leave_balance.earned_leave_balance, 0)
         + EXCLUDED.earned_leave_credited
         - COALESCE(leave_balance.earned_leave_used, 0)),
       accrual_date = EXCLUDED.accrual_date,
       last_accrual_date = EXCLUDED.last_accrual_date,
       updated_at = NOW()`,
    [employeeId, year, month, perMonth, todayStr]
  );

  const bal = await getLeaveBalance(employeeId, year, month);
  return { accrued: true, added: perMonth, balance: bal.current_balance, ...bal };
}

export const accrueMonthlyEarnedLeave = accrueMonthlyLeave;

export async function accrueEarnedLeaveCatchUp(userId, asOf = new Date()) {
  const userRes = await pool.query(
    `SELECT COALESCE(joining_date, DATE(created_at)) AS joining_date FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) return { accruedMonths: 0 };

  const joiningDate = userRes.rows[0].joining_date;
  const { probationMonths } = await getPaidLeavePolicy();
  const start = getEligibilityDate(joiningDate, probationMonths);
  if (!start || asOf < start) return { accruedMonths: 0 };

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  let count = 0;

  while (cursor <= end) {
    const r = await accrueMonthlyLeave(userId, cursor);
    if (r.accrued) count++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return { accruedMonths: count, ...(await getEarnedLeaveBalance(userId)) };
}

/**
 * On approval: deduct paid portion; remainder is unpaid (salary deducted separately).
 */



export async function deductLeave(employeeId, days, year, month, leaveCategory = "Casual") {
  const requestedDays = Number(days || 0);

  const bal = await getLeaveBalance(employeeId, year, month, leaveCategory);

  const availablePaid = Math.max(0, Number(bal.current_balance || 0));

  const paid = Math.min(availablePaid, requestedDays);
  const unpaid = Math.max(0, requestedDays - paid);

  let sickUsed = 0;
  let casualUsed = 0;

  if (leaveCategory === "Sick") {
    sickUsed = paid;
  } else if (leaveCategory === "Casual") {
    casualUsed = paid;
  } else {
    // If leave type is Unpaid, no paid leave should be used
    sickUsed = 0;
    casualUsed = 0;
  }

  await pool.query(
    `INSERT INTO leave_balance
       (user_id, year, month,
        sick_credited, sick_used,
        casual_credited, casual_used,
        paid_leave_credited, paid_leave_used,
        unpaid_leave_used, updated_at)
     VALUES ($1, $2, $3, 0, $4, 0, $5, 0, $6, $7, NOW())
     ON CONFLICT (user_id, year, month) DO UPDATE SET
       sick_used = COALESCE(leave_balance.sick_used, 0) + EXCLUDED.sick_used,
       casual_used = COALESCE(leave_balance.casual_used, 0) + EXCLUDED.casual_used,
       paid_leave_used = COALESCE(leave_balance.paid_leave_used, 0) + EXCLUDED.paid_leave_used,
       unpaid_leave_used = COALESCE(leave_balance.unpaid_leave_used, 0) + EXCLUDED.unpaid_leave_used,
       updated_at = NOW()`,
    [employeeId, year, month, sickUsed, casualUsed, paid, unpaid]
  );

  return {
    paid,
    unpaid,
    available_before_approval: availablePaid,
    ...(await getLeaveBalance(employeeId, year, month, leaveCategory)),
  };
}
export function computeSalaryDeduction(monthlySalary, year, month, unpaidDays) {
  if (!unpaidDays || unpaidDays <= 0) return 0;
  const dim = daysInMonth(year, month);
  const dailyRate = Number(monthlySalary) / dim;
  return Math.round(dailyRate * unpaidDays * 100) / 100;
}

export async function getLeaveBalanceHistory(employeeId, monthsBack = 6) {
  const res = await pool.query(
    `SELECT year, month,
            COALESCE(earned_leave_credited, earned_leave_balance, 0) AS credited,
            COALESCE(earned_leave_used, 0) AS used,
            COALESCE(balance,
              GREATEST(0, COALESCE(earned_leave_credited, earned_leave_balance, 0)
                - COALESCE(earned_leave_used, 0))) AS balance
     FROM leave_balance
     WHERE user_id = $1
     ORDER BY year DESC, month DESC
     LIMIT $2`,
    [employeeId, monthsBack]
  );
  return res.rows;
}

export async function accrueAllActiveEmployees(asOf = new Date()) {
  const users = await pool.query(
    `SELECT id FROM users WHERE role IN ('EMPLOYEE', 'MANAGER') AND status = 'active'`
  );
  const results = [];
  for (const row of users.rows) {
    try {
      const r = await accrueMonthlyLeave(row.id, asOf);
      results.push({ userId: row.id, ...r });
    } catch (e) {
      results.push({ userId: row.id, accrued: false, error: e.message });
    }
  }
  return results;
}
