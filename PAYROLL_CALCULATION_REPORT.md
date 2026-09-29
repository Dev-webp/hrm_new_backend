# Payroll Calculation Report

**Generated:** 2026-09-29  
**Purpose:** Complete documentation of payroll calculation flow, leave effects, manual editing, and risks

---

## 1. File Inventory

| File | Description |
|------|-------------|
| **Main Payroll Computation** |
| `routes/payrollService.js` | Core payroll calculation engine - fetches data, applies sandwich policy, calculates salary, persists payslips |
| **Route Files (Triggers Payroll)** |
| `routes/payrollRoutes.js` | API endpoints for payroll: generate, batch-generate, preview, list, download PDF, update status |
| **Imports in payrollService.js** |
| `utils/computedAttendanceStatus.js` | Computes attendance status from attendance records |
| `utils/breakMinutes.js` | Calculates total break minutes from break records |
| `utils/sandwichPolicy.js` | Applies sandwich policy to determine Sunday penalties |
| **Database Tables Accessed** |
| `users` | Employee data: salary, joining_date, department, branch |
| `attendance_records` | Daily attendance: check-in/out, status, late_minutes, production_hours |
| `employee_breaks` | Break records for each day |
| `company_holidays` | Holiday calendar |
| `leave_requests` | Approved leave requests (paid_days, unpaid_days, penalty_days) |
| `payslip_records` | Generated payslips storage |
| **Manual Editing** |
| None (see Section 4) |
| **Related Files (Not Direct Payroll)** |
| `routes/leaveRoutes.js` | Leave approval/rejection, syncs attendance metadata |
| `routes/attendanceRoutes.js` | Attendance editing, auto-recalculation |
| `utils/leavePolicy.js` | Leave balance management |
| `utils/attendancePolicy.js` | Attendance classification, late login evaluation |
| `utils/attendanceWithPolicy.js` | Shared attendance fetching with sandwich policy |
| `utils/activityLogger.js` | Activity logging for payroll generation |
| `routes/notificationTriggers.js` | Notification when payslip generated |

---

## 2. Payroll Calculation Flow

### Step-by-Step for a Single Payslip (User, Month)

#### Step 1: Fetch Raw Data (`fetchPayrollData`)
**Location:** `payrollService.js` lines 141-251

**Inputs fetched:**
- `users` table: id, full_name, email, department, branch, salary, employee_code, joining_date, role
- `company_holidays` table: date, name, type (extended range: previous month last day to next month first day)
- `attendance_records` table: date, status, late_minutes, check_in_time, check_out_time, production_hours, total_break_minutes, half_day_slot, leave_type, leave_status (extended range)
- `employee_breaks` table: date, break_type, start_time, end_time, duration_minutes, break3_sessions (extended range)
- `leave_requests` table: from_date, to_date, days, requested_days, leave_duration_type, leave_type, status, paid_days, unpaid_days, penalty_days, leave_category (only approved, extended range)

**Returns:** Object with employee, holidays, attendance, leaves, date ranges

#### Step 2: Build Calendar Maps with Sandwich Policy (`buildCalendarMaps`)
**Location:** `payrollService.js` lines 269-357

**Functions called:**
- Creates maps: `holidayMap`, `attMap` (attendance by date)
- Creates `approvedLeaveSet` from approved leave_requests
- Creates `halfDayLeaveMap` for half-day leave (paid/unpaid split)
- **Applies sandwich policy:** `applySandwichPolicy(sandwichData, options)` from `utils/sandwichPolicy.js`
  - Extended date range used (previous month last day to next month first day)
  - Returns `sandwichResults` (array of `{ date, applied, reason }`)
  - Returns `allowanceUsage` (Map of monthly allowance consumption)

**Returns:** Maps for holiday, attendance, leaves, plus sandwich results

#### Step 3: Tally Attendance (`tallyAttendance`)
**Location:** `payrollService.js` lines 376-453

**Function:** Iterates working days, classifies each day

**Counts:**
- `fullDays`: Full day present
- `halfDays`: Half day present
- `absentDays`: No attendance record, no approved leave
- `pendingDays`: Future dates with no record
- `formalLeaveCount`: Approved leave_requests on working days
- `lateLogins`: Check-in after 10:15
- `halfLeavePaid`: Half-day leave paid portion
- `halfLeaveUnpaid`: Half-day leave unpaid portion
- `halfLeaveAbsent`: Half-day leave where other half not worked

