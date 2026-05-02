import { createHash } from 'crypto';
import { sqlite } from './db.js';
import { tableExists, parseNotes } from './helpers/db-utils.js';
import { isSundayDate } from './helpers/sunday-utils.js';

/**
 * Categorizes a Google Calendar event based on its summary/description.
 * Returns the event_type_id and color.
 */
export const categorizeGoogleEvent = (googleEvent, categories, eventTypes) => {
    const title = (googleEvent.summary || '').toLowerCase();
    const description = (googleEvent.description || '').toLowerCase();
    const content = `${title} ${description}`;
    const riteIServiceType = eventTypes.find((t) => t.slug === 'rite-i-service');
    const riteIIServiceType = eventTypes.find((t) => t.slug === 'rite-ii-service');
    const eucharistServiceType = eventTypes.find((t) => t.slug === 'eucharist-service');
    const specialServiceType = eventTypes.find((t) => t.slug === 'special-service');
    const weeklyServiceType = eventTypes.find((t) => t.slug === 'weekly-service');
    const maintenanceType = eventTypes.find((t) => t.slug === 'maintenance-closure');
    const meetingType = eventTypes.find((t) => t.slug === 'meeting') || eventTypes[0];

    // Default fallback
    let matchedType = meetingType;

    const startValue = googleEvent?.start?.dateTime || googleEvent?.start?.date || '';
    const startDate = startValue ? new Date(startValue) : null;
    const startHour = startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate.getHours() : null;
    const isSundayMorningService = startDate instanceof Date
        && !Number.isNaN(startDate.getTime())
        && startDate.getDay() === 0
        && [8, 10].includes(startHour);
    const isWednesdayService = startDate instanceof Date
        && !Number.isNaN(startDate.getTime())
        && startDate.getDay() === 3;
    const sundayServiceType = startHour === 8
        ? (riteIServiceType || weeklyServiceType || specialServiceType || meetingType)
        : (riteIIServiceType || weeklyServiceType || specialServiceType || meetingType);
    const weekdayEucharistKeywords = [
        'mid-week service',
        'midweek service',
        'weekday eucharist',
        'weekday mass',
        'eucharist',
        'mass'
    ];
    const specialServiceKeywords = [
        'holy week',
        'maundy thursday',
        'good friday',
        'stations of the cross',
        'easter vigil',
        'great vigil',
        'ash wednesday',
        'palm sunday',
        'evensong',
        'tenebrae',
        'compline',
        'lessons and carols'
    ];
    const matchesSpecialService = specialServiceKeywords.some((keyword) => content.includes(keyword));
    const matchesWeekdayEucharist = weekdayEucharistKeywords.some((keyword) => content.includes(keyword));

    // Priority 1: Explicit Hashtags (Overrides)
    const tags = {
        '#service': 'rite-ii-service',
        '#rite1': 'rite-i-service',
        '#rite-1': 'rite-i-service',
        '#rite2': 'rite-ii-service',
        '#rite-2': 'rite-ii-service',
        '#eucharist': 'eucharist-service',
        '#special': 'special-service',
        '#wedding': 'wedding',
        '#funeral': 'funeral',
        '#baptism': 'baptism',
        '#confirmation': 'confirmation',
        '#meeting': 'meeting',
        '#rehearsal': 'rehearsal',
        '#class': 'class-formation',
        '#concert': 'concert',
        '#rental': 'private-rental',
        '#maintenance': 'maintenance-closure'
    };

    for (const [tag, slug] of Object.entries(tags)) {
        if (content.includes(tag)) {
            const found = eventTypes.find(t => t.slug === slug);
            if (found) matchedType = found;
            break;
        }
    }

    const containsHgk = /\bhgk\b/.test(content) || content.includes('holy ghost kitchen') || content.includes('#hgk');
    if (containsHgk) {
        const volunteerType = eventTypes.find((t) => t.slug === 'volunteer');
        if (volunteerType) matchedType = volunteerType;
    }

    // Priority 2: Keyword matching (if no hashtag matched)
    if (!containsHgk && (matchedType.slug === 'public-event' || !Object.keys(tags).some(tag => content.includes(tag)))) {
        if (content.includes('wedding')) {
            matchedType = eventTypes.find(t => t.slug === 'wedding');
        } else if (content.includes('funeral') || content.includes('memorial')) {
            matchedType = eventTypes.find(t => t.slug === 'funeral');
        } else if (content.includes('baptism') || content.includes('christening')) {
            matchedType = eventTypes.find(t => t.slug === 'baptism');
        } else if (content.includes('confirmation')) {
            matchedType = eventTypes.find(t => t.slug === 'confirmation');
        } else if (content.includes('meeting') || content.includes('vestry')) {
            matchedType = eventTypes.find(t => t.slug === 'meeting');
        } else if (content.includes('rehearsal') || content.includes('choir')) {
            matchedType = eventTypes.find(t => t.slug === 'rehearsal');
        } else if (isSundayMorningService) {
            matchedType = sundayServiceType;
        } else if (isWednesdayService && matchesWeekdayEucharist) {
            matchedType = eucharistServiceType || specialServiceType || matchedType;
        } else if (matchesSpecialService) {
            matchedType = specialServiceType || riteIIServiceType || weeklyServiceType || matchedType;
        } else if (content.includes('service')) {
            matchedType = isSundayMorningService
                ? sundayServiceType
                : ((isWednesdayService && (content.includes('mid-week') || content.includes('midweek')))
                    ? (eucharistServiceType || specialServiceType || matchedType)
                    : (specialServiceType || riteIIServiceType || weeklyServiceType || matchedType));
        } else if (content.includes('concert') || content.includes('recital')) {
            matchedType = eventTypes.find(t => t.slug === 'concert');
        } else if (content.includes('class') || content.includes('study') || content.includes('formation')) {
            matchedType = eventTypes.find(t => t.slug === 'class-formation');
        } else if (content.includes('maintenance') || content.includes('repair') || content.includes('closure') || content.includes('pest control')) {
            matchedType = maintenanceType || matchedType;
        } else if (content.includes('rental') || content.includes('lease')) {
            matchedType = eventTypes.find(t => t.slug === 'private-rental');
        } else if (content.includes('holy ghost kitchen') || content.includes('hgk')) {
            matchedType = eventTypes.find(t => t.slug === 'volunteer');
        }
    }

    const category = categories.find(c => c.id === matchedType.category_id);

    return {
        type_id: matchedType.id,
        type_name: matchedType.name,
        type_slug: matchedType.slug,
        category_name: category ? category.name : 'Other',
        color: matchedType.color || (category ? category.color : '#6B7280')
    };
};

