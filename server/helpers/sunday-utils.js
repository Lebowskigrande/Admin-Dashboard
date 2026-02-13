import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import { coerceJsonArray, coerceJsonObject } from './db-utils.js';
import { format, isSunday, parseISO } from 'date-fns';

export const DEFAULT_LOCATION_BY_TIME = {
    '08:00': 'chapel',
    '10:00': 'sanctuary'
};

export const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist'];
export const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];

export const ROLE_KEYS = [...new Set([...EIGHT_AM_ROLE_KEYS, ...TEN_AM_ROLE_KEYS])];

export const ROLE_FIELD_MAP = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    organist: 'organist',
    lector: 'lector',
    usher: 'usher',
    acolyte: 'acolyte',
    lem: 'lem',
    sound: 'sound',
    coffeeHour: 'coffeeHour',
    childcare: 'childcare'
};

export const formatDateKey = (date) => format(date, 'yyyy-MM-dd');

export const isSundayDate = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.getDay() === 0;
};

export const getSundayIndex = (dateStr) => {
    const date = new Date(`${dateStr}T00:00:00`);
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstDow = firstOfMonth.getDay();
    const firstSunday = 1 + ((7 - firstDow) % 7);
    const index = Math.floor((date.getDate() - firstSunday) / 7) + 1;
    return index;
};

export const getRotationAssignmentsForDate = (dateStr, roleKeys) => {
    const teamNumber = getSundayIndex(dateStr);
    if (teamNumber > 4 || teamNumber < 1) return { __skipRotation: true };
    const rows = db.prepare('SELECT id, roles, teams FROM people').all();
    const assignments = {};
    roleKeys.forEach((roleKey) => {
        assignments[roleKey] = [];
    });
    rows.forEach((row) => {
        const roles = coerceJsonArray(row.roles);
        const teams = coerceJsonObject(row.teams);
        roleKeys.forEach((roleKey) => {
            if (!roles.includes(roleKey)) return;
            const teamList = Array.isArray(teams?.[roleKey]) ? teams[roleKey] : [];
            if (teamList.map(Number).includes(teamNumber)) {
                assignments[roleKey].push(row.id);
            }
        });
    });
    return assignments;
};

export const ensureSundayOccurrence = (date, serviceTime) => {
    const existing = db.prepare(`
        SELECT id FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = ?
    `).get(date, serviceTime);
    if (existing?.id) return existing.id;
    const rite = serviceTime.startsWith('08') ? 'Rite I' : 'Rite II';
    const occurrenceId = `occ-${randomUUID()}`;
    db.prepare(`
        INSERT INTO event_occurrences (
            id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
        ) VALUES (?, 'sunday-service', ?, ?, NULL, ?, ?, 0, NULL)
    `).run(
        occurrenceId,
        date,
        serviceTime,
        DEFAULT_LOCATION_BY_TIME[serviceTime] || '',
        rite
    );
    return occurrenceId;
};

export const replaceAssignmentsForRole = (occurrenceId, roleKey, personIds) => {
    db.prepare('DELETE FROM assignments WHERE occurrence_id = ? AND role_key = ?')
        .run(occurrenceId, roleKey);
    const uniquePeople = Array.from(new Set(personIds || []));
    uniquePeople.forEach((personId) => {
        db.prepare(`
            INSERT INTO assignments (id, occurrence_id, role_key, person_id)
            VALUES (?, ?, ?, ?)
        `).run(`asgn-${randomUUID()}`, occurrenceId, roleKey, personId);
    });
};

export const applyRotationForDate = (date) => {
    const rotationTen = getRotationAssignmentsForDate(date, TEN_AM_ROLE_KEYS);
    const rotationEight = getRotationAssignmentsForDate(date, EIGHT_AM_ROLE_KEYS);
    const skipRotation = rotationTen.__skipRotation || rotationEight.__skipRotation;

    const occurrenceTen = ensureSundayOccurrence(date, '10:00');
    if (!skipRotation) {
        Object.entries(rotationTen).forEach(([roleKey, personIds]) => {
            if (roleKey === '__skipRotation') return;
            if (!personIds.length) return;
            replaceAssignmentsForRole(occurrenceTen, roleKey, personIds);
        });
    }

    const occurrenceEight = ensureSundayOccurrence(date, '08:00');
    if (!skipRotation) {
        Object.entries(rotationEight).forEach(([roleKey, personIds]) => {
            if (roleKey === '__skipRotation') return;
            if (!personIds.length) return;
            replaceAssignmentsForRole(occurrenceEight, roleKey, personIds);
        });
    }
};

export const parseReadings = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean);
};

