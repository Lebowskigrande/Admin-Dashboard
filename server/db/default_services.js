import { sqlite } from '../db.js';
import { randomUUID } from 'crypto';

const DEFAULT_LOCATION_BY_TIME = {
    '08:00': 'chapel',
    '10:00': 'sanctuary'
};

const DEFAULT_ORGANIST_ID = 'rob-hovencamp';

const getWeeklyServiceTypeId = () => {
    const row = sqlite.prepare('SELECT id FROM event_types WHERE slug = ?').get('weekly-service');
    return row?.id || null;
};

const parseJsonArray = (value) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const parseJsonObject = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const getWeekOfMonth = (dateStr) => {
    const date = new Date(`${dateStr}T00:00:00`);
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const offset = firstOfMonth.getDay();
    return Math.floor((date.getDate() + offset - 1) / 7) + 1;
};

const ensureSundayServiceEvent = () => {
    const existing = sqlite.prepare('SELECT id FROM events WHERE id = ?').get('sunday-service');
    if (existing) return existing.id;
    const now = new Date().toISOString();
    sqlite.prepare(`
        INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'sunday-service',
        'Sunday Service',
        'Default Sunday services (Rite I and Rite II)',
        getWeeklyServiceTypeId(),
        'schedule',
        JSON.stringify({ default: true }),
        now,
        now
    );
    return 'sunday-service';
};

const ensurePerson = (id, displayName) => {
    const existing = sqlite.prepare('SELECT id FROM people WHERE id = ?').get(id);
    if (existing) return;
    sqlite.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags, teams)
        VALUES (?, ?, '', 'staff', '[]', '[]', '{}')
    `).run(id, displayName);
};

const hasAssignment = (occurrenceId, roleKey) => {
    const row = sqlite.prepare(`
        SELECT 1 FROM assignments WHERE occurrence_id = ? AND role_key = ? LIMIT 1
    `).get(occurrenceId, roleKey);
    return !!row;
};

const insertAssignment = (occurrenceId, roleKey, personId) => {
    sqlite.prepare(`
        INSERT INTO assignments (id, occurrence_id, role_key, person_id)
        VALUES (?, ?, ?, ?)
    `).run(`asgn-${randomUUID()}`, occurrenceId, roleKey, personId);
};

const getTeamAssignmentsForDate = (dateStr) => {
    const teamNumber = getWeekOfMonth(dateStr);
    if (teamNumber > 4) return {};
    const rows = sqlite.prepare('SELECT id, roles, teams FROM people').all();
    const output = { lem: [], acolyte: [], usher: [] };

    rows.forEach((row) => {
        const roles = parseJsonArray(row.roles);
        const teams = parseJsonObject(row.teams);
        Object.keys(output).forEach((roleKey) => {
            if (!roles.includes(roleKey)) return;
            const teamList = Array.isArray(teams?.[roleKey]) ? teams[roleKey] : [];
            if (teamList.map(Number).includes(teamNumber)) {
                output[roleKey].push(row.id);
            }
        });
    });

    return output;
};

export const applyDefaultSundayAssignments = (occurrenceId, date, time, { forceOrganist = false } = {}) => {
    ensurePerson(DEFAULT_ORGANIST_ID, 'Rob Hovencamp');
    if (forceOrganist) {
        sqlite.prepare('DELETE FROM assignments WHERE occurrence_id = ? AND role_key = ?')
            .run(occurrenceId, 'organist');
    }
    if (!hasAssignment(occurrenceId, 'organist')) {
        insertAssignment(occurrenceId, 'organist', DEFAULT_ORGANIST_ID);
    }

    if (time !== '10:00') return;
    const teamAssignments = getTeamAssignmentsForDate(date);
    Object.entries(teamAssignments).forEach(([roleKey, people]) => {
        if (!people.length) return;
        if (hasAssignment(occurrenceId, roleKey)) return;
        people.forEach((personId) => insertAssignment(occurrenceId, roleKey, personId));
    });
};

const createOccurrence = (eventId, date, time, rite) => {
    const occurrenceId = `occ-${randomUUID()}`;
    sqlite.prepare(`
        INSERT INTO event_occurrences (
            id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        occurrenceId,
        eventId,
        date,
        time,
        null,
        DEFAULT_LOCATION_BY_TIME[time] || null,
        rite,
        1,
        null
    );
    return occurrenceId;
};

export const ensureDefaultSundayServices = () => {
    const eventId = ensureSundayServiceEvent();
    const sundayDates = sqlite.prepare(`
        SELECT date
        FROM liturgical_days
        WHERE CAST(strftime('%w', date) AS INTEGER) = 0
    `).all();

    const occurrenceLookup = new Set(
        sqlite.prepare('SELECT date, start_time FROM event_occurrences WHERE event_id = ?').all(eventId)
            .map((row) => `${row.date}-${row.start_time}`)
    );

    sundayDates.forEach(({ date }) => {
        const eightKey = `${date}-08:00`;
        const tenKey = `${date}-10:00`;
        if (!occurrenceLookup.has(eightKey)) {
            const occurrenceId = createOccurrence(eventId, date, '08:00', 'Rite I');
            applyDefaultSundayAssignments(occurrenceId, date, '08:00');
        }
        if (!occurrenceLookup.has(tenKey)) {
            const occurrenceId = createOccurrence(eventId, date, '10:00', 'Rite II');
            applyDefaultSundayAssignments(occurrenceId, date, '10:00');
        }
    });

    const existingOccurrences = sqlite.prepare(`
        SELECT id, date, start_time FROM event_occurrences WHERE event_id = ?
    `).all(eventId);
    existingOccurrences.forEach((occurrence) => {
        applyDefaultSundayAssignments(occurrence.id, occurrence.date, occurrence.start_time || '10:00', { forceOrganist: true });
    });
};
