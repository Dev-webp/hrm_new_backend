-- Clear status for existing half-day leave records
-- This will allow the computed status to determine the final status based on actual attendance
UPDATE attendance_records
SET status = NULL
WHERE half_day_slot IS NOT NULL
  AND half_day_slot != 'INVALID'
  AND leave_status = 'approved'
  AND (check_in_time IS NULL OR check_out_time IS NULL);

-- Verify the update
SELECT 
  date,
  status,
  check_in_time,
  check_out_time,
  half_day_slot,
  leave_type,
  is_paid_leave,
  leave_request_id
FROM attendance_records
WHERE half_day_slot IS NOT NULL
  AND half_day_slot != 'INVALID'
  AND leave_status = 'approved'
ORDER BY date DESC;