export const classifyReading = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'unknown';
    if (/\bpsalm\b/i.test(raw)) return 'psalm';
    if (/\bgospel\b/i.test(raw)) return 'gospel';

    const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    const book = normalize(raw);
    const startsWith = (name) => new RegExp(`^${name}\\b`, 'i').test(book);

    const gospelBooks = ['matthew', 'mark', 'luke', 'john'];
    if (gospelBooks.some((name) => startsWith(name))) return 'gospel';

    const ntBooks = [
        'acts', 'romans', '1 corinthians', '2 corinthians', 'corinthians',
        'galatians', 'ephesians', 'philippians', 'colossians', '1 thessalonians',
        '2 thessalonians', 'thessalonians', '1 timothy', '2 timothy', 'timothy',
        'titus', 'philemon', 'hebrews', 'james', '1 peter', '2 peter', 'peter',
        '1 john', '2 john', '3 john', 'jude', 'revelation'
    ];
    if (ntBooks.some((name) => startsWith(name))) return 'nt';

    const otBooks = [
        'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy',
        'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', 'samuel',
        '1 kings', '2 kings', 'kings', '1 chronicles', '2 chronicles', 'chronicles',
        'ezra', 'nehemiah', 'esther', 'job', 'proverbs', 'ecclesiastes', 'song of solomon',
        'song of songs', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel',
        'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk',
        'zephaniah', 'haggai', 'zechariah', 'malachi'
    ];
    if (otBooks.some((name) => startsWith(name))) return 'ot';

    return 'unknown';
};

