import { sqlite } from './db.js';
import { createHash } from 'crypto';

/**
 * Categorizes a Google Calendar event based on its summary/description.
 * Returns the event_type_id and color.
 */
export const categorizeGoogleEvent = (googleEvent, categories, eventTypes) => {
    const title = (googleEvent.summary || '').toLowerCase();
    const description = (googleEvent.description || '').toLowerCase();
    const content = `${title} ${description}`;

    // Default fallback
    let matchedType = eventTypes.find(t => t.slug === 'weekly-service') || eventTypes[0];

    // Priority 1: Explicit Hashtags (Overrides)
    const tags = {
        '#service': 'weekly-service',
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

    // Priority 2: Keyword matching (if no hashtag matched)
    if (matchedType.slug === 'public-event' || !Object.keys(tags).some(tag => content.includes(tag))) {
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
        } else if (content.includes('service') || content.includes('eucharist') || content.includes('mass')) {
            matchedType = eventTypes.find(t => t.slug === 'weekly-service');
        } else if (content.includes('concert') || content.includes('recital')) {
            matchedType = eventTypes.find(t => t.slug === 'concert');
        } else if (content.includes('class') || content.includes('study') || content.includes('formation')) {
            matchedType = eventTypes.find(t => t.slug === 'class-formation');
        } else if (content.includes('maintenance') || content.includes('repair') || content.includes('closure')) {
            matchedType = eventTypes.find(t => t.slug === 'maintenance-closure');
        } else if (content.includes('rental') || content.includes('lease')) {
            matchedType = eventTypes.find(t => t.slug === 'private-rental');
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

const BUILDING_ID_ALIASES = new Map([
    ['church', 'sanctuary'],
    ['sanctuary', 'sanctuary'],
    ['chapel', 'chapel'],
    ['parish-hall', 'parish-hall'],
    ['parish hall', 'parish-hall'],
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

const normalizeBuildingId = (value) => {
    if (!value) return null;
    const slug = toSlug(value);
    return BUILDING_ID_ALIASES.get(slug) || slug || null;
};

const hashId = (value) => createHash('sha1').update(String(value)).digest('hex');

export const syncGoogleEvents = async (fetchFn, { userId, tokens }) => {
    const { categories, eventTypes } = getEventContext();

    // Get selected calendars
    const selectedCalendars = sqlite.prepare(`
        SELECT calendar_id FROM calendar_links
        WHERE user_id = ? AND selected = 1
    `).all(userId);
    const calendarIds = selectedCalendars.length > 0
        ? selectedCalendars.map(c => c.calendar_id)
        : ['primary'];

    let totalSynced = 0;

    const allEvents = [];
    for (const calId of calendarIds) {
        try {
            const events = await fetchFn(tokens, calId);
            allEvents.push(...events);
        } catch (error) {
            console.error(`Failed to fetch calendar ${calId}:`, error);
        }
    }

    // Deduplicate in memory
    const uniqueEvents = new Map();
    const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });

    for (const event of allEvents) {
        let date, time;
        if (event.start?.dateTime) {
            const d = new Date(event.start.dateTime);
            date = dateFormatter.format(d);
            time = timeFormatter.format(d);
        } else if (event.start?.date) {
            // All-day event: use the date string directly to avoid timezone/DST shifts
            date = event.start.date;
            time = '';
        } else {
            continue;
        }

        // Sanitize title: trim and collapse multiple spaces
        const title = (event.summary || 'Untitled').replace(/\s+/g, ' ').trim();

        // Semantic key for user-visible deduplication
        const semanticKey = `${title.toLowerCase()}|${date}|${time}`;

        // If we already have this event, keep the one we already found 
        if (!uniqueEvents.has(semanticKey)) {
            uniqueEvents.set(semanticKey, { event, date, time, title });
        }
    }

    for (const { event, date, time, title } of uniqueEvents.values()) {
        const categorization = categorizeGoogleEvent(event, categories, eventTypes);
        const globalId = event.iCalUID || event.id;
        const normalizedTime = time || '';

        // Handle possible conflicts on either external_id OR semantic key
        // SQLite doesn't support multiple ON CONFLICT targets easily, so we use a transaction or manual check
        const eventId = `google-${hashId(globalId)}`;
        const occurrenceId = `occ-${hashId(`${eventId}-${date}-${normalizedTime}`)}`;
        const now = new Date().toISOString();

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
            event.description || '',
            categorization.type_id,
            JSON.stringify({
                externalId: globalId,
                calendarId: event.organizer?.email || null
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
            null,
            normalizeBuildingId(event.location),
            null,
            0,
            null
        );
        totalSynced++;
    }

    return totalSynced;
};