**Returns:** Tally object with all counts and date arrays

#### Step 4: Compute Paid Leave Eligibility (`computePaidLeave`)
**Location:** `payrollService.js` lines 493-514

**Formula:**
```
monthsCompleted = monthsBetween(joiningDate, monthStart)
eligible = monthsCompleted >= 3
allowedPaidLeave = eligible ? 1 : 0

# Half-day paid leave consumes quota first
usedByHalf = min(halfLeavePaid, allowedPaidLeave)
quotaLeft = allowedPaidLeave - usedByHalf
totalAbsences = absentDays + formalLeaveCount
paidFromAbs = min(quotaLeft, totalAbsences)

paidLeaveUsed = usedByHalf + paidFromAbs
unpaidLeaveDays = max(0, totalAbsences - paidFromAbs)
```

**Key point:** Both absences AND formal leave consume the paid leave quota. Only surplus is unpaid.

**Returns:** Eligibility status, paidLeaveUsed, unpaidLeaveDays

#### Step 5: Compute Approved Leave Split (`computeApprovedLeaveSplit`)
**Location:** `payrollService.js` lines 455-481

**Function:** Processes leave_requests table data

**Returns:**
- `paidLeaveUsed`: Sum of paid_days from leave_requests
- `unpaidLeaveDays`: Sum of unpaid_days from leave_requests
- `penaltyDays`: Sum of penalty_days from leave_requests

#### Step 6: Apply Sandwich Sundays to Unpaid Days
**Location:** `payrollService.js` lines 615-632

**Process:**
```
sandwichSundays = sandwichResults.filter(r => r.applied)
sandwichSundayCount = sandwichSundays.length

# Add to unpaidLeaveDays AFTER computePaidLeave()
# This ensures sandwich Sundays don't consume paid-leave quota
leaveCalc.unpaidLeaveDays += sandwichSundayCount

# Recalculate payableDays with sandwich Sundays included
finalPayableDays = activeDates.length - unpaidLeaveDays - (halfDays * 0.5)
```

**Sandwich Sunday entry point:** Lines 615-622 in `payrollService.js`

#### Step 7: Compute Salary (`computeSalary`)
**Location:** `payrollService.js` lines 519-569

**Formula:**
```
dailyRate = monthlySalary / totalDaysInMonth
earnedBasic = dailyRate * payableDays
absentDeduction = monthlySalary - earnedBasic
penaltyDeduction = dailyRate * penaltyDays
grossPay = earnedBasic + incentives
totalDeductions = penaltyDeduction + manualDeductions + tax
netPay = grossPay - penaltyDeduction - manualDeductions - tax
```

**Where values enter:**
- `unpaidLeaveDays`: Reduces `payableDays` → reduces `earnedBasic`
- `halfDays`: Reduces `payableDays` by 0.5 each
- `penaltyDays`: Direct deduction via `penaltyDeduction`
- `sandwichSundayCount`: Added to `unpaidLeaveDays` (Step 6)

**Returns:** salary object with dailyRate, payableDays, earnedBasic, deductions, netPay

#### Step 8: Persist Payslip (`persistPayslip`)
**Location:** `payrollService.js` lines 756-920

**Process:**
1. Check for existing payslip (FOR UPDATE lock)
2. Apply manual overrides if provided (incentives, deductions, tax)
3. Preserve existing manual adjustments if no override
4. Calculate effective values
5. Store breakdown (autoCalculated + manualAdjustments)
6. INSERT or UPDATE `payslip_records` table
7. Log activity

**Database table:** `payslip_records`
- Columns: user_id, month, basic_salary, earned_basic, incentives, deductions, tax, net_pay, working_days, present_days, payment_status, breakdown, unpaid_leave_days, leave_deduction, penalty_days, penalty_deduction

---

## 3. Leave's Effect on Payroll

