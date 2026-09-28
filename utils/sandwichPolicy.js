// ═══════════════════════════════════════════════════════════════════
// SATURDAY-SUNDAY SANDWICH / OFF-DAY PAYROLL POLICY ENGINE
// ═══════════════════════════════════════════════════════════════════
//
// This module implements the Saturday-Sunday sandwich policy as specified:
// - One qualifying Saturday per calendar month without Sunday penalty
// - Second+ qualifying Saturdays make following Sunday unpaid
// - Two-sided exception: Sat non-working + Sun + Mon non-working = Sun unpaid (no allowance consumed)
// - Actual work overrides all rules
// - Holidays are completely excluded
// - Cross-month patterns supported
//
// ═══════════════════════════════════════════════════════════════════

import { toDateStr, addDays, getDayOfWeek, getYearMonth } from './dateHelper.js';

/**
 * Determine day state for sandwich processing
 * Order: excluded → worked → approved leave = off → pending → off
 * 
 * @param {Object} att - Attendance record for the date
 * @param {boolean} isHoliday - Whether the date is a holiday
 * @param {boolean} isPreJoining - Whether the date is before joining date
 * @param {string} todayStr - Today's date string (YYYY-MM-DD)
 * @returns {string} - "excluded", "worked", "off", "pending"
 */
function getDayState(att, isHoliday, isPreJoining, todayStr, approvedLeaveDates, dateStr) {
  // Rule: excluded (holiday/pre-joining)
  if (isHoliday || isPreJoining) {
    return "excluded";
  }
  
  // Rule: worked (complete punch, work in half_day/full_day/present)
  if (isDateWorked(att)) {
    return "worked";
  }
  
  // Rule: approved leave = off (even for future dates, even without attendance record)
  // Check both attendance record and approved leave dates set
  const hasApprovedLeaveInAtt = att && (att.leave_status === "approved" || att.approved_leave);
  const hasApprovedLeaveInSet = approvedLeaveDates && approvedLeaveDates.has(dateStr);
  if (hasApprovedLeaveInAtt || hasApprovedLeaveInSet) {
    return "off";
  }
  
  // Rule: pending (inferred states for future/today-open)
  // Inferred states: no record, absent, check-in-only, today before checkout
  const isInferred = !att || 
    String(att.status || "").toLowerCase() === "absent" ||
    (att.check_in_time && !att.check_out_time);
  
  if (isInferred) {
    // Check if date is future or today-open
    if (!att || !att.date) {
      // No record - assume today-open if date is today
      return "pending";
    }
    
    const dateStrFromAtt = att.date;
    if (dateStrFromAtt > todayStr) {
      // Future date
      return "pending";
    }
    
    if (dateStrFromAtt === todayStr) {
      // Today - check if checkout is missing
      if (!att.check_out_time) {
        return "pending";
      }
    }
  }
  
  // Default: off
  return "off";
}

/**
 * Determine if a date is worked based on effective attendance status
 * @param {Object} att - Attendance record for the date
 * @returns {boolean} - True if the employee actually worked
 */
function isDateWorked(att) {
  if (!att) return false;
  
  const status = String(att.status || "").toLowerCase();
  
  // Worked statuses
  const workedStatuses = ["present", "full_day", "half_day", "late"];
  
  // Check if there's actual punch data
  const hasPunch = att.check_in_time || att.check_out_time;
  
  // If punch data exists, check work hours
  if (hasPunch) {
    // For half-day status with punch data, it's worked
    if (status === "half_day") return true;
    
    // Calculate work hours if we have both times
    if (att.check_in_time && att.check_out_time) {
      const inSec = timeToSeconds(att.check_in_time);
      const outSec = timeToSeconds(att.check_out_time);
      const workHours = Math.max(0, outSec - inSec) / 3600;
      
      // More than 0 hours worked = worked
      return workHours > 0;
    }
    
    // Has at least one punch = considered worked
    return true;
  }
  
  // No punch data - check status
  return workedStatuses.includes(status);
}

/**
 * Determine if a date is non-working based on effective attendance status
 * @param {Object} att - Attendance record for the date
 * @returns {boolean} - True if the employee did not work
 */
