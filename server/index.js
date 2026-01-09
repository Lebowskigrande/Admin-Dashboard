import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile, rm } from 'fs/promises';
import { join, dirname, resolve, basename, extname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import db from './db.js';
import { seedDatabase } from './seed.js';
import { getAuthUrl, getTokensFromCode, setStoredCredentials } from './googleAuth.js';
import { fetchGoogleCalendarEvents, fetchCalendarList } from './googleCalendar.js';
import { categorizeGoogleEvent, getEventContext, syncGoogleEvents } from './eventEngine.js';
import { buildDepositSlipPdf, extractChecksFromImages } from './depositSlip.js';

dotenv.config({ path: './server/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3001;
const upload = multer({ dest: join(tmpdir(), 'deposit-slip-uploads') });
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });

app.use(cors());
app.use(express.json());

// Run Seed
seedDatabase();

const normalizeName = (name = '') => name.trim().replace(/\s+/g, ' ');
const slugifyName = (name) => normalizeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

const coerceJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            return value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
        }
    }
    return [];
};

const coerceJsonObject = (value) => {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
};

const parseJsonField = (value, fallback = []) => {
    if (!value) return fallback;
    const parsed = coerceJsonArray(value);
    return parsed.length ? parsed : fallback;
};

const ROLE_TOKEN_MAP = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    officiant: 'officiant',
    lector: 'lector',
    lem: 'lem',
    'lay eucharistic minister': 'lem',
    acolyte: 'acolyte',
    thurifer: 'thurifer',
    usher: 'usher',
    'altar guild': 'altarGuild',
    altarguild: 'altarGuild',
    choirmaster: 'choirmaster',
    organist: 'organist',
    sound: 'sound',
    'sound engineer': 'sound',
    soundengineer: 'sound',
    'coffee hour': 'coffeeHour',
    coffeehour: 'coffeeHour',
    'building supervisor': 'buildingSupervisor',
    buildingsupervisor: 'buildingSupervisor',
    childcare: 'childcare'
};

const normalizeRoleToken = (token) => {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const lowered = raw.toLowerCase();
    const compact = lowered.replace(/[^a-z0-9]+/g, '');
    return ROLE_TOKEN_MAP[lowered] || ROLE_TOKEN_MAP[compact] || raw;
};

const normalizePersonRoles = (value) => {
    const roles = coerceJsonArray(value)
        .map((role) => normalizeRoleToken(role))
        .filter(Boolean);
    return Array.from(new Set(roles));
};