/**
 * Fetches all event types and categories for processing.
 */
export const getEventContext = () => {
    const categories = sqlite.prepare('SELECT * FROM event_categories').all();
    const eventTypes = sqlite.prepare('SELECT * FROM event_types').all();
    return { categories, eventTypes };
};

/**
 * Synchronizes Google Calendar events into the local database cache.
 */
const toSlug = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const TAG_HASH_RE = /(^|\s)#([a-z0-9][\w-]*)/gi;
const TAG_AT_RE = /(^|\s)@([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*)*)/gi;
const TAG_TYPE_ALIASES = new Map([
    ['vestry', 'meeting'],
    ['hgk', 'volunteer'],
    ['holy-ghost-kitchen', 'volunteer']
]);
const VALID_ENTRY_KINDS = new Set([
    'event',
    'service',
    'meeting',
    'reminder',
    'schedule',
    'out_of_office',
    'appointment',
    'personal',
    'resource_hold',
    'deadline'
]);
const VALID_TASK_POLICIES = new Set(['auto', 'manual_only', 'never']);
const TASK_ENABLED_ENTRY_KINDS = new Set(['event', 'service', 'meeting']);

const normalizeDirectiveValue = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const normalizeTaskPolicy = (value, fallback = 'auto') => {
    const normalized = normalizeDirectiveValue(value);
    if (normalized === 'none' || normalized === 'no') return 'never';
    if (normalized === 'manual') return 'manual_only';
    return VALID_TASK_POLICIES.has(normalized) ? normalized : fallback;
};

const normalizeEntryKind = (value, fallback = 'event') => {
    const normalized = normalizeDirectiveValue(value);
    return VALID_ENTRY_KINDS.has(normalized) ? normalized : fallback;
};

const parseDashboardDirectives = (value) => {
    const directives = {};
    if (!value) return directives;
    const content = String(value);
    const hashDirectiveRe = /(^|\s)#(dashboard|task|kind|type):([a-z0-9_-]+)/gi;
    let match;
    while ((match = hashDirectiveRe.exec(content)) !== null) {
        directives[normalizeDirectiveValue(match[2])] = normalizeDirectiveValue(match[3]);
    }

    const blockMatch = content.match(/(?:^|\n)\s*Dashboard\s*:\s*\n([\s\S]*?)(?=\n\s*\S[^:\n]*\s*:\s*\n|\n{2,}|$)/i);
    if (blockMatch) {
        blockMatch[1]
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => {
                const pair = line.match(/^([a-z0-9 _-]+)\s*:\s*(.+)$/i);
                if (!pair) return;
                directives[normalizeDirectiveValue(pair[1])] = normalizeDirectiveValue(pair[2]);
            });
    }

    return directives;
};

