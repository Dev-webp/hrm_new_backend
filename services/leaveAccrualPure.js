/** Pure earned-leave helpers (no DB) — safe for unit tests. */

export function safeDate(d) {
  if (!d) return null;
  const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function monthsSinceJoining(joiningDate, asOf = new Date()) {
  const joined = safeDate(joiningDate);
  if (!joined) return 0;
  const ref = safeDate(asOf);
  return (
    (ref.getFullYear() - joined.getFullYear()) * 12 +
    (ref.getMonth() - joined.getMonth())
  );
}

export function getEligibilityDate(joiningDate, probationMonths = 3) {
  const joined = safeDate(joiningDate);
  if (!joined) return null;
  const d = new Date(joined);
  d.setMonth(d.getMonth() + probationMonths);
  return d;
}

export function normalizeLeaveType(leaveType) {
  if (!leaveType) return "Unpaid";
  const t = String(leaveType).trim().toLowerCase();
  if (t === "paid" || t === "earned") return "Paid";
  if (t === "unpaid" || t === "lwp") return "Unpaid";
  return leaveType === "Paid" ? "Paid" : "Unpaid";
}

export function isPaidLeaveType(leaveType) {
  return normalizeLeaveType(leaveType) === "Paid";
}

export function isEarnedLeaveType(leaveType) {
  return isPaidLeaveType(leaveType);
}
