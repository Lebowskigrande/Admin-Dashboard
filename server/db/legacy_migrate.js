import { sqlite } from '../db.js';
import { randomUUID } from 'crypto';

const toSlug = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createId = (prefix) => `${prefix}-${randomUUID()}`;

const BUILDING_ID_ALIASES = new Map([
    ['church', 'sanctuary'],
    ['sanctuary', 'sanctuary'],
    ['chapel', 'chapel'],
    ['fellows-hall', 'parish-hall'],
    ['parish-hall', 'parish-hall'],
    ['parish hall', 'parish-hall'],
    ['fellows hall', 'parish-hall'],
    ['office-school', 'office'],
    ['office', 'office'],
    ['north-lot', 'parking-north'],
    ['north lot', 'parking-north'],
    ['parking-north', 'parking-north'],
    ['south-lot', 'parking-south'],
    ['south lot', 'parking-south'],
    ['parking-south', 'parking-south'],
    ['main gate', 'main-gate'],
    ['south parking gate', 'south-parking-gate'],
    ['north parking gate', 'north-parking-gate']
]);

const normalizeBuildingId = (value) => {
    if (!value) return null;
    const slug = toSlug(value);
    return BUILDING_ID_ALIASES.get(slug) || BUILDING_ID_ALIASES.get(value) || slug || null;
};

