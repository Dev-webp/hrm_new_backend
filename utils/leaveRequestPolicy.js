const DURATION_TYPES = new Set(["full_day", "half_day"]);
const HALF_DAY_SESSIONS = new Set(["morning", "afternoon"]);

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function countWorkingDays(fromDate, toDate, holidayDates = new Set()) {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);
  if (!start || !end || end < start) return 0;

  let count = 0;
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateString = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && !holidayDates.has(dateString)) count += 1;
  }
  return count;
}

export function resolveLeaveRequest({
  fromDate,
  toDate,
  leaveDurationType = "full_day",
  halfDaySession = null,
  holidayDates = new Set(),
}) {
  if (!parseDateOnly(fromDate) || !parseDateOnly(toDate)) {
    throw new Error("Valid from_date and to_date are required");
  }
  if (toDate < fromDate) throw new Error("to_date cannot be before from_date");
  if (!DURATION_TYPES.has(leaveDurationType)) {
    throw new Error("leave_duration_type must be full_day or half_day");
  }

  if (leaveDurationType === "half_day") {
    if (fromDate !== toDate) throw new Error("Half-day leave must be for a single date");
    if (!HALF_DAY_SESSIONS.has(halfDaySession)) {
      throw new Error("half_day_session must be morning or afternoon");
    }
    return { requestedDays: 0.5, halfDaySession };
  }

  const requestedDays = countWorkingDays(fromDate, toDate, holidayDates);
  if (requestedDays <= 0) throw new Error("Selected range has no working days");
  return { requestedDays, halfDaySession: null };
}

export function attendanceStatusForLeave(leaveDurationType) {
  return leaveDurationType === "half_day" ? "half_day" : "leave";
}

export function halfDaySlotForSession(session) {
  if (session === "morning") return "SLOT_A";
  if (session === "afternoon") return "SLOT_B";
  return null;
}

export function resolveLeaveBalanceUsage({ usePaidLeave, requestedDays, availableBalance }) {
  const requested = Number(requestedDays || 0);
  const available = Number(availableBalance || 0);
  const paidDays = usePaidLeave ? Math.min(requested, available) : 0;
  const unpaidDays = Math.max(0, requested - paidDays);

  return {
    paidDays,
    unpaidDays,
    remainingBalance: Math.max(0, available - paidDays),
  };
}
