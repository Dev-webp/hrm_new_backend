import {
  buildMonthlyLateStats,
  calculateLateMinutes,
  classifyDayPolicy,
  formatDateStr,
  parseDateStr,
} from "./attendancePolicy.js";

const STATUS_LABELS = {
  full_day: "Present",
  present: "Present",
  half_day: "Half Day",
  absent: "Absent",
  paid_leave: "Paid Leave",
  unpaid_leave: "Unpaid Leave",
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
          new Date(
            parseDateStr(dateStr).getFullYear(),
            parseDateStr(dateStr).getMonth() + 1,
            0
          ).getDate(),
          parseDateStr(dateStr).getFullYear(),
          parseDateStr(dateStr).getMonth() + 1
        )
      : {});

  const log = buildPolicyLog(record);

  // Leave must be resolved BEFORE live attendance / punch / sunday / holiday /
  // missing checkout / absent / classifyDayPolicy — otherwise leave can be
  // misclassified as absent.
  const rawStatus = String(
    record?.status || record?.day_status || record?.attendance_status || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const leaveType = String(record?.leave_type || record?.leaveType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const isPaidLeave =
    rawStatus === "paid_leave" ||
    rawStatus === "paid" ||
    leaveType === "paid_leave" ||
    leaveType === "paid" ||
    record?.is_paid_leave === true ||
    record?.isPaidLeave === true ||
    Number(record?.paid_days ?? record?.paidDays ?? 0) > 0;

  const isUnpaidLeave =
    rawStatus === "unpaid_leave" ||
    rawStatus === "unpaid" ||
    leaveType === "unpaid_leave" ||
    leaveType === "unpaid" ||
    record?.is_unpaid_leave === true ||
    record?.isUnpaidLeave === true ||
    Number(record?.unpaid_days ?? record?.unpaidDays ?? 0) > 0;

  if (isPaidLeave) {
    return {
      computed_status: "paid_leave",
      display_status: "Paid Leave",
      policy_status: "paid_leave",
      policy_bucket: "paid_leave",
      policy_reason: record?.policy_reason || record?.reason || "Paid leave",
      policy_flags: ["paid_leave"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: Number(record?.total_break_minutes || 0),
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  if (isUnpaidLeave) {
    return {
      computed_status: "unpaid_leave",
      display_status: "Unpaid Leave",
      policy_status: "unpaid_leave",
      policy_bucket: "unpaid_leave",
      policy_reason: record?.policy_reason || record?.reason || "Unpaid leave",
      policy_flags: ["unpaid_leave"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: Number(record?.total_break_minutes || 0),
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  const hasPunch = Boolean(log?.office_in || log?.office_out);

  const liveStatus = getLiveAttendanceStatus(record, { ...context, dateStr, todayStr });
  if (liveStatus) return liveStatus;

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

  if (log?.office_in && !log?.office_out) {
    return {
      computed_status: "absent",
      display_status: labelFor("absent"),
      policy_status: "absent",
      policy_reason: "Missing check-in or checkout",
      policy_flags:
        dateStr && dateStr < todayStr
          ? ["missing_checkout_previous_date"]
          : ["missing_checkout"],
      late_minutes: calculateLateMinutes(log.office_in),
      production_hours: 0,
      total_break_minutes: Number(record?.total_break_minutes || 0),
      attendance_track: null,
      required_checkout_time: null,
    };
  }

  if (!hasPunch && !record?.leave_type && !record?.leave_status) {
    return {
      computed_status: noRecordStatus,
      display_status: labelFor(noRecordStatus),
      policy_status: noRecordStatus,
      policy_reason:
        noRecordStatus === "no_record"
          ? "No attendance record"
          : "No attendance record - absent",
      policy_flags: ["no_attendance_record"],
      late_minutes: 0,
      production_hours: 0,
      total_break_minutes: 0,
      attendance_track: null,
      required_checkout_time: null,
    };
  }

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