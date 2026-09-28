import { pool } from './middleware/db.js';

async function checkPenaltyDays() {
  try {
    console.log('=== PENALTY DAYS FOR LEAVES (Oct/Nov 2026, Users 32 & 41) ===\n');

    const result = await pool.query(
      `
      SELECT id, user_id, from_date::text, to_date::text, requested_days, paid_days, unpaid_days,
             penalty_days, leave_category, leave_type, status
      FROM leave_requests
      WHERE user_id IN (32, 41)
        AND (
          (from_date::date >= '2026-10-01' AND from_date::date <= '2026-11-30')
        )
        AND status = 'approved'
      ORDER BY user_id, from_date
      `
    );

    console.log('Leaves:', JSON.stringify(result.rows, null, 2));

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPenaltyDays();
