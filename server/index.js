import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db.js';
import { seedDatabase } from './seed.js';
import { getAuthUrl, getTokensFromCode, setStoredCredentials } from './googleAuth.js';
import { fetchGoogleCalendarEvents, fetchCalendarList } from './googleCalendar.js';
import { categorizeGoogleEvent, getEventContext, syncGoogleEvents } from './eventEngine.js';

dotenv.config({ path: './server/.env' });

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Run Seed
seedDatabase();

const normalizeName = (name = '') => name.trim().replace(/\s+/g, ' ');
const slugifyName = (name) => normalizeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

const parseJsonField = (value, fallback = []) => {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
};

const ensureUniqueId = (baseId, table) => {
    const allowedTables = new Set(['people', 'buildings', 'tickets', 'tasks']);
    if (!allowedTables.has(table)) {
        throw new Error('Invalid table for ID generation');
    }

    let candidate = baseId;
    let counter = 2;
    while (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(candidate)) {
        candidate = `${baseId}-${counter}`;
        counter += 1;
    }
    return candidate;
};

const TICKET_STATUSES = ['new', 'reviewed', 'in_process', 'closed'];

// --- Google Calendar OAuth Routes ---

app.get('/auth/google', (req, res) => {
    const authUrl = getAuthUrl();
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('No authorization code provided');
    }

    try {
        const tokens = await getTokensFromCode(code);

        // Store tokens in database
        db.prepare(`
            INSERT OR REPLACE INTO google_tokens (id, access_token, refresh_token, expiry_date)
            VALUES (1, ?, ?, ?)
        `).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);

        // Redirect back to frontend Settings page
        res.redirect('http://localhost:5173/settings');
    } catch (error) {
        console.error('Error during OAuth callback:', error);
        res.status(500).send('Authentication failed');
    }
});

app.get('/api/google/status', (req, res) => {
    const tokens = db.prepare('SELECT * FROM google_tokens WHERE id = 1').get();
    res.json({ connected: !!tokens });
});

app.post('/api/google/disconnect', (req, res) => {
    db.prepare('DELETE FROM google_tokens WHERE id = 1').run();
    res.json({ success: true });
});

app.get('/api/google/calendars', async (req, res) => {
    try {
        const tokens = db.prepare('SELECT * FROM google_tokens WHERE id = 1').get();

        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google Calendar' });
        }

        setStoredCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });

        const calendars = await fetchCalendarList();
        const selectedIds = db.prepare('SELECT calendar_id FROM selected_calendars').all().map(c => c.calendar_id);

        const calendarsWithSelection = calendars.map(cal => ({
            id: cal.id,
            summary: cal.summary,
            backgroundColor: cal.backgroundColor,
            selected: selectedIds.includes(cal.id)
        }));

        res.json(calendarsWithSelection);
    } catch (error) {
        console.error('Error fetching calendar list:', error);
        res.status(500).json({ error: 'Failed to fetch calendar list' });
    }
});

app.post('/api/google/calendars/select', async (req, res) => {
    try {
        const { calendarId, summary, backgroundColor, selected } = req.body;

        if (selected) {
            db.prepare(`
                INSERT OR REPLACE INTO selected_calendars (calendar_id, summary, background_color)
                VALUES (?, ?, ?)
            `).run(calendarId, summary, backgroundColor);
        } else {
            db.prepare('DELETE FROM selected_calendars WHERE calendar_id = ?').run(calendarId);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating calendar selection:', error);
        res.status(500).json({ error: 'Failed to update selection' });
    }
});

app.get('/api/google/events', async (req, res) => {
    try {
        const tokens = db.prepare('SELECT * FROM google_tokens WHERE id = 1').get();

        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google Calendar' });
        }

        setStoredCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });

        // Get selected calendars
        const selectedCalendars = db.prepare('SELECT calendar_id FROM selected_calendars').all();
        const calendarIds = selectedCalendars.length > 0
            ? selectedCalendars.map(c => c.calendar_id)
            : ['primary'];

        // Return cached events from database
        let rows = db.prepare(`
            SELECT e.*, t.name as type_name, t.slug as type_slug, c.name as category_name, 
                   COALESCE(t.color, c.color) as type_color
            FROM custom_events e
            JOIN event_types t ON e.event_type_id = t.id
            JOIN event_categories c ON t.category_id = c.id
            WHERE e.source = 'google'
        `).all();

        // If cache is empty, trigger a sync in the background
        if (rows.length === 0) {
            console.log('Google event cache empty, triggering background sync...');
            syncGoogleEvents(fetchGoogleCalendarEvents).catch(err => {
                console.error('Background sync failed:', err);
            });
        }

        const formatted = rows.map(e => ({
            id: `google-${e.id}`,
            summary: e.title,
            description: e.description,
            start: { dateTime: e.time ? `${e.date}T${e.time}:00` : null, date: !e.time ? e.date : null },
            location: e.location,
            type_name: e.type_name,
            category_name: e.category_name,
            color: e.type_color,
            source: 'google'
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching Google events:', error);
        res.status(500).json({ error: 'Failed to fetch Google Calendar events' });
    }
});

app.post('/api/google/sync', async (req, res) => {
    try {
        const tokens = db.prepare('SELECT * FROM google_tokens WHERE id = 1').get();
        if (!tokens) return res.status(401).json({ error: 'Not connected' });

        setStoredCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });

        const total = await syncGoogleEvents(fetchGoogleCalendarEvents);
        res.json({ success: true, count: total });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Sync failed' });
    }
});