| Leave Type | Reduces Payable Days? | By How Much | Read Live or Cached? | Source File/Function |
|------------|----------------------|-------------|---------------------|---------------------|
| **Paid Leave (approved)** | Yes | Consumes quota first (1 per month) | Live (from leave_requests table) | `payrollService.js` lines 455-481, 493-514 |
| **Unpaid Leave (approved)** | Yes | Full day per request | Live (from leave_requests table) | `payrollService.js` lines 455-481 |
| **Earned Leave** | Same as Paid Leave | Full day per request | Live (from leave_requests table) | `payrollService.js` lines 455-481 (if leave_category="paid") |
| **Half-Day Leave (approved)** | Yes | 0.5 day (can be paid or unpaid) | Live (from leave_requests table) | `payrollService.js` lines 279-292, 376-453 |
| **Sandwich Sunday (penalty)** | Yes | Full day | Live (from sandwich policy) | `payrollService.js` lines 615-622 |
| **Pending Leave** | No | 0 | Not used in payroll | Not included (only approved leaves) |
| **Rejected Leave** | No | 0 | Not used in payroll | Not included (only approved leaves) |

### Leave Status Change Impact

**If leave request status changes (approved → rejected or vice versa) after payslip generation:**

- **Payslip is NOT automatically affected**
- Payroll reads leave data live from `leave_requests` table at calculation time
- Once a payslip is persisted to `payslip_records`, it becomes a snapshot
- To reflect leave status changes, the payslip must be **regenerated** by calling the generate endpoint again
- The ON CONFLICT clause in `persistPayslip` (line 871) updates the existing payslip with new calculations
- **No automatic recalculation trigger** exists when leave status changes

**Code reference:** `payrollService.js` line 219 (only fetches `status = 'approved'` leaves)

---

## 4. Manual Editing

### Does Manual Editing Exist?

**Limited manual editing exists** - only for specific fields, not full payslip editing.

### Available Manual Edit Operations

| Operation | Endpoint | What Can Be Edited | Who Can Edit |
|-----------|----------|-------------------|--------------|
| Update payment status | `PUT /api/payroll/payslip/:id/status` | `payment_status` (paid/unpaid) only | SUPER_ADMIN |
| Regenerate with overrides | `POST /api/payroll/generate` | `incentives`, `deductions`, `tax` at generation time | SUPER_ADMIN |

### What Manual Editing Does NOT Support

- **No direct payslip edit endpoint** for adjusting days worked
- **No override for payableDays, unpaidLeaveDays, or attendance counts**
- **No bonus/deduction line items** beyond the three override fields
- **No audit trail for manual changes** (only activity log for generation)

### Regeneration Behavior

**When a payslip is regenerated:**

**Code path:** `payrollService.js` lines 756-804

```javascript
const existingPayslip = existingRes.rows[0] || null;
const forceManualUpdate = Boolean(
  overrides.forceManualUpdate ||
    overrides.forceManualAdjustments ||
    overrides.forceRegeneration
);
const hasNonZeroOverride = key =>
  Object.prototype.hasOwnProperty.call(overrides, key) &&
  Number(overrides[key] || 0) !== 0;
const shouldUseOverride = key =>
  forceManualUpdate || hasNonZeroOverride(key);
```

**Behavior:**
1. If `forceManualUpdate` is true → Use all override values
2. If specific override is non-zero → Use that override value
3. If no override and existing payslip exists → **Preserve existing value**
4. If no override and no existing payslip → Use calculated value

**Example:**
- Existing payslip has `incentives = 5000`
- Regenerate without providing `incentives` override
- Result: `incentives` remains 5000 (preserved)
- Regenerate with `incentives = 0` override
- Result: `incentives` becomes 0 (overridden)

**Audit trail:**
- Activity log records: who generated payslip, when, net pay, user name
- Location: `payrollRoutes.js` lines 178-191
- Function: `logPayslip` from `utils/activityLogger.js`
- **Does NOT track individual field changes** (only generation events)

### Summary

- **Manual editing exists but is limited** to incentives, deductions, tax, and payment status
- **Regeneration preserves existing manual adjustments** unless explicitly overridden
- **No full audit trail** for field-level changes
- **No UI for editing payslip details** (days, attendance, leave counts)

---

## 5. Known Gaps and Risks

### 5.1 Stale Payslip Risk

**Risk:** Payslip generated before attendance/leave changes may become stale.

**Scenarios:**
- Payslip generated, then attendance status changes (e.g., manual correction)
- Payslip generated, then leave request approved/rejected
- Payslip generated before sandwich policy was applied
- Payslip generated before extended sandwich rule (Fri+Sat+Sun) was implemented

**Impact:** Payslip reflects old data, not current state.

