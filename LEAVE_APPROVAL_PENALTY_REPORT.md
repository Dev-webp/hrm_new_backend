# Leave-Approval Penalty vs Sandwich Policy Report

## Overview

The HRMS has **TWO SEPARATE MECHANISMS** for handling Saturday/Monday absences:

1. **Leave-Approval Penalty** (`leavePolicy.js`) - Applies at leave approval time
2. **Sandwich Policy** (`sandwichPolicy.js`) - Applies at payroll calculation time

## Leave-Approval Penalty (Existing Mechanism)

### Location
- File: `backend/utils/leavePolicy.js`
- Function: `evaluateLeaveOnApproval()`
- Constants: `SAT_MON_LIMIT_PER_MONTH = 1`

### Logic
```javascript
export function evaluateLeaveOnApproval(leave, monthSatMonLeaves = [], policyConfig = {}) {
  const satMonLimit = policyConfig.satMonLimit ?? SAT_MON_LIMIT_PER_MONTH; // Default: 1
  
  const isSatMon = isSaturdayOrMondayLeaveDay(fromDate);
  
  const satMonUsed = monthSatMonLeaves.filter((l) => {
    return l.id !== leave.id && isSaturdayOrMondayLeaveDay(l.from_date);
  }).length;
  
  const satMonExceeded = isSatMon && satMonUsed >= satMonLimit;
  const applyPenalty = isSudden || satMonExceeded;
  
  const penalty = applyPenalty
    ? computeOnePlusOnePenalty(leave.requested_days ?? leave.days ?? 1)
    : { penalty_applied: false, penalty_days: 0 };
}
```

### Behavior
- **Scope:** Saturday OR Monday leave requests
- **Limit:** 1 Saturday/Monday leave per month
- **Penalty:** 1+1 penalty days (requested_days as penalty)
- **Trigger:** Sudden leave OR exceeded monthly limit
- **Applies to:** Leave request itself (not Sunday)

### Key Differences from Sandwich Policy
| Aspect | Leave-Approval Penalty | Sandwich Policy |
|--------|---------------------|-----------------|
| Scope | Saturday OR Monday | Saturday + Sunday |
| Limit | 1 Sat/Mon per month | 1 Saturday per month |
| Penalty | 1+1 on leave request | Sunday becomes unpaid |
| Monday | Included in limit | Only for two-sided exception |
| Timing | At approval | At payroll |

## Double Charge Analysis

### Scenario: User-32 October 2026

#### Leave Requests
- Oct 3 (Saturday): Unpaid leave
- Oct 10 (Saturday): Unpaid leave
- Oct 12 (Monday): Unpaid leave

#### Leave-Approval Penalty Behavior
1. **Oct 3 (Saturday):**
   - First Saturday/Monday in October
   - `satMonUsed = 0`
   - `satMonExceeded = false`
   - **No penalty** (unless sudden)

2. **Oct 10 (Saturday):**
   - Second Saturday/Monday in October
   - `satMonUsed = 1` (Oct 3)
   - `satMonExceeded = true`
   - **Penalty applied:** 1+1 penalty days on Oct 10 leave request

3. **Oct 12 (Monday):**
   - Third Saturday/Monday in October
   - `satMonUsed = 2` (Oct 3, Oct 10)
   - `satMonExceeded = true`
   - **Penalty applied:** 1+1 penalty days on Oct 12 leave request

#### Sandwich Policy Behavior
1. **Oct 3 (Saturday):**
   - First qualifying Saturday in October
   - Oct 4 (Sunday): Normal (allowance used)

2. **Oct 10 (Saturday):**
   - Second qualifying Saturday in October
   - Oct 11 (Sunday): TWO_SIDED_NON_WORKING (two-sided exception with Oct 12 Monday)
   - **Oct 11 becomes unpaid** (does not consume allowance)

3. **Oct 12 (Monday):**
   - Monday is only used for two-sided exception check
   - Already satisfied two-sided exception for Oct 11

### Double Charge Check

#### Oct 10
- **Leave-Approval Penalty:** 1+1 penalty days added to Oct 10 leave request
- **Sandwich Policy:** Oct 11 Sunday becomes unpaid (two-sided exception)
- **Result:** **NO DOUBLE CHARGE** - different dates affected

#### Oct 12
- **Leave-Approval Penalty:** 1+1 penalty days added to Oct 12 leave request
- **Sandwich Policy:** Oct 12 Monday only used for two-sided exception check (no direct penalty)
- **Result:** **NO DOUBLE CHARGE** - leave-approval penalty is on the leave request itself

## Conclusion

### Are Oct 10 or Oct 12 charged twice?
**NO.** The two mechanisms operate on different dates:

1. **Leave-Approval Penalty** charges the leave request date itself (Oct 10, Oct 12)
2. **Sandwich Policy** charges the Sunday following Saturday (Oct 11)

### Potential Conflict
The leave-approval penalty mechanism and sandwich policy are **independent and unrelated**:

- Leave-approval penalty applies 1+1 penalty to Saturday/Monday leave requests
- Sandwich policy converts Sundays to unpaid based on Saturday allowance

There is **no double charge** because:
- Leave-approval penalty affects the leave request date
- Sandwich policy affects the Sunday following Saturday
- These are different calendar dates

### Recommendation
The leave-approval penalty mechanism (`SAT_MON_LIMIT_PER_MONTH`) is a **legacy system** that should be **reviewed for deprecation** since:

1. The sandwich policy provides more comprehensive Saturday/Sunday handling
2. The leave-approval penalty treats Saturday and Monday equally, which conflicts with the sandwich policy's Monday-only exception logic
3. Both systems applying simultaneously creates confusion and potential policy conflicts

For now, they operate independently without double charges, but the leave-approval penalty should be considered for removal or alignment with the sandwich policy.