const ensurePerson = (token) => {
    const normalized = token.trim();
    if (!normalized) return null;
    const slug = toSlug(normalized);
    const existing = sqlite.prepare('SELECT id FROM people WHERE id = ?').get(slug)
        || sqlite.prepare('SELECT id FROM people WHERE LOWER(display_name) = LOWER(?)').get(normalized);
    if (existing?.id) return existing.id;

    let candidate = slug || createId('guest');
    let counter = 2;
    while (sqlite.prepare('SELECT 1 FROM people WHERE id = ?').get(candidate)) {
        candidate = `${slug}-${counter}`;
        counter += 1;
    }

    sqlite.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags, teams)
        VALUES (?, ?, '', 'volunteer', ?, ?, ?)
    `).run(
        candidate,
        normalized,
        JSON.stringify([]),
        JSON.stringify(['guest']),
        JSON.stringify({})
    );
    return candidate;
};

const ROLE_FIELD_MAP = [
    ['celebrant', 'celebrant'],
    ['preacher', 'preacher'],
    ['organist', 'organist'],
    ['lector', 'lector'],
    ['usher', 'usher'],
    ['acolyte', 'acolyte'],
    ['chalice_bearer', 'lem'],
    ['sound_engineer', 'sound'],
    ['coffee_hour', 'coffeeHour'],
    ['childcare', 'childcare']
];

const ROLE_KEY_ALIASES = new Map([
    ['chalice_bearer', 'lem'],
    ['chalicebearer', 'lem'],
    ['chaliceBearer', 'lem'],
    ['coffee_hour', 'coffeeHour'],
    ['coffeehour', 'coffeeHour'],
    ['sound_engineer', 'sound'],
    ['soundengineer', 'sound']
]);

const normalizeRoleKey = (value) => {
    if (!value) return '';
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    if (ROLE_KEY_ALIASES.has(raw)) return ROLE_KEY_ALIASES.get(raw);
    if (ROLE_KEY_ALIASES.has(lower)) return ROLE_KEY_ALIASES.get(lower);
    if (['acolyte', 'lecter', 'lector', 'usher', 'lem', 'celebrant', 'preacher', 'organist', 'childcare'].includes(lower)) {
        return lower === 'lecter' ? 'lector' : lower;
    }
    if (lower === 'sound engineer') return 'sound';
    if (lower === 'coffee hour') return 'coffeeHour';
    if (lower === 'lem') return 'lem';
    return raw;
};

const splitAssignments = (value) => {
    if (!value) return [];
    return String(value)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
};

export const migrateLegacyData = () => {
    const ensureAssignmentsSchema = () => {
        const columns = sqlite.prepare('PRAGMA table_info(assignments)').all().map((col) => col.name);
        const required = ['id', 'occurrence_id', 'role_key', 'person_id'];
        const hasAll = required.every((name) => columns.includes(name));
        if (hasAll) return;
        if (columns.length > 0) {
            const legacyName = `assignments_legacy_${Date.now()}`;
            sqlite.exec(`ALTER TABLE assignments RENAME TO ${legacyName};`);
        }
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS assignments (
                id TEXT PRIMARY KEY,
                occurrence_id TEXT NOT NULL,
                role_key TEXT NOT NULL,
                person_id TEXT NOT NULL
            );
        `);
    };

    const hasTable = (name) => {
        const row = sqlite.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(name);
        return !!row;
    };

    if (!hasTable('events') || !hasTable('event_occurrences')) {
        return;
    }

    ensureAssignmentsSchema();

    if (hasTable('buildings')) {
        const buildings = sqlite.prepare('SELECT * FROM buildings').all();
        const upsert = sqlite.prepare(`
        INSERT INTO buildings (
            id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
    `);
        buildings.forEach((row) => {
            const normalizedId = normalizeBuildingId(row.id || row.name);
            if (!normalizedId) return;
            upsert.run(
                normalizedId,
                row.name || '',
                row.category || '',
                row.capacity || 0,
                row.size_sqft || 0,
                row.rental_rate_hour || 0,
                row.rental_rate_day || 0,
                row.parking_spaces || 0,
                row.event_types || JSON.stringify([]),
                row.notes || ''
            );
        });
    }

    const hasEvents = sqlite.prepare('SELECT count(*) as count FROM events').get().count > 0;
    const hasOccurrences = sqlite.prepare('SELECT count(*) as count FROM event_occurrences').get().count > 0;

    const typeRow = sqlite.prepare('SELECT id FROM event_types WHERE slug = ?').get('weekly-service');
    const weeklyServiceTypeId = typeRow?.id || null;

    const sundayEventId = 'sunday-service';
    const now = new Date().toISOString();
    sqlite.prepare(`
        INSERT OR IGNORE INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        sundayEventId,
        'Sunday Service',
        'Default Sunday services (Rite I and Rite II)',
        weeklyServiceTypeId,
        'schedule',
        JSON.stringify({ default: true }),
        now,
        now
    );

    const scheduleRows = hasTable('schedule_roles')
        ? sqlite.prepare('SELECT * FROM schedule_roles').all()
        : [];
    const insertOccurrence = sqlite.prepare(`
        INSERT INTO event_occurrences (id, event_id, date, start_time, end_time, building_id, rite, is_default, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAssignment = sqlite.prepare(`
        INSERT INTO assignments (id, occurrence_id, role_key, person_id)
        VALUES (?, ?, ?, ?)
    `);
    const occurrenceIndex = new Map();

    if (!hasEvents && !hasOccurrences) {
        scheduleRows.forEach((row) => {
            const date = row.date;
            const time = row.service_time || '10:00';
            if (!date) return;
            const key = `${date}-${time}`;
            if (!occurrenceIndex.has(key)) {
                const occurrenceId = createId('occ');
                const buildingId = normalizeBuildingId(row.location || (time.startsWith('08') ? 'chapel' : 'sanctuary'));
                const rite = time.startsWith('08') ? 'Rite I' : 'Rite II';
                insertOccurrence.run(
                    occurrenceId,
                    sundayEventId,
                    date,
                    time,
                    null,
                    buildingId,
                    rite,
                    0,
                    null
                );
                occurrenceIndex.set(key, occurrenceId);
            }

            const occurrenceId = occurrenceIndex.get(key);
            ROLE_FIELD_MAP.forEach(([field, roleKey]) => {
                splitAssignments(row[field]).forEach((token) => {
                    const personId = ensurePerson(token);
                    if (!personId) return;
                    insertAssignment.run(createId('asgn'), occurrenceId, roleKey, personId);
                });
            });
        });

        const customEvents = hasTable('custom_events')
            ? sqlite.prepare('SELECT * FROM custom_events').all()
            : [];
        const insertEvent = sqlite.prepare(`
            INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        customEvents.forEach((row) => {
            const eventId = `custom-${row.id}`;
            const createdAt = row.date ? `${row.date}T00:00:00.000Z` : now;
            insertEvent.run(
                eventId,
                row.title,
                row.description || '',
                row.event_type_id || null,
                row.source || 'manual',
                row.metadata || null,
                createdAt,
                createdAt
            );
            insertOccurrence.run(
                createId('occ'),
                eventId,
                row.date,
                row.time || null,
                row.end_time || null,
                normalizeBuildingId(row.location),
                null,
                0,
                null
            );
        });
    }

    const legacyAssignmentsTable = sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'assignments_legacy_%'
        ORDER BY name DESC LIMIT 1
    `).get();

    if (legacyAssignmentsTable) {
        const assignmentCount = sqlite.prepare('SELECT count(*) as count FROM assignments').get().count;
        if (assignmentCount === 0) {
            const rows = sqlite.prepare(`SELECT * FROM ${legacyAssignmentsTable.name}`).all();
            const findOccurrence = sqlite.prepare(`
                SELECT id FROM event_occurrences
                WHERE event_id = 'sunday-service' AND date = ? AND start_time = ?
                LIMIT 1
            `);
            const insertOccurrence = sqlite.prepare(`
                INSERT INTO event_occurrences (id, event_id, date, start_time, end_time, building_id, rite, is_default, notes)
                VALUES (?, 'sunday-service', ?, ?, NULL, ?, ?, 0, NULL)
            `);
            const insertAssignment = sqlite.prepare(`
                INSERT INTO assignments (id, occurrence_id, role_key, person_id)
                VALUES (?, ?, ?, ?)
            `);
            const existsAssignment = sqlite.prepare(`
                SELECT 1 FROM assignments
                WHERE occurrence_id = ? AND role_key = ? AND person_id = ?
            `);

            rows.forEach((row) => {
                const serviceId = row.service_id || '';
                const parts = serviceId.split('-');
                if (parts.length < 4) return;
                const date = `${parts[0]}-${parts[1]}-${parts[2]}`;
                const startTime = parts.slice(3).join('-');
                if (!date || !startTime) return;

                const roleKey = normalizeRoleKey(row.role_key);
                const personName = row.person_name || '';
                const status = (row.status || '').toLowerCase();
                if (!roleKey) return;
                if (status === 'needs_support' || personName.toLowerCase().includes('volunteer needed')) {
                    return;
                }

                const occurrence = findOccurrence.get(date, startTime);
                let occurrenceId = occurrence?.id;
                if (!occurrenceId) {
                    const rite = startTime.startsWith('08') ? 'Rite I' : 'Rite II';
                    const buildingId = normalizeBuildingId(startTime.startsWith('08') ? 'chapel' : 'sanctuary');
                    occurrenceId = createId('occ');
                    insertOccurrence.run(occurrenceId, date, startTime, buildingId, rite);
                }

                const personId = row.person_id || (personName ? ensurePerson(personName) : null);
                if (!personId) return;
                if (existsAssignment.get(occurrenceId, roleKey, personId)) return;
                insertAssignment.run(createId('asgn'), occurrenceId, roleKey, personId);
            });
        }
    }

    const normalizeAssignments = () => {
        const distinct = sqlite.prepare('SELECT DISTINCT role_key FROM assignments').all();
        distinct.forEach((row) => {
            const normalized = normalizeRoleKey(row.role_key);
            if (!normalized || normalized === row.role_key) return;
            sqlite.prepare('UPDATE assignments SET role_key = ? WHERE role_key = ?').run(normalized, row.role_key);
        });
    };

    normalizeAssignments();
};
