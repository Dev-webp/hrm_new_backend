# Endpoint Sandwich Metadata Audit - UPDATED

## Purpose
Audit which calendar endpoints return sandwich metadata (`applied`, `reason` fields) to determine if frontend refactoring is feasible.

## Changes Made

### 1. Created Shared Service Function
**File:** `backend/utils/attendanceWithPolicy.js`
**Function:** `getAttendanceWithPolicy(userId, fromDate, toDate)`

This function:
- Fetches attendance records for the user
- Fetches user's joining_date
- Fetches approved leave requests
- Fetches holidays for the date range
- Applies `applySandwichPolicy()` with leaves parameter
- Adds synthetic rows for Sundays with `applied: true`
- Returns `{ rows, sandwich, summary }`

### 2. Extended Sunday Rule Implemented
**File:** `backend/utils/sandwichPolicy.js`
**New Rule:** Fri+Sat+Sun pattern

A Sunday is penalized when:
- Leave runs Fri + Sat (both non-working), OR
- The nearest working days on both sides are non-working (Sat+Sun+Mon pattern)

**New Reason Codes:**
- `FRI_SAT_SUN_NON_WORKING` - Fri + Sat + Sun all non-working
- `FRI_SAT_PATTERN_NO_ALLOWANCE` - Saturday allowance not consumed for Fri+Sat pattern

### 3. Refactored Endpoints

#### `/attendance/self/history` (EmployeeAttendance.jsx)
**Location:** `attendanceRoutes.js` line 1776
**Status:** ✅ Refactored to use `getAttendanceWithPolicy()`
**Response Shape:** Unchanged
**Sandwich Policy:** ✅ Applied via shared function
**Metadata:** ✅ Each row includes `sandwich: [{ date, applied, reason }]`

#### `/attendance/user/:userId` (AdminCalendar.jsx)
**Location:** `attendanceRoutes.js` line 3966
**Status:** ✅ Refactored to use `getAttendanceWithPolicy()`
**Response Shape:** Now includes sandwich metadata
**Sandwich Policy:** ✅ Applied via shared function
**Metadata:** ✅ Each row includes `sandwich: [{ date, applied, reason }]`

#### `/attendance/range/summary/user/:userId` (NEW)
**Location:** `attendanceRoutes.js` line 3998
**Authorization:** SUPER_ADMIN, OPERATIONAL_MANAGER, MANAGER
**Branch Restriction:** Managers can only access users in their own branch
**Response Shape:** `{ rows, summary }`
**Sandwich Policy:** ✅ Applied via shared function
**Metadata:** ✅ Each row includes `sandwich: [{ date, applied, reason }]`

#### `/attendance/range/summary` (ManagerCalendar.jsx)
**Location:** `attendanceRoutes.js` line 2434
**Status:** ⚠️ Unchanged (still returns aggregated data)
**Note:** This endpoint is for branch-wide summary, not per-user calendar

## Endpoint Comparison Test Results

**Test:** User 41, October 2026
```
Total rows: 9
Oct 4: applied: true, reason: TWO_SIDED_NON_WORKING ✅
```

**Test:** User 41, November 2026
```
Total rows: 4
Nov 8: applied: true, reason: FRI_SAT_SUN_NON_WORKING ✅
```

**Note:** Nov 8 is NOW penalized due to the new Fri+Sat+Sun rule (Nov 6-7 leave). Previously it was not penalized (SATURDAY_ALLOWANCE) because only Saturday leave existed.

## Findings

| Endpoint | Component | Sandwich Policy | Per-User Metadata | Status |
|----------|-----------|------------------|-------------------|--------|
| `/attendance/self/history` | EmployeeAttendance | ✅ Yes (shared) | ✅ Yes | ✅ Ready |
| `/attendance/range/summary/user/:userId` | ManagerCalendar | ✅ Yes (shared) | ✅ Yes | ✅ Ready |
| `/attendance/user/:userId` | AdminCalendar | ✅ Yes (shared) | ✅ Yes | ✅ Ready |
| `/attendance/range/summary` | ManagerCalendar (branch) | ✅ Yes (aggregated) | ❌ No | ⚠️ Unchanged |

## Response Structure Consistency

All three per-user endpoints now return identical structure:
```json
[
  {
    "date": "2026-10-04",
    "status": "sunday",
    "check_in_time": null,
    "check_out_time": null,
    "late_minutes": 0,
    "production_hours": 0,
    "total_break_minutes": 0,
    "half_day_slot": null,
    "leave_type": null,
    "leave_status": null,
    "sandwich": [
      {
        "date": "2026-10-04",
        "applied": true,
        "reason": "TWO_SIDED_NON_WORKING"
      }
    ]
  }
]
```

## New Endpoint for ManagerCalendar

**Endpoint:** `GET /api/attendance/range/summary/user/:userId?start=&end=`
**Authorization:** SUPER_ADMIN, OPERATIONAL_MANAGER, MANAGER
**Branch Restriction:** Managers can only access users in their own branch
**Response:** `{ rows: [...], summary: { present, absent, late, halfDay, leave, sandwichPenaltyCount, total } }`

This endpoint provides per-user calendar data with sandwich metadata for ManagerCalendar to display individual employee sandwich status.

## Next Steps

**Frontend Refactoring:**
1. Create shared `utils/sundaySandwich.js` helper
2. Create shared `SundayBadge` component
3. Update EmployeeAttendance.jsx to use shared helper
4. Update ManagerCalendar.jsx to use new endpoint `/attendance/range/summary/user/:userId` and shared helper
5. Update AdminCalendar.jsx to use shared helper
6. Ensure all counters use backend sandwich metadata from `summary.sandwichPenaltyCount`

**Files Changed:**
- `backend/utils/attendanceWithPolicy.js` (NEW)
- `backend/utils/sandwichPolicy.js` (extended rule)
- `backend/routes/attendanceRoutes.js` (3 endpoints refactored, 1 new endpoint)
- `backend/test_endpoint_consistency.js` (NEW - test script)

