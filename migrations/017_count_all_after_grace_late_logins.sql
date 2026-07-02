-- Late-login count is independent from attendance status.
-- Any check-in at or after 10:15 AM counts as late, including 10:30+ half-day eligible logins.

UPDATE policy_config
SET config_value = '10:15:00',
    description = 'Late-login count starts at this time and has no end cutoff'
WHERE config_key = 'late_login_grace_time';

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
  COUNT(*) FILTER (WHERE a.check_in_time >= TIME '10:15:00')::int AS late_days,
  COALESCE(ROUND(AVG(a.total_break_minutes))::numeric, 0)::int AS avg_break_mins,
  COUNT(*) FILTER (WHERE COALESCE(a.total_break_minutes, 0) > 60)::int AS break_exceeded_days,
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
