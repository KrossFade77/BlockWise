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
  const table = DURATION_BY_WEIGHT[w] || DURATION_BY_WEIGHT[1]; // fixed fallback
  const mins = table[i] ?? table[7] ?? 30;
  return Math.max(floorMinutes, Math.min(capMinutes, mins));
}

function expandAnchorsThisWeek(modules, todayISO) {
  const weekStartISO = startOfISOWeek(todayISO);
  const weekEndISO   = endOfISOWeek(todayISO);
  const inThisWeek = (d) => d >= weekStartISO && d <= weekEndISO;

  const byModule = new Map();
  for (const e of modules || []) {
    if (e.type !== 'lesson' || !e.date || !inThisWeek(e.date)) continue;
    const key = e.courseCode || e.courseName || e.title || 'Module';
    if (!byModule.has(key) || e.date < byModule.get(key).date) {
      byModule.set(key, { moduleName: key, anchorDate: e.date, weight: Number(e.weightage || 1) });
    }
  }
  return Array.from(byModule.values());
}

function buildLessonsIndex(modules) {
  const idx = new Map();
  for (const e of modules || []) {
    if (e.type !== 'lesson' || !e.date) continue;
    const key = e.courseCode || e.courseName || e.title || 'Module';
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(e.date);
  }
  for (const [k, arr] of idx) arr.sort(); // ISO sort
  return idx;
}

function nextClassAfter(moduleName, afterISO, lessonsIndex) {
  const arr = lessonsIndex.get(moduleName) || [];
  for (const d of arr) if (d > afterISO) return d;
  return null;
}

function futureClassesWithin(moduleName, afterISO, untilISO, lessonsIndex) {
  const arr = lessonsIndex.get(moduleName) || [];
  let n = 0;
  for (const d of arr) if (d > afterISO && d <= untilISO) n++;
  return n;
}

function startOfWeekSunday(dateISO) {
  const d = new Date(dateISO);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
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

  const weeks           = Math.max(1, Number(cfg.weeksToGenerate || 4));
  const horizonStartISO = maxISO(startOfWeekSunday(todayISO()), semester.startDate);
  const horizonEndISO   = minISO(addDaysISO(horizonStartISO, weeks * 7), semester.endDate);
  if (horizonStartISO > horizonEndISO) return { sessions: [] };

  // windows + fixed busy
  const dailyWindows = buildDailyWindows(semester, cfg, horizonStartISO, horizonEndISO);
  const busyMap = {};
  for (const day of Object.keys(dailyWindows)) {
    busyMap[day] = toBusyForDay(day, [...(modules || []), ...(personalEvents || [])]);
  }

  // anchors and lessons index
  const anchors      = expandAnchorsThisWeek(modules || [], horizonStartISO);
  const lessonsIndex = buildLessonsIndex(modules || []);

  // per-module state: single active cycle; restart only from next class after +7
  const states = anchors.map(a => ({
    moduleName: a.moduleName,
    weight: a.weight,
    anchorDate: a.anchorDate, // current cycle’s anchor (a class date)
    idx: 0,                   // 0->+1, 1->+3, 2->+7
    done: false,
    cyclesLeft: futureClassesWithin(a.moduleName, a.anchorDate, horizonEndISO, lessonsIndex) // how many future class anchors available in horizon
  }));

  const sessions = [];
  const MAX_PASSES = 2000;

  // Weight-tiered scheduler: try all W=5 candidates first, then W=4, ..., W=1 in each pass.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let placedSomethingThisPass = false;

    // iterate tiers 5 -> 1
    for (let tier = 5; tier >= 1; tier--) {
      // build candidates for this tier only
      const batch = states.flatMap(s => {
        if (s.done || s.weight !== tier || s.idx >= DEFAULT_INTERVALS.length) return [];
        const interval  = DEFAULT_INTERVALS[s.idx];
        const targetDay = addDaysISO(s.anchorDate, interval);
        return (targetDay <= horizonEndISO) ? [{ s, interval, targetDay }] : [];
      });

      if (batch.length === 0) continue;

      // within the same weight, prefer earliest targets (then module name for stability)
      batch.sort((a, b) =>
        a.targetDay.localeCompare(b.targetDay) ||
        a.s.moduleName.localeCompare(b.s.moduleName)
      );

      let placedInTier = false;

      for (const { s, interval, targetDay } of batch) {
        if (s.done) continue;

        // skip past-due step (rare edge)
        if (targetDay < horizonStartISO) {
          s.idx++;
          if (s.idx >= DEFAULT_INTERVALS.length) s.done = true;
          continue;
        }

        const mins = durationFor(s.weight, interval, Number(cfg.minStudyDuration ?? 15));
        const slot = findSlotOnOrAfter(targetDay, mins, dailyWindows, busyMap);
        if (!slot) {
          // couldn’t place → advance within the cycle; if cycle finishes, stop module
          s.idx++;
          if (s.idx >= DEFAULT_INTERVALS.length) s.done = true;
          continue;
        }

        placedInTier = true;
        placedSomethingThisPass = true;

        // reserve
        const reserved = busyMap[slot.dateISO] || (busyMap[slot.dateISO] = []);
        reserved.push({ start: slot.start, end: slot.end });
        reserved.sort((a, b) => a.start - b.start);

        sessions.push({
          moduleName: s.moduleName,
          start: toISO(slot.start),
          end:   toISO(slot.end),
          interval,
          status: (slot.dateISO === targetDay ? 'planned' : 'moved')
        });

        // advance cycle; when +7 placed, anchor moves to next class (not +7)
        if (interval === 7) {
          // find next class to restart from; only if there are still classes in horizon
          const afterISO   = slot.dateISO;
          const nextAnchor = nextClassAfter(s.moduleName, afterISO, lessonsIndex);

          if (nextAnchor && nextAnchor <= horizonEndISO && s.cyclesLeft > 0) {
            s.anchorDate = nextAnchor;
            s.idx = 0;                 // restart +1,+3,+7 on new anchor
            s.cyclesLeft--;            // consumed one future anchor
          } else {
            s.done = true;
          }
        } else {
          s.idx++; // continue within the same cycle
        }
      }

      // If we placed something in this tier, restart the outer pass
      // so tier 5 gets to keep preempting lower tiers as long as it still has work.
      if (placedInTier) break;
    }

    if (!placedSomethingThisPass) break; // no tier could place anything → stop
  }

  return { sessions };
}

module.exports = { buildSchedule };