const normalizePersonName = (value) => {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const DEFAULT_ORGANIST_ID = 'rob-hovencamp';
const DEFAULT_SOUND_ID = 'cristo-nava';
const DEFAULT_LOCATION_BY_TIME = {
    '08:00': 'chapel',
    '10:00': 'sanctuary'
};
const TEAM_ROLE_COLUMNS = {
    lem: 'chalice_bearer',
    acolyte: 'acolyte',
    usher: 'usher',
    sound: 'sound_engineer',
    coffeeHour: 'coffee_hour',
    childcare: 'childcare'
};

const getWeekOfMonth = (dateStr) => {
    const date = new Date(`${dateStr}T00:00:00`);
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const offset = firstOfMonth.getDay();
    return Math.floor((date.getDate() + offset - 1) / 7) + 1;
};

const DEFAULT_BUILDINGS = [
    { id: 'sanctuary', name: 'Church', category: 'Worship', notes: 'Main worship space, nave, and sacristy access.' },
    { id: 'chapel', name: 'Chapel', category: 'Worship', notes: 'Weekday services and quiet prayer.' },
    { id: 'parish-hall', name: 'Fellows Hall', category: 'All Purpose', notes: 'Fellowship hall, kitchens, and meeting rooms.' },
    { id: 'office', name: 'Office/School', category: 'All Purpose', notes: 'Administration, classrooms, and staff workspace.' },
    { id: 'parking-north', name: 'North Parking', category: 'Parking', notes: 'Primary lot with 48 spaces and ADA access.' },
    { id: 'parking-south', name: 'South Parking', category: 'Parking', notes: 'Overflow lot and service access.' },
    { id: 'playground', name: 'Playground', category: 'Grounds', notes: 'Outdoor play area and family gathering space.' },
    { id: 'close', name: 'Close', category: 'Grounds', notes: 'Green space, garden beds, and footpaths.' },
    { id: 'main-gate', name: 'Main Gate', category: 'Entry', notes: 'Main pedestrian entry off the street.' },
    { id: 'south-parking-gate', name: 'South Parking Gate', category: 'Entry', notes: 'Gate access to the south parking lot.' },
    { id: 'north-parking-gate', name: 'North Parking Gate', category: 'Entry', notes: 'Gate access to the north parking lot.' }
];

const getTeamDefaultsForDate = (dateStr) => {
    const teamNumber = getWeekOfMonth(dateStr);
    const rows = db.prepare('SELECT id, display_name, roles, teams FROM people').all();
    const defaults = {};
    Object.keys(TEAM_ROLE_COLUMNS).forEach((role) => {
        defaults[role] = [];
    });

    rows.forEach((row) => {
        const roles = normalizePersonRoles(row.roles);
        const teams = coerceJsonObject(row.teams);
        Object.keys(TEAM_ROLE_COLUMNS).forEach((role) => {
            if (!roles.includes(role)) return;
            const teamList = Array.isArray(teams?.[role]) ? teams[role] : [];
            const normalizedTeams = teamList.map((value) => Number(value)).filter((value) => !Number.isNaN(value));
            if (normalizedTeams.includes(teamNumber)) {
                defaults[role].push({ id: row.id, name: row.display_name || '' });
            }
        });
    });

    const output = {};
    Object.entries(defaults).forEach(([role, members]) => {
        output[role] = members
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((member) => member.id)
            .join(', ');
    });

    return output;
};

const buildPeopleIndex = () => {
    const rows = db.prepare('SELECT id, display_name FROM people').all();
    const byId = new Map();
    const byName = new Map();
    const byNameNormalized = new Map();
    const byFirstName = new Map();
    rows.forEach((row) => {
        if (row.id) byId.set(row.id, row.id);
        if (row.display_name) {
            byName.set(row.display_name.toLowerCase(), row.id);
            const normalized = normalizePersonName(row.display_name);
            if (normalized) byNameNormalized.set(normalized, row.id);
            const first = normalized.split(' ')[0];
            if (first) {
                const existing = byFirstName.get(first);
                if (existing) {
                    byFirstName.set(first, null);
                } else {
                    byFirstName.set(first, row.id);
                }
            }
        }
    });
    return { byId, byName, byNameNormalized, byFirstName };
};

const normalizeScheduleValue = (value, peopleIndex) => {
    if (!value) return '';
    const tokens = String(value)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);

    const normalized = tokens.map((token) => {
        if (peopleIndex.byId.has(token)) return token;
        const match = peopleIndex.byName.get(token.toLowerCase());
        if (match) return match;
        const normalizedName = normalizePersonName(token);
        const normalizedMatch = peopleIndex.byNameNormalized.get(normalizedName);
        if (normalizedMatch) return normalizedMatch;
        if (normalizedName && !normalizedName.includes(' ')) {
            return peopleIndex.byFirstName.get(normalizedName) || token;
        }
        return token;
    });

    return normalized.join(', ');
};

const normalizeScheduleRow = (row, peopleIndex) => {
    if (!row) return row;
    const fields = [
        'celebrant',
        'preacher',
        'organist',
        'lector',
        'usher',
        'acolyte',
        'chalice_bearer',
        'sound_engineer',
        'coffee_hour',
        'childcare'
    ];

    const normalized = { ...row };
    fields.forEach((field) => {
        normalized[field] = normalizeScheduleValue(row[field], peopleIndex);
    });

    return normalized;
};

