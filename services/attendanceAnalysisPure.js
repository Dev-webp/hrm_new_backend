export function monthRange(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, year: y, month: m, lastDay };
}

export function heatmapStatus(rec) {
  if (!rec) return "absent";
  if (rec.status === "sunday") return "sunday";
  if (rec.status === "holiday") return "holiday";
  if (rec.status === "leave") {
    return rec.isPaidLeave ? "paid_leave" : "unpaid_leave";
  }
  if (rec.status === "absent") return "absent";
  if (rec.status === "half_day") return "half_day";
  if (rec.lateMinutes > 0) return "late";
  if (rec.status === "full_day") return "present";
  return "absent";
}