function isDateNonWorking(att) {
  if (!att) return true; // No record = non-working
  
  const status = String(att.status || "").toLowerCase();
  
  // Non-working statuses
  const nonWorkingStatuses = ["absent", "paid_leave", "unpaid_leave", "leave"];
  
  return nonWorkingStatuses.includes(status) && !isDateWorked(att);
}

/**
 * Convert time string (HH:MM:SS) to seconds since midnight
 * @param {string} timeStr - Time string
 * @returns {number|null} - Seconds or null
 */
function timeToSeconds(timeStr) {
  if (!timeStr) return null;
  
  const str = String(timeStr).trim();
  const [h, m, s] = str.split(":").map(Number);
  
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  
  return h * 3600 + m * 60 + (s || 0);
}

// addDays, getDayOfWeek, getYearMonth are now imported from dateHelper.js

/**
 * Apply sandwich policy to calendar data
 * 
 * @param {Object} data - Calendar data with attendance, leaves, holidays
 * @param {Map} data.attMap - Map of date -> attendance record
 * @param {Map} data.holidayMap - Map of date -> holiday info
 * @param {Map} data.halfDayLeaveMap - Map of date -> half-day leave info
 * @param {Array} data.allDates - Array of date strings to process
 * @param {Array} data.leaves - Array of approved leave requests
 * @param {Object} options - Configuration options
 * @param {string} options.todayStr - Today's date string (YYYY-MM-DD)
 * @param {string} options.joiningDate - Employee joining date string (YYYY-MM-DD)
 * @returns {Object} - Modified calendar data with sandwich statuses
 */