const getCalendarPolicy = (row = {}) => ({
    calendarRole: normalizeDirectiveValue(row.calendar_role || row.calendarRole || 'work') || 'work',
    importMode: normalizeDirectiveValue(row.import_mode || row.importMode || 'classify') || 'classify',
    taskPolicy: normalizeTaskPolicy(row.task_policy || row.taskPolicy || 'auto', 'auto'),
    displayGroup: String(row.display_group || row.displayGroup || 'Work').trim() || 'Work',
    defaultEntryKind: normalizeEntryKind(row.default_entry_kind || row.defaultEntryKind || 'event', 'event')
});

const addDaysKey = (dateKey, days) => {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const enumerateAllDayDates = (startDate, endDate) => {
    if (!startDate) return [];
    const dates = [];
    const exclusiveEnd = endDate && endDate > startDate ? endDate : addDaysKey(startDate, 1);
    let cursor = startDate;
    let guard = 0;
    while (cursor && cursor < exclusiveEnd && guard < 370) {
        dates.push(cursor);
        cursor = addDaysKey(cursor, 1);
        guard += 1;
    }
    return dates.length ? dates : [startDate];
};

const classifyGoogleCalendarEntry = ({ googleEvent, calendarPolicy, directives, date, time, endDate, categorization }) => {
    const title = String(googleEvent?.summary || '').trim();
    const content = `${title}\n${googleEvent?.description || ''}`.toLowerCase();
    const policy = getCalendarPolicy(calendarPolicy);
    let entryKind = policy.defaultEntryKind;
    const reasons = [];

    if (policy.calendarRole === 'personal') {
        entryKind = 'personal';
        reasons.push('calendar-role-personal');
    }
    if (policy.calendarRole === 'resource') {
        entryKind = 'resource_hold';
        reasons.push('calendar-role-resource');
    }
    if (policy.calendarRole === 'staff_schedule') {
        entryKind = 'schedule';
        reasons.push('calendar-role-staff-schedule');
    }

    const isAllDay = !time;
    const isMultiDay = Boolean(isAllDay && endDate && endDate > date && addDaysKey(date, 1) !== endDate);
    if (/\b(out of office|ooo|pto|vacation|away)\b/i.test(content)) {
        entryKind = 'out_of_office';
        reasons.push('out-of-office-keyword');
    } else if (isMultiDay && /\b(out|off|away|travel|conference|retreat)\b/i.test(content)) {
        entryKind = 'schedule';
        reasons.push('multi-day-schedule');
    } else if (/\b(reminder|remember to)\b/i.test(content)) {
        entryKind = 'reminder';
        reasons.push('reminder-keyword');
    } else if (/\b(deadline|due)\b/i.test(content)) {
        entryKind = 'deadline';
        reasons.push('deadline-keyword');
    } else if (/\b(doctor|dr\.|dentist|appointment)\b/i.test(content)) {
        entryKind = policy.calendarRole === 'personal' ? 'appointment' : entryKind;
        reasons.push('appointment-keyword');
    } else if (['weekly-service', 'rite-i-service', 'rite-ii-service', 'eucharist-service', 'special-service'].includes(categorization?.type_slug)) {
        entryKind = 'service';
        reasons.push('service-type');
    } else if (categorization?.type_slug === 'meeting') {
        entryKind = 'meeting';
        reasons.push('meeting-type');
    }

    if (directives.kind) {
        entryKind = normalizeEntryKind(directives.kind, entryKind);
        reasons.push('directive-kind');
    }
    if (directives.dashboard) {
        const dashboardValue = normalizeDirectiveValue(directives.dashboard);
        if (dashboardValue === 'personal') entryKind = 'personal';
        if (dashboardValue === 'schedule') entryKind = 'schedule';
        if (dashboardValue === 'reminder') entryKind = 'reminder';
        if (dashboardValue === 'ignore') reasons.push('directive-ignore');
        reasons.push('directive-dashboard');
    }

    const directiveTaskPolicy = directives.task ? normalizeTaskPolicy(directives.task, '') : '';
    let taskPolicy = policy.taskPolicy;
    if (directiveTaskPolicy && policy.calendarRole !== 'personal') {
        taskPolicy = directiveTaskPolicy;
        reasons.push('directive-task');
    }
    if (policy.importMode === 'reference_only' || policy.calendarRole === 'personal') {
        taskPolicy = 'never';
        reasons.push(policy.importMode === 'reference_only' ? 'reference-only-calendar' : 'personal-calendar');
    }
    if (['personal', 'schedule', 'out_of_office', 'resource_hold'].includes(entryKind)) {
        taskPolicy = 'never';
        reasons.push(`${entryKind}-no-auto-task`);
    }
    if (entryKind === 'reminder' || entryKind === 'deadline') {
        taskPolicy = taskPolicy === 'auto' ? 'manual_only' : taskPolicy;
        reasons.push('lightweight-entry-manual-task');
    }

    return {
        entryKind,
        taskPolicy,
        importMode: policy.importMode,
        calendarRole: policy.calendarRole,
        displayGroup: policy.displayGroup,
        shouldImport: policy.importMode !== 'ignore' && normalizeDirectiveValue(directives.dashboard) !== 'ignore',
        shouldAutoSeedTasks: policy.importMode === 'classify'
            && taskPolicy === 'auto'
            && TASK_ENABLED_ENTRY_KINDS.has(entryKind),
        reasons
    };
};

export const extractEventTags = (value) => {
    const tags = {
        hashtags: [],
        locations: []
    };
    if (!value) return tags;
    const content = String(value);
    let match;
    while ((match = TAG_HASH_RE.exec(content)) !== null) {
        const slug = toSlug(match[2]);
        if (slug && !tags.hashtags.includes(slug)) {
            tags.hashtags.push(slug);
        }
    }
    while ((match = TAG_AT_RE.exec(content)) !== null) {
        const raw = match[2].trim();
        if (!raw || raw.includes('@') || raw.includes('.')) continue;
        const slug = toSlug(raw);
        if (slug && !tags.locations.includes(slug)) {
            tags.locations.push(slug);
        }
    }
    return tags;
};

export const getLocationContext = () => {
    const buildings = sqlite.prepare('SELECT id, name FROM buildings').all();
    const rooms = sqlite.prepare('SELECT id, name, building_id FROM rooms').all();
    const buildingBySlug = new Map();
    const roomBySlug = new Map();
    buildings.forEach((building) => {
        const idSlug = toSlug(building.id);
        const nameSlug = toSlug(building.name);
        if (idSlug) buildingBySlug.set(idSlug, building);
        if (nameSlug) buildingBySlug.set(nameSlug, building);
    });
    rooms.forEach((room) => {
        const idSlug = toSlug(room.id);
        const nameSlug = toSlug(room.name);
        if (idSlug) roomBySlug.set(idSlug, room);
        if (nameSlug) roomBySlug.set(nameSlug, room);
    });
    return { buildings, rooms, buildingBySlug, roomBySlug };
};

export const findEventTypeFromTags = (hashtags, eventTypes) => {
    if (!hashtags?.length) return null;
    for (const tag of hashtags) {
        const match = eventTypes.find((type) => type.slug === tag || toSlug(type.name) === tag);
        if (match) return match;
        const alias = TAG_TYPE_ALIASES.get(tag);
        if (alias) {
            const aliasMatch = eventTypes.find((type) => type.slug === alias);
            if (aliasMatch) return aliasMatch;
        }
    }
    return null;
};

const buildCategorization = (eventType, categories) => {
    const category = categories.find(c => c.id === eventType.category_id);
    return {
        type_id: eventType.id,
        type_name: eventType.name,
        type_slug: eventType.slug,
        category_name: category ? category.name : 'Other',
        color: eventType.color || (category ? category.color : '#6B7280')
    };
};

const BUILDING_ID_ALIASES = new Map([
    ['church', 'sanctuary'],
    ['sanctuary', 'sanctuary'],
    ['chapel', 'chapel'],
    ['parish-hall', 'parish-hall'],
    ['parish hall', 'parish-hall'],
    ['fellows-hall', 'parish-hall'],
    ['fellows hall', 'parish-hall'],
    ['office', 'office'],
    ['office-school', 'office'],
    ['north-lot', 'parking-north'],
    ['north lot', 'parking-north'],
    ['parking-north', 'parking-north'],
    ['south-lot', 'parking-south'],
    ['south lot', 'parking-south'],
    ['parking-south', 'parking-south']
]);

export const normalizeBuildingId = (value, locationContext = null) => {
    if (!value) return null;
    const slug = toSlug(value);
    if (!slug) return null;
    if (locationContext?.buildingBySlug?.has(slug)) {
        return locationContext.buildingBySlug.get(slug).id;
    }
    return BUILDING_ID_ALIASES.get(slug) || slug || null;
};

const hashId = (value) => createHash('sha1').update(String(value)).digest('hex');
// parseNotes moved to db-utils.js

const parseNotesWithText = (value) => {
    if (!value) return { data: {}, rawText: '' };
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
            return { data: parsed, rawText: '' };
        }
    } catch {
        // fallthrough
    }
    return { data: {}, rawText: String(value) };
};

