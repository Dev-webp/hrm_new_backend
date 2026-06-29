UPDATE attendance_records
SET
  status = 'half_day',
  half_day_slot = 'SLOT_B',
  updated_at = CURRENT_TIMESTAMP
WHERE check_in_time > TIME '10:15:00'
  AND check_in_time <= TIME '14:30:00'
  AND check_out_time >= TIME '18:30:00'
  AND COALESCE(production_hours, 0) >= 4
  AND COALESCE(status, '') NOT IN ('leave', 'holiday');

UPDATE attendance_records
SET
  status = 'absent',
  half_day_slot = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE check_in_time IS NOT NULL
  AND check_out_time IS NOT NULL
  AND COALESCE(status, '') NOT IN ('leave', 'holiday')
  AND (
    (check_in_time > TIME '10:00:00' AND check_out_time <= TIME '14:30:00')
    OR check_in_time > TIME '14:30:00'
    OR (check_in_time > TIME '10:00:00' AND check_in_time <= TIME '14:30:00' AND check_out_time < TIME '18:30:00')
  );

REFRESH MATERIALIZED VIEW mv_monthly_attendance;
