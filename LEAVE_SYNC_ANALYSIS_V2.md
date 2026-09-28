# Leave Sync Analysis - Corrected

## Investigation 1: Actual Stored Dates

### Leave 310 (User 41)
- **from_date::text:** `2026-10-03`
- **to_date::text:** `2026-10-05`
- **Attendance records:** Oct 3 and Oct 5 (Sunday Oct 4 correctly skipped)

### Leave 307 (User 32)
- **from_date::text:** `2026-10-10`
- **to_date::text:** `2026-10-12`
- **Attendance records:** Oct 10 and Oct 12 (Sunday Oct 11 correctly skipped)

## Conclusion

**Both leave syncs are WORKING CORRECTLY.** The attendance records are on the correct dates, and Sundays are being skipped properly.

## The Real Issue

The issue is NOT with leave sync. The issue is that the **sandwich policy is not being applied to the calendar** for user 41.

When a user takes leave on Saturday and Monday:
- Saturday: Unpaid Leave ✓
- Sunday: Should show "Absent (Sandwich)" ✗ (currently shows "Sunday / Weekly Off")
- Monday: Unpaid Leave ✓

The leave sync correctly skips Sunday, but the sandwich policy should mark Sunday as absent. This is a calendar/sandwich policy issue, not a leave sync issue.

## Log Output Discrepancy

The earlier log output showed:
```
from_date: 2026-10-02T18:30:00.000Z
to_date: 2026-10-04T18:30:00.000Z
```

This was from the raw pg driver output BEFORE `setTypeParser(1082, v => v)` was applied. After the parser was configured, the dates are correctly returned as strings.

## Next Steps

1. Verify sandwich policy is being applied to `/attendance/self/history` endpoint for user 41
2. Check if the calendar for user 41 has any leave records that would trigger sandwich processing
3. Ensure the frontend is using the sandwich metadata from the API response
