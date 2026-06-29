export function formatTime12Hour(time) {
  if (!time) return "-";

  const match = String(time).match(/(\d{1,2}):(\d{2})/);
  if (!match) return String(time);

  const hours = Number(match[1]);
  const minutes = match[2];
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
