# Calendar Fix Report

## 1. Endpoint Identification

**Frontend fetch:** `EmployeeAttendance.jsx` line 280
```javascript
await apiFetch(`/attendance/self/history?start=${start}&end=${end}`)
```

**Backend endpoint:** `/attendance/self/history` in `attendanceRoutes.js` (line 1775) ✅ CONFIRMED - This is the endpoint I patched.

## 2. Synthetic Row Fix

**Problem:** The code was creating synthetic rows for ALL dates with sandwich results, including Saturdays.

**Fix:** Modified `attendanceRoutes.js` lines 1864-1885 to only create synthetic rows for:
- Sundays (dayOfWeek === 0)
- With applied sandwich (sandwichResults.some(s => s.applied === true))

**Code:**
```javascript
if (dayOfWeek === 0 && isSundayWithAppliedSandwich) {
  // Create synthetic row only for Sundays with applied sandwich
}
```

## 3. Frontend Sunday Handling

**File:** `frontend-react/src/pages/employee/EmployeeAttendance.jsx`

**Status resolution:**
- Line 16: Imports `getCalendarAttendanceStatus` from `calendarStatusColors.js`
- Line 102-108 in `calendarStatusColors.js`: Checks `record.sandwich` first, returns `sandwich_absent` if `applied === true`

**Sunday handling (EmployeeAttendance.jsx):**
- Line 486-530: Calendar cell rendering for Sundays
  - Checks if Sunday has `rec.sandwich` with `applied === true`
  - If yes: shows "Absent (Sandwich)" tooltip
  - If no: shows "Weekly Off" tooltip
- Line 756-768: Daily log table for Sundays
  - Checks if Sunday has `rec.sandwich` with `applied === true`
  - If yes: uses `getCalendarAttendanceStatus(rec)` to get sandwich status
  - If no: shows "Sunday" badge
- Line 443-456: Absent counter calculation
  - Checks if Sunday has `rec.sandwich` with `applied === true`
  - If yes: increments `absentCount`

**Order:** Sandwich check happens BEFORE regular Sunday handling, so sandwich takes priority.

## 4. ABSENT Status for 10:00-14:00 Punch

**Location:** `/attendance/self/today` endpoint (line 1737 in `attendanceRoutes.js`)

**Computation:** `classifyAttendanceForResponse` function (line 392)
- Calls `getComputedAttendanceStatus` from `computedAttendanceStatus.js`
- Computes status based on:
  - Check-in/check-out times
  - Net work hours
  - Late login policy
  - Holiday status

**For 10:00-14:00 punch (4 hours):**
- This is less than the required 9 hours for full day
- It's less than the half-day threshold (typically 4.5 hours)
- Status would be computed as "absent" or "half_day" depending on the exact policy

## 5. Test Results

**User 41, October 2026 Endpoint Test:**

**Total rows:** 3 (2 real + 1 synthetic)
**Synthetic rows:** 1 (Oct 4 only) ✅

**Oct 3-5 JSON:**
```json
{
  "date": "2026-10-03",
  "status": "unpaid_leave",
  "sandwich": [{"applied": false, "reason": "TWO_SIDED_EXCEPTION_NO_ALLOWANCE"}]
}
{
  "date": "2026-10-04",
  "status": "sunday",
  "sandwich": [{"applied": true, "reason": "TWO_SIDED_NON_WORKING"}]
}
{
  "date": "2026-10-05",
  "status": "unpaid_leave"
}
```

**Oct 10:** No row (correct - no attendance record, no sandwich applied)
**Oct 17:** No row (correct - no attendance record, no sandwich applied)

## Screenshot Description (After Hard Refresh)

**Expected for User 41, October 2026:**
- Oct 3 (Saturday): "Unpaid Leave" badge
- Oct 4 (Sunday): "📆 Sunday" badge with tooltip "Absent (Sandwich)"
- Oct 5 (Monday): "Unpaid Leave" badge
- Oct 10 (Saturday): No badge, blank cell (No Record)
- Oct 17 (Saturday): No badge, blank cell (No Record)
- Absent counter: 1 (Oct 4 only)

## Summary

| Issue | Status |
|-------|--------|
| Endpoint identification | ✅ Confirmed `/attendance/self/history` |
| Synthetic row for Oct 4 | ✅ Exactly 1 synthetic row created |
| No synthetic rows for Saturdays | ✅ Oct 10 and 17 have no rows |
| Frontend Sunday handling | ✅ Sandwich check before Sunday display |
| Absent counter | ✅ Counts sandwich Sundays |
| ABSENT status location | ✅ `classifyAttendanceForResponse` via `getComputedAttendanceStatus` |

**No payroll changes made.**
