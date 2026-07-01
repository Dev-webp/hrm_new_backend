-- HRMS attendance policy fix:
-- 1) late_days counts only grace late logins: > 10:00 AM and <= 10:15 AM
-- 2) after-10:15 logins remain late by minutes, but do not consume grace late count

BEGIN;

UPDATE attendance_records
SET status = CASE
    WHEN check_in_time IS NULL OR check_out_time IS NULL THEN 'absent'
    WHEN COALESCE(production_hours, 0) < 4 THEN 'absent'
    WHEN check_in_time > TIME '10:15:00' THEN 'half_day'
    WHEN check_out_time < TIME '19:00:00' THEN 'half_day'
    WHEN COALESCE(production_hours, 0) >= 8
      AND check_out_time >= TIME '19:00:00' THEN 'full_day'
    WHEN COALESCE(production_hours, 0) >= 4 THEN 'half_day'
    ELSE 'absent'
  END,
  half_day_slot = CASE
    WHEN check_in_time IS NULL OR check_out_time IS NULL THEN NULL
    WHEN COALESCE(production_hours, 0) < 4 THEN NULL
    WHEN check_in_time > TIME '10:15:00' THEN COALESCE(half_day_slot, 'INVALID')
    WHEN check_out_time < TIME '19:00:00' THEN COALESCE(half_day_slot, 'INVALID')
    WHEN COALESCE(production_hours, 0) >= 4
      AND NOT (COALESCE(production_hours, 0) >= 8 AND check_out_time >= TIME '19:00:00') THEN COALESCE(half_day_slot, 'INVALID')
    ELSE NULL
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(leave_status, '') != 'approved'
  AND COALESCE(status, '') NOT IN ('leave', 'holiday');

DROP MATERIALIZED VIEW IF EXISTS mv_monthly_attendance;

CREATE MATERIALIZED VIEW mv_monthly_attendance AS
SELECT
  u.id AS user_id,
  u.full_name,
  u.department,
  u.branch,
  DATE_TRUNC('month', a.date::timestamp)::date AS month_start,
  COUNT(*) FILTER (WHERE a.status = 'full_day')::int AS full_days,
  COUNT(*) FILTER (WHERE a.status = 'half_day')::int AS half_days,
  COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent_days,
  COUNT(*) FILTER (
    WHERE a.check_in_time > TIME '10:00:00'
      AND a.check_in_time <= TIME '10:15:00'
      AND a.check_out_time IS NOT NULL
  )::int AS late_days,
  COALESCE(ROUND(AVG(a.total_break_minutes))::numeric, 0)::int AS avg_break_mins,
  COUNT(*) FILTER (WHERE COALESCE(a.total_break_minutes, 0) > 90)::int AS break_exceeded_days,
  COALESCE(SUM(a.production_hours), 0)::numeric AS total_production_hours
FROM attendance_records a
JOIN users u ON u.id = a.user_id
WHERE u.role NOT IN ('SUPER_ADMIN')
GROUP BY
  u.id,
  u.full_name,
  u.department,
  u.branch,
  DATE_TRUNC('month', a.date::timestamp)::date;

CREATE UNIQUE INDEX IF NOT EXISTS mv_monthly_attendance_user_month_idx
  ON mv_monthly_attendance (user_id, month_start);

CREATE INDEX IF NOT EXISTS idx_mv_branch_month
  ON mv_monthly_attendance (branch, month_start);

CREATE INDEX IF NOT EXISTS idx_mv_dept_month
  ON mv_monthly_attendance (department, month_start);

REFRESH MATERIALIZED VIEW mv_monthly_attendance;

COMMIT;
