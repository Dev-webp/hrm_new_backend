# SQL Repair Queries for Leave 310

## 1. Delete Incorrect Attendance Records for Leave 310

These records were created on a holiday and a Sunday, which should be skipped in leave sync:

```sql
-- Delete the incorrect attendance record on Oct 2 (Gandhi Jayanti holiday)
DELETE FROM attendance_records 
WHERE leave_request_id = 310 
  AND date = '2026-10-02';

-- Delete the incorrect attendance record on Oct 4 (Sunday)
DELETE FROM attendance_records 
WHERE leave_request_id = 310 
  AND date = '2026-10-04';
```

## 2. Create Correct Attendance Records for Leave 310

Create attendance records on the actual leave days (Oct 3 Saturday and Oct 5 Monday):

```sql
-- Create attendance record for Oct 3 (Saturday) - actual leave day
INSERT INTO attendance_records (
  user_id, 
  date, 
  status, 
  leave_type, 
  leave_status, 
  leave_request_id, 
  has_punch, 
  check_in_time, 
  check_out_time, 
  late_minutes, 
  production_hours, 
  total_break_minutes, 
  half_day_slot, 
  post_login_idle_minutes, 
  misuse_of_time
) VALUES (
  41, 
  '2026-10-03', 
  'unpaid_leave', 
  'unpaid_leave', 
  'approved', 
  310, 
  false, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL
);

-- Create attendance record for Oct 5 (Monday) - actual leave day
INSERT INTO attendance_records (
  user_id, 
  date, 
  status, 
  leave_type, 
  leave_status, 
  leave_request_id, 
  has_punch, 
  check_in_time, 
  check_out_time, 
  late_minutes, 
  production_hours, 
  total_break_minutes, 
  half_day_slot, 
  post_login_idle_minutes, 
  misuse_of_time
) VALUES (
  41, 
  '2026-10-05', 
  'unpaid_leave', 
  'unpaid_leave', 
  'approved', 
  310, 
  false, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL, 
  NULL
);
```

## 3. Query to List All Attendance Records Outside Their Leave Range or on Sundays

This query identifies potentially incorrect attendance records that were created by leave sync:

```sql
-- Find attendance records on Sundays (created by leave sync)
SELECT ar.id, ar.user_id, ar.date, ar.status, ar.leave_request_id, lr.from_date, lr.to_date
FROM attendance_records ar
LEFT JOIN leave_requests lr ON ar.leave_request_id = lr.id
WHERE EXTRACT(DOW FROM ar.date) = 0  -- Sunday
  AND ar.leave_request_id IS NOT NULL
ORDER BY ar.date, ar.user_id;

-- Find attendance records on holidays (created by leave sync)
SELECT ar.id, ar.user_id, ar.date, ar.status, ar.leave_request_id, lr.from_date, lr.to_date, ch.name
FROM attendance_records ar
LEFT JOIN leave_requests lr ON ar.leave_request_id = lr.id
LEFT JOIN company_holidays ch ON ar.date = ch.date
WHERE ar.leave_request_id IS NOT NULL
  AND ch.date IS NOT NULL
ORDER BY ar.date, ar.user_id;

-- Find attendance records outside their leave date range
SELECT ar.id, ar.user_id, ar.date, ar.status, ar.leave_request_id, lr.from_date, lr.to_date
FROM attendance_records ar
LEFT JOIN leave_requests lr ON ar.leave_request_id = lr.id
WHERE ar.leave_request_id IS NOT NULL
  AND (ar.date < lr.from_date OR ar.date > lr.to_date)
ORDER BY ar.date, ar.user_id;
```

## 4. Leave Sync Day Count Behavior

**Current behavior:** The leave sync counts ALL days in the date range (from_date to_date), including Sundays and holidays that are skipped when creating attendance records.

**Issue:** This means `requested_days` may be higher than the actual number of attendance records created.

**Fix needed:** The leave sync should:
1. Count only working days when creating attendance records
2. Update `requested_days` to match the actual number of attendance records created
3. Or, report the discrepancy between requested days and actual records created

## Verification

After running the repair SQL, verify:
1. User 41's October calendar shows:
   - Oct 3: Unpaid Leave
   - Oct 4: Absent (Sandwich) - TWO_SIDED_NON_WORKING
   - Oct 5: Unpaid Leave
2. No attendance records exist on Oct 2 (holiday) or Oct 4 (Sunday) for leave 310
3. All other leave-synced records are verified for correctness