export function applySandwichPolicy(data, options = {}) {
  const { attMap, holidayMap, halfDayLeaveMap, allDates, leaves = [] } = data;
  const { todayStr = toDateStr(new Date()), joiningDate } = options;
  
  // Build a set of dates with approved leave (IST-correct dates)
  const approvedLeaveDates = new Set();
  for (const leave of leaves) {
    const fromDate = toDateStr(leave.from_date);
    const toDate = toDateStr(leave.to_date);
    if (fromDate && toDate) {
      const [y1, m1, d1] = fromDate.split('-').map(Number);
      const [y2, m2, d2] = toDate.split('-').map(Number);
      const start = new Date(y1, m1 - 1, d1);
      const end = new Date(y2, m2 - 1, d2);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dStr = toDateStr(d);
        // Skip Sundays
        if (getDayOfWeek(dStr) !== 0) {
          approvedLeaveDates.add(dStr);
        }
      }
    }
  }
  
  // Track monthly Saturday allowance usage
  // Key: "user_id:year:month" -> count of qualifying Saturdays used
  const allowanceUsage = new Map();
  
  // Results array: [{date, reason, applied, status}]
  const sandwichResults = [];
  
  // Process all dates to identify Saturdays and their Sundays
  for (const dateStr of allDates) {
    const dow = getDayOfWeek(dateStr);
    
    // Only process Saturdays
    if (dow !== 6) continue;
    
    const att = attMap.get(dateStr);
    const isHoliday = holidayMap.has(dateStr);
    const isPreJoining = joiningDate && dateStr < joiningDate;
    
    // Get day state using new logic
    const dayState = getDayState(att, isHoliday, isPreJoining, todayStr, approvedLeaveDates, dateStr);
    
    // Rule F: Actual work on Saturday means no sandwich trigger
    if (dayState === "worked") {
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "SATURDAY_WORKED",
      });
      continue;
    }
    
    // Rule B: Company holidays are completely excluded
    if (dayState === "excluded") {
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "HOLIDAY_EXCLUDED",
      });
      continue;
    }
    
    // Rule D/E: Check if Saturday is non-working (off state)
    if (dayState !== "off") {
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "SATURDAY_PENDING",
      });
      continue;
    }
    
    // Saturday is qualifying non-working - process Sunday
    const sundayStr = addDays(dateStr, 1);
    const sundayAtt = attMap.get(sundayStr);
    const sundayHoliday = holidayMap.has(sundayStr);
    const sundayPreJoining = joiningDate && sundayStr < joiningDate;
    const sundayState = getDayState(sundayAtt, sundayHoliday, sundayPreJoining, todayStr, approvedLeaveDates, sundayStr);
    
    // Rule M: Actual Sunday attendance always wins
    if (sundayState === "worked") {
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "SUNDAY_WORKED",
      });
      sandwichResults.push({
        date: sundayStr,
        applied: false,
        reason: "SUNDAY_WORKED",
      });
      continue;
    }
    
    // Rule B: Sunday holiday check
    if (sundayState === "excluded") {
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "HOLIDAY_EXCLUDED",
      });
      continue;
    }
    
    // Check Monday for two-sided exception
    const mondayStr = addDays(sundayStr, 1);
    const mondayAtt = attMap.get(mondayStr);
    const mondayHoliday = holidayMap.has(mondayStr);
    const mondayPreJoining = joiningDate && mondayStr < joiningDate;
    const mondayState = getDayState(mondayAtt, mondayHoliday, mondayPreJoining, todayStr, approvedLeaveDates, mondayStr);
    
    // Rule J/K/L: Two-sided exception (Sat non-working + Sun + Mon non-working)
    // Monday must be "off" state (non-working)
    if (mondayState === "off" && !mondayHoliday) {
      // Two-sided exception triggered
      sandwichResults.push({
        date: sundayStr,
        applied: true,
        reason: "TWO_SIDED_NON_WORKING",
      });
      
      // Rule L: Two-sided exception does NOT consume allowance
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "TWO_SIDED_EXCEPTION_NO_ALLOWANCE",
      });
      continue;
    }
    
    // Normal allowance-based rule (only if two-sided exception doesn't apply)
    // Get Saturday's year/month for allowance tracking
    const satYearMonth = getYearMonth(dateStr);
    const allowanceKey = `:${satYearMonth.year}:${satYearMonth.month}`;
    
    const currentUsage = allowanceUsage.get(allowanceKey) || 0;
    
    if (currentUsage === 0) {
      // Rule C/H: First qualifying Saturday - Sunday remains normal
      allowanceUsage.set(allowanceKey, 1);
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: "FIRST_QUALIFYING_SATURDAY",
      });
      sandwichResults.push({
        date: sundayStr,
        applied: false,
        reason: "SATURDAY_ALLOWANCE",
      });
    } else {
      // Rule H: Second+ qualifying Saturday - Sunday becomes unpaid
      const allowanceCount = currentUsage + 1;
      allowanceUsage.set(allowanceKey, allowanceCount);
      
      let reason = "SECOND_QUALIFYING_SATURDAY";
      if (allowanceCount === 3) reason = "THIRD_QUALIFYING_SATURDAY";
      if (allowanceCount === 4) reason = "FOURTH_QUALIFYING_SATURDAY";
      if (allowanceCount >= 5) reason = `QUALIFYING_SATURDAY_${allowanceCount}`;
      
      sandwichResults.push({
        date: dateStr,
        applied: false,
        reason: reason,
      });
      
      sandwichResults.push({
        date: sundayStr,
        applied: true,
        reason: reason,
      });
    }
  }
  
  return {
    sandwichResults,
    allowanceUsage,
  };
}

/**
 * Apply sandwich results to attendance map for payroll calculation
 * REMOVED: We no longer mutate the attendance map.
 * Sandwich results are returned as separate metadata.
 * 
 * @param {Map} attMap - Original attendance map
 * @param {Array} sandwichResults - Sandwich policy results
 * @returns {Map} - Original attendance map (unchanged)
 */
export function applySandwichToAttendanceMap(attMap, sandwichResults) {
  // Return the original map unchanged - we don't mutate it anymore
  return attMap;
}

/**
 * Get sandwich summary for debugging/reporting
 * 
 * @param {Array} sandwichResults - Sandwich policy results
 * @returns {Array} - Array of sandwich decisions
 */
export function getSandwichSummary(sandwichResults) {
  return sandwichResults.filter(r => r.applied || r.reason).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get sandwich results for a specific date
 * 
 * @param {Array} sandwichResults - Sandwich policy results
 * @param {string} dateStr - Date string
 * @returns {Object|null} - Sandwich result for the date
 */
export function getSandwichResultForDate(sandwichResults, dateStr) {
  return sandwichResults.find(r => r.date === dateStr) || null;
}
