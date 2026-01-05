import db from './db.js';

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
    const categories = db.prepare('SELECT * FROM event_categories').all();
    const eventTypes = db.prepare('SELECT * FROM event_types').all();
    return { categories, eventTypes };
};

/**
 * Synchronizes Google Calendar events into the local database cache.
 */
export const syncGoogleEvents = async (fetchFn) => {
    const { categories, eventTypes } = getEventContext();

    // Get selected calendars
    const selectedCalendars = db.prepare('SELECT calendar_id FROM selected_calendars').all();
    const calendarIds = selectedCalendars.length > 0
        ? selectedCalendars.map(c => c.calendar_id)
        : ['primary'];

    let totalSynced = 0;

    const allEvents = [];
    for (const calId of calendarIds) {
        try {
            const events = await fetchFn(calId);
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
        const existing = db.prepare(`
            SELECT id FROM custom_events 
            WHERE external_id = ? OR (title = ? AND date = ? AND time = ? AND source = 'google')
            LIMIT 1
        `).get(globalId, title, date, normalizedTime);

        if (existing) {
            db.prepare(`
                UPDATE custom_events SET
                    title = ?,
                    description = ?,
                    event_type_id = ?,
                    date = ?,
                    time = ?,
                    location = ?,
                    external_id = ?
                WHERE id = ?
            `).run(
                title,
                event.description || '',
                categorization.type_id,
                date,
                normalizedTime,
                event.location || '',
                globalId,
                existing.id
            );
        } else {
            db.prepare(`
                INSERT INTO custom_events (
                    title, description, event_type_id, date, time, location, source, external_id
                ) VALUES (?, ?, ?, ?, ?, ?, 'google', ?)
            `).run(
                title,
                event.description || '',
                categorization.type_id,
                date,
                normalizedTime,
                event.location || '',
                globalId
            );
        }
        totalSynced++;
    }

    return totalSynced;
};
