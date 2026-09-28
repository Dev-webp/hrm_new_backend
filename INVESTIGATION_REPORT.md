# Investigation Report: Sandwich Policy and Date Handling

## Investigation 1: Actual Stored Dates for Leave 310

**Query:**
```sql
SELECT id, user_id, from_date::text, to_date::text, from_date, to_date, leave_type, status, requested_days
FROM leave_requests WHERE id = 310;
```

**Result:**
- `from_date::text`: `2026-10-03`
- `to_date::text`: `2026-10-05`
- `from_date` (as string after setTypeParser): `2026-10-03`
- `to_date` (as string after setTypeParser): `2026-10-05`

**Attendance Records for Leave 310:**
- Oct 3: `unpaid_leave` (Saturday - correct)
- Oct 5: `unpaid_leave` (Monday - correct)
- Oct 4: No record (Sunday - correctly skipped by leave sync)

**Conclusion:** Leave sync is working correctly. The dates are stored as `2026-10-03` to `2026-10-05` in the database, and attendance records are created on the correct days (Saturday and Monday, skipping Sunday).

## Investigation 2: Leave 307 vs Leave 310 Comparison

**Leave 307 (User 32):**
- `from_date::text`: `2026-10-10`
- `to_date::text`: `2026-10-12`
- Attendance records: Oct 10 and Oct 12 (Sunday Oct 11 correctly skipped)

**Leave 310 (User 41):**
- `from_date::text`: `2026-10-03`
- `to_date::text`: `2026-10-05`
- Attendance records: Oct 3 and Oct 5 (Sunday Oct 4 correctly skipped)

**Conclusion:** Both leave syncs are working correctly. There is no off-by-one error in the sync loop. The earlier log output showing `2026-10-02T18:30:00.000Z` was from the pg driver's default behavior BEFORE `setTypeParser(1082, v => v)` was applied.

## Investigation 3: Date Column Audit After setTypeParser

**Configuration Applied:**
```javascript
pg.types.setTypeParser(1082, v => v);
```

**Effect:** PostgreSQL DATE columns are now returned as strings (e.g., `2026-10-03`) instead of JavaScript Date objects with UTC conversion.

**Files with Date Operations (24 files identified):**
1. `routes/attendanceRoutes.js` - 11 matches
2. `routes/payrollService.js` - 10 matches
3. `utils/dateHelper.js` - 1 match
4. `routes/leaveRoutes.js` - 10 matches
5. `routes/employeeSelfRoutes.js` - 3 matches
6. `routes/analysisRoutes.js` - 2 matches
7. `routes/managerRoutes.js` - 1 match
8. `utils/leavePolicy.js` - 3 matches
9. `utils/attendancePolicy.js` - 1 match
10. `server.js` - 2 matches
11. `utils/leaveRequestPolicy.js` - 2 matches
12. `services/adminDashboardAttendanceService.js` - 2 matches
13. `services/leaveAccrualService.js` - 1 match
14. `services/attendanceAnalysisService.js` - 2 matches
15. `controllers/offerLetterController.js` - 1 match
16. `routes/employeeRoutes.js` - 1 match
17. `controllers/letterController.js` - 1 match
18. `services/offerLetterService.js` - 1 match
19. `routes/holidays.js` - 3 matches
20. `services/leaveAccrualPure.js` - 1 match
21. Plus scratch scripts

**Test Suite Status:** The sandwich test suite (`backend/test/sandwich.test.js`) passes with 13/13 tests after the parser configuration.

**Risk Assessment:** Some uses of `.toISOString()` are intentional (e.g., creating timestamps for new Date objects). A blind replacement across all 18+ files is NOT recommended. Each usage should be reviewed individually.

## Investigation 4: Leave Sync Day Count Rule

**Current Rule:**
- Leave sync counts ALL days in the date range (from_date to_date) for `requested_days`
- It creates attendance records ONLY on working days (skipping Sundays and holidays)
- This means `requested_days` may be higher than the actual number of attendance records created