// --- Events Engine Core Endpoints ---

app.get('/api/event-categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM event_categories').all();
    res.json(categories);
});

app.get('/api/event-types', (req, res) => {
    const types = db.prepare(`
        SELECT t.*, c.name as category_name, c.color as category_color 
        FROM event_types t
        JOIN event_categories c ON t.category_id = c.id
    `).all();
    res.json(types);
});

// --- People Management ---

app.get('/api/people', (req, res) => {
    const rows = db.prepare('SELECT * FROM people ORDER BY display_name').all();
    const people = rows.map(row => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email || '',
        category: row.category || '',
        roles: parseJsonField(row.roles),
        tags: parseJsonField(row.tags)
    }));
    res.json(people);
});

app.post('/api/people', (req, res) => {
    const { displayName, email = '', category = 'volunteer', roles = [], tags = [] } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const baseId = slugifyName(normalizedName) || `person-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'people');

    db.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        email,
        category,
        JSON.stringify(Array.isArray(roles) ? roles : []),
        JSON.stringify(Array.isArray(tags) ? tags : [])
    );

    res.status(201).json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: Array.isArray(roles) ? roles : [],
        tags: Array.isArray(tags) ? tags : []
    });
});

app.put('/api/people/:id', (req, res) => {
    const { id } = req.params;
    const { displayName, email = '', category = 'volunteer', roles = [], tags = [] } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const existing = db.prepare('SELECT id FROM people WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Person not found' });
    }

    db.prepare(`
        UPDATE people SET
            display_name = ?,
            email = ?,
            category = ?,
            roles = ?,
            tags = ?
        WHERE id = ?
    `).run(
        normalizedName,
        email,
        category,
        JSON.stringify(Array.isArray(roles) ? roles : []),
        JSON.stringify(Array.isArray(tags) ? tags : []),
        id
    );

    res.json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: Array.isArray(roles) ? roles : [],
        tags: Array.isArray(tags) ? tags : []
    });
});

app.delete('/api/people/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM people WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Person not found' });
    }
    res.json({ success: true });
});

// --- Buildings & Grounds ---

app.get('/api/buildings', (req, res) => {
    const rows = db.prepare('SELECT * FROM buildings ORDER BY name').all();
    const buildings = rows.map(row => ({
        id: row.id,
        name: row.name,
        category: row.category,
        capacity: row.capacity,
        size_sqft: row.size_sqft,
        rental_rate_hour: row.rental_rate_hour,
        rental_rate_day: row.rental_rate_day,
        parking_spaces: row.parking_spaces,
        event_types: parseJsonField(row.event_types),
        notes: row.notes || ''
    }));
    res.json(buildings);
});

app.post('/api/buildings', (req, res) => {
    const {
        name,
        category = 'All Purpose',
        capacity = 0,
        size_sqft = 0,
        rental_rate_hour = 0,
        rental_rate_day = 0,
        parking_spaces = 0,
        event_types = [],
        notes = ''
    } = req.body || {};

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const baseId = slugifyName(normalizedName) || `building-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'buildings');

    db.prepare(`
        INSERT INTO buildings (
            id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        JSON.stringify(Array.isArray(event_types) ? event_types : []),
        notes
    );

    res.status(201).json({
        id,
        name: normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        event_types: Array.isArray(event_types) ? event_types : [],
        notes
    });
});

app.put('/api/buildings/:id', (req, res) => {
    const { id } = req.params;
    const {
        name,
        category = 'All Purpose',
        capacity = 0,
        size_sqft = 0,
        rental_rate_hour = 0,
        rental_rate_day = 0,
        parking_spaces = 0,
        event_types = [],
        notes = ''
    } = req.body || {};

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const existing = db.prepare('SELECT id FROM buildings WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Building not found' });
    }

    db.prepare(`
        UPDATE buildings SET
            name = ?,
            category = ?,
            capacity = ?,
            size_sqft = ?,
            rental_rate_hour = ?,
            rental_rate_day = ?,
            parking_spaces = ?,
            event_types = ?,
            notes = ?
        WHERE id = ?
    `).run(
        normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        JSON.stringify(Array.isArray(event_types) ? event_types : []),
        notes,
        id
    );

    res.json({
        id,
        name: normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        event_types: Array.isArray(event_types) ? event_types : [],
        notes
    });
});

app.delete('/api/buildings/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Building not found' });
    }
    res.json({ success: true });
});

// --- Tickets & Tasks ---

const buildTicketResponse = (ticketRow) => {
    const areas = db.prepare('SELECT area_id FROM ticket_areas WHERE ticket_id = ?').all(ticketRow.id).map(r => r.area_id);
    const tasks = db.prepare('SELECT * FROM tasks WHERE ticket_id = ? ORDER BY created_at DESC').all(ticketRow.id).map(task => ({
        id: task.id,
        ticket_id: task.ticket_id,
        text: task.text,
        completed: !!task.completed,
        created_at: task.created_at
    }));

    return {
        id: ticketRow.id,
        title: ticketRow.title,
        description: ticketRow.description || '',
        status: ticketRow.status,
        notes: parseJsonField(ticketRow.notes),
        areas,
        tasks,
        created_at: ticketRow.created_at,
        updated_at: ticketRow.updated_at
    };
};

app.get('/api/tickets', (req, res) => {
    const rows = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    const tickets = rows.map(buildTicketResponse);
    res.json(tickets);
});

app.get('/api/tickets/:id', (req, res) => {
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(buildTicketResponse(row));
});

app.post('/api/tickets', (req, res) => {
    const {
        title,
        description = '',
        status = 'new',
        notes = [],
        area_ids = []
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!TICKET_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const now = new Date().toISOString();
    const baseId = slugifyName(normalizedTitle) || `ticket-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'tickets');

    db.prepare(`
        INSERT INTO tickets (id, title, description, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedTitle,
        description,
        status,
        JSON.stringify(Array.isArray(notes) ? notes : []),
        now,
        now
    );

    const insertArea = db.prepare('INSERT OR IGNORE INTO ticket_areas (ticket_id, area_id) VALUES (?, ?)');
    if (Array.isArray(area_ids)) {
        area_ids.forEach(areaId => {
            if (areaId) insertArea.run(id, areaId);
        });
    }

    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.status(201).json(buildTicketResponse(row));
});

app.put('/api/tickets/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    const {
        title = existing.title,
        description = existing.description || '',
        status = existing.status,
        notes,
        area_ids
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!TICKET_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const updatedNotes = Array.isArray(notes) ? notes : parseJsonField(existing.notes);

    db.prepare(`
        UPDATE tickets SET
            title = ?,
            description = ?,
            status = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        normalizedTitle,
        description,
        status,
        JSON.stringify(updatedNotes),
        new Date().toISOString(),
        id
    );

    if (Array.isArray(area_ids)) {
        db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(id);
        const insertArea = db.prepare('INSERT OR IGNORE INTO ticket_areas (ticket_id, area_id) VALUES (?, ?)');
        area_ids.forEach(areaId => {
            if (areaId) insertArea.run(id, areaId);
        });
    }

    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.json(buildTicketResponse(row));
});

