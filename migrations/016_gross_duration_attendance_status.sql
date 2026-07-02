-- Attendance status now uses gross login-to-logout duration.
-- Break/lunch time remains in production_hours and break reports, but no longer decides full/half day.

UPDATE attendance_records
SET
  status = CASE
    WHEN check_in_time IS NULL OR check_out_time IS NULL THEN status
    WHEN GREATEST(
      0,
      EXTRACT(EPOCH FROM (check_out_time - GREATEST(check_in_time, TIME '10:00:00'))) / 3600.0
    ) < 4 THEN 'absent'
    WHEN check_in_time >= TIME '10:30:00' THEN 'half_day'
    WHEN check_out_time >= GREATEST(check_in_time, TIME '10:00:00') + INTERVAL '9 hours'
      AND GREATEST(
        0,
        EXTRACT(EPOCH FROM (check_out_time - GREATEST(check_in_time, TIME '10:00:00'))) / 3600.0
      ) >= 9 THEN 'full_day'
    ELSE 'half_day'
  END,
  half_day_slot = CASE
    WHEN check_in_time IS NULL OR check_out_time IS NULL THEN half_day_slot
    WHEN GREATEST(
      0,
      EXTRACT(EPOCH FROM (check_out_time - GREATEST(check_in_time, TIME '10:00:00'))) / 3600.0
    ) < 4 THEN NULL
    WHEN check_in_time >= TIME '10:30:00' THEN COALESCE(half_day_slot, 'INVALID')
    WHEN check_out_time >= GREATEST(check_in_time, TIME '10:00:00') + INTERVAL '9 hours'
      AND GREATEST(
        0,
        EXTRACT(EPOCH FROM (check_out_time - GREATEST(check_in_time, TIME '10:00:00'))) / 3600.0
      ) >= 9 THEN NULL
    ELSE COALESCE(half_day_slot, 'INVALID')
  END
WHERE check_in_time IS NOT NULL
  AND check_out_time IS NOT NULL
  AND COALESCE(status, '') NOT IN ('leave', 'holiday', 'sunday');
