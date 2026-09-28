# Endpoint Sandwich Metadata Audit

## Purpose
Audit which calendar endpoints return sandwich metadata (`applied`, `reason` fields) to determine if frontend refactoring is feasible.

## Endpoints Checked

### 1. `/attendance/self/history` (EmployeeAttendance.jsx)
**Location:** `attendanceRoutes.js` line 1775
**Sandwich Policy:** ✅ APPLIED
**Synthetic Rows:** ✅ Only for Sundays with `applied: true`
**Metadata:** ✅ Each row includes `sandwich: [{ date, applied, reason }]`

**Example Response:**
```json
{
  "date": "2026-10-04",
  "status": "sunday",
  "sandwich": [
    {
      "date": "2026-10-04",
      "applied": true,
      "reason": "TWO_SIDED_NON_WORKING"
    }
  ]
}
```

### 2. `/attendance/range/summary` (ManagerCalendar.jsx)
**Location:** `attendanceRoutes.js` line 2434
**Sandwich Policy:** ✅ APPLIED (lines 2546-2595)
**Synthetic Rows:** ❌ N/A (returns aggregated summary, not per-user records)
**Metadata:** ✅ Each summary item includes `sandwich: [{ user_id, reason }]`

**Example Response:**
```json
{
  "date": "2026-10-04",
  "present": 0,
  "halfDay": 0,
  "absent": 0,
  "leave": 0,
  "late": 0,
  "total": 10,
  "sandwich": [
    {
      "user_id": 41,
      "reason": "TWO_SIDED_NON_WORKING"
    }
  ]
}
```

**Issue:** This endpoint returns AGGREGATED data for the entire branch, not per-user records. ManagerCalendar needs per-user sandwich data to show individual employee sandwich status.

### 3. `/attendance/user/:userId` (AdminCalendar.jsx)
**Location:** `attendanceRoutes.js` line 4078
**Sandwich Policy:** ❌ NOT APPLIED
**Synthetic Rows:** ❌ None
**Metadata:** ❌ No sandwich metadata

**Current Behavior:** Merges attendance_records with approved leave_requests but does NOT apply sandwich policy.

## Findings

| Endpoint | Component | Sandwich Policy | Per-User Metadata | Status |
|----------|-----------|------------------|-------------------|--------|
| `/attendance/self/history` | EmployeeAttendance | ✅ Yes | ✅ Yes | ✅ Ready |
| `/attendance/range/summary` | ManagerCalendar | ✅ Yes | ❌ No (aggregated) | ⚠️ Incomplete |
| `/attendance/user/:userId` | AdminCalendar | ❌ No | ❌ No | ❌ Missing |

## Required Backend Changes

### 1. Add Sandwich Policy to `/attendance/user/:userId`
**Endpoint:** `attendanceRoutes.js` line 4078
**Changes Needed:**
- Fetch user's joining_date
- Fetch approved leave requests for the user
- Build attendance map
- Apply `applySandwichPolicy()` with leaves parameter
- Add synthetic rows for Sundays with `applied: true`
- Include `sandwich` metadata in each row

### 2. ManagerCalendar Endpoint Issue
**Problem:** `/attendance/range/summary` returns aggregated data, not per-user records with sandwich metadata.

**Options:**
- **Option A:** Keep using `/attendance/range/summary` for aggregated stats, but add a new endpoint `/attendance/range/summary/user/:userId` for per-user calendar view
- **Option B:** Have ManagerCalendar call `/attendance/user/:userId` for each employee (would require many API calls)
- **Option C:** Modify `/attendance/range/summary` to return per-user records instead of aggregated counts (breaking change)

**Recommendation:** Option A - Add a new endpoint that mirrors `/attendance/self/history` but is authorized for admin/manager roles.

## Counter Consistency Check

### EmployeeAttendance
- Source: `/attendance/self/history` response
- Counting: Counts rows with `sandwich.applied === true`
- ✅ Uses backend sandwich metadata

### ManagerCalendar
- Source: `/attendance/range/summary` response
- Counting: Currently counts from summary stats
- ⚠️ Summary has `sandwich` array but it's aggregated by date, not per-user
- ⚠️ Cannot show per-user sandwich badges without per-user data

### AdminCalendar
- Source: `/attendance/user/:userId` response
- Counting: Custom logic in component
- ❌ No sandwich metadata available from backend

## Conclusion

**Before frontend refactoring:**
1. Add sandwich policy to `/attendance/user/:userId` endpoint
2. Add a new endpoint for ManagerCalendar to fetch per-user calendar data with sandwich metadata (or reuse an existing one with proper authorization)
3. Ensure all three endpoints return consistent sandwich metadata structure: `sandwich: [{ date, applied, reason }]`

**After backend changes:**
1. Create shared `utils/sundaySandwich.js` helper
2. Create shared `SundayBadge` component
3. Update all three calendar components to use shared helper
4. Ensure all counters use backend sandwich metadata, not frontend computation