app.delete('/api/tickets/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE ticket_id = ?').run(id);
    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json({ success: true });
});

app.get('/api/tasks', (req, res) => {
    const rows = db.prepare(`
        SELECT tasks.*, tickets.title as ticket_title
        FROM tasks
        LEFT JOIN tickets ON tasks.ticket_id = tickets.id
        ORDER BY tasks.created_at DESC
    `).all();
    const tasks = rows.map(row => ({
        id: row.id,
        ticket_id: row.ticket_id,
        ticket_title: row.ticket_title || '',
        text: row.text,
        completed: !!row.completed,
        created_at: row.created_at
    }));
    res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
    const { text, ticket_id = null } = req.body || {};
    const normalizedText = normalizeName(text);
    if (!normalizedText) {
        return res.status(400).json({ error: 'Task text is required' });
    }

    if (ticket_id) {
        const ticketExists = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticket_id);
        if (!ticketExists) {
            return res.status(400).json({ error: 'Ticket not found' });
        }
    }

    const id = ensureUniqueId(`task-${Date.now()}`, 'tasks');
    const createdAt = new Date().toISOString();
    db.prepare(`
        INSERT INTO tasks (id, ticket_id, text, completed, created_at)
        VALUES (?, ?, ?, 0, ?)
    `).run(id, ticket_id, normalizedText, createdAt);

    res.status(201).json({
        id,
        ticket_id,
        text: normalizedText,
        completed: false,
        created_at: createdAt
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task not found' });
    }

    const { text = existing.text, completed = existing.completed } = req.body || {};
    const normalizedText = normalizeName(text);
    if (!normalizedText) {
        return res.status(400).json({ error: 'Task text is required' });
    }

    db.prepare('UPDATE tasks SET text = ?, completed = ? WHERE id = ?')
        .run(normalizedText, completed ? 1 : 0, id);

    res.json({
        id,
        ticket_id: existing.ticket_id,
        text: normalizedText,
        completed: !!completed,
        created_at: existing.created_at
    });
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true });
});

