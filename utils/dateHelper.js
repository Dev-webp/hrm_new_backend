/**
 * Date Helper Functions for IST (Asia/Kolkata)
 * All date operations should use this to ensure consistent timezone handling
 */

// pg.types.setTypeParser for DATE type (OID 1082) to prevent UTC conversion
import pg from 'pg';
pg.types.setTypeParser(1082, v => v);

/**
 * Convert any date value to YYYY-MM-DD string in IST
 * Handles: Date objects, strings (YYYY-MM-DD, ISO strings), and undefined/null
 * @param {Date|string|undefined|null} value
 * @returns {string} YYYY-MM-DD string
 */
export function toDateStr(value) {
  if (!value) return '';
  
  if (value instanceof Date) {
    // For Date objects, format as YYYY-MM-DD in local time (IST)
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  if (typeof value === 'string') {
    // If already YYYY-MM-DD, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    
    // If ISO string, parse and format in local time
    if (value.includes('T') || value.includes('Z')) {
      const date = new Date(value);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    // Fallback: return as-is
    return value;
  }
  
  return '';
}

/**
 * Get current date as YYYY-MM-DD string in IST
 * @returns {string} YYYY-MM-DD string
 */
export function todayStr() {
  return toDateStr(new Date());
}

/**
 * Add days to a date string (YYYY-MM-DD)
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {number} days - Days to add (can be negative)
 * @returns {string} New date string (YYYY-MM-DD)
 */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const newY = date.getFullYear();
  const newM = String(date.getMonth() + 1).padStart(2, '0');
  const newD = String(date.getDate()).padStart(2, '0');
  return `${newY}-${newM}-${newD}`;
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday)
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {number} Day of week
 */
export function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Get year and month from date string
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {Object} { year, month }
 */
export function getYearMonth(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return { year: y, month: m };
}
