export const BREAK_ACTIVITY_TYPES = ["break1", "break2", "lunch", "break3"];

export const BREAK_ACTIVITY_LABELS = {
  break1: "Break 1",
  break2: "Break 2",
  lunch: "Lunch",
  break3: "Break 3",
};

function normalizedTime(value) {
  const time = String(value ?? "").trim();
  return !time || time === "--" || time === "00:00" ? null : time;
}

function normalizedDuration(value) {
  const duration = Number(value || 0);
  return Number.isFinite(duration) ? duration : 0;
}

export function classifyBreakActivity(actorId, targetEmployeeId) {
  const isSelfAction = Number(actorId) === Number(targetEmployeeId);
  return {
    isSelfAction,
    action: isSelfAction ? "BREAK_SELF_UPDATED" : "BREAK_EDITED",
    actionType: "break_changed",
  };
}

export function buildBreakChangeRows(oldValues = {}, newValues = {}) {
  return BREAK_ACTIVITY_TYPES.map((breakType) => {
    const oldValue = oldValues[breakType] || {};
    const newValue = newValues[breakType] || {};
    const oldStart = normalizedTime(oldValue.start_time);
    const oldEnd = normalizedTime(oldValue.end_time);
    const newStart = normalizedTime(newValue.start_time);
    const newEnd = normalizedTime(newValue.end_time);
    const oldDuration = normalizedDuration(oldValue.duration_minutes);
    const newDuration = normalizedDuration(newValue.duration_minutes);
    const oldMissing = !oldStart && !oldEnd;
    const newMissing = !newStart && !newEnd;

    let change = "No change";
    if (oldMissing && !newMissing) change = "Added";
    else if (!oldMissing && newMissing) change = "Removed";
    else if (oldStart !== newStart && oldEnd !== newEnd) change = "Start and end changed";
    else if (oldStart !== newStart) change = "Start time changed";
    else if (oldEnd !== newEnd) change = "End time changed";
    else if (oldDuration !== newDuration) change = "Duration changed";

    return {
      break_type: breakType,
      label: BREAK_ACTIVITY_LABELS[breakType],
      old_start_time: oldStart,
      old_end_time: oldEnd,
      new_start_time: newStart,
      new_end_time: newEnd,
      old_duration_minutes: oldDuration,
      new_duration_minutes: newDuration,
      change,
    };
  });
}