**Mitigation:** None currently. Requires manual regeneration by admin.

**Affected months if extended sandwich rule was applied:**
- Any month with Fri+Sat leave where Sunday was previously given allowance
- **November 2026 for user 41** confirmed to change (Nov 8 now penalized vs previously SATURDAY_ALLOWANCE)
- October 2026: No change (Oct 4, 11, 18 were already penalized)

### 5.2 Duplicate/Independent Unpaid Days Calculation

**Risk:** Unpaid days calculated outside payroll flow may not match.

**Locations:**
- Payroll calculation: `payrollService.js` lines 493-514, 615-622
- Leave approval: `leaveRoutes.js` lines 349-369 (writes attendance metadata)
- Attendance recalculation: `attendanceRoutes.js` lines 621-629 (checks for manual override)

**Current state:**
- Payroll is the **authoritative source** for salary calculation
- Leave approval writes `is_paid_leave` and `leave_type` to attendance_records for reference
- Attendance recalculation skips if manual override exists
- **No duplicate calculation** - payroll is the only place where salary is computed

**Assessment:** No duplicate calculation risk identified.

### 5.3 Extended Sandwich Rule Integration

**Status:** **Partially integrated**

**What's integrated:**
- Extended sandwich rule (Fri+Sat+Sun) is implemented in `utils/sandwichPolicy.js`
- Sandwich Sundays are added to `unpaidLeaveDays` in payroll calculation
- Line 615-622 in `payrollService.js`: `leaveCalc.unpaidLeaveDays += sandwichSundayCount`

**What's NOT integrated:**
- Late login count does NOT feed into payroll math
- Late login is only for display/logging (counted in tallyAttendance, not used in salary formula)
- Penalty days from leave_requests are used (line 599), but not late-login penalties

**Code reference:** `payrollService.js` line 638 (`penaltyDays: leaveCalc.penaltyDays || 0`) - only uses leave penalty_days, not lateLogins

### 5.4 Half-Day Leave with Attendance Status

**Risk:** Half-day leave may not correctly consume paid leave quota if attendance status is also set.

**Current implementation:**
- Half-day leave writes metadata to attendance_records (lines 362-410 in `leaveRoutes.js`)
- Does NOT set `status` field (explicitly protected)
- Payroll calculates half-day leave separately via `halfDayLeaveMap` (lines 279-292)
- Both paid and unpaid portions tracked

**Assessment:** Correctly implemented. Half-day leave quota consumption is accurate.

### 5.5 Cross-Month Sandwich Support

**Status:** **Implemented but not verified**

**Implementation:**
- Extended date range used: previous month last day to next month first day
- Lines 154-158 in `payrollService.js`
- Lines 294-304 in `payrollService.js`

**Risk:** If sandwich policy doesn't correctly handle month boundaries, payslips may be incorrect.

**Mitigation:** None currently. Requires manual verification.

### 5.6 No Automatic Payslip Recalculation Trigger

**Risk:** No automatic trigger to regenerate payslips when underlying data changes.

**Events that should trigger recalculation (but don't):**
- Leave request approved/rejected
- Attendance status changed manually
- Sandwich policy rule change
- Salary structure change

**Impact:** Requires manual admin action to regenerate payslips.

**Mitigation:** None currently.

### 5.7 Payroll Generation Before Attendance Finalization

**Risk:** Payslip generated for current month before month ends may not include future absences.

**Current behavior:**
- Payroll uses `today` parameter to exclude future dates (line 411-418 in `payrollService.js`)
- Future days marked as `pendingDays`, not counted as absent
- Payslip can be regenerated after month ends for final version

**Assessment:** Correctly handled via `pendingDays` logic.

---

## Summary

**Payroll calculation is centralized** in `payrollService.js` with clear separation of concerns:
- Data fetching
- Sandwich policy application
- Attendance tallying
- Paid leave eligibility
- Salary computation
- Persistence

**Leave effects are comprehensive** - all approved leave types are processed live from the database at calculation time.

**Manual editing is limited** - only incentives, deductions, tax, and payment status can be modified. No full payslip editing exists.

**Risks exist around stale payslips** - no automatic recalculation triggers, so data changes after payslip generation require manual regeneration.

**Extended sandwich rule is integrated** for payroll (Sunday penalties affect unpaidLeaveDays), but late login counts do not affect pay.