const backfillScheduleRoles = () => {
    const peopleIndex = buildPeopleIndex();
    const rows = db.prepare('SELECT * FROM schedule_roles').all();
    const update = db.prepare(`
        UPDATE schedule_roles
        SET celebrant = ?, preacher = ?, organist = ?, lector = ?, usher = ?, acolyte = ?,
            chalice_bearer = ?, sound_engineer = ?, coffee_hour = ?, childcare = ?
        WHERE id = ?
    `);
    rows.forEach((row) => {
        const normalized = normalizeScheduleRow(row, peopleIndex);
        const changed = [
            'celebrant', 'preacher', 'organist', 'lector', 'usher', 'acolyte',
            'chalice_bearer', 'sound_engineer', 'coffee_hour', 'childcare'
        ].some((field) => (row[field] || '') !== (normalized[field] || ''));
        if (changed) {
            update.run(
                normalized.celebrant,
                normalized.preacher,
                normalized.organist,
                normalized.lector,
                normalized.usher,
                normalized.acolyte,
                normalized.chalice_bearer,
                normalized.sound_engineer,
                normalized.coffee_hour,
                normalized.childcare,
                row.id
            );
        }
    });
};

backfillScheduleRoles();

const backfillServiceTimes = () => {
    const sundayDates = db.prepare(`
        SELECT date
        FROM liturgical_days
        WHERE CAST(strftime('%w', date) AS INTEGER) = 0
    `).all();
    const getRow = db.prepare('SELECT * FROM schedule_roles WHERE date = ? AND service_time = ?');
    const insertRow = db.prepare(`
        INSERT INTO schedule_roles (
            date, service_time, celebrant, preacher, organist, location, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateLinked = db.prepare(`
        UPDATE schedule_roles
        SET celebrant = ?, preacher = ?, organist = ?
        WHERE date = ? AND service_time = ?
    `);

    sundayDates.forEach(({ date }) => {
        const eight = getRow.get(date, '08:00');
        const ten = getRow.get(date, '10:00');
        const source = eight || ten || {};

        const defaultOrganist = source.organist || DEFAULT_ORGANIST_ID;
        const defaultCelebrant = source.celebrant || '';
        const defaultPreacher = source.preacher || '';
        const defaultLocation = source.location || '';

        if (!eight) {
            insertRow.run(
                date,
                '08:00',
                defaultCelebrant,
                defaultPreacher,
                defaultOrganist,
                defaultLocation || DEFAULT_LOCATION_BY_TIME['08:00'] || '',
                '',
                '',
                '',
                '',
                '',
                '',
                ''
            );
        }

        if (!ten) {
            const teamDefaults = getTeamDefaultsForDate(date);
            insertRow.run(
                date,
                '10:00',
                defaultCelebrant,
                defaultPreacher,
                defaultOrganist,
                defaultLocation || DEFAULT_LOCATION_BY_TIME['10:00'] || '',
                '',
                teamDefaults.usher || '',
                teamDefaults.acolyte || '',
                teamDefaults.lem || '',
                teamDefaults.sound || DEFAULT_SOUND_ID,
                teamDefaults.coffeeHour || '',
                teamDefaults.childcare || ''
            );
        }

        if (eight && ten) {
            const mergedCelebrant = eight.celebrant || ten.celebrant || '';
            const mergedPreacher = eight.preacher || ten.preacher || '';
            const mergedOrganist = eight.organist || ten.organist || DEFAULT_ORGANIST_ID;
            const mergedLocation = eight.location || ten.location || DEFAULT_LOCATION_BY_TIME['10:00'] || '';
            updateLinked.run(mergedCelebrant, mergedPreacher, mergedOrganist, date, '08:00');
            updateLinked.run(mergedCelebrant, mergedPreacher, mergedOrganist, date, '10:00');
            db.prepare('UPDATE schedule_roles SET location = ? WHERE date = ? AND service_time = ?').run(mergedLocation, date, '08:00');
            db.prepare('UPDATE schedule_roles SET location = ? WHERE date = ? AND service_time = ?').run(mergedLocation, date, '10:00');
        }
    });
};

backfillServiceTimes();

const backfillPeopleFields = () => {
    const rows = db.prepare('SELECT id, roles, tags, teams FROM people').all();
    const update = db.prepare(`
        UPDATE people
        SET roles = ?, tags = ?, teams = ?
        WHERE id = ?
    `);
    rows.forEach((row) => {
        const roles = normalizePersonRoles(row.roles);
        const tags = coerceJsonArray(row.tags);
        const teams = coerceJsonObject(row.teams);
        const nextRoles = JSON.stringify(roles);
        const nextTags = JSON.stringify(tags);
        const nextTeams = JSON.stringify(teams);
        if ((row.roles || '') !== nextRoles || (row.tags || '') !== nextTags || (row.teams || '') !== nextTeams) {
            update.run(nextRoles, nextTags, nextTeams, row.id);
        }
    });
};

backfillPeopleFields();

const backfillBuildings = () => {
    const insert = db.prepare(`
        INSERT INTO buildings (
            id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const exists = db.prepare('SELECT 1 FROM buildings WHERE id = ?');

    DEFAULT_BUILDINGS.forEach((building) => {
        if (exists.get(building.id)) return;
        insert.run(
            building.id,
            building.name,
            building.category || 'All Purpose',
            0,
            0,
            0,
            0,
            0,
            JSON.stringify([]),
            building.notes || ''
        );
    });
};

backfillBuildings();

const backfillTeamDefaults = () => {
    const rows = db.prepare(`
        SELECT id, date, service_time, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
        FROM schedule_roles
        WHERE service_time = '10:00'
    `).all();
    const update = db.prepare(`
        UPDATE schedule_roles
        SET usher = ?, acolyte = ?, chalice_bearer = ?, sound_engineer = ?, coffee_hour = ?, childcare = ?
        WHERE id = ?
    `);

    rows.forEach((row) => {
        const defaults = getTeamDefaultsForDate(row.date);
        const nextUsher = row.usher || defaults.usher || '';
        const nextAcolyte = row.acolyte || defaults.acolyte || '';
        const nextLem = row.chalice_bearer || defaults.lem || '';
        const nextSound = row.sound_engineer || defaults.sound || DEFAULT_SOUND_ID;
        const nextCoffee = row.coffee_hour || defaults.coffeeHour || '';
        const nextChildcare = row.childcare || defaults.childcare || '';

        const changed = nextUsher !== (row.usher || '')
            || nextAcolyte !== (row.acolyte || '')
            || nextLem !== (row.chalice_bearer || '')
            || nextSound !== (row.sound_engineer || '')
            || nextCoffee !== (row.coffee_hour || '')
            || nextChildcare !== (row.childcare || '');

        if (changed) {
            update.run(
                nextUsher,
                nextAcolyte,
                nextLem,
                nextSound,
                nextCoffee,
                nextChildcare,
                row.id
            );
        }
    });
};

backfillTeamDefaults();

const backfillServiceLocations = () => {
    const rows = db.prepare('SELECT id, service_time, location FROM schedule_roles').all();
    const update = db.prepare('UPDATE schedule_roles SET location = ? WHERE id = ?');
    rows.forEach((row) => {
        if (row.location && `${row.location}`.trim()) return;
        const fallback = DEFAULT_LOCATION_BY_TIME[row.service_time] || '';
        if (fallback) update.run(fallback, row.id);
    });
};

backfillServiceLocations();

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

app.get('/api/youtube/upcoming', async (req, res) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) {
        return res.status(400).json({ error: 'Missing YouTube API configuration' });
    }
    try {
        const params = new URLSearchParams({
            part: 'id',
            channelId,
            eventType: 'upcoming',
            type: 'video',
            order: 'date',
            maxResults: '1',
            key: apiKey
        });
        const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Failed to fetch YouTube stream');
        }
        const data = await response.json();
        const videoId = data?.items?.[0]?.id?.videoId || '';
        if (!videoId) {
            return res.json({ url: '' });
        }
        return res.json({ url: `https://www.youtube.com/watch?v=${videoId}` });
    } catch (error) {
        console.error('YouTube API error:', error);
        return res.status(500).json({ error: 'Failed to fetch livestream' });
    }
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
        roles: normalizePersonRoles(row.roles),
        tags: parseJsonField(row.tags),
        teams: coerceJsonObject(row.teams)
    }));
    res.json(people);
});

