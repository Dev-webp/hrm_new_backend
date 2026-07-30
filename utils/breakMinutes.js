const STANDARD_BREAKS = ["break1", "lunch", "break2"];

export function parseBreakTimeToMinutes(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const meridianMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (meridianMatch) {
    let hours = Number(meridianMatch[1]);
    const minutes = Number(meridianMatch[2]);
    const meridian = meridianMatch[3].toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (meridian === "PM" && hours !== 12) hours += 12;
    if (meridian === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const parts = raw.split(":").map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }
  return parts[0] * 60 + parts[1];
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseSessions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pairMinutes(start, end, workStart = null, workEnd = null) {
  const startMinutes = parseBreakTimeToMinutes(start);
  const endMinutes = parseBreakTimeToMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return 0;
  }

  const effectiveStart = workStart === null ? startMinutes : Math.max(startMinutes, workStart);
  const effectiveEnd = workEnd === null ? endMinutes : Math.min(endMinutes, workEnd);
  return Math.max(0, effectiveEnd - effectiveStart);
}

function sessionMinutes(session, workStart = null, workEnd = null) {
  const stored = positiveNumber(session?.duration_minutes ?? session?.duration);
  if (stored > 0) return stored;
  return pairMinutes(session?.start ?? session?.start_time, session?.end ?? session?.end_time, workStart, workEnd);
}

function namedBreakMinutes(source, key, startField, endField, workStart, workEnd) {
  const nested = source?.[key] || {};
  const stored = positiveNumber(
    nested.duration_minutes ??
      nested.duration ??
      source?.[`${key}_duration_minutes`] ??
      source?.[`${key}_duration`]
  );
  if (stored > 0) return stored;

  const start = nested.start ?? nested.start_time ?? source?.[startField];
  const end = nested.end ?? nested.end_time ?? source?.[endField];
  return pairMinutes(start, end, workStart, workEnd);
}

export function calculateBreakMinutes(source = {}) {
  if (!source) return 0;

  const workStart = parseBreakTimeToMinutes(source.office_in ?? source.check_in_time);
  const workEnd = parseBreakTimeToMinutes(source.office_out ?? source.check_out_time);
  const boundedWorkStart = workStart !== null && workEnd !== null && workEnd > workStart ? workStart : null;
  const boundedWorkEnd = workStart !== null && workEnd !== null && workEnd > workStart ? workEnd : null;

  let total = 0;
  total += namedBreakMinutes(source, "break1", "break_in", "break_out", boundedWorkStart, boundedWorkEnd);
  total += namedBreakMinutes(source, "lunch", "lunch_in", "lunch_out", boundedWorkStart, boundedWorkEnd);
  total += namedBreakMinutes(source, "break2", "break_in_2", "break_out_2", boundedWorkStart, boundedWorkEnd);

  const break3Sessions = parseSessions(source.break3Sessions ?? source.break3_sessions);
  if (break3Sessions.length) {
    total += break3Sessions.reduce(
      (sum, session) => sum + sessionMinutes(session, boundedWorkStart, boundedWorkEnd),
      0
    );
  } else {
    total += namedBreakMinutes(source, "break3", "break3_in", "break3_out", boundedWorkStart, boundedWorkEnd);
  }

  const extraIns = Array.isArray(source.extra_break_ins) ? source.extra_break_ins : [];
  const extraOuts = Array.isArray(source.extra_break_outs) ? source.extra_break_outs : [];
  const pairCount = Math.min(extraIns.length, extraOuts.length);
  for (let i = 0; i < pairCount; i += 1) {
    total += pairMinutes(extraIns[i], extraOuts[i], boundedWorkStart, boundedWorkEnd);
  }

  if (total <= 0) {
    total = positiveNumber(source.total_break_minutes);
  }

  return Math.max(0, Math.round(total));
}

export function calculateBreakMinutesFromRows(rows = []) {
  return Math.max(
    0,
    Math.round(
      rows.reduce((sum, row) => {
        if (row?.break_type === "break3") {
          const sessions = parseSessions(row.break3_sessions);
          if (sessions.length) {
            return sum + sessions.reduce((sessionSum, session) => sessionSum + sessionMinutes(session), 0);
          }
        }
        return sum + sessionMinutes({
          start: row?.start_time,
          end: row?.end_time,
          duration_minutes: row?.duration_minutes,
        });
      }, 0)
    )
  );
}

export function attachTotalBreakMinutes(groupedBreaks = {}) {
  return {
    ...groupedBreaks,
    total_break_minutes: calculateBreakMinutes(groupedBreaks),
  };
}

export { STANDARD_BREAKS };
