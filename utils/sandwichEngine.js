/**
 * SANDWICH RULE ENGINE (pure, no DB access)
 *
 * Anchor  = Sunday, or a company holiday (non-half-day).
 * Check   = day before -> anchor -> day after.
 *
 *  anchor worked / before joining / neighbour pending  -> no sandwich
 *  day before worked                                   -> no sandwich
 *  day before OFF + day after OFF                      -> SANDWICH (two-sided, no allowance used)
 *  day before OFF + day after WORKED                   -> one-sided: 1st per month FREE, 2nd+ SANDWICH
 *  neighbour not an "ordinary" day (Sunday/holiday)    -> no sandwich
 *
 * Allowance pool is per calendar month of the ANCHOR and shared by Sundays + holidays.
 */
import { getComputedAttendanceStatus } from "./computedAttendanceStatus.js";

export const FREE_ONE_SIDED_PER_MONTH = 1;
const WORKED_STATUSES = new Set(["full_day", "present", "half_day"]);

const pad = n => String(n).padStart(2, "0");
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  return fmt(new Date(y, m - 1, d + n));
}
const dow = ds => { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

/**
 * Build stateOf(ds) -> "worked" | "off" | "pending" | "excluded" | "non_ordinary"
 * Priority: excluded > non_ordinary > worked(actual attendance) > pending > leave/absent/no-record => off
 */
export function buildDayStateResolver({ attMap, holidayMap, approvedLeaveSet, joiningDate, todayStr }) {
  const holidaySet = new Set(holidayMap.keys());
  return function stateOf(ds) {
    if (joiningDate && ds < joiningDate) return "excluded";
    if (dow(ds) === 0 || holidaySet.has(ds)) {
      // a Sunday/holiday is never an "ordinary" neighbour
      return "non_ordinary";
    }
    const rec = attMap.get(ds);
    if (rec) {
      const st = getComputedAttendanceStatus(rec, { dateStr: ds, holidaySet, todayStr }).computed_status;
      if (WORKED_STATUSES.has(st)) return "worked";          // actual work beats leave
      if (st === "in_progress") return "pending";             // today, no checkout yet
    }
    if (ds > todayStr) return "pending";
    if (ds === todayStr && !(rec && rec.check_out_time)) return "pending";
    return "off"; // absent, no record, approved leave, missing checkout on a past day
  };
}

export function buildAnchors({ activeDates, holidayMap }) {
  return activeDates.filter(ds => {
    if (dow(ds) === 0) return true;
    const h = holidayMap.get(ds);
    return h && String(h.type || "holiday").toLowerCase() !== "halfday";
  });
}

/** anchorWorked(ds): true if employee actually worked on the Sunday/holiday itself */
export function evaluateSandwich({ anchors, stateOf, anchorWorked, joiningDate, freePerMonth = FREE_ONE_SIDED_PER_MONTH }) {
  const used = {}; // "YYYY-MM" -> one-sided count
  const results = [];
  for (const anchor of [...anchors].sort()) {
    const type = dow(anchor) === 0 ? "SUNDAY" : "HOLIDAY";
    const base = { date: anchor, anchorType: type, isSandwich: false, payable: 1, reason: null, usedFree: false };
    if (joiningDate && anchor < joiningDate) { results.push({ ...base, reason: "BEFORE_JOINING" }); continue; }
    if (anchorWorked && anchorWorked(anchor)) { results.push({ ...base, reason: `${type}_WORKED` }); continue; }

    const before = stateOf(addDays(anchor, -1));
    const after = stateOf(addDays(anchor, 1));
    if (before === "worked") { results.push({ ...base, reason: "DAY_BEFORE_WORKED" }); continue; }
    if (before !== "off") { results.push({ ...base, reason: `DAY_BEFORE_${before.toUpperCase()}` }); continue; }
    if (after === "off") { results.push({ ...base, isSandwich: true, payable: 0, reason: "TWO_SIDED_NON_WORKING" }); continue; }
    if (after === "worked") {
      const ym = anchor.slice(0, 7);
      used[ym] = (used[ym] || 0) + 1;
      if (used[ym] <= freePerMonth) { results.push({ ...base, usedFree: true, reason: "ONE_SIDED_FREE" }); }
      else results.push({ ...base, isSandwich: true, payable: 0, reason: `ONE_SIDED_QUALIFYING_${used[ym]}` });
      continue;
    }
    results.push({ ...base, reason: `DAY_AFTER_${after.toUpperCase()}` }); // pending / excluded / non_ordinary
  }
  return results;
}

/**
 * One call used by payroll, admin analysis and the employee calendar so all three always agree.
 *  month        "YYYY-MM"
 *  attMap       Map<date, attendance row>   (include 1 day before/after the month)
 *  holidayMap   Map<date, {type,name}>      (include 1 day before/after the month)
 * Returns sandwich results ONLY for anchors that fall inside `month`.
 */
export function computeMonthSandwich({ month, attMap, holidayMap, joiningDate = null, todayStr, freePerMonth }) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const activeDates = [];
  for (let d = 1; d <= last; d++) {
    const ds = `${month}-${pad(d)}`;
    if (!joiningDate || ds >= joiningDate) activeDates.push(ds);
  }
  const stateOf = buildDayStateResolver({ attMap, holidayMap, approvedLeaveSet: new Set(), joiningDate, todayStr });
  return evaluateSandwich({
    anchors: buildAnchors({ activeDates, holidayMap }),
    stateOf,
    // an actual punch on the Sunday/holiday itself always wins
    anchorWorked: ds => {
      const r = attMap.get(ds);
      return Boolean(r && (r.check_in_time || r.check_out_time));
    },
    joiningDate,
    freePerMonth,
  });
}
