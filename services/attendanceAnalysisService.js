/**
 * Unified employee monthly attendance analysis.
 * Builds full calendar (Sundays, holidays, absents, leave Paid/Unpaid).
 * Preserves late_minutes even when status = full_day.
 */
import { pool } from "../middleware/db.js";
import { monthRange, heatmapStatus } from "./attendanceAnalysisPure.js";

export { monthRange, heatmapStatus };

const MAX_BREAK_MINS = 60;

function isGraceLateRecord(record = {}) {
  const raw = record.checkIn || record.check_in_time;
  if (!raw || raw === "--") return false;
  const [h, m] = String(raw).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const minutes = h * 60 + m;
  return minutes >= 10 * 60 + 15 && minutes < 10 * 60 + 30;
}

function fmtTime(t) {
  if (!t) return "--";
  const s = String(t).slice(0, 5);
  const [h, mi] = s.split(":").map(Number);
  if (Number.isNaN(h)) return "--";
  return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtTime24(t) {
  if (!t) return "--";
  return String(t).slice(0, 5);
}

function normalizeAttendanceStatus(att) {
  return att?.status || "absent";
}

function expandLeaveDates(leaves, start, end) {
  const map = new Map();
  for (const lv of leaves) {
    const from = new Date(String(lv.from_date).slice(0, 10));
    const to = new Date(String(lv.to_date).slice(0, 10));
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds >= start && ds <= end) {
        map.set(ds, {
          leaveType: lv.leave_type,
          isPaidLeave: lv.is_paid_leave === true || lv.leave_type === "Paid",
          reason: lv.reason,
        });
      }
    }
  }
  return map;
}

function buildEmptyDay(dateStr, status, holidayName = null) {
  return {
    date: dateStr,
    status,
    checkIn: "--",
    checkOut: "--",
    lateMinutes: 0,
    workHours: 0,
    productionHours: 0,
    breaks: 0,
    breakMins: { b1: 0, lunch: 0, b2: 0, b3: 0 },
    breakDetails: {
      b1: { in: "—", out: "—" },
      lunch: { in: "—", out: "—" },
      b2: { in: "—", out: "—" },
      b3: { in: "—", out: "—" },
    },
    holidayName,
    leaveType: null,
    isPaidLeave: false,
    heatmapStatus:
      status === "sunday" ? "sunday" :
      status === "holiday" ? "holiday" :
      status === "no_record" ? "no_record" :
      "absent",
  };
}

/**
 * @param {number} userId
 * @param {string} month YYYY-MM
 * @param {string|null} branchFilter
 */
