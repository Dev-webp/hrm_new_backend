import { pool } from "../middleware/db.js";

const LEAVE_STATUSES = new Set(["paid_leave", "unpaid_leave"]);
const PRESENT_STATUSES = new Set(["full_day", "present", "late", "in_progress", "working"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(result.getTime()) ? null : result;
}

function dateRange(start, end) {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to || from > to) throw new Error("start and end must be valid YYYY-MM-DD dates");
  const dates = [];
  for (const date = new Date(from); date <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function isSunday(dateStr) {
  return parseDate(dateStr)?.getUTCDay() === 0;
}

/**
 * The only attendance classification used by the Admin Dashboard API.
 * It accepts raw attendance_records fields and returns display-safe flags.
 */
export function calculateFinalAttendanceStatus({ record, date, holiday, today }) {
  const rawStatus = normalizeStatus(record?.status);
  const leaveType = normalizeStatus(record?.leave_type);
  const hasCheckIn = Boolean(record?.check_in_time);
  const hasCheckOut = Boolean(record?.check_out_time);

  let attendanceStatus;
  if (rawStatus === "paid_leave" || leaveType === "paid_leave" || record?.is_paid_leave === true) {
    attendanceStatus = "paid_leave";
  } else if (rawStatus === "unpaid_leave" || leaveType === "unpaid_leave") {
    attendanceStatus = "unpaid_leave";
  } else if (holiday) {
    attendanceStatus = "holiday";
  } else if (isSunday(date)) {
    attendanceStatus = "sunday";
  } else if (date === today && hasCheckIn && !hasCheckOut) {
    attendanceStatus = "working";
  } else if (rawStatus === "half_day") {
    attendanceStatus = "half_day";
  } else if (rawStatus === "missing_checkout" || (hasCheckIn && !hasCheckOut)) {
    attendanceStatus = "missing_checkout";
  } else if (PRESENT_STATUSES.has(rawStatus) || (hasCheckIn && hasCheckOut)) {
    attendanceStatus = "full_day";
  } else {
    attendanceStatus = "absent";
  }

  const isLeave = LEAVE_STATUSES.has(attendanceStatus);
  const isHalfDay = attendanceStatus === "half_day";
  const isWorking = attendanceStatus === "working";
  const isPresent = ["full_day", "working"].includes(attendanceStatus);
  const isLate = !isLeave && Number(record?.late_minutes || 0) > 0;

  return {
    attendance_status: attendanceStatus,
    status: attendanceStatus,
    is_present: isPresent,
    is_absent: attendanceStatus === "absent",
    is_half_day: isHalfDay,
    is_leave: isLeave,
    is_paid_leave: attendanceStatus === "paid_leave",
    is_unpaid_leave: attendanceStatus === "unpaid_leave",
    is_late: isLate,
    is_working: isWorking,
    attendance_units: isPresent ? 1 : isHalfDay ? 0.5 : 0,
  };
}

function summarize(records = []) {
  return records.reduce(
    (summary, record) => {
      summary.totalEmployees += 1;
      if (record.is_present && !record.is_working) summary.present += 1;
      if (record.is_working) summary.working += 1;
      if (record.is_half_day) summary.halfDay += 1;
      if (record.is_absent) summary.absent += 1;
      if (record.is_paid_leave) summary.paidLeave += 1;
      if (record.is_unpaid_leave) summary.unpaidLeave += 1;
      if (record.is_late) summary.late += 1;
      return summary;
    },
    { totalEmployees: 0, present: 0, working: 0, halfDay: 0, absent: 0, paidLeave: 0, unpaidLeave: 0, late: 0 }
  );
}

function buildEmployeeStats(records = []) {
  const summary = summarize(records);
  const effectivePresent = summary.present + summary.working + summary.halfDay * 0.5;
  const denominator = effectivePresent + summary.absent;
  return {
    workingDays: records.filter((record) => !["holiday", "sunday"].includes(record.attendance_status)).length,
    fullDays: summary.present,
    working: summary.working,
    halfDays: summary.halfDay,
    effectivePresent,
    absent: summary.absent,
    paidLeave: summary.paidLeave,
    unpaidLeave: summary.unpaidLeave,
    late: summary.late,
    attendancePercentage: denominator ? Math.round((effectivePresent / denominator) * 100) : 0,
  };
}

export async function getAdminDashboardAttendance({ start, end, summaryDate, branch }) {
  const rangeDates = dateRange(start, end);
  const branchClause = branch ? "AND u.branch = $3" : "";
  const singleBranchClause = branch ? "AND u.branch = $1" : "";
  const params = branch ? [start, end, branch] : [start, end];

  const [employeesResult, attendanceResult, holidaysResult, pendingResult, pendingItemsResult, departmentsResult] = await Promise.all([
    pool.query(
      `SELECT id, full_name, department, branch, employee_code
       FROM users u
       WHERE u.role <> 'SUPER_ADMIN' AND COALESCE(u.status, 'active') = 'active' ${singleBranchClause}
       ORDER BY u.full_name`,
      branch ? [branch] : []
    ),
    pool.query(
      `SELECT l.id, l.leave_type, l.from_date, l.to_date, l.days, l.reason, l.status,
              u.full_name, u.department, u.branch
       FROM leave_requests l JOIN users u ON u.id = l.user_id
       WHERE LOWER(l.status) = 'pending' AND u.role <> 'SUPER_ADMIN' ${singleBranchClause}
       ORDER BY l.created_at DESC LIMIT 5`,
      branch ? [branch] : []
    ),
    pool.query(
      `SELECT user_id, TO_CHAR(date, 'YYYY-MM-DD') AS date, status, check_in_time, check_out_time,
              late_minutes, production_hours, total_break_minutes, half_day_slot,
              leave_type, leave_status, is_paid_leave, leave_request_id
       FROM attendance_records a
       JOIN users u ON u.id = a.user_id
       WHERE a.date BETWEEN $1::date AND $2::date AND u.role <> 'SUPER_ADMIN' ${branchClause}
       ORDER BY a.user_id, a.date`,
      params
    ),
    pool.query(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, name, type, branch
       FROM company_holidays
       WHERE date BETWEEN $1::date AND $2::date
         AND (LOWER(COALESCE(branch, 'all')) = 'all' ${branch ? "OR branch = $3" : ""})`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM leave_requests l JOIN users u ON u.id = l.user_id
       WHERE LOWER(l.status) = 'pending' AND u.role <> 'SUPER_ADMIN' ${singleBranchClause}`,
      branch ? [branch] : []
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM departments
       ${branch ? "WHERE branch = 'All' OR branch = $1" : ""}`,
      branch ? [branch] : []
    ),
  ]);

  const employees = employeesResult.rows;
  const attendanceByEmployeeDate = new Map(
    attendanceResult.rows.map((row) => [`${row.user_id}|${row.date}`, row])
  );
  const holidayByDate = new Map(holidaysResult.rows.map((row) => [row.date, row]));
  const monthlyEmployeeRecords = new Map();
  const dailySummary = [];

  for (const date of rangeDates) {
    const dayRecords = employees.map((employee) => {
      const raw = attendanceByEmployeeDate.get(`${employee.id}|${date}`);
      const holiday = holidayByDate.get(date);
      return {
        ...employee,
        date,
        check_in_time: raw?.check_in_time || null,
        check_out_time: raw?.check_out_time || null,
        late_minutes: Number(raw?.late_minutes || 0),
        production_hours: Number(raw?.production_hours || 0),
        total_break_minutes: Number(raw?.total_break_minutes || 0),
        half_day_slot: raw?.half_day_slot || null,
        leave_type: raw?.leave_type || null,
        leave_status: raw?.leave_status || null,
        leave_request_id: raw?.leave_request_id || null,
        holiday_name: holiday?.name || null,
        ...calculateFinalAttendanceStatus({ record: raw, date, holiday, today: summaryDate }),
      };
    });
    dailySummary.push({ date, ...summarize(dayRecords) });
    for (const record of dayRecords) {
      if (!monthlyEmployeeRecords.has(record.id)) monthlyEmployeeRecords.set(record.id, []);
      monthlyEmployeeRecords.get(record.id).push(record);
    }
  }

  const employeesWithStats = employees.map((employee) => {
    const records = monthlyEmployeeRecords.get(employee.id) || [];
    return { ...employee, stats: buildEmployeeStats(records), records };
  });
  const monthlyStats = summarize(employeesWithStats.flatMap((employee) => employee.records));
  const todaySummary = dailySummary.find((day) => day.date === summaryDate) || { ...summarize([]), date: summaryDate };
  const branchStats = Array.from(
    employeesWithStats.reduce((map, employee) => {
      const current = map.get(employee.branch) || { name: employee.branch, totalEmployees: 0, percentageTotal: 0 };
      current.totalEmployees += 1;
      current.percentageTotal += employee.stats.attendancePercentage;
      map.set(employee.branch, current);
      return map;
    }, new Map()).values()
  ).map((entry) => ({ ...entry, attendancePercentage: entry.totalEmployees ? Math.round(entry.percentageTotal / entry.totalEmployees) : 0 }));
  const holidayDates = new Set(holidaysResult.rows.map((row) => row.date));
  const calendar = {
    totalDays: rangeDates.length,
    sundays: rangeDates.filter(isSunday).length,
    holidays: holidayDates.size,
    workingDays: rangeDates.filter((date) => !isSunday(date) && !holidayDates.has(date)).length,
  };
  const alerts = [
    ...employeesWithStats
      .flatMap((employee) => employee.records.filter((record) => record.date === summaryDate && record.is_late)
        .map((record) => ({ color: "#FF8C00", text: `${record.full_name} — ${record.late_minutes}m late`, time: "Today" })))
      .slice(0, 3),
    ...employeesWithStats
      .filter((employee) => employee.stats.attendancePercentage < 50 && employee.stats.workingDays > 5)
      .slice(0, 3)
      .map((employee) => ({ color: "#DC2626", text: `${employee.full_name} — only ${employee.stats.attendancePercentage}% MTD`, time: "MTD" })),
  ].slice(0, 5);

  return {
    summary: todaySummary,
    dailySummary,
    employees: employeesWithStats,
    monthlyStats,
    branchStats,
    holidays: holidaysResult.rows.map((row) => ({ date: row.date, name: row.name, type: row.type })),
    pendingLeaves: Number(pendingResult.rows[0]?.count || 0),
    pendingLeaveItems: pendingItemsResult.rows,
    departmentCount: Number(departmentsResult.rows[0]?.count || 0),
    calendar,
    alerts,
    metadata: { start, end, summaryDate, branch: branch || "all" },
  };
}