// tableExists, isSundayDate moved to helpers

export const resolveLocation = ({ locationTags, eventLocation, locationContext, textContent = '', typeSlug = '' }) => {
    if (locationTags?.length) {
        for (const tag of locationTags) {
            if (locationContext.roomBySlug.has(tag)) {
                const room = locationContext.roomBySlug.get(tag);
                const building = locationContext.buildingBySlug.get(toSlug(room.building_id));
                return {
                    roomId: room.id,
                    buildingId: room.building_id || building?.id || null,
                    source: 'tag'
                };
            }
            if (locationContext.buildingBySlug.has(tag)) {
                const building = locationContext.buildingBySlug.get(tag);
                return { roomId: null, buildingId: building.id, source: 'tag' };
            }
            const alias = BUILDING_ID_ALIASES.get(tag);
            if (alias) {
                return { roomId: null, buildingId: alias, source: 'tag' };
            }
        }
    }

    if (eventLocation) {
        const parts = String(eventLocation).split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
        for (const part of parts.length ? parts : [eventLocation]) {
            const slug = toSlug(part);
            if (!slug) continue;
            if (locationContext.roomBySlug.has(slug)) {
                const room = locationContext.roomBySlug.get(slug);
                const building = locationContext.buildingBySlug.get(toSlug(room.building_id));
                return {
                    roomId: room.id,
                    buildingId: room.building_id || building?.id || null,
                    source: 'location'
                };
            }
            if (locationContext.buildingBySlug.has(slug)) {
                const building = locationContext.buildingBySlug.get(slug);
                return { roomId: null, buildingId: building.id, source: 'location' };
            }
            const alias = BUILDING_ID_ALIASES.get(slug);
            if (alias) {
                return { roomId: null, buildingId: alias, source: 'location' };
            }
        }
        const normalized = normalizeBuildingId(eventLocation, locationContext);
        if (normalized) {
            return { roomId: null, buildingId: normalized, source: 'location' };
        }
    }

    const content = String(textContent || '').toLowerCase();
    if (content.includes('chapel')) {
        return { roomId: null, buildingId: 'chapel', source: 'text' };
    }
    if (
        content.includes('church')
        || content.includes('sanctuary')
        || ['rite-i-service', 'rite-ii-service', 'eucharist-service', 'special-service', 'weekly-service'].includes(String(typeSlug || '').toLowerCase())
    ) {
        return { roomId: null, buildingId: 'sanctuary', source: 'default' };
    }
    return { roomId: null, buildingId: null, source: null };
};

