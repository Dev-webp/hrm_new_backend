UPDATE attendance_records
SET late_minutes = GREATEST(
  0,
  FLOOR(EXTRACT(EPOCH FROM (check_in_time - TIME '10:00:00')) / 60)
)::int
WHERE check_in_time IS NOT NULL;

REFRESH MATERIALIZED VIEW mv_monthly_attendance;