app.post('/api/people', (req, res) => {
    const { displayName, email = '', category = 'volunteer', roles = [], tags = [], teams = {} } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const baseId = slugifyName(normalizedName) || `person-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'people');

    db.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags, teams)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        email,
        category,
        JSON.stringify(normalizePersonRoles(roles)),
        JSON.stringify(coerceJsonArray(tags)),
        JSON.stringify(coerceJsonObject(teams))
    );

    res.status(201).json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: normalizePersonRoles(roles),
        tags: coerceJsonArray(tags),
        teams: coerceJsonObject(teams)
    });
});

app.put('/api/people/:id', (req, res) => {
    const { id } = req.params;
    const { displayName, email = '', category = 'volunteer', roles = [], tags = [], teams = {} } = req.body || {};

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
            tags = ?,
            teams = ?
        WHERE id = ?
    `).run(
        normalizedName,
        email,
        category,
        JSON.stringify(normalizePersonRoles(roles)),
        JSON.stringify(coerceJsonArray(tags)),
        JSON.stringify(coerceJsonObject(teams)),
        id
    );

    res.json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: normalizePersonRoles(roles),
        tags: coerceJsonArray(tags),
        teams: coerceJsonObject(teams)
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

// --- Liturgical & Schedule Data ---

app.get('/api/liturgical-days', (req, res) => {
    const { start, end } = req.query;
    let sql = 'SELECT * FROM liturgical_days';
    const params = [];

    if (start && end) {
        sql += ' WHERE date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' WHERE date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' WHERE date <= ?';
        params.push(end);
    }

    sql += ' ORDER BY date';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
});

const buildServiceRows = (scheduleRows = []) => {
    const serviceTimes = ['08:00', '10:00'];
    const rowsByTime = new Map(
        scheduleRows.map((row) => [row.service_time || '', row])
    );

    return serviceTimes.map((time) => {
        const row = rowsByTime.get(time) || {};
        const rite = time.startsWith('08') ? 'Rite I' : 'Rite II';
        return {
            name: 'Sunday Service',
            time,
            rite,
            location: row.location || DEFAULT_LOCATION_BY_TIME[time] || '',
            roles: {
                celebrant: row.celebrant || '',
                preacher: row.preacher || '',
                lector: row.lector || '',
                organist: row.organist || '',
                usher: row.usher || '',
                acolyte: row.acolyte || '',
                lem: row.chalice_bearer || '',
                sound: row.sound_engineer || '',
                coffeeHour: row.coffee_hour || '',
                childcare: row.childcare || ''
            }
        };
    });
};

app.get('/api/sundays', (req, res) => {
    const { start, end } = req.query;
    let sql = 'SELECT * FROM liturgical_days';
    const params = [];

    if (start && end) {
        sql += ' WHERE date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' WHERE date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' WHERE date <= ?';
        params.push(end);
    }

    sql += ' ORDER BY date';
    const days = db.prepare(sql).all(...params);
    const scheduleRows = db.prepare('SELECT * FROM schedule_roles').all();
    const peopleIndex = buildPeopleIndex();
    const normalizedSchedule = scheduleRows.map((row) => normalizeScheduleRow(row, peopleIndex));
    const scheduleByDate = normalizedSchedule.reduce((acc, row) => {
        if (!acc[row.date]) acc[row.date] = [];
        acc[row.date].push(row);
        return acc;
    }, {});

    const sundays = days.map((day) => ({
        ...day,
        bulletin_status: day.bulletin_status || 'draft',
        services: buildServiceRows(scheduleByDate[day.date] || [])
    }));

    res.json(sundays);
});

app.get('/api/schedule-roles', (req, res) => {
    const { start, end } = req.query;
    let sql = 'SELECT * FROM schedule_roles';
    const params = [];

    if (start && end) {
        sql += ' WHERE date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' WHERE date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' WHERE date <= ?';
        params.push(end);
    }

    sql += ' ORDER BY date, service_time';
    const rows = db.prepare(sql).all(...params);
    const peopleIndex = buildPeopleIndex();
    const normalized = rows.map((row) => normalizeScheduleRow(row, peopleIndex));
    res.json(normalized);
});

app.put('/api/schedule-roles', (req, res) => {
    const {
        date,
        service_time = '10:00',
        celebrant = '',
        preacher = '',
        lector = '',
        organist = '',
        usher = '',
        acolyte = '',
        lem = '',
        sound = '',
        coffeeHour = '',
        childcare = '',
        location = ''
    } = req.body || {};

    const peopleIndex = buildPeopleIndex();
    const normalized = {
        celebrant: normalizeScheduleValue(celebrant, peopleIndex),
        preacher: normalizeScheduleValue(preacher, peopleIndex),
        lector: normalizeScheduleValue(lector, peopleIndex),
        organist: normalizeScheduleValue(organist, peopleIndex),
        usher: normalizeScheduleValue(usher, peopleIndex),
        acolyte: normalizeScheduleValue(acolyte, peopleIndex),
        lem: normalizeScheduleValue(lem, peopleIndex),
        sound: normalizeScheduleValue(sound, peopleIndex),
        coffeeHour: normalizeScheduleValue(coffeeHour, peopleIndex),
        childcare: normalizeScheduleValue(childcare, peopleIndex)
    };
    if (!date) {
        return res.status(400).json({ error: 'Date is required' });
    }

    const existing = db.prepare(
        'SELECT 1 FROM schedule_roles WHERE date = ? AND service_time = ?'
    ).get(date, service_time);

    if (existing) {
        db.prepare(`
            UPDATE schedule_roles
            SET celebrant = ?, preacher = ?, lector = ?, organist = ?, location = ?, usher = ?, acolyte = ?, chalice_bearer = ?, sound_engineer = ?, coffee_hour = ?, childcare = ?
            WHERE date = ? AND service_time = ?
        `).run(
            normalized.celebrant,
            normalized.preacher,
            normalized.lector,
            normalized.organist,
            location || DEFAULT_LOCATION_BY_TIME[service_time] || '',
            normalized.usher,
            normalized.acolyte,
            normalized.lem,
            normalized.sound,
            normalized.coffeeHour,
            normalized.childcare,
            date,
            service_time
        );
    } else {
        const teamDefaults = service_time === '10:00' ? getTeamDefaultsForDate(date) : {};
        const defaultOrganist = normalized.organist || DEFAULT_ORGANIST_ID;
        const defaultSound = service_time === '10:00'
            ? (normalized.sound || teamDefaults.sound || DEFAULT_SOUND_ID)
            : normalized.sound;
        db.prepare(`
            INSERT INTO schedule_roles (
                date, service_time, celebrant, preacher, lector, organist, location, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            date,
            service_time,
            normalized.celebrant,
            normalized.preacher,
            normalized.lector,
            defaultOrganist,
            location || DEFAULT_LOCATION_BY_TIME[service_time] || '',
            normalized.usher || teamDefaults.usher || '',
            normalized.acolyte || teamDefaults.acolyte || '',
            normalized.lem || teamDefaults.lem || '',
            defaultSound,
            normalized.coffeeHour || teamDefaults.coffeeHour || '',
            normalized.childcare || teamDefaults.childcare || ''
        );
    }

    const linkedTime = service_time === '08:00' ? '10:00' : '08:00';
    const linkedRow = db.prepare('SELECT 1 FROM schedule_roles WHERE date = ? AND service_time = ?').get(date, linkedTime);
    if (linkedRow) {
        db.prepare(`
            UPDATE schedule_roles
            SET celebrant = ?, preacher = ?, organist = ?
            WHERE date = ? AND service_time = ?
        `).run(normalized.celebrant, normalized.preacher, normalized.organist, date, linkedTime);
    } else {
        const linkedDefaults = linkedTime === '10:00' ? getTeamDefaultsForDate(date) : {};
        const defaultOrganist = normalized.organist || DEFAULT_ORGANIST_ID;
        const linkedSound = linkedTime === '10:00'
            ? (normalized.sound || linkedDefaults.sound || DEFAULT_SOUND_ID)
            : '';

        if (linkedTime === '10:00') {
            db.prepare(`
                INSERT INTO schedule_roles (
                    date, service_time, celebrant, preacher, organist, location, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
                )
                VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)
            `).run(
                date,
                linkedTime,
                normalized.celebrant,
                normalized.preacher,
                defaultOrganist,
                location || DEFAULT_LOCATION_BY_TIME[linkedTime] || '',
                linkedDefaults.usher || '',
                linkedDefaults.acolyte || '',
                linkedDefaults.lem || '',
                linkedSound,
                linkedDefaults.coffeeHour || '',
                linkedDefaults.childcare || ''
            );
        } else {
            db.prepare(`
                INSERT INTO schedule_roles (
                    date, service_time, celebrant, preacher, organist, location, lector, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
                )
                VALUES (?, ?, ?, ?, ?, ?, '', '', '', '', '', '', '')
            `).run(
                date,
                linkedTime,
                normalized.celebrant,
                normalized.preacher,
                defaultOrganist,
                location || DEFAULT_LOCATION_BY_TIME[linkedTime] || ''
            );
        }
    }

    res.json({ success: true, date, service_time });
});

// --- Vestry Packet Builder ---

app.post('/api/vestry/packet', vestryUpload.any(), async (req, res) => {
    const files = req.files || [];
    const filesById = new Map(files.map((file) => [file.fieldname, file]));
    const convertedFiles = [];
    try {
        const order = JSON.parse(req.body?.order || '[]');
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: 'Packet order is required' });
        }

        const packetDoc = await PDFDocument.create();

        const ensurePdf = async (file) => {
            const filePath = file.path;
            const originalName = file.originalname || '';
            const originalExt = extname(originalName).toLowerCase();
            const isPdf = originalExt === '.pdf' || file.mimetype === 'application/pdf';
            if (isPdf) return filePath;
            const outputDir = dirname(filePath);
            try {
                await execFileAsync('soffice', [
                    '--headless',
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    outputDir,
                    filePath
                ]);
                const baseName = originalExt ? basename(originalName, originalExt) : basename(filePath);
                const outputPath = join(outputDir, `${baseName}.pdf`);
                convertedFiles.push(outputPath);
                return outputPath;
            } catch (error) {
                const message = error?.code === 'ENOENT'
                    ? 'LibreOffice (soffice) is not installed or not on PATH. Upload PDFs or install LibreOffice.'
                    : 'Unable to convert document to PDF.';
                throw new Error(message);
            }
        };

        for (const item of order) {
            if (!item || !item.id) continue;
            const file = filesById.get(item.id);
            if (!file) {
                if (item.required) {
                    return res.status(400).json({ error: `Missing required document: ${item.label || item.id}` });
                }
                continue;
            }
            const pdfPath = await ensurePdf(file);
            const srcBytes = await readFile(pdfPath);
            const srcDoc = await PDFDocument.load(srcBytes);
            const pages = await packetDoc.copyPages(srcDoc, srcDoc.getPageIndices());
            pages.forEach((page) => packetDoc.addPage(page));
        }

        const pages = packetDoc.getPages();
        const totalPages = pages.length;
        const font = await packetDoc.embedFont(StandardFonts.Helvetica);
        pages.forEach((page, index) => {
            const label = `Page ${index + 1} of ${totalPages}`;
            const fontSize = 9;
            const { width } = page.getSize();
            const textWidth = font.widthOfTextAtSize(label, fontSize);
            const x = (width - textWidth) / 2;
            const y = 18;
            page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.35, 0.35, 0.35) });
        });

        const pdfBytes = await packetDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="vestry-packet.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Vestry packet error:', error);
        res.status(500).json({ error: error?.message || 'Failed to build vestry packet' });
    } finally {
        await Promise.all([
            ...files.map((file) => rm(file.path, { force: true }).catch(() => {})),
            ...convertedFiles.map((filePath) => rm(filePath, { force: true }).catch(() => {}))
        ]);
    }
});

app.get('/api/vestry/checklist', (req, res) => {
    const month = Number(req.query.month);
    if (!month || Number.isNaN(month)) {
        const rows = db.prepare(`
            SELECT id, month, month_name, phase, task, notes, sort_order
            FROM vestry_checklist
            ORDER BY month, sort_order, id
        `).all();
        return res.json(rows);
    }
    const rows = db.prepare(`
        SELECT id, month, month_name, phase, task, notes, sort_order
        FROM vestry_checklist
        WHERE month = ?
        ORDER BY sort_order, id
    `).all(month);
    return res.json(rows);
});

// --- Deposit Slip OCR ---

app.post('/api/deposit-slip', upload.array('checks', 30), async (req, res) => {
    let outputDir = null;
    let imagePaths = null;
    try {
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'No check images uploaded' });
        }

        const debugOcr = req.body?.debugOcr === '1' || req.body?.debugOcr === 'true';
        const configPath = resolve(__dirname, 'depositSlipConfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const templatePath = resolve(__dirname, '..', config.templatePath || 'deposit slip template.pdf');

        outputDir = join(tmpdir(), `deposit-slip-${Date.now()}`);
        const outputPath = join(outputDir, 'deposit-slip.pdf');

        imagePaths = files.map((file) => ({
            path: file.path,
            source: file.originalname || basename(file.path)
        }));
        const checks = await extractChecksFromImages(imagePaths, {
            ocrRegions: config.ocrRegions,
            includeOcrLines: debugOcr,
            ocrEngines: config.ocrEngines,
            ocrRegionOrigin: config.ocrRegionOrigin,
            ocrRegionAnchor: config.ocrRegionAnchor,
            ocrModel: config.ocrModel,
            ocrCropMaxSize: config.ocrCropMaxSize,
            ocrPreviewOnly: config.ocrPreviewOnly === true,
            ocrAlign: config.ocrAlign
        });

        await buildDepositSlipPdf({
            templatePath,
            outputPath,
            checks,
            fieldMap: config.fieldMap || {}
        });

        const pdfBytes = await readFile(outputPath);
        const pdfBase64 = pdfBytes.toString('base64');
        res.json({
            pdfBase64,
            checks,
            debugOcr
        });
    } catch (error) {
        console.error('Deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build deposit slip' });
        }
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => {});
        }
        if (imagePaths?.length) {
            await Promise.all(
                imagePaths.map((file) => rm(file.path || file, { force: true }).catch(() => {}))
            );
        }
    }
});

// Get roles for a specific date
app.get('/api/roles/:date', (req, res) => {
    const { date } = req.params;
    const roles = db.prepare('SELECT * FROM schedule_roles WHERE date = ?').get(date);
    const peopleIndex = buildPeopleIndex();
    const normalized = roles ? normalizeScheduleRow(roles, peopleIndex) : {};
    res.json(normalized);
});

// Update roles
app.put('/api/roles/:date', (req, res) => {
    const { date } = req.params;
    const peopleIndex = buildPeopleIndex();
    const {
        celebrant = '',
        preacher = '',
        lector = '',
        organist = '',
        usher = '',
        acolyte = '',
        chaliceBearer = '',
        sound = '',
        coffeeHour = '',
        childcare = '',
        location = ''
    } = req.body || {};

    const normalized = {
        celebrant: normalizeScheduleValue(celebrant, peopleIndex),
        preacher: normalizeScheduleValue(preacher, peopleIndex),
        lector: normalizeScheduleValue(lector, peopleIndex),
        organist: normalizeScheduleValue(organist, peopleIndex),
        usher: normalizeScheduleValue(usher, peopleIndex),
        acolyte: normalizeScheduleValue(acolyte, peopleIndex),
        chaliceBearer: normalizeScheduleValue(chaliceBearer, peopleIndex),
        sound: normalizeScheduleValue(sound, peopleIndex),
        coffeeHour: normalizeScheduleValue(coffeeHour, peopleIndex),
        childcare: normalizeScheduleValue(childcare, peopleIndex)
    };

    // Check if entry exists
    const exists = db.prepare('SELECT 1 FROM schedule_roles WHERE date = ?').get(date);

    if (exists) {
        db.prepare(`
            UPDATE schedule_roles 
            SET celebrant = ?, preacher = ?, lector = ?, organist = ?, location = ?, usher = ?, acolyte = ?, chalice_bearer = ?, sound_engineer = ?, coffee_hour = ?, childcare = ?
            WHERE date = ?
        `).run(
            normalized.celebrant,
            normalized.preacher,
            normalized.lector,
            normalized.organist,
            location || '',
            normalized.usher,
            normalized.acolyte,
            normalized.chaliceBearer,
            normalized.sound,
            normalized.coffeeHour,
            normalized.childcare,
            date
        );
    } else {
        db.prepare(`
            INSERT INTO schedule_roles (
                date, celebrant, preacher, lector, organist, location, usher, acolyte, chalice_bearer, sound_engineer, coffee_hour, childcare
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            date,
            normalized.celebrant,
            normalized.preacher,
            normalized.lector,
            normalized.organist,
            location || '',
            normalized.usher,
            normalized.acolyte,
            normalized.chaliceBearer,
            normalized.sound,
            normalized.coffeeHour,
            normalized.childcare
        );
    }

    res.json({ success: true, date });
});

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});
