// Time functions

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
function minISO(a, b) { return (a < b) ? a : b; }
function maxISO(a, b) { return (a > b) ? a : b; }


function startOfISOWeek(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - day);
  return dayISO(d);
}
function endOfISOWeek(dateISO) {
  const start = new Date(`${startOfISOWeek(dateISO)}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return dayISO(start);
}


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
const DURATION_BY_WEIGHT = {
  5: { 1: 120, 3: 75,  7: 45 },
  4: { 1: 90,  3: 60,  7: 45 },
  3: { 1: 60,  3: 45,  7: 30 },
  2: { 1: 45,  3: 30,  7: 30 },
  1: { 1: 30,  3: 30,  7: 30 }
};

/**
 * Choose lesson anchors in [(today - maxInterval) .. horizonEnd] so that
 * a lesson “yesterday” still spawns +1 today, etc.
 */
function durationFor(weight, interval, floorMinutes = 15, capMinutes = 240) {
    const w = Math.min(5, Math.max(1, Number(weight || 1)));
    const i = Number(interval);
    const table = DURATION_BY_WEIGHT[w] || DURATION_BY_WEIGHT[i];
    const mins = table[i] ?? table[7] ?? 30; // fallback just in case
    // Clamp for safety:
    return Math.max(floorMinutes, Math.min(capMinutes, mins));
}

function expandReviews(modules, horizonStartISO, horizonEndISO) {
  const weekStartISO = startOfISOWeek(horizonStartISO);
  const weekEndISO   = endOfISOWeek(horizonStartISO);

  // pick only this week's lessons
  const inThisWeek = (dateISO) => (dateISO >= weekStartISO && dateISO <= weekEndISO);

  const lessons = (modules || []).filter(
    e => e.type === 'lesson' && e.date && inThisWeek(e.date)
  );

  // one anchor per module (course)
  const byModule = new Map();
  for (const e of lessons) {
    const key = e.courseCode || e.courseName || e.title || 'Module';
    // if a module had >1 lesson in a week, keep the earliest in that week
    if (!byModule.has(key) || e.date < byModule.get(key).date) {
      byModule.set(key, e);
    }
  }

  const out = [];
  for (const e of byModule.values()) {
    out.push({
      moduleName: e.courseCode || e.courseName || e.title || 'Module',
      anchorDate: e.date,
      weight: e.weightage || 1,
      intervals: DEFAULT_INTERVALS
    });
  }
  return out;
}

function diffDays(aISO, bISO) {
  const a = new Date(aISO), b = new Date(bISO);
  return Math.floor((b - a) / (24 * 3600 * 1000));
}

function uniqueModules(modules) {
  const byKey = new Map();
  for (const m of modules || []) {
    if (!m) continue;
    const key = (m.courseCode || m.title || '').toUpperCase().trim();
    if (!key) continue;
    const weight = Number(m.weightage || 1);
    if (!byKey.has(key)) {
      byKey.set(key, { moduleName: (m.title || m.courseCode || key), weight });
    } else {
      // keep the max weight across occurrences
      byKey.get(key).weight = Math.max(byKey.get(key).weight, weight);
    }
  }
  return Array.from(byKey.values());
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
  if (!semester?.startDate || !semester?.endDate) throw new Error('Missing semester dates');
  if (!cfg?.dailyStart || !cfg?.dailyEnd) throw new Error('Missing schedulerConfig.dailyStart/dailyEnd');

  const INTERVALS = [1, 3, 7];
  const minMinutes = Number(cfg.minStudyDuration ?? 30);

  const horizonStartISO = todayISO();
  const horizonEndISO   = addDaysISO(horizonStartISO, Math.max(1, Number(cfg.weeksToGenerate || 4)) * 7);

  // Respect semester clamp
  const windowStartISO = horizonStartISO < semester.startDate ? semester.startDate : horizonStartISO;
  const windowEndISO   = horizonEndISO   > semester.endDate   ? semester.endDate   : horizonEndISO;

  if (windowStartISO > windowEndISO) return { sessions: [] };

  // Build daily windows within [windowStartISO .. windowEndISO]
  const dailyWindows = buildDailyWindows(semester, cfg, windowStartISO, windowEndISO);

  // Busy map from lessons + personal events
  const busyMap = {};
  for (const day of Object.keys(dailyWindows)) {
    busyMap[day] = toBusyForDay(day, [...(modules || []), ...(personalEvents || [])]);
  }

  // Group lessons by module (use title first, then courseCode, then courseName)
  const lessonsByModule = {};
  (modules || []).forEach(m => {
    if (m?.type !== 'lesson' || !m.date) return;
    const key = (m.title || m.courseCode || m.courseName || 'Unknown').trim();
    if (!lessonsByModule[key]) lessonsByModule[key] = [];
    lessonsByModule[key].push({
      date: m.date,
      weight: Number(m.weightage ?? 1)
    });
  });
  // sort lesson dates per module
  for (const k of Object.keys(lessonsByModule)) {
    lessonsByModule[k].sort((a, b) => a.date.localeCompare(b.date));
  }

  // How many cycles can fit in the horizon (≈ 8 days per cycle)
  const horizonDays = Math.floor((Date.parse(windowEndISO) - Date.parse(windowStartISO)) / 86400000) + 1;
  const cyclesPerModule = Math.max(1, Math.floor(horizonDays / 8)); // e.g. 3w → floor(21/8)=2

  const sessions = [];

  // Iterate modules; heavier modules first (by their first lesson weight, falling back to 1)
  const moduleKeys = Object.keys(lessonsByModule).sort((ka, kb) => {
    const wa = lessonsByModule[ka][0]?.weight ?? 1;
    const wb = lessonsByModule[kb][0]?.weight ?? 1;
    return wb - wa;
  });

  for (const mod of moduleKeys) {
    const lessonList = lessonsByModule[mod];  // [{date, weight}...]
    const baseWeight = lessonList[0]?.weight ?? 1;

    // cycle cursor = earliest possible anchor search point (start of window)
    let cycleCursorISO = windowStartISO;

    for (let cycle = 0; cycle < cyclesPerModule; cycle++) {
      // Pick anchor: first lesson date >= cycleCursorISO
      const anchorItem = lessonList.find(d => d.date >= cycleCursorISO);
      if (!anchorItem) break; // no more anchors available this semester/horizon

      const anchorDateISO = anchorItem.date;

      // Attempt this cycle's intervals
      for (const interval of INTERVALS) {
        const targetDayISO = addDaysISO(anchorDateISO, interval);
        if (targetDayISO < windowStartISO) continue;          // never in the past
        if (targetDayISO > windowEndISO) break;               // beyond horizon/semester; stop intervals for this cycle

        const mins = durationFor(baseWeight, interval, minMinutes);
        const slot = findSlotOnOrAfter(targetDayISO, mins, dailyWindows, busyMap);
        if (!slot) continue; // couldn't fit this interval within the window; skip it

        // Reserve and record
        const dayBusy = (busyMap[slot.dateISO] ||= []);
        dayBusy.push({ start: slot.start, end: slot.end });
        dayBusy.sort((a, b) => a.start - b.start);

        sessions.push({
          moduleName: mod,
          start: toISO(slot.start),
          end: toISO(slot.end),
          interval,
          status: (slot.dateISO === targetDayISO ? 'planned' : 'moved')
        });
      }

      // Move the cycle cursor forward so the next cycle starts AFTER this one finishes
      // (anchor + 8d ensures cycles are siloed)
      cycleCursorISO = addDaysISO(anchorDateISO, 8);
      // Optional: also nudge cursor if there are no future lessons ≥ cursor
      // (this prevents reusing the same anchor if lesson dates are sparse)
      const nextLesson = lessonList.find(d => d.date >= cycleCursorISO);
      if (!nextLesson) break;
    }
  }

  return { sessions };
}

module.exports = { buildSchedule };