export const updateOccurrenceLinks = (occurrenceId, { buildingId, roomId, source, tag }) => {
    if (!occurrenceId) return;
    if (!tableExists('entity_links')) return;
    sqlite.prepare(`
        DELETE FROM entity_links
        WHERE from_type = 'event_occurrence' AND from_id = ? AND role = 'location'
    `).run(occurrenceId);
    const now = new Date().toISOString();
    const metaJson = JSON.stringify({
        source,
        tag: tag || null
    });
    if (roomId) {
        sqlite.prepare(`
            INSERT INTO entity_links (id, from_type, from_id, to_type, to_id, role, created_at, meta_json)
            VALUES (?, 'event_occurrence', ?, 'room', ?, 'location', ?, ?)
        `).run(`link-${hashId(`${occurrenceId}-room-${roomId}`)}`, occurrenceId, roomId, now, metaJson);
        return;
    }
    if (buildingId) {
        sqlite.prepare(`
            INSERT INTO entity_links (id, from_type, from_id, to_type, to_id, role, created_at, meta_json)
            VALUES (?, 'event_occurrence', ?, 'building', ?, 'location', ?, ?)
        `).run(`link-${hashId(`${occurrenceId}-building-${buildingId}`)}`, occurrenceId, buildingId, now, metaJson);
    }
};

