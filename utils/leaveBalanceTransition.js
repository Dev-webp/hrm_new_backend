export function getAttendanceLeaveBalanceDelta(oldStatus, newStatus) {
  const wasPaidLeave = String(oldStatus || "").toLowerCase() === "paid_leave";
  const isPaidLeave = String(newStatus || "").toLowerCase() === "paid_leave";
  const wasUnpaidLeave = String(oldStatus || "").toLowerCase() === "unpaid_leave";
  const isUnpaidLeave = String(newStatus || "").toLowerCase() === "unpaid_leave";

  return {
    paid_days: Number(isPaidLeave) - Number(wasPaidLeave),
    unpaid_days: Number(isUnpaidLeave) - Number(wasUnpaidLeave),
  };
}

export function applyAttendanceLeaveBalanceDelta({
  oldStatus,
  newStatus,
  availablePaidBalance,
  targetPaidUsed,
  targetUnpaidUsed,
}) {
  const requested = getAttendanceLeaveBalanceDelta(oldStatus, newStatus);
  const available = Number(availablePaidBalance || 0);

  if (requested.paid_days > available) {
    const err = new Error(`Insufficient paid leave balance. Available: ${available}`);
    err.statusCode = 400;
    throw err;
  }

  // A status can predate this fix. Never create leave credit when a later
  // manual edit removes a status that was never recorded as used.
  const paidDays = requested.paid_days < 0
    ? -Math.min(Math.abs(requested.paid_days), Number(targetPaidUsed || 0))
    : requested.paid_days;
  const unpaidDays = requested.unpaid_days < 0
    ? -Math.min(Math.abs(requested.unpaid_days), Number(targetUnpaidUsed || 0))
    : requested.unpaid_days;

  return {
    paid_days: paidDays,
    unpaid_days: unpaidDays,
    available_before: available,
    available_after: Math.max(0, available - paidDays),
    target_paid_used_after: Math.max(0, Number(targetPaidUsed || 0) + paidDays),
    target_unpaid_used_after: Math.max(0, Number(targetUnpaidUsed || 0) + unpaidDays),
  };
}