export async function getEmployeeMonthlyAnalysis(userId, month, branchFilter = null) {
  const { start, end, year, month: mNum, lastDay } = monthRange(month);

  const [userRes, attRes, breakRes, holidayRes, leaveRes, mvRes] = await Promise.all([
    pool.query(
      `SELECT id, full_name, email, department, branch, employee_code, salary, joining_date
       FROM users WHERE id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         status, check_in_time, check_out_time,
         late_minutes, production_hours, total_break_minutes,
         is_paid_leave, leave_request_id, holiday_name
       FROM attendance_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [userId, start, end]
    ),
    pool.query(
      `SELECT
         TO_CHAR(date,'YYYY-MM-DD') AS date,
         break_type, start_time, end_time, duration_minutes, break3_sessions
       FROM employee_breaks
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, break_type`,
      [userId, start, end]
    ),
    pool.query(
      `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, name
       FROM company_holidays
       WHERE date BETWEEN $1 AND $2
         AND (branch = 'all' OR branch = (SELECT branch FROM users WHERE id = $3 LIMIT 1))`,
      [start, end, userId]
    ),
    pool.query(
      `SELECT leave_type, from_date, to_date,
              COALESCE(requested_days, days::numeric) AS days,
              leave_duration_type, half_day_session,
              reason, is_paid_leave, status
       FROM leave_requests
       WHERE user_id = $1 AND status = 'approved'
         AND from_date <= $3 AND to_date >= $2`,
      [userId, start, end]
    ),
    pool.query(
      `SELECT * FROM mv_monthly_attendance
       WHERE user_id = $1 AND month_start = $2::date`,
      [userId, `${month}-01`]
    ),
  ]);

  if (!userRes.rows.length) {
    return null;
  }

  const user = userRes.rows[0];
  if (branchFilter && user.branch !== branchFilter) {
    return { forbidden: true };
  }

  const attMap = new Map(attRes.rows.map((r) => [r.date, r]));
  const holidayMap = new Map(holidayRes.rows.map((h) => [h.date, h.name]));
  const leaveDateMap = expandLeaveDates(leaveRes.rows, start, end);

  const breakMap = new Map();
  for (const b of breakRes.rows) {
    if (!breakMap.has(b.date)) breakMap.set(b.date, {});
    breakMap.get(b.date)[b.break_type] = b;
  }

  const records = [];
  const dailyLoginLogout = [];
  const dailyBreakAnalysis = [];
  const dailyProductionHours = [];
  const heatmap = [];

  let totalBreakMins = 0;
  let breakWorkDays = 0;
  let longestBreakDay = { date: null, minutes: 0 };
  const todayStr = new Date().toISOString().slice(0, 10);

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${month}-${String(d).padStart(2, "0")}`;
    const dow = new Date(dateStr).getDay();

    if (dow === 0) {
      const rec = buildEmptyDay(dateStr, "sunday");
      records.push(rec);
      heatmap.push({ date: dateStr, status: "sunday", label: "Sunday" });
      continue;
    }

    if (holidayMap.has(dateStr)) {
      const rec = buildEmptyDay(dateStr, "holiday", holidayMap.get(dateStr));
      records.push(rec);
      heatmap.push({
        date: dateStr,
        status: "holiday",
        label: holidayMap.get(dateStr) || "Holiday",
      });
      continue;
    }

    const att = attMap.get(dateStr);
    const dayBreaks = breakMap.get(dateStr) || {};
    const b1 = dayBreaks.break1 || {};
    const lunch = dayBreaks.lunch || {};
    const b2 = dayBreaks.break2 || {};
    const b3 = dayBreaks.break3 || {};
    const break3Sessions = Array.isArray(b3.break3_sessions) ? b3.break3_sessions : [];

    const breakMins = {
      b1: Number(b1.duration_minutes) || 0,
      lunch: Number(lunch.duration_minutes) || 0,
      b2: Number(b2.duration_minutes) || 0,
      b3: Number(b3.duration_minutes) || 0,
      b3Count: break3Sessions.length,
      b3History: break3Sessions,
    };
    const totalDayBreak =
      breakMins.b1 + breakMins.lunch + breakMins.b2 + breakMins.b3 ||
      Number(att?.total_break_minutes) ||
      0;

    let status = normalizeAttendanceStatus(att);
    let isPaidLeave = att?.is_paid_leave === true;
    let leaveType = null;

    const leaveInfo = leaveDateMap.get(dateStr);
    if (leaveInfo && (!att || att.status === "leave" || att.status === "absent")) {
      status = "leave";
      isPaidLeave = leaveInfo.isPaidLeave;
      leaveType = leaveInfo.leaveType;
    } else if (att?.leave_request_id || leaveInfo) {
      leaveType = leaveInfo?.leaveType || null;
      isPaidLeave = isPaidLeave || leaveInfo?.isPaidLeave || false;
    }

    if (!att && !leaveInfo && dow !== 0 && !holidayMap.has(dateStr)) {
      status = dateStr > todayStr ? "no_record" : "absent";
    }

    const checkIn = att?.check_in_time ? fmtTime24(att.check_in_time) : "--";
    const checkOut = att?.check_out_time ? fmtTime24(att.check_out_time) : "--";
    const lateMinutes = Number(att?.late_minutes) || 0;
    const productionHours = parseFloat(att?.production_hours) || 0;
    let workHours = productionHours;
    if (!workHours && checkIn !== "--" && checkOut !== "--") {
      const [ih, im] = checkIn.split(":").map(Number);
      const [oh, om] = checkOut.split(":").map(Number);
      workHours = Math.max(0, (oh * 60 + om - (ih * 60 + im)) / 60);
    }

    const rec = {
      date: dateStr,
      status,
      checkIn,
      checkOut,
      loginTime: fmtTime(att?.check_in_time),
      logoutTime: fmtTime(att?.check_out_time),
      lateMinutes,
      workHours,
      productionHours,
      breaks: totalDayBreak,
      breakMins,
      breakDetails: {
        b1: { in: fmtTime(b1.start_time) === "--" ? "—" : fmtTime(b1.start_time), out: fmtTime(b1.end_time) === "--" ? "—" : fmtTime(b1.end_time) },
        lunch: { in: fmtTime(lunch.start_time) === "--" ? "—" : fmtTime(lunch.start_time), out: fmtTime(lunch.end_time) === "--" ? "—" : fmtTime(lunch.end_time) },
        b2: { in: fmtTime(b2.start_time) === "--" ? "—" : fmtTime(b2.start_time), out: fmtTime(b2.end_time) === "--" ? "—" : fmtTime(b2.end_time) },
        b3: { in: fmtTime(b3.start_time) === "--" ? "—" : fmtTime(b3.start_time), out: fmtTime(b3.end_time) === "--" ? "—" : fmtTime(b3.end_time) },
      },
      holidayName: att?.holiday_name || null,
      leaveType,
      isPaidLeave,
    };

    rec.heatmapStatus = heatmapStatus(rec);
    records.push(rec);

    heatmap.push({
      date: dateStr,
      status: rec.heatmapStatus,
      checkIn: rec.loginTime,
      checkOut: rec.logoutTime,
      break1: `${rec.breakDetails.b1.in} → ${rec.breakDetails.b1.out}`,
      break2: `${rec.breakDetails.b2.in} → ${rec.breakDetails.b2.out}`,
      break3: `${rec.breakDetails.b3.in} → ${rec.breakDetails.b3.out}`,
      lunch: `${rec.breakDetails.lunch.in} → ${rec.breakDetails.lunch.out}`,
      productionHours: rec.productionHours,
      totalBreakMinutes: rec.breaks,
      lateMinutes: rec.lateMinutes,
      leaveType: rec.leaveType,
      isPaidLeave: rec.isPaidLeave,
      label: rec.heatmapStatus,
    });

    if (!["sunday", "holiday", "absent"].includes(status) || (status === "leave" && totalDayBreak > 0)) {
      if (!["sunday", "holiday"].includes(status)) {
        dailyLoginLogout.push({
          date: dateStr,
          login: rec.loginTime,
          logout: rec.logoutTime,
          loginHour: att?.check_in_time ? parseInt(String(att.check_in_time).slice(0, 2), 10) : null,
        });
        dailyProductionHours.push({
          date: dateStr,
          hours: parseFloat(workHours.toFixed(2)),
        });
        if (totalDayBreak > 0 || ["full_day", "half_day", "late"].includes(status) || lateMinutes > 0) {
          dailyBreakAnalysis.push({
            date: dateStr,
            break1: breakMins.b1,
            lunch: breakMins.lunch,
            break2: breakMins.b2,
            break3: breakMins.b3,
            total: totalDayBreak,
            exceeded: totalDayBreak > MAX_BREAK_MINS,
          });
          if (!["leave"].includes(status) || totalDayBreak > 0) {
            totalBreakMins += totalDayBreak;
            breakWorkDays += 1;
            if (totalDayBreak > longestBreakDay.minutes) {
              longestBreakDay = { date: dateStr, minutes: totalDayBreak };
            }
          }
        }
      }
    }
  }

  const safeRecords = records.filter(Boolean).map((r) => ({
    ...r,
    status: r.status || "absent",
    checkIn: r.checkIn || "--",
    checkOut: r.checkOut || "--",
    lateMinutes: Number(r.lateMinutes) || 0,
    workHours: Number(r.workHours) || 0,
    productionHours: Number(r.productionHours) || 0,
    breaks: Number(r.breaks) || 0,
    breakMins: {
      b1: Number(r.breakMins?.b1) || 0,
      lunch: Number(r.breakMins?.lunch) || 0,
      b2: Number(r.breakMins?.b2) || 0,
      b3: Number(r.breakMins?.b3) || 0,
    },
    breakDetails: r.breakDetails || {
      b1: { in: "--", out: "--" },
      lunch: { in: "--", out: "--" },
      b2: { in: "--", out: "--" },
      b3: { in: "--", out: "--" },
    },
  }));
  const safeHeatmap = heatmap.filter(Boolean).map((r) => ({
    ...r,
    status: r.status || "absent",
    label: r.label || r.status || "Absent",
  }));

  const mv = mvRes.rows[0] || {};
  const monthlySummary = {
    fullDays: safeRecords.filter((r) => r.status === "full_day").length,
    halfDays: safeRecords.filter((r) => r.status === "half_day").length,
    absentDays: safeRecords.filter((r) => r.status === "absent").length,
    leaveDays: Number(mv.leave_days) || safeRecords.filter((r) => r.status === "leave").length,
    paidLeaveDays: safeRecords.filter((r) => r.status === "leave" && r.isPaidLeave).length,
    unpaidLeaveDays: safeRecords.filter((r) => r.status === "leave" && !r.isPaidLeave).length,
    holidayDays: Number(mv.holiday_days) || safeRecords.filter((r) => r.status === "holiday").length,
    lateDays: Number(mv.late_days) || safeRecords.filter(isGraceLateRecord).length,
    totalLateMinutes: Number(mv.total_late_minutes) || safeRecords.reduce((s, r) => s + r.lateMinutes, 0),
    totalProductionHours: parseFloat(mv.total_production_hours) || safeRecords.reduce((s, r) => s + r.productionHours, 0),
    totalBreakMinutes: Number(mv.total_break_minutes) || totalBreakMins,
    avgBreakMins: Number(mv.avg_break_mins) || (breakWorkDays ? Math.round(totalBreakMins / breakWorkDays) : 0),
    breakExceededDays: Number(mv.break_exceeded_days) || safeRecords.filter((r) => r.breaks > MAX_BREAK_MINS).length,
    avgLoginTime: mv.avg_login_time ? fmtTime(mv.avg_login_time) : "--",
    avgLogoutTime: mv.avg_logout_time ? fmtTime(mv.avg_logout_time) : "--",
  };

  const breakAnalysis = {
    monthlyTotalBreakMinutes: totalBreakMins,
    averageBreakMinutes: breakWorkDays ? Math.round(totalBreakMins / breakWorkDays) : 0,
    longestBreakDay: longestBreakDay.date,
    longestBreakMinutes: longestBreakDay.minutes,
    breakTypeTotals: {
      break1: safeRecords.reduce((s, r) => s + r.breakMins.b1, 0),
      lunch: safeRecords.reduce((s, r) => s + r.breakMins.lunch, 0),
      break2: safeRecords.reduce((s, r) => s + r.breakMins.b2, 0),
      break3: safeRecords.reduce((s, r) => s + r.breakMins.b3, 0),
    },
    maxBreakMinutesPolicy: MAX_BREAK_MINS,
  };

  return {
    employee: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      department: user.department,
      branch: user.branch,
      employee_code: user.employee_code,
      salary: user.salary,
      joining_date: user.joining_date,
    },
    selectedMonth: month,
    monthlySummary,
    dailyLoginLogout,
    dailyBreakAnalysis,
    dailyProductionHours,
    heatmap: safeHeatmap,
    breakAnalysis,
    records: safeRecords,
    approvedLeaves: leaveRes.rows,
  };
}