const cleanupDeletedOccurrences = (occurrenceIds) => {
    if (!occurrenceIds?.length) return;
    const placeholders = occurrenceIds.map(() => '?').join(', ');
    const deleteTransaction = sqlite.transaction(() => {
        if (tableExists('entity_links')) {
            sqlite.prepare(`
                DELETE FROM entity_links
                WHERE from_type = 'event_occurrence' AND from_id IN (${placeholders})
            `).run(...occurrenceIds);
        }

        if (tableExists('task_origins') && tableExists('task_instances')) {
            const taskRows = sqlite.prepare(`
                SELECT o.task_instance_id, ti.task_id
                FROM task_origins o
                JOIN task_instances ti ON ti.id = o.task_instance_id
                WHERE o.scope = 'instance'
                  AND o.origin_type = 'event'
                  AND o.origin_id IN (${placeholders})
            `).all(...occurrenceIds);
            if (taskRows.length) {
                const taskInstanceIds = taskRows.map((row) => row.task_instance_id);
                const taskIds = taskRows.map((row) => row.task_id).filter(Boolean);
                const taskInstancePlaceholders = taskInstanceIds.map(() => '?').join(', ');
                sqlite.prepare(`
                    DELETE FROM task_origins
                    WHERE task_instance_id IN (${taskInstancePlaceholders})
                `).run(...taskInstanceIds);
                sqlite.prepare(`
                    DELETE FROM task_instances
                    WHERE id IN (${taskInstancePlaceholders})
                `).run(...taskInstanceIds);
                if (taskIds.length && tableExists('tasks_new')) {
                    const taskIdPlaceholders = taskIds.map(() => '?').join(', ');
                    sqlite.prepare(`
                        DELETE FROM tasks_new
                        WHERE id IN (${taskIdPlaceholders})
                    `).run(...taskIds);
                }
            }
        }

        sqlite.prepare(`
            DELETE FROM event_occurrences
            WHERE id IN (${placeholders})
        `).run(...occurrenceIds);
    });
    deleteTransaction();
};

