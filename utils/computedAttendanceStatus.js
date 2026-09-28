import {
  buildMonthlyLateStats,
  calculateLateMinutes,
  classifyDayPolicy,
  formatDateStr,
  parseDateStr,
  timeToSeconds,
} from "./attendancePolicy.js";

const STATUS_LABELS = {
  full_day: "Present",
  present: "Present",
  half_day: "Half Day",
  absent: "Absent",
  paid_leave: "Paid Leave",
  unpaid_leave: "Unpaid Leave",
  mixed_leave: "Mixed Leave",
  leave: "Leave",
  holiday: "Holiday",
  sunday: "Sunday / Weekly Off",
  no_record: "No Record",
  in_progress: "Working",
  working: "Working",
  missing_checkout: "Missing Checkout",
};

const POLICY_STATUS_MAP = {
  full_day: "full_day",
  present: "present",
  half_day: "half_day",
  paid_leave: "paid_leave",
  unpaid_leave: "unpaid_leave",
  mixed_leave: "mixed_leave",
  leave: "leave",
  holiday: "holiday",
  absent: "absent",
};

// Statuses that count as "present" for dashboards (late is present).
const PRESENT_LIKE_STATUSES = [
  "full_day",
  "present",
  "working",
  "in_progress",
  "late",
];

// Statuses that count as "leave" for dashboards.
const LEAVE_LIKE_STATUSES = ["leave", "paid_leave", "unpaid_leave"];

function normalizeDateStr(value) {
  if (!value) return null;
  if (value instanceof Date) return formatDateStr(value);
  return String(value).slice(0, 10);
}

function normalizeTime(value) {
  if (!value) return null;
  return String(value).slice(0, 8);
}

function isSunday(dateStr) {
  if (!dateStr) return false;
  return parseDateStr(dateStr).getDay() === 0;
}

function labelFor(status) {
  return STATUS_LABELS[status] || "Absent";
}

function todayDateStr() {
  return formatDateStr(new Date());
}

function buildPolicyLog(record = {}) {
  if (!record) return null;

  return {
    ...record,
    office_in: normalizeTime(record.office_in ?? record.check_in_time),
    office_out: normalizeTime(record.office_out ?? record.check_out_time),
    break_in: normalizeTime(record.break_in ?? record.break1_in),
    break_out: normalizeTime(record.break_out ?? record.break1_out),
    break_in_2: normalizeTime(record.break_in_2 ?? record.break2_in),
    break_out_2: normalizeTime(record.break_out_2 ?? record.break2_out),
    lunch_in: normalizeTime(record.lunch_in),
    lunch_out: normalizeTime(record.lunch_out),
    break3_in: normalizeTime(record.break3_in),
    break3_out: normalizeTime(record.break3_out),
    break3_duration_minutes: Number(record.break3_duration_minutes || 0),
    break3_sessions: record.break3_sessions || record.break3Sessions || [],
    total_break_minutes: Number(record.total_break_minutes || 0),
  };
}

