export function formatTime12Hour(time) {
  if (time === null || time === undefined || time === "") return "--";

  const raw = String(time).trim();
  if (!raw || raw === "--" || raw === "—" || raw === "â€”" || raw === "-") return "--";

  const match = raw.match(/(?:T|\b)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?\s*(AM|PM)?\b/i);
  if (!match) return raw;

  let hours = Number(match[1]);
  const minutes = match[2];
  const existingSuffix = match[3]?.toUpperCase();

  if (existingSuffix) {
    if (existingSuffix === "PM" && hours !== 12) hours += 12;
    if (existingSuffix === "AM" && hours === 12) hours = 0;
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour}:${minutes} ${suffix}`;
}

export function formatProductionMinutes(productionMinutes) {
  const totalMinutes = Math.max(0, Math.round(Number(productionMinutes) || 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours} hrs ${minutes.toString().padStart(2, "0")} min`;
}

export function formatProductionHours(productionHours) {
  return formatProductionMinutes((Number(productionHours) || 0) * 60);
}