export const mergeReadingFragments = (list) => {
    const merged = [];
    list.forEach((item) => {
        const trimmed = String(item || '').trim();
        if (!trimmed) return;
        const isContinuation = /^(?:\d+\s*[:[]|\[\d|\(\d|or\b)/i.test(trimmed);
        if (isContinuation && merged.length > 0) {
            merged[merged.length - 1] = `${merged[merged.length - 1]}; ${trimmed}`;
            return;
        }
        merged.push(trimmed);
    });
    return merged;
};

export const getReadingPair = (readings) => {
    const list = Array.isArray(readings) ? readings : parseReadings(readings);
    const merged = mergeReadingFragments(list);
    const filtered = merged.filter((item) => {
        const type = classifyReading(item);
        return type !== 'psalm' && type !== 'gospel';
    });

    const oldTestament = filtered.find((item) => classifyReading(item) === 'ot') || '';
    const newTestament = filtered.find((item) => classifyReading(item) === 'nt') || '';

    return {
        oldTestament: oldTestament || filtered[0] || '',
        newTestament: newTestament || filtered[1] || ''
    };
};

export const pickReadingForService = (readings, serviceTime) => {
    const { oldTestament, newTestament } = getReadingPair(readings);
    if (String(serviceTime || '').startsWith('08')) return oldTestament || newTestament || '';
    return newTestament || oldTestament || '';
};

export const loadSundayOccurrences = (start, end) => {
    const sql = end
        ? 'SELECT * FROM event_occurrences WHERE event_id = ? AND date BETWEEN ? AND ?'
        : 'SELECT * FROM event_occurrences WHERE event_id = ? AND date >= ?';
    const params = end ? ['sunday-service', start, end] : ['sunday-service', start];
    const rows = db.prepare(sql).all(...params);

    const occurrencesByDate = {};
    rows.forEach(row => {
        if (!occurrencesByDate[row.date]) occurrencesByDate[row.date] = [];
        const assignments = db.prepare('SELECT role_key, person_id FROM assignments WHERE occurrence_id = ?').all(row.id);
        const roles = {};
        assignments.forEach(asgn => {
            if (!roles[asgn.role_key]) roles[asgn.role_key] = [];
            roles[asgn.role_key].push(asgn.person_id);
        });
        occurrencesByDate[row.date].push({ ...row, roles });
    });
    return occurrencesByDate;
};

export const buildUpcomingSundaySchedule = (startDate) => {
    const liturgicalDays = db.prepare(`
        SELECT date, feast, color
        FROM liturgical_days
        WHERE date >= ?
        ORDER BY date
    `).all(startDate);
    const liturgicalByDate = new Map(liturgicalDays.map((day) => [day.date, day]));

    const peopleRows = db.prepare('SELECT id, display_name FROM people').all();
    const peopleById = new Map(peopleRows.map((row) => [row.id, row.display_name]));

    const buildingRows = db.prepare('SELECT id, name FROM buildings').all();
    const buildingsById = new Map(buildingRows.map((row) => [row.id, row.name]));

    const occurrencesByDate = loadSundayOccurrences(startDate, null);
    const dates = Object.keys(occurrencesByDate)
        .filter((date) => {
            const parsed = parseISO(date);
            return !Number.isNaN(parsed.getTime()) && isSunday(parsed);
        })
        .sort((a, b) => a.localeCompare(b));

    const entries = dates.map((date) => {
        const dateObj = parseISO(date);
        const liturgical = liturgicalByDate.get(date);
        const services = (occurrencesByDate[date] || [])
            .filter((occurrence) => ['08:00', '10:00'].includes(occurrence.start_time || '10:00'))
            .map((occurrence) => {
                const time = occurrence.start_time || '10:00';
                const rite = occurrence.rite || (time.startsWith('08') ? 'Rite I' : 'Rite II');
                const locationName = buildingsById.get(occurrence.building_id) || occurrence.building_id || '';
                const roles = ROLE_KEYS.reduce((acc, roleKey) => {
                    const ids = occurrence.roles?.[roleKey] || [];
                    const names = ids
                        .map((id) => peopleById.get(id) || id)
                        .filter(Boolean)
                        .join(', ');
                    acc[roleKey] = names;
                    return acc;
                }, {});
                return { time, rite, location: locationName, roles };
            })
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        return {
            date,
            dateObj,
            feast: liturgical?.feast || 'Sunday',
            color: liturgical?.color || '',
            services
        };
    });

    const grouped = new Map();
    entries.forEach((entry) => {
        const monthKey = format(entry.dateObj, 'MMMM yyyy');
        if (!grouped.has(monthKey)) grouped.set(monthKey, []);
        grouped.get(monthKey).push(entry);
    });

    return Array.from(grouped.entries()).map(([month, items]) => ({ month, items }));
};

export const buildScheduleForMonths = (monthKeys = []) => {
    const validKeys = Array.from(new Set(monthKeys))
        .map((key) => String(key || '').trim())
        .filter((key) => /^\d{4}-\d{2}$/.test(key));
    if (validKeys.length === 0) return [];

    const peopleRows = db.prepare('SELECT id, display_name FROM people').all();
    const peopleById = new Map(peopleRows.map((row) => [row.id, row.display_name]));

    const buildingRows = db.prepare('SELECT id, name FROM buildings').all();
    const buildingsById = new Map(buildingRows.map((row) => [row.id, row.name]));

    const monthData = [];
    validKeys.forEach((monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0);
        const startKey = formatDateKey(monthStart);
        const endKey = formatDateKey(monthEnd);

        const liturgicalDays = db.prepare(`
            SELECT date, feast, readings
            FROM liturgical_days
            WHERE date BETWEEN ? AND ?
            ORDER BY date
        `).all(startKey, endKey);
        const liturgicalByDate = new Map(liturgicalDays.map((day) => [day.date, day]));

        const occurrencesByDate = loadSundayOccurrences(startKey, endKey);
        const dates = Object.keys(occurrencesByDate)
            .filter((date) => {
                const parsed = parseISO(date);
                return !Number.isNaN(parsed.getTime()) && isSunday(parsed);
            })
            .sort((a, b) => a.localeCompare(b));

        const rows = [];
        dates.forEach((date) => {
            const dateObj = parseISO(date);
            const liturgical = liturgicalByDate.get(date);
            const readings = parseReadings(liturgical?.readings || '');
            const services = (occurrencesByDate[date] || [])
                .filter((occurrence) => ['08:00', '10:00'].includes(occurrence.start_time || '10:00'))
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

            services.forEach((occurrence) => {
                const time = occurrence.start_time || '10:00';
                const locationName = buildingsById.get(occurrence.building_id) || occurrence.building_id || '';
                const feast = liturgical?.feast || 'Sunday';
                const reading = pickReadingForService(readings, time);

                const getRoleNames = (roleKey, { numbered = false } = {}) => {
                    const ids = occurrence.roles?.[roleKey] || [];
                    const names = ids.map((id) => peopleById.get(id) || id).filter(Boolean);
                    if (!numbered) return names.join('\n');
                    return names.map((name, index) => `${index + 1}: ${name}`).join('\n');
                };

                rows.push({
                    date,
                    dateObj,
                    time,
                    feast,
                    location: locationName,
                    lector: getRoleNames('lector', { numbered: time.startsWith('10') }),
                    lem: getRoleNames('lem'),
                    acolyte: getRoleNames('acolyte'),
                    usher: getRoleNames('usher'),
                    sound: getRoleNames('sound'),
                    reading
                });
            });
        });

        if (rows.length) {
            monthData.push({
                monthLabel: format(monthStart, 'MMMM yyyy'),
                rows
            });
        }
    });

    return monthData;
};