/*
|--------------------------------------------------------------------------
| SINGLE SOURCE OF TRUTH — explicit boolean fields
|--------------------------------------------------------------------------
| Every consumer (dashboard summary counts, bulk-monthly, range summary,
| frontend) should read these instead of re-deriving status from raw
| check-in/out times or hardcoded time windows.
|--------------------------------------------------------------------------
*/
function withComputedFields(record, computed) {
  const status = computed.computed_status;

  return {
    ...record,
    status,
    computed_status: status,
    display_status: computed.display_status,
    policy_status: computed.policy_status,
    policy_bucket: computed.policy_status,
    late_minutes: computed.late_minutes,
    production_hours: computed.production_hours,
    total_break_minutes: computed.total_break_minutes,
    policy_reason: computed.policy_reason,
    policy_flags: computed.policy_flags,
    attendance_track: computed.attendance_track,
    required_checkout_time: computed.required_checkout_time,

    is_in_progress: status === "in_progress",
    is_missing_checkout: status === "missing_checkout",

    // Explicit, authoritative flags — dashboards and frontend should trust
    // these directly instead of recomputing.
    is_present: PRESENT_LIKE_STATUSES.includes(status),
    is_absent: status === "absent",
    is_half_day: status === "half_day",
    is_leave: LEAVE_LIKE_STATUSES.includes(status),
    is_holiday: status === "holiday" || status === "sunday",
    is_late:
      Number(computed.late_minutes) > 0 &&
      PRESENT_LIKE_STATUSES.includes(status),
  };
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const PAID_LEAVE_TYPES = new Set(["paid_leave", "paid", "earned", "pl"]);
const UNPAID_LEAVE_TYPES = new Set(["unpaid_leave", "unpaid", "loss_of_pay", "lop"]);

function resolveLeaveContext(record = {}) {
  const rawStatus = normalizeToken(record.status ?? record.day_status ?? record.attendance_status);
  const leaveType = normalizeToken(record.leave_type ?? record.leaveType);
  const leaveStatus = normalizeToken(record.leave_status ?? record.leaveStatus);
  const durationType = normalizeToken(record.leave_duration_type);
  const slot = String(record.half_day_slot || "").toUpperCase();
  const paidDays = Number(record.paid_days ?? record.paidDays ?? 0);
  const unpaidDays = Number(record.unpaid_days ?? record.unpaidDays ?? 0);
  const approved = leaveStatus === "approved";

  // Half-day is decided FIRST, so a paid half-day is never read as a full paid-leave day.
  const isHalfDayLeave =
    durationType === "half_day" ||
    (approved && (slot === "SLOT_A" || slot === "SLOT_B" || rawStatus === "half_day"));

  const storedFullLeave = ["paid_leave", "unpaid_leave", "leave"].includes(rawStatus);
  const isFullDayLeave =
    !isHalfDayLeave &&
    (storedFullLeave || (approved && (leaveType !== "" || paidDays > 0 || unpaidDays > 0)));

  let kind = "leave";
  if (rawStatus === "paid_leave") kind = "paid_leave";
  else if (rawStatus === "unpaid_leave") kind = "unpaid_leave";
  else if (PAID_LEAVE_TYPES.has(leaveType) || record.is_paid_leave === true || record.isPaidLeave === true) kind = "paid_leave";
  else if (UNPAID_LEAVE_TYPES.has(leaveType) || record.is_unpaid_leave === true || record.isUnpaidLeave === true) kind = "unpaid_leave";
  else if (paidDays > 0 && unpaidDays === 0) kind = "paid_leave";
  else if (unpaidDays > 0 && paidDays === 0) kind = "unpaid_leave";

  return { isHalfDayLeave, isFullDayLeave, kind };
}

export function getLiveAttendanceStatus(record = {}, context = {}) {
  const dateStr = normalizeDateStr(context.dateStr || record?.date);
  const todayStr = normalizeDateStr(context.todayStr) || todayDateStr();
  const log = buildPolicyLog(record);

  if (!log?.office_in || log?.office_out) {
    return null;
  }

  if (!dateStr || dateStr >= todayStr) {
    return {
      computed_status: "in_progress",
      display_status: labelFor("in_progress"),
      policy_status: "in_progress",
      policy_reason: "Active working day, checkout pending",
      policy_flags: ["active_working_day"],
      late_minutes: calculateLateMinutes(log.office_in),
      production_hours: 0,
      total_break_minutes: Number(record?.total_break_minutes || 0),
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  return {
    computed_status: "absent",
    display_status: labelFor("absent"),
    policy_status: "absent",
    policy_reason: "Missed checkout, date has passed",
    policy_flags: ["missing_checkout_previous_date"],
    late_minutes: calculateLateMinutes(log.office_in),
    production_hours: 0,
    total_break_minutes: Number(record?.total_break_minutes || 0),
    attendance_track: null,
    required_checkout_time: null,
  };
}

export function getComputedAttendanceStatus(record = {}, context = {}) {
  const dateStr = normalizeDateStr(context.dateStr || record?.date);
  const todayStr = normalizeDateStr(context.todayStr) || todayDateStr();
  const holidaySet = context.holidaySet || new Set();
  const noRecordStatus = context.noRecordStatus || "absent";
  const logsByDate = context.logsByDate || {};

  const monthlyLateStats =
    context.monthlyLateStats ||
    (dateStr
      ? buildMonthlyLateStats(
          logsByDate,
          new Date(parseDateStr(dateStr).getFullYear(), parseDateStr(dateStr).getMonth() + 1, 0).getDate(),
          parseDateStr(dateStr).getFullYear(),
          parseDateStr(dateStr).getMonth() + 1
        )
      : {});

  const log = buildPolicyLog(record);
  const hasPunch = Boolean(log?.office_in || log?.office_out);
  const leave = resolveLeaveContext(record);
  const totalBreak = Number(record?.total_break_minutes || 0);

  // ============================================================
  // IMPORTANT: Half-day leave must NOT determine attendance status
  // ============================================================
  // Business rule: Attendance status must be determined by actual
  // punch data and attendance policy, NOT by leave request type.
  // However, if punch data exists with leave metadata, calculate
  // actual attendance status from the punch data.
  // ============================================================

  // If punch data exists, calculate status from work hours
  if (hasPunch) {
    const inSec = timeToSeconds(log.office_in);
    const outSec = timeToSeconds(log.office_out);
    const grossWorkSec = Math.max(0, outSec - inSec);
    const grossWorkHours = grossWorkSec / 3600;

    let calculatedStatus = "absent";
    let halfDaySlot = null;
    let prodHours = grossWorkHours;

    if (grossWorkHours >= 6) {
      calculatedStatus = "full_day";
    } else if (grossWorkHours >= 3) {
      calculatedStatus = "half_day";
      // Determine slot based on check-in time
      const inMin = inSec / 60;
      if (inMin < 810) { // Before 13:30
        halfDaySlot = "SLOT_A"; // Morning
      } else {
        halfDaySlot = "SLOT_B"; // Afternoon
      }
    }

    return {
      computed_status: calculatedStatus,
      display_status: labelFor(calculatedStatus),
      policy_status: calculatedStatus,
      policy_bucket: calculatedStatus,
      policy_reason: "Calculated from punch data",
      policy_flags: ["punch_data", ...(leave.isFullDayLeave ? ["leave_present"] : [])],
      half_day_slot: halfDaySlot,
      late_minutes: calculateLateMinutes(log.office_in),
      production_hours: prodHours,
      total_break_minutes: totalBreak,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  // 1. Approved full-day leave WINS, even if there is punch data
  if (leave.isFullDayLeave) {
    return {
      computed_status: leave.kind,
      display_status: labelFor(leave.kind),
      policy_status: leave.kind,
      policy_bucket: leave.kind,
      policy_reason: hasPunch
        ? "Approved leave takes priority over punch data"
        : record?.policy_reason || record?.reason || labelFor(leave.kind),
      policy_flags: [leave.kind, "approved_leave_wins", ...(hasPunch ? ["punch_ignored_on_leave_day"] : [])],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: totalBreak,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  // 3. Checked in, not checked out yet
  const liveStatus = getLiveAttendanceStatus(record, { ...context, dateStr, todayStr });
  if (liveStatus) return liveStatus;

  // 4. Sunday / company holiday with no punch
  if (!hasPunch && isSunday(dateStr)) {
    return {
      computed_status: "sunday",
      display_status: labelFor("sunday"),
      policy_status: "holiday",
      policy_reason: "Sunday weekly off",
      policy_flags: ["sunday_weekly_off"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: 0,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  if (!hasPunch && holidaySet.has(dateStr)) {
    return {
      computed_status: "holiday",
      display_status: labelFor("holiday"),
      policy_status: "holiday",
      policy_reason: "Company holiday",
      policy_flags: ["company_holiday"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: 0,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  // 5. No punch, no leave data: past = absent, today/future = no_record
  if (!hasPunch && !record?.leave_type && !record?.leave_status) {
    const status = dateStr && dateStr >= todayStr ? "no_record" : noRecordStatus;
    return {
      computed_status: status,
      display_status: labelFor(status),
      policy_status: status,
      policy_reason: status === "no_record" ? "No attendance record" : "No attendance record - absent",
      policy_flags: ["no_attendance_record"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: 0,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  // 6. Normal punch-based policy
  const policy = classifyDayPolicy({ dateStr, log, holidaySet, monthlyLateStats, logsByDate });
  const computedStatus = POLICY_STATUS_MAP[policy.bucket] || "absent";

  return {
    computed_status: computedStatus,
    display_status: labelFor(computedStatus),
    policy_status: policy.bucket,
    policy_bucket: policy.bucket,
    policy_reason: policy.reason,
    policy_flags: policy.flags || [],
    late_minutes: calculateLateMinutes(log?.office_in),
    production_hours: Number(policy.net_hours ?? 0),
    total_break_minutes: Number(policy.total_break_minutes ?? record?.total_break_minutes ?? 0),
    attendance_track: policy.attendance_track || null,
    required_checkout_time: policy.required_checkout_time || null,
  };
}

export function calculateAttendanceStatus(input = {}) {
  const record = {
    date: input.date ?? input.dateStr,
    check_in_time: input.check_in_time,
    check_out_time: input.check_out_time,
    total_break_minutes: input.total_break_minutes,
    late_minutes: input.late_minutes,
    leave_type: input.leave_type,
    leave_status: input.leave_status,
    is_paid_leave: input.is_paid_leave,
    isPaidLeave: input.isPaidLeave,
    paid_days: input.paid_days,
    paidDays: input.paidDays,
    is_unpaid_leave: input.is_unpaid_leave,
    isUnpaidLeave: input.isUnpaidLeave,
    unpaid_days: input.unpaid_days,
    unpaidDays: input.unpaidDays,
    half_day_slot: input.half_day_slot,
    break_in: input.break_in,
    break_out: input.break_out,
    break_in_2: input.break_in_2,
    break_out_2: input.break_out_2,
    lunch_in: input.lunch_in,
    lunch_out: input.lunch_out,
    status: input.status,
    day_status: input.day_status,
  };

  const computed = getComputedAttendanceStatus(record, {
    dateStr: input.date ?? input.dateStr,
    holidaySet: input.holidaySet || new Set(),
    logsByDate: input.logsByDate || {},
    monthlyLateStats: input.monthlyLateStats || input.late_count_for_month || {},
    noRecordStatus: input.noRecordStatus,
    todayStr: input.todayStr,
  });

  return {
    status: computed.computed_status,
    production_hours: computed.production_hours,
    late_minutes: computed.late_minutes,
    half_day_slot: computed.computed_status === "half_day" ? input.half_day_slot || null : null,
    reason: computed.policy_reason,
    total_break_minutes: computed.total_break_minutes,
    flags: computed.policy_flags,
    attendance_track: computed.attendance_track,
    required_checkout_time: computed.required_checkout_time,
  };
}

export function withComputedAttendanceStatus(record = {}, context = {}) {
  return withComputedFields(
    record,
    getComputedAttendanceStatus(record, { ...context, dateStr: context.dateStr || record?.date })
  );
}

export function mapPolicyBucketToComputedStatus(bucket) {
  return POLICY_STATUS_MAP[bucket] || "absent";
}