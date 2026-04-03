export const addDaysIso = (dateKey, offsetDays) => {
    if (!dateKey) return null;
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    date.setDate(date.getDate() + Number(offsetDays || 0));
    return date.toISOString().slice(0, 10);
};

const normalizeListKey = (value) => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

export const toDateKey = (dateValue) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10);
};

export const toMonthKey = (dateValue) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const toYearKey = (dateValue) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getFullYear());
};

export const getWeekStartMonday = (dateValue = new Date()) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return new Date();
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const mondayOffset = (day + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
};

export const getNextWeekdayDate = (baseDate, weekday) => {
    const date = baseDate instanceof Date ? new Date(baseDate) : new Date(baseDate);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const delta = (weekday - day + 7) % 7;
    date.setDate(date.getDate() + delta);
    return date;
};

export const getLastDayOfMonthKey = (year, monthIndex) => {
    const date = new Date(year, monthIndex + 1, 0);
    return toDateKey(date);
};

export const getNthWeekdayOfMonth = (year, monthIndex, weekday, nth) => {
    const first = new Date(year, monthIndex, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, monthIndex, 1 + offset + ((nth - 1) * 7));
};

export const getVestryMeetingDate = (year, monthIndex) => {
    const nth = (monthIndex === 10 || monthIndex === 11) ? 3 : 4;
    return getNthWeekdayOfMonth(year, monthIndex, 4, nth);
};

export const getVestryTaskSchedule = ({ year, monthIndex, listKey, dueOffsetDays = null } = {}) => {
    const meetingDate = getVestryMeetingDate(year, monthIndex);
    const meetingKey = toDateKey(meetingDate);
    const mondayBeforeKey = addDaysIso(meetingKey, -3);
    const mondayAfterKey = addDaysIso(meetingKey, 4);
    const normalizedListKey = normalizeListKey(listKey);
    const startAt = normalizedListKey === 'postvestry' ? mondayAfterKey : mondayBeforeKey;

    if (dueOffsetDays != null && String(dueOffsetDays).trim() !== '' && Number.isFinite(Number(dueOffsetDays))) {
        return {
            meetingKey,
            startAt,
            dueAt: addDaysIso(meetingKey, Number(dueOffsetDays))
        };
    }

    if (normalizedListKey === 'postvestry') {
        return {
            meetingKey,
            startAt: mondayAfterKey,
            dueAt: addDaysIso(meetingKey, 7)
        };
    }

    if (normalizedListKey === 'email' || normalizedListKey === 'print') {
        return {
            meetingKey,
            startAt: mondayBeforeKey,
            dueAt: addDaysIso(meetingKey, -1)
        };
    }

    return {
        meetingKey,
        startAt: mondayBeforeKey,
        dueAt: meetingKey
    };
};

export const getEventTaskSchedule = ({ dateKey, dueOffsets = [] } = {}) => {
    const validOffsets = (Array.isArray(dueOffsets) ? dueOffsets : [dueOffsets])
        .map((offset) => Number(offset))
        .filter((offset) => Number.isFinite(offset));
    if (!dateKey || !validOffsets.length) {
        return {
            startAt: dateKey || null,
            dueAt: dateKey || null
        };
    }
    return {
        startAt: addDaysIso(dateKey, Math.min(...validOffsets)),
        dueAt: addDaysIso(dateKey, Math.max(...validOffsets))
    };
};

export const parseMonthdays = (value, fallback = []) => {
    if (!value) return fallback;
    const monthdays = String(value)
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((part) => Number.isInteger(part) && part >= 1 && part <= 31);
    return monthdays.length ? monthdays : fallback;
};

export const getStrictPreviousMonday = (dateValue) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    const weekday = date.getDay();
    const delta = weekday === 1 ? 7 : (weekday + 6) % 7;
    date.setDate(date.getDate() - delta);
    return date;
};

export const getTimesheetTargetPeriod = (templates, now = new Date()) => {
    const configTemplate = Array.isArray(templates) ? templates.find((template) => template) : null;
    const anchorMonthdays = parseMonthdays(configTemplate?.anchor_monthdays, [10, 25]);
    const scheduleRule = String(configTemplate?.schedule_rule || 'friday_before_monday_before_anchor').trim().toLowerCase();
    const today = now instanceof Date ? new Date(now) : new Date(now);
    if (Number.isNaN(today.getTime())) return null;
    today.setHours(0, 0, 0, 0);

    const candidates = [];
    for (let monthOffset = 0; monthOffset <= 2; monthOffset += 1) {
        const cursor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
        anchorMonthdays.forEach((monthday) => {
            const anchorDate = new Date(cursor.getFullYear(), cursor.getMonth(), monthday);
            if (anchorDate.getMonth() !== cursor.getMonth()) return;
            anchorDate.setHours(0, 0, 0, 0);
            candidates.push(anchorDate);
        });
    }

    const periodEnd = candidates
        .sort((a, b) => a.getTime() - b.getTime())
        .find((candidate) => candidate.getTime() >= today.getTime());

    if (!periodEnd) return null;

    let dueDate = new Date(periodEnd);
    if (scheduleRule === 'friday_before_monday_before_anchor') {
        const mondayBeforeAnchor = getStrictPreviousMonday(periodEnd);
        dueDate = mondayBeforeAnchor ? new Date(mondayBeforeAnchor) : dueDate;
        dueDate.setDate(dueDate.getDate() - 3);
    }

    const periodMonthKey = toMonthKey(periodEnd);
    const periodHalf = periodEnd.getDate() <= 15 ? 'a' : 'b';
    return {
        originId: `timesheets-${periodMonthKey}-${periodHalf}`,
        periodEndKey: toDateKey(periodEnd),
        dueAt: toDateKey(dueDate)
    };
};
