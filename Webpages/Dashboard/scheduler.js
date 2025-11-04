// Time functions

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function parseTimeHHMM(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function toDateTime(dateStr, hhmm) {
  const { h, m } = parseTimeHHMM(hhmm);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function addMinutes(dt, mins) {
  const d = new Date(dt);
  d.setMinutes(d.getMinutes() + mins);
  return d;
}

function addDays(dt, days) {
  const d = new Date(dt);
  d.setDate(d.getDate() + days);
  return d;
}

function dayISO(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

function addDaysISO(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dayISO(d);
}

function todayISO() {
  const now = new Date();
  return dayISO(now);
}

function toISO(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = dt.getFullYear();
  const m = pad(dt.getMonth() + 1);
  const d = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mm = pad(dt.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function minISO(a, b) { return (a < b) ? a : b; }
function maxISO(a, b) { return (a > b) ? a : b; }

/**
 * Build a map { dateISO: { start: Date, end: Date } } for every day in
 * [horizonStartISO, horizonEndISO], clamped to the semester.
 */
function buildDailyWindows(semester, cfg, horizonStartISO, horizonEndISO) {
  const map = {};
  const startISO = maxISO(horizonStartISO, semester.startDate);
  const endISO   = minISO(horizonEndISO,   semester.endDate);

  const start = new Date(`${startISO}T00:00:00`);
  const end   = new Date(`${endISO}T00:00:00`);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = dayISO(d);
    map[iso] = {
      start: toDateTime(iso, cfg.dailyStart),
      end:   toDateTime(iso, cfg.dailyEnd),
    };
  }
  return map;
}

/**
 * Convert events (lessons + personal) into busy intervals for a given day.
 * Expects events with { date, time/startTime, endTime }.
 */
function toBusyForDay(dateISO, events) {
  const out = [];
  for (const ev of events || []) {
    if (ev.date !== dateISO) continue;
    const startHHMM = ev.startTime || ev.time;
    const endHHMM   = ev.endTime;
    if (!startHHMM || !endHHMM) continue; // skip malformed
    const s = toDateTime(dateISO, startHHMM);
    const e = toDateTime(dateISO, endHHMM);
    if (e <= s) continue; // ignore zero/negative lengths
    out.push({ start: s, end: e });
  }
  // Merge overlaps (normalize)
  out.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const slot of out) {
    if (!merged.length || merged[merged.length - 1].end <= slot.start) {
      merged.push({ ...slot });
    } else {
      merged[merged.length - 1].end = new Date(
        Math.max(merged[merged.length - 1].end, slot.end)
      );
    }
  }
  return merged;
}

/**
 * Given a day window and existing busy slots for that day, try to place a
 * new interval of length `mins` starting as early as possible.
 */
function placeOnDay(dayWindow, busy, mins) {
  const durationMs = mins * 60 * 1000;

  let cursor = new Date(dayWindow.start);
  // walk through gaps between busy blocks
  for (let i = 0; i <= busy.length; i++) {
    const gapEnd = (i < busy.length) ? busy[i].start : dayWindow.end;
    if (cursor.getTime() + durationMs <= gapEnd.getTime()) {
      const start = new Date(cursor);
      const end   = addMinutes(start, mins);
      return { start, end };
    }
    // move cursor to end of this busy block
    if (i < busy.length) {
      cursor = new Date(Math.max(cursor, busy[i].end));
    }
  }
  return null;
}

/**
 * Try to place a session on `targetDayISO` or the next available day within the horizon.
 */
function findSlotOnOrAfter(targetDayISO, mins, dailyWindows, busyMap) {
  const allDays = Object.keys(dailyWindows).sort(); // ISO sorts chronologically
  const startIdx = Math.max(0, allDays.indexOf(targetDayISO));
  for (let i = startIdx; i < allDays.length; i++) {
    const dayISO = allDays[i];
    const window = dailyWindows[dayISO];
    if (!window) continue;
    const busy = busyMap[dayISO] || [];
    const placed = placeOnDay(window, busy, mins);
    if (placed) return { dateISO: dayISO, start: placed.start, end: placed.end };
  }
  return null;
}

// -------------------------------
// Review expansion & schedule
// -------------------------------

const DEFAULT_INTERVALS = [1, 3, 7];

/**
 * Choose lesson anchors in [(today - maxInterval) .. horizonEnd] so that
 * a lesson “yesterday” still spawns +1 today, etc.
 */
function expandReviews(modules, horizonStartISO, horizonEndISO) {
  const maxInterval = Math.max(...DEFAULT_INTERVALS); // 7
  const anchorStartISO = addDaysISO(horizonStartISO, -maxInterval);

  const inWindow = (dateISO) => (dateISO >= anchorStartISO && dateISO <= horizonEndISO);

  const lessons = (modules || []).filter(
    e => e.type === 'lesson' && e.date && inWindow(e.date)
  );

  const out = [];
  for (const e of lessons) {
    out.push({
      moduleName: e.courseCode || e.courseName || e.title || 'Module',
      anchorDate: e.date,
      weight: e.weightage || 1,
      intervals: DEFAULT_INTERVALS
    });
  }
  return out;
}

/**
 * Core entry: build the spaced-repetition schedule.
 * Input payload shape comes directly from your frontend:
 * {
 *   semester: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' },
 *   schedulerConfig: { dailyStart, dailyEnd, minStudyDuration, weeksToGenerate },
 *   modules: [lesson events...],
 *   personalEvents: [non-lesson events...]
 * }
 * Returns: { sessions: [{ moduleName, start, end, interval, status }, ...] }
 */
function buildSchedule(payload) {
  const { semester, schedulerConfig: cfg, modules, personalEvents } = payload || {};
  if (!semester?.startDate || !semester?.endDate) {
    throw new Error('Missing semester dates');
  }
  if (!cfg?.dailyStart || !cfg?.dailyEnd) {
    throw new Error('Missing schedulerConfig.dailyStart/dailyEnd');
  }

  const minutes = clamp(Number(cfg.minStudyDuration ?? 30), 15, 240);
  const weeks   = Math.max(1, Number(cfg.weeksToGenerate || 4));

  const horizonStartISO = todayISO();
  const horizonEndISO   = addDaysISO(horizonStartISO, weeks * 7);

  // 1) Day windows for [today .. today+weeks], clamped by semester
  const dailyWindows = buildDailyWindows(semester, cfg, horizonStartISO, horizonEndISO);

  // 2) Busy map from lessons + personal events (reviews are not included)
  const busyMap = {};
  for (const day of Object.keys(dailyWindows)) {
    busyMap[day] = toBusyForDay(day, [...(modules || []), ...(personalEvents || [])]);
  }

  // 3) Expand review targets by lessons in [(today-7)..horizonEnd]
  const targets = expandReviews(modules || [], horizonStartISO, horizonEndISO);

  // 4) Greedy placement: heavier modules first, then earliest anchors
  targets.sort((a, b) => (b.weight - a.weight) || a.anchorDate.localeCompare(b.anchorDate));

  const sessions = [];
  for (const t of targets) {
    for (const interval of t.intervals) {
      const targetDay = addDaysISO(t.anchorDate, interval);

      // Never schedule in the past
      if (targetDay < horizonStartISO) continue;

      const slot = findSlotOnOrAfter(targetDay, minutes, dailyWindows, busyMap);
      if (!slot) continue; // couldn’t fit within horizon

      // Reserve the time to avoid overlaps with later placements
      const reserved = busyMap[slot.dateISO] || (busyMap[slot.dateISO] = []);
      reserved.push({ start: slot.start, end: slot.end });
      // keep busy list normalized (optional but keeps placement stable)
      reserved.sort((a, b) => a.start - b.start);

      sessions.push({
        moduleName: t.moduleName,
        start: toISO(slot.start),
        end: toISO(slot.end),
        interval,
        status: (slot.dateISO === targetDay ? 'planned' : 'moved')
      });
    }
  }

  return { sessions };
}

export { buildSchedule };