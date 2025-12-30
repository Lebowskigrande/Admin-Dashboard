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
