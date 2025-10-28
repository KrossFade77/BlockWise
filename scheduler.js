// util functions

function parseTimeHHMM(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return { h, m };
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

function within(date, startDateStr, endDateStr) {
    const d = new Date(date.toISOString().split('T')[0]);
    const s = new Date(startDateStr);
    const e = new Date(endDateStr);

    return d >= s && d <= e;
}

function formatISO(dt) {
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

function clampToStudyWindow(dateStr, proposedStart, dailyStart, dailyEnd, durationMins) {
    const dayStart = toDateTime(dateStr, dailyStart);
    const dayEnd = toDateTime(dateStr, dailyEnd);
    const maxStart = addMinutes(dayEnd, -durationMins);

    let start = proposedStart;
    if (start < dayStart) {
        start = dayStart;
    }
    if (start > maxStart) {
        return null; // no time today
    }

    return start;
}

function hasConflict(start, end, personalEvents) {
    return personalEvents.some(ev => {
        const evStart = toDateTime(ev.date, ev.startTime || ev.time);
        const evEnd = toDateTime(ev.date, ev.endTime);
        return overlaps(start, end, evStart, evEnd);
    });
}



// SCHEDULING ALGORITHM

function generateSpacedRepetitionSchedule(semester, config, modules, personalEvents) {
    if (!semester?.startDate || !semester?.endDate) {
        throw new Error('Missing semester dates');
    }
    if (!config?.dailyStart || !config?.dailyEnd) {
        throw new Error('Missing scheduling configuration daily start and end time');
    }
    if (!Array.isArray(modules) || !Array.isArray(personalEvents)) {
        throw new Error('Invalid modules/personalEvents');
    }

    // Normalize lesson + non-lesson event shapes expected from the UI
    // modules: [{ courseCode, courseName, date, time, endTime, weightage, ... }]
    // personalEvents: [{ date, time or startTime, endTime, ... }]
    const dailyStart = config.dailyStart;
    const dailyEnd = config.dailyEnd;
    const defaultReviewMins = Math.min(Math.max(config.minStudyDuration ?? 60, 30), 180); // safe clamp

    const out = [];
    modules.forEach((lesson) => {
        if (!lesson.date || !lesson.time || !lesson.endTime) return;

        // Review on first interval (1)
        const classStart = toDateTime(lesson.date, lesson.time);
        const proposed = addDays(classStart, 1);
        const dateStr = proposed.toISOString().split('T')[0];

        if (!within(proposed, semester.startDate, semester.endDate)) return;

        // Fix review task into study window
        const clamped = clampToStudyWindow(dateStr, proposed, dailyStart, dailyEnd, defaultReviewmins);
        if (!snapped) return;

        const reviewStart = snapped;
        const reviewEnd = addMinutes(reviewStart, defaultReviewMins);

        if (hasConflict(reviewStart, reviewEnd, personalEvents)) {
            let placed = false;
            let tryStart = new Date(reviewStart);

            for (let i = 0; i < 3 && !placed; i++) {
                tryStart = addMinutes(tryStart, 30);
                const tryEnd = addMinutes(tryStart, defaultReviewMins);

                const dayStr = tryStart.toISOString().split('T')[0];
                const clamped = clampToStudyWindow(dayStr, tryStart, dailyStart, dailyEnd, defaultReviewMins);
                if (!clamped) break;

                if (!hasConflict(clamped, tryEnd, personalEvents)) {
                    out.push({
                        moduleName: lesson.courseCode || lesson.courseName || lesson.title || 'Review',
                        weightage: lesson.weightage ?? 3,
                        start: formatISO(clamped),
                        end: formatISO(tryEnd),
                        interval: 1
                    });
                    placed = true;
                }
            }
        }
    });

    return out;
}

module.exports = { generateSpacedRepetitionSchedule };