// Get all events (merged)
app.get('/api/events', async (req, res) => {
    try {
        const { categories, eventTypes } = getEventContext();

        // 1. Get liturgical events
        const days = db.prepare('SELECT * FROM liturgical_days ORDER BY date').all();
        const liturgicalEvents = days.map(day => {
            // Map liturgical color name to hex if possible or use default
            const colorMap = {
                'Green': '#dcfce7',
                'White': '#f3f4f6',
                'Purple': '#f3e8ff',
                'Red': '#fee2e2'
            };

            return {
                id: `lit-${day.date}`,
                title: day.feast,
                date: day.date,
                time: '10:00 AM',
                type_name: 'Weekly Service',
                type_slug: 'weekly-service',
                category_name: 'Liturgical',
                color: colorMap[day.color] || '#15803d',
                source: 'liturgical',
                readings: day.readings
            };
        });

        // 2. Get custom events
        const customEventsRows = db.prepare(`
            SELECT e.*, t.name as type_name, t.slug as type_slug, c.name as category_name, 
                   COALESCE(t.color, c.color) as type_color
            FROM custom_events e
            JOIN event_types t ON e.event_type_id = t.id
            JOIN event_categories c ON t.category_id = c.id
        `).all();

        const customEvents = customEventsRows.map(e => ({
            id: `custom-${e.id}`,
            title: e.title,
            description: e.description,
            date: e.date,
            time: e.time,
            location: e.location,
            type_name: e.type_name,
            type_slug: e.type_slug,
            category_name: e.category_name,
            color: e.type_color,
            metadata: e.metadata ? JSON.parse(e.metadata) : {},
            source: 'manual'
        }));

        // 3. Merge and return
        res.json([...liturgicalEvents, ...customEvents]);
    } catch (error) {
        console.error('Error fetching merged events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// Get roles for a specific date
app.get('/api/roles/:date', (req, res) => {
    const { date } = req.params;
    const roles = db.prepare('SELECT * FROM schedule_roles WHERE date = ?').get(date);
    res.json(roles || {});
});

// Update roles
app.put('/api/roles/:date', (req, res) => {
    const { date } = req.params;
    const { lector, usher, acolyte, chaliceBearer, sound, coffeeHour } = req.body;

    // Check if entry exists
    const exists = db.prepare('SELECT 1 FROM schedule_roles WHERE date = ?').get(date);

    if (exists) {
        db.prepare(`
            UPDATE schedule_roles 
            SET lector = ?, usher = ?, acolyte = ?, chalice_bearer = ?, sound_engineer = ?, coffee_hour = ?
            WHERE date = ?
        `).run(lector, usher, acolyte, chaliceBearer, sound, coffeeHour, date);
    } else {
        db.prepare(`
            INSERT INTO schedule_roles (date, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(date, lector, usher, acolyte, chaliceBearer, sound, coffeeHour);
    }

    res.json({ success: true, date });
});

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});
