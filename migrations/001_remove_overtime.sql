-- VJC Overseas HRMS — Remove overtime tracking (no OT policy)
-- Run against PostgreSQL: psql -U <user> -d <database> -f 001_remove_overtime.sql

BEGIN;

-- ── 1. Drop materialized view that may reference overtime_hours / total_overtime ──
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_attendance;

-- ── 2. Remove column from daily attendance records ──
ALTER TABLE attendance_records
  DROP COLUMN IF EXISTS overtime_hours;

-- ── 3. Recreate monthly summary view (without total_overtime) ──
-- Columns match analysisRoutes.js + dashboardRoutes.js expectations.
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
  COUNT(*) FILTER (WHERE a.late_minutes > 0)::int AS late_days,
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

REFRESH MATERIALIZED VIEW mv_monthly_attendance;

COMMIT;