**Example:** Leave from Oct 3 (Saturday) to Oct 5 (Monday):
- `requested_days`: 3 days (Sat, Sun, Mon)
- Attendance records created: 2 days (Sat, Mon - Sunday skipped)

**Recommendation:** Do not change this rule. The discrepancy is expected behavior.

## Investigation 5: Layer 2 Payroll Verification

**Test Script:** `backend/scratch_payroll_layer2.js`

**Results (identical across TZ=UTC, TZ=Asia/Kolkata, and default):**

### October 2026, User 32, Sandwich OFF
- pendingDays: 21 ✅
- absentDays: 0 ✅
- formalLeaveCount: 4 ✅ (Oct 1, 3, 10, 12)
- unpaidLeaveDays: 3 ✅
- paidLeaveUsed: 1 ✅
- payableDays: 28 ✅
- netPay: 9032.24 ✅
- Sandwich dates: [] ✅

### October 2026, User 32, Sandwich ON
- pendingDays: 21 ✅
- absentDays: 0 ✅
- formalLeaveCount: 4 ✅
- unpaidLeaveDays: 4 ✅ (+1 from OFF)
- paidLeaveUsed: 1 ✅ (identical to OFF)
- payableDays: 27 ✅ (-1 from OFF)
- netPay: 8709.66 ✅ (-322.58 = 1 daily rate)
- Sandwich dates: Oct 11 with TWO_SIDED_NON_WORKING ✅

### November 2026, User 32, Sandwich ON
- pendingDays: 19 ✅
- absentDays: 0 ✅
- formalLeaveCount: 5 ✅
- unpaidLeaveDays: 5 ✅
- paidLeaveUsed: 1 ✅
- payableDays: 25 ✅
- netPay: 8333.25 ✅
- Sandwich dates: Nov 8 with TWO_SIDED_NON_WORKING ✅

**Timezone Invariance:** ✅ VERIFIED - Results are identical across all three timezone settings.

## Layer 3: Calendar Endpoint Fix

**Endpoint:** `/attendance/self/history`

**Changes Made:**
1. Added approved leave query to the endpoint
2. Built `allDates` from the full date range (not just dates with attendance records)
3. Passed `leaves` to `applySandwichPolicy()`
4. Added synthetic rows for dates without attendance records but with sandwich results

**Frontend:**
- `calendarStatusColors.js` already has `sandwich_absent` status and "Absent (Sandwich)" label
- The status check is already implemented to return `sandwich_absent` when `record.sandwich` has `applied: true`

**Expected UI Behavior:**
- User 41, October 2026: Oct 4 should now show "Absent (Sandwich)"
- User 32, October 2026: Oct 11 should show "Absent (Sandwich)"
- User 32, November 2026: Nov 8 should show "Absent (Sandwich)"

## Summary

| Item | Status | Notes |
|------|--------|-------|
| Leave 310 dates | ✅ Correct | Stored as Oct 3-5, attendance on correct days |
| Leave sync logic | ✅ Correct | Sundays and holidays properly skipped |
| setTypeParser(1082) | ✅ Applied | DATE columns now strings |
| Date audit | ⚠️ Partial | 24 files identified, need individual review |
| Leave day count rule | ✅ Documented | No change needed |
| Layer 2 payroll | ✅ PASS | All expected values match, timezone invariant |
| Layer 3 calendar | ✅ Fixed | Endpoint updated with leave data and full date range |

## SQL Repair Queries

**File:** `backend/LEAVE_SYNC_REPAIR_SQL.md`

**Status:** Queries are ready but NOT executed. Waiting for explicit approval before any database write.

**Queries include:**
1. Delete incorrect attendance records (if any)
2. Create correct attendance records (if any)
3. List all attendance records on Sundays, holidays, or outside leave ranges

**Current State:** Based on the investigation, leave 310's attendance records are CORRECT and do not need repair. The SQL queries are provided for reference only.