export const syncGoogleEvents = async (fetchFn, { userId, tokens, onOccurrence, syncWindow }) => {
    const { categories, eventTypes } = getEventContext();
    const locationContext = getLocationContext();

    const now = new Date();
    const windowBackDays = Number.isFinite(syncWindow?.backDays) ? syncWindow.backDays : 30;
    const windowForwardDays = Number.isFinite(syncWindow?.forwardDays) ? syncWindow.forwardDays : 365;
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - windowBackDays);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + windowForwardDays);

    // Get selected calendars
    const selectedCalendars = sqlite.prepare(`
        SELECT calendar_id, calendar_role, import_mode, task_policy, display_group, default_entry_kind
        FROM calendar_links
        WHERE user_id = ? AND selected = 1
    `).all(userId);
    const calendarPolicies = new Map(selectedCalendars.map((calendar) => [
        calendar.calendar_id,
        getCalendarPolicy(calendar)
    ]));
    const calendarIds = selectedCalendars.length > 0
        ? selectedCalendars.map(c => c.calendar_id)
        : ['primary'];

    let totalSynced = 0;

    const allEvents = [];
    for (const calId of calendarIds) {
        try {
            const events = await fetchFn(tokens, calId, { timeMin: windowStart, timeMax: windowEnd });
            const policy = calendarPolicies.get(calId) || getCalendarPolicy({});
            allEvents.push(...events.map((event) => ({ ...event, _calendarId: calId, _calendarPolicy: policy })));
        } catch (error) {
            console.error(`Failed to fetch calendar ${calId}:`, error);
        }
    }

    const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });
    const seenOccurrences = new Set();
    const canonicalEvents = new Map();

    for (const event of allEvents) {
        if (event?.status === 'cancelled') {
            continue;
        }
        let date, time, endTime, endDate;
        const occurrenceDates = [];
        if (event.start?.dateTime) {
            const d = new Date(event.start.dateTime);
            date = dateFormatter.format(d);
            time = timeFormatter.format(d);
            if (event.end?.dateTime) {
                const endDateTime = new Date(event.end.dateTime);
                endTime = timeFormatter.format(endDateTime);
            }
            occurrenceDates.push(date);
        } else if (event.start?.date) {
            // All-day event: use the date string directly to avoid timezone/DST shifts
            date = event.start.date;
            time = '';
            endTime = null;
            endDate = event.end?.date || addDaysKey(date, 1);
            occurrenceDates.push(...enumerateAllDayDates(date, endDate));
        } else {
            continue;
        }

        occurrenceDates.forEach((occurrenceDate) => {
            const canonicalKey = `${event.iCalUID || event.id || 'unknown'}|${occurrenceDate}|${time || 'all-day'}`;
            const score = [
                event.summary,
                event.description,
                event.location,
                event.organizer?.email
            ].filter(Boolean).length;
            const existing = canonicalEvents.get(canonicalKey);
            if (!existing || score > existing.score) {
                canonicalEvents.set(canonicalKey, {
                    event,
                    date: occurrenceDate,
                    time,
                    endTime,
                    endDate,
                    score
                });
            }
        });
    }

    for (const { event, date, time, endTime, endDate } of canonicalEvents.values()) {
        const calendarId = event._calendarId || event.organizer?.email || 'primary';
        const instanceId = event.id;
        if (!instanceId) continue;

        const title = (event.summary || 'Untitled').replace(/\s+/g, ' ').trim();
        const description = event.description || '';
        const tagSource = `${title}\n${description}`;
        const globalId = event.iCalUID || event.id;
        const normalizedTime = time || '';
        const tags = extractEventTags(tagSource);
        const directives = parseDashboardDirectives(tagSource);
        if (directives.type) {
            const typeTag = toSlug(directives.type);
            if (typeTag && !tags.hashtags.includes(typeTag)) {
                tags.hashtags.unshift(typeTag);
            }
        }
        if (!tags.hashtags.length && /\bvestry\b/i.test(title)) {
            tags.hashtags.push('vestry');
        }
        if (!tags.locations.length && /\bvestry\b/i.test(title)) {
            tags.locations.push('library');
        }
        const taggedType = findEventTypeFromTags(tags.hashtags, eventTypes);
        const categorization = taggedType
            ? buildCategorization(taggedType, categories)
            : categorizeGoogleEvent(event, categories, eventTypes);
        const calendarPolicy = getCalendarPolicy(event._calendarPolicy || {});
        const entryClassification = classifyGoogleCalendarEntry({
            googleEvent: event,
            calendarPolicy,
            directives,
            date,
            time: normalizedTime,
            endDate,
            categorization
        });
        if (!entryClassification.shouldImport) {
            continue;
        }

        const isCanonicalSundayService = ['weekly-service', 'rite-i-service', 'rite-ii-service'].includes(categorization.type_slug);

        if (isCanonicalSundayService
            && isSundayDate(date)
            && entryClassification.entryKind === 'service'
            && entryClassification.importMode === 'classify'
            && entryClassification.calendarRole !== 'personal') {
            const timeValue = normalizedTime || null;
            const existing = timeValue
                ? sqlite.prepare(`
                    SELECT id, notes, building_id FROM event_occurrences
                    WHERE event_id = 'sunday-service' AND date = ? AND start_time = ?
                `).get(date, timeValue)
                : sqlite.prepare(`
                    SELECT id, notes, building_id FROM event_occurrences
                    WHERE event_id = 'sunday-service' AND date = ? AND start_time IS NULL
                `).get(date);
            const baseNotes = parseNotes(existing?.notes);
            const nextNotes = {
                ...baseNotes,
                google: {
                    ...(baseNotes.google || {}),
                    externalId: globalId,
                    iCalUid: event.iCalUID || null,
                    calendarId
                }
            };
            const locationInfo = resolveLocation({
                locationTags: tags.locations,
                eventLocation: event.location,
                locationContext,
                textContent: tagSource,
                typeSlug: categorization.type_slug
            });
            const buildingId = locationInfo.buildingId || existing?.building_id || null;
            const rite = categorization.type_slug === 'rite-i-service'
                ? 'Rite I'
                : (categorization.type_slug === 'rite-ii-service'
                    ? 'Rite II'
                    : (normalizedTime.startsWith('08')
                        ? 'Rite I'
                        : (normalizedTime.startsWith('10') ? 'Rite II' : null)));

            if (!existing) {
                const occurrenceId = `occ-${hashId(`sunday-service-${date}-${normalizedTime || 'all-day'}`)}`;
                sqlite.prepare(`
                    INSERT INTO event_occurrences (
                        id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
                    ) VALUES (?, 'sunday-service', ?, ?, ?, ?, ?, 0, ?)
                `).run(
                    occurrenceId,
                    date,
                    timeValue,
                    null,
                    buildingId,
                    rite,
                    JSON.stringify(nextNotes)
                );
            } else {
                sqlite.prepare(`
                    UPDATE event_occurrences
                    SET building_id = ?, notes = ?
                    WHERE id = ?
                `).run(
                    buildingId,
                    JSON.stringify(nextNotes),
                    existing.id
                );
            }
            totalSynced++;
            continue;
        }

        const eventSeriesKey = `${calendarId}:${globalId}`;
        const eventId = `google-${hashId(eventSeriesKey)}`;
        const occurrenceKey = `${calendarId}:${instanceId}:${date}:${normalizedTime || 'all-day'}`;
        const occurrenceId = `occ-${hashId(occurrenceKey)}`;
        const now = new Date().toISOString();
        const locationInfo = resolveLocation({
            locationTags: tags.locations,
            eventLocation: event.location,
            locationContext,
            textContent: tagSource,
            typeSlug: categorization.type_slug
        });
        const existingOccurrence = sqlite.prepare(`
            SELECT id, notes FROM event_occurrences WHERE id = ?
        `).get(occurrenceId);
        const { data: existingNotes, rawText } = parseNotesWithText(existingOccurrence?.notes);
        const nextNotes = {
            ...existingNotes,
            ...(rawText ? { text: rawText } : {}),
            google: {
                ...(existingNotes.google || {}),
                instanceId,
                iCalUid: event.iCalUID || null,
                calendarId,
                updated: event.updated || null,
                status: event.status || null,
                endDate: endDate || null
            },
            calendar: {
                role: entryClassification.calendarRole,
                displayGroup: entryClassification.displayGroup,
                taskPolicy: entryClassification.taskPolicy,
                importMode: entryClassification.importMode
            },
            classification: {
                entryKind: entryClassification.entryKind,
                taskPolicy: entryClassification.taskPolicy,
                reasons: entryClassification.reasons
            },
            tags: {
                ...(existingNotes.tags || {}),
                hashtags: tags.hashtags,
                locations: tags.locations
            }
        };

        sqlite.prepare(`
            INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'google', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                event_type_id = excluded.event_type_id,
                metadata = excluded.metadata,
                updated_at = excluded.updated_at
        `).run(
            eventId,
            title,
            description,
            categorization.type_id,
            JSON.stringify({
                externalId: globalId,
                calendarId,
                iCalUid: event.iCalUID || null,
                entryKind: entryClassification.entryKind,
                taskPolicy: entryClassification.taskPolicy,
                calendarRole: entryClassification.calendarRole,
                displayGroup: entryClassification.displayGroup,
                importMode: entryClassification.importMode,
                classificationReasons: entryClassification.reasons
            }),
            now,
            now
        );

        sqlite.prepare(`
            INSERT INTO event_occurrences (
                id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                date = excluded.date,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                building_id = excluded.building_id,
                notes = excluded.notes
        `).run(
            occurrenceId,
            eventId,
            date,
            normalizedTime || null,
            endTime || null,
            locationInfo.buildingId || null,
            null,
            0,
            JSON.stringify(nextNotes)
        );
        updateOccurrenceLinks(occurrenceId, {
            buildingId: locationInfo.buildingId,
            roomId: locationInfo.roomId,
            source: locationInfo.source,
            tag: tags.locations[0] || null
        });
        seenOccurrences.add(occurrenceId);
        if (typeof onOccurrence === 'function') {
            onOccurrence({
                occurrenceId,
                eventTypeId: categorization.type_id,
                dateKey: date
            });
        }
        totalSynced++;
    }

    const windowStartKey = dateFormatter.format(windowStart);
    const windowEndKey = dateFormatter.format(windowEnd);
    const dbOccurrences = sqlite.prepare(`
        SELECT o.id
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        WHERE e.source = 'google'
          AND o.date >= ?
          AND o.date <= ?
    `).all(windowStartKey, windowEndKey);
    const staleIds = dbOccurrences
        .map((row) => row.id)
        .filter((id) => !seenOccurrences.has(id));
    if (staleIds.length) {
        cleanupDeletedOccurrences(staleIds);
    }

    const orphanEvents = sqlite.prepare(`
        SELECT e.id
        FROM events e
        LEFT JOIN event_occurrences o ON o.event_id = e.id
        WHERE e.source = 'google'
        GROUP BY e.id
        HAVING COUNT(o.id) = 0
    `).all();
    if (orphanEvents.length) {
        const orphanIds = orphanEvents.map((row) => row.id);
        const placeholders = orphanIds.map(() => '?').join(', ');
        sqlite.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...orphanIds);
    }

    return totalSynced;
};

