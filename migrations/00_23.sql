   ALTER TABLE attendance_records
   ADD COLUMN needs_leave_reconciliation BOOLEAN DEFAULT false;

   ALTER TABLE attendance_records
   ADD COLUMN leave_reconciliation_status TEXT DEFAULT NULL;


   UPDATE attendance_records
SET status = CASE
    WHEN half_day_slot IS NOT NULL THEN 'half_day'
    WHEN is_paid_leave = true THEN 'paid_leave'
    ELSE 'unpaid_leave'
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE leave_status = 'approved'
  AND leave_type IS NOT NULL
  AND status NOT IN ('half_day', 'paid_leave', 'unpaid_leave');