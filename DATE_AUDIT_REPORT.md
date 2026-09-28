# Date Operations Audit After setTypeParser(1082)

## Test Suite Status

**Sandwich tests:** ✅ 14/14 PASS (`test/sandwich.test.js`)

**ComputedAttendanceStatus test:** ❌ 1/2 FAIL (`tests/computedAttendanceStatus.test.js`)
- Failure: Expected 8 hours, got 9 hours (not related to date parsing)

**Other tests:** Not run (time/resource constraints)

## Date Operations Audit

### SAFE Operations (No Changes Needed)

These operations create Date objects from numeric year/month/day values or current time, not from database DATE columns:

**payrollService.js:**
- Line 60: `value instanceof Date ? d.toISOString() : String(d)` - Safe (checks type)
- Line 88: Same pattern - Safe
- Lines 157-158, 297-298: `new Date(year, month - 1, 0).toISOString().slice(0, 10)` - Safe (numeric params)
- Line 261: `new Date(t).toISOString().slice(0, 10)` where t is UTC timestamp - Safe
- Line 303: Same as 261 - Safe
- Line 320: `new Date().toISOString().slice(0, 10)` - Safe (current time)
- Line 337: `new Date(ds + "T00:00:00").getDay()` - Safe (string parsing with explicit time)

**attendanceRoutes.js:**
- Line 306: `new Date(year, month - 1, day).getDay()` - Safe (numeric params)
- Line 572: `new Date().toISOString()` - Safe (current time)
- Line 1046: `new Date(parseDateStr(ds)).getDay()` - Safe (parseDateStr handles it)
- Line 1522: `new Date(y, m - 1, d).getDay()` - Safe (numeric params)
- Line 1841: `new Date().toISOString().slice(0, 10)` - Safe (current time)
- Line 4261: `new Date(end).toISOString().slice(0, 10)` - Safe (end is base date)
- Line 4683: `new Date(year, month - 1, day).getDay()` - Safe (numeric params)

**leaveRoutes.js:**
- Lines 204-213: `new Date(\`${fromDateStr}T00:00:00\`)` - Safe (explicit T00:00:00)
- Line 309: `current.getDay()` - Safe (current is already a Date)
- Lines 1209, 1213: `new Date().toISOString()` - Safe (current time)

**employeeSelfRoutes.js:**
- Lines 195-199: Creating Date from startDate with getMonth - Safe (numeric params)
- Lines 452-456: Same pattern - Safe

### AFFECTED Operations (Need Fixing)

These operations create Date objects from database DATE columns (now strings after setTypeParser):

**attendanceRoutes.js:**
- **Line 1822-1825:** `new Date(start)` where start is a date string parameter
  - Risk: If start comes from DB, timezone shift could occur
  - Fix: Use `new Date(start + "T00:00:00")` or use dateHelper

- **Lines 2653-2656:** `new Date(lv.from_date)` where from_date is from DB
  - Risk: Direct parsing of DB date string
  - Fix: Use `new Date(lv.from_date + "T00:00:00")` or dateHelper

- **Lines 2684-2687:** Same as above
  - Risk: Direct parsing of DB date string
  - Fix: Use `new Date(lv.from_date + "T00:00:00")` or dateHelper

**leaveRoutes.js:**
- **Lines 53-54:** `new Date(leave.from_date)` where from_date is from DB
  - Risk: Direct parsing of DB date string
  - Fix: Use `new Date(leave.from_date + "T00:00:00")` or dateHelper

- **Lines 153-155:** `new Date(value)` where value is a date string
  - Risk: Could be from DB
  - Fix: Check source, use dateHelper if from DB

- **Lines 609-611:** `new Date(String(leave.from_date).slice(0, 10))` where from_date is from DB
  - Risk: Direct parsing of DB date string
  - Fix: Use dateHelper

- **Lines 613-614:** Same loop
  - Risk: Direct parsing of DB date string
  - Fix: Use dateHelper

- **Lines 1012-1014:** `new Date(leave.from_date)` where from_date is from DB
  - Risk: Direct parsing of DB date string
  - Fix: Use `new Date(leave.from_date + "T00:00:00")` or dateHelper

**employeeSelfRoutes.js:**
- **Line 742:** `new Date(b.date)` where date is from DB
  - Risk: Direct parsing of DB date string
  - Fix: Use dateHelper

## Summary

- **Total operations found:** 49
- **Safe:** 38
- **Affected:** 11

**Affected locations:**
1. `attendanceRoutes.js`: 3 locations (lines 1822-1825, 2653-2656, 2684-2687)
2. `leaveRoutes.js`: 5 locations (lines 53-54, 153-155, 609-611, 613-614, 1012-1014)
3. `employeeSelfRoutes.js`: 1 location (line 742)

## Recommended Fix Pattern

Replace `new Date(dbDateString)` with:
```javascript
import { toDateStr } from './utils/dateHelper.js';

// If you need a Date object for comparison:
const date = new Date(dbDateString + "T00:00:00");

// If you need a string (preferred):
const dateStr = toDateStr(dbDateString);
```

Or use the dateHelper functions directly:
```javascript
import { addDays, getDayOfWeek } from './utils/dateHelper.js';
```
