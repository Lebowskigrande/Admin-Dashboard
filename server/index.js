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
import { randomUUID } from 'crypto';
import { sqlite } from './db.js';
import { runMigrations } from './db/migrate.js';
import { seedNormalized } from './db/seedNormalized.js';
import { migrateLegacyData } from './db/legacy_migrate.js';
import { applyDefaultSundayAssignments, ensureDefaultSundayServices } from './db/default_services.js';
import { seedDatabase } from './seed.js';
import { getAuthUrl, getTokensFromCode } from './googleAuth.js';
import { fetchGoogleCalendarEvents, fetchCalendarList } from './googleCalendar.js';
import { google } from 'googleapis';
import { syncGoogleEvents } from './eventEngine.js';
import { buildDepositSlipPdf, extractChecksFromImages } from './depositSlip.js';

dotenv.config({ path: './server/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const upload = multer({ dest: join(tmpdir(), 'deposit-slip-uploads') });
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

const SESSION_COOKIE = 'dashboard_session';
const SESSION_TTL_DAYS = 30;

const parseCookies = (cookieHeader = '') => {
    return cookieHeader.split(';').reduce((acc, pair) => {
        const [rawKey, ...rest] = pair.trim().split('=');
        if (!rawKey) return acc;
        acc[rawKey] = decodeURIComponent(rest.join('='));
        return acc;
    }, {});
};

const setSessionCookie = (res, value, days = SESSION_TTL_DAYS) => {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
};

const clearSessionCookie = (res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
};

const loadSessionUser = (req) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies[SESSION_COOKIE];
    if (!sessionId) return null;
    const session = db.prepare(`
        SELECT user_id, expires_at FROM user_sessions WHERE id = ?
    `).get(sessionId);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) return null;
    const user = db.prepare(`
        SELECT id, email, display_name, avatar_url FROM users WHERE id = ?
    `).get(session.user_id);
    return user || null;
};

app.use((req, _res, next) => {
    req.user = loadSessionUser(req);
    next();
});

const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

const getUserTokens = (userId) => {
    return db.prepare(`
        SELECT * FROM user_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(userId);
};

// Run migrations and seeds
runMigrations();
seedDatabase();
seedNormalized();
migrateLegacyData();
ensureDefaultSundayServices();

const db = sqlite;

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

const normalizeTags = (value) => {
    const tags = coerceJsonArray(value)
        .map((tag) => normalizeName(tag))
        .filter(Boolean);
    return Array.from(new Set(tags));
};

const normalizePersonName = (value) => {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const DEFAULT_LOCATION_BY_TIME = {
    '08:00': 'chapel',
    '10:00': 'sanctuary'
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

const fetchGoogleProfile = async (tokens) => {
    const oauth2 = google.oauth2('v2');
    const response = await oauth2.userinfo.get({ access_token: tokens.access_token });
    return response.data;
};

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
        const profile = await fetchGoogleProfile(tokens);
        const userId = `google-${profile.id}`;
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO users (id, email, display_name, avatar_url, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url
        `).run(
            userId,
            profile.email || '',
            profile.name || profile.email || 'User',
            profile.picture || '',
            now
        );

        db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(userId);
        db.prepare(`
            INSERT INTO user_tokens (id, user_id, access_token, refresh_token, expiry_date, scope, token_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            `token-${randomUUID()}`,
            userId,
            tokens.access_token || null,
            tokens.refresh_token || null,
            tokens.expiry_date || null,
            tokens.scope || null,
            tokens.token_type || null,
            now
        );

        const sessionId = `sess-${randomUUID()}`;
        const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        db.prepare(`
            INSERT INTO user_sessions (id, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(sessionId, userId, now, expiresAt);

        setSessionCookie(res, sessionId);
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Error during OAuth callback:', error);
        res.status(500).send('Authentication failed');
    }
});

app.get('/api/google/status', (req, res) => {
    if (!req.user) return res.json({ connected: false });
    const tokens = getUserTokens(req.user.id);
    res.json({ connected: !!tokens });
});

app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user });
});

app.post('/api/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
        db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
    }
    clearSessionCookie(res);
    res.json({ success: true });
});

const YOUTUBE_TIMEZONE = process.env.YOUTUBE_TIMEZONE || 'America/Los_Angeles';

const formatYoutubeDate = (isoString) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: YOUTUBE_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
};

const fetchUpcomingStreams = async (apiKey, channelId) => {
    const searchParams = new URLSearchParams({
        part: 'id',
        channelId,
        eventType: 'upcoming',
        type: 'video',
        order: 'date',
        maxResults: '10',
        key: apiKey
    });
    const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`);
    if (!searchResponse.ok) {
        throw new Error('Failed to fetch YouTube stream list');
    }
    const searchData = await searchResponse.json();
    const videoIds = (searchData.items || [])
        .map((item) => item?.id?.videoId)
        .filter(Boolean);
    if (!videoIds.length) return [];

    const videosParams = new URLSearchParams({
        part: 'snippet,liveStreamingDetails',
        id: videoIds.join(','),
        key: apiKey
    });
    const videosResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videosParams.toString()}`);
    if (!videosResponse.ok) {
        throw new Error('Failed to fetch YouTube stream details');
    }
    const videosData = await videosResponse.json();
    return (videosData.items || []).map((item) => {
        const scheduled = item?.liveStreamingDetails?.scheduledStartTime || '';
        return {
            videoId: item.id,
            title: item?.snippet?.title || 'Upcoming Livestream',
            scheduledStartTime: scheduled,
            scheduledDate: scheduled ? formatYoutubeDate(scheduled) : '',
            url: `https://www.youtube.com/watch?v=${item.id}`
        };
    }).filter((item) => item.scheduledDate);
};

const parseNotes = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const syncLivestreamsToSundays = (streams) => {
    const update = db.prepare('UPDATE event_occurrences SET notes = ? WHERE id = ?');
    const findOccurrence = db.prepare(`
        SELECT id, notes FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = '10:00'
    `);
    let updated = 0;
    streams.forEach((stream) => {
        const occurrence = findOccurrence.get(stream.scheduledDate);
        if (!occurrence) return;
        const notes = parseNotes(occurrence.notes);
        notes.youtubeUrl = stream.url;
        notes.youtubeTitle = stream.title;
        notes.youtubeVideoId = stream.videoId;
        notes.youtubeScheduledStart = stream.scheduledStartTime;
        update.run(JSON.stringify(notes), occurrence.id);
        updated += 1;
    });
    return updated;
};

const scheduleYouTubeSync = () => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) return;

    const runSync = async () => {
        try {
            const streams = await fetchUpcomingStreams(apiKey, channelId);
            syncLivestreamsToSundays(streams);
            const nextScheduled = streams
                .map((stream) => new Date(stream.scheduledStartTime).getTime())
                .filter((ts) => Number.isFinite(ts))
                .sort((a, b) => a - b)[0];
            if (nextScheduled) {
                const delay = Math.max(nextScheduled - Date.now() + 2 * 60 * 1000, 5 * 60 * 1000);
                setTimeout(runSync, delay);
                return;
            }
        } catch (error) {
            console.error('YouTube auto-sync error:', error);
        }
        setTimeout(runSync, 60 * 60 * 1000);
    };

    runSync();
};

scheduleYouTubeSync();

app.get('/api/youtube/upcoming', async (req, res) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) {
        return res.status(400).json({ error: 'Missing YouTube API configuration' });
    }
    try {
        const streams = await fetchUpcomingStreams(apiKey, channelId);
        res.json(streams);
    } catch (error) {
        console.error('YouTube API error:', error);
        return res.status(500).json({ error: 'Failed to fetch livestream' });
    }
});

app.post('/api/youtube/sync', async (req, res) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) {
        return res.status(400).json({ error: 'Missing YouTube API configuration' });
    }
    try {
        const streams = await fetchUpcomingStreams(apiKey, channelId);
        const synced = syncLivestreamsToSundays(streams);
        res.json({ success: true, synced });
    } catch (error) {
        console.error('YouTube sync error:', error);
        res.status(500).json({ error: 'Failed to sync livestreams' });
    }
});

app.get('/api/sunday/livestream', (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    const occurrence = db.prepare(`
        SELECT notes FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = '10:00'
        LIMIT 1
    `).get(date);
    const notes = parseNotes(occurrence?.notes);
    res.json({
        url: notes.youtubeUrl || '',
        title: notes.youtubeTitle || '',
        videoId: notes.youtubeVideoId || '',
        scheduledStart: notes.youtubeScheduledStart || ''
    });
});

app.post('/api/google/disconnect', requireAuth, (req, res) => {
    db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM calendar_links WHERE user_id = ?').run(req.user.id);
    res.json({ success: true });
});

app.get('/api/google/calendars', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google Calendar' });
        }

        const calendars = await fetchCalendarList({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });

        const selectedIds = db.prepare(`
            SELECT calendar_id FROM calendar_links WHERE user_id = ? AND selected = 1
        `).all(req.user.id).map(c => c.calendar_id);

        const upsertCalendar = db.prepare(`
            INSERT INTO calendars (id, summary, background_color, time_zone)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                summary = excluded.summary,
                background_color = excluded.background_color,
                time_zone = excluded.time_zone
        `);

        calendars.forEach((calendar) => {
            upsertCalendar.run(
                calendar.id,
                calendar.summary || '',
                calendar.backgroundColor || '',
                calendar.timeZone || ''
            );
        });

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

app.post('/api/google/calendars/select', requireAuth, async (req, res) => {
    try {
        const { calendarId, selected } = req.body;
        if (!calendarId) {
            return res.status(400).json({ error: 'calendarId is required' });
        }
        const linkId = `link-${req.user.id}-${calendarId}`;

        db.prepare(`
            INSERT INTO calendar_links (id, user_id, calendar_id, selected)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET selected = excluded.selected
        `).run(linkId, req.user.id, calendarId, selected ? 1 : 0);

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating calendar selection:', error);
        res.status(500).json({ error: 'Failed to update selection' });
    }
});

app.get('/api/google/events', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google Calendar' });
        }

        const rows = db.prepare(`
            SELECT e.id, e.title, e.description, e.event_type_id, o.date, o.start_time, o.building_id,
                   t.name as type_name, t.slug as type_slug, c.name as category_name, 
                   COALESCE(t.color, c.color) as type_color
            FROM events e
            JOIN event_occurrences o ON o.event_id = e.id
            LEFT JOIN event_types t ON e.event_type_id = t.id
            LEFT JOIN event_categories c ON t.category_id = c.id
            WHERE e.source = 'google'
        `).all();

        if (rows.length === 0) {
            syncGoogleEvents(fetchGoogleCalendarEvents, {
                userId: req.user.id,
                tokens: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expiry_date: tokens.expiry_date
                }
            }).catch(err => {
                console.error('Background sync failed:', err);
            });
        }

        const formatted = rows.map(e => ({
            id: `google-${e.id}`,
            summary: e.title,
            description: e.description,
            start: { dateTime: e.start_time ? `${e.date}T${e.start_time}:00` : null, date: !e.start_time ? e.date : null },
            location: e.building_id,
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

app.post('/api/google/sync', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) return res.status(401).json({ error: 'Not connected' });

        const total = await syncGoogleEvents(fetchGoogleCalendarEvents, {
            userId: req.user.id,
            tokens: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date
            }
        });
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

    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = normalizeTags(tags);

    db.prepare(`
        INSERT INTO people (id, display_name, email, category, roles, tags, teams)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        email,
        category,
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams))
    );

    res.status(201).json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: normalizedRoles,
        tags: normalizedTags,
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

    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = normalizeTags(tags);

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
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams)),
        id
    );

    res.json({
        id,
        displayName: normalizedName,
        email,
        category,
        roles: normalizedRoles,
        tags: normalizedTags,
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

        // 2. Get scheduled/custom events
        const eventRows = db.prepare(`
            SELECT e.id, e.title, e.description, e.event_type_id, e.source, e.metadata,
                   o.date, o.start_time, o.end_time, o.building_id,
                   t.name as type_name, t.slug as type_slug, c.name as category_name,
                   COALESCE(t.color, c.color) as type_color
            FROM events e
            JOIN event_occurrences o ON o.event_id = e.id
            LEFT JOIN event_types t ON e.event_type_id = t.id
            LEFT JOIN event_categories c ON t.category_id = c.id
            WHERE e.id <> 'sunday-service'
        `).all();

        const scheduledEvents = eventRows.map(e => ({
            id: e.id,
            title: e.title,
            description: e.description,
            date: e.date,
            time: e.start_time,
            location: e.building_id,
            type_name: e.type_name,
            type_slug: e.type_slug,
            category_name: e.category_name,
            color: e.type_color,
            metadata: e.metadata ? JSON.parse(e.metadata) : {},
            source: e.source || 'manual'
        }));

        // 3. Merge and return
        res.json([...liturgicalEvents, ...scheduledEvents]);
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

const ROLE_KEYS = [
    'celebrant',
    'preacher',
    'organist',
    'lector',
    'usher',
    'acolyte',
    'lem',
    'sound',
    'coffeeHour',
    'childcare'
];

const ROLE_FIELD_MAP = {
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

const normalizeAssignmentList = (value, peopleIndex) => {
    const normalized = normalizeScheduleValue(value, peopleIndex);
    return normalized
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
};

const buildServiceRowsFromOccurrences = (occurrences = []) => {
    const sorted = [...occurrences].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    return sorted.map((occurrence) => {
        const time = occurrence.start_time || '10:00';
        const rite = occurrence.rite || (time.startsWith('08') ? 'Rite I' : 'Rite II');
        return {
            name: 'Sunday Service',
            time,
            rite,
            location: occurrence.building_id || '',
            roles: ROLE_KEYS.reduce((acc, key) => {
                acc[key] = (occurrence.roles?.[key] || []).join(', ');
                return acc;
            }, {})
        };
    });
};

const loadSundayOccurrences = (start, end) => {
    const params = [];
    let sql = `
        SELECT o.id as occurrence_id, o.date, o.start_time, o.building_id, o.rite,
               a.role_key, a.person_id
        FROM event_occurrences o
        LEFT JOIN assignments a ON a.occurrence_id = o.id
        WHERE o.event_id = 'sunday-service'
    `;
    if (start && end) {
        sql += ' AND o.date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' AND o.date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' AND o.date <= ?';
        params.push(end);
    }
    const rows = db.prepare(sql).all(...params);

    const byDate = new Map();
    rows.forEach((row) => {
        if (!byDate.has(row.date)) byDate.set(row.date, new Map());
        const byOccurrence = byDate.get(row.date);
        if (!byOccurrence.has(row.occurrence_id)) {
            byOccurrence.set(row.occurrence_id, {
                id: row.occurrence_id,
                date: row.date,
                start_time: row.start_time,
                building_id: row.building_id,
                rite: row.rite,
                roles: {}
            });
        }
        const occurrence = byOccurrence.get(row.occurrence_id);
        if (row.role_key && row.person_id) {
            if (!occurrence.roles[row.role_key]) occurrence.roles[row.role_key] = [];
            occurrence.roles[row.role_key].push(row.person_id);
        }
    });

    const result = {};
    byDate.forEach((occurrenceMap, date) => {
        result[date] = Array.from(occurrenceMap.values());
    });
    return result;
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
    const occurrencesByDate = loadSundayOccurrences(start, end);
    const sundays = days.map((day) => ({
        ...day,
        bulletin_status: day.bulletin_status || 'draft',
        services: buildServiceRowsFromOccurrences(occurrencesByDate[day.date] || [])
    }));

    res.json(sundays);
});

app.get('/api/schedule-roles', (req, res) => {
    const { start, end } = req.query;
    const occurrencesByDate = loadSundayOccurrences(start, end);
    const rows = [];
    Object.values(occurrencesByDate).forEach((occurrences) => {
        occurrences.forEach((occurrence) => {
            rows.push({
                id: occurrence.id,
                date: occurrence.date,
                service_time: occurrence.start_time,
                location: occurrence.building_id || '',
                celebrant: (occurrence.roles?.celebrant || []).join(', '),
                preacher: (occurrence.roles?.preacher || []).join(', '),
                organist: (occurrence.roles?.organist || []).join(', '),
                lector: (occurrence.roles?.lector || []).join(', '),
                usher: (occurrence.roles?.usher || []).join(', '),
                acolyte: (occurrence.roles?.acolyte || []).join(', '),
                chalice_bearer: (occurrence.roles?.lem || []).join(', '),
                sound_engineer: (occurrence.roles?.sound || []).join(', '),
                coffee_hour: (occurrence.roles?.coffeeHour || []).join(', '),
                childcare: (occurrence.roles?.childcare || []).join(', ')
            });
        });
    });
    res.json(rows);
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

    if (!date) {
        return res.status(400).json({ error: 'Date is required' });
    }
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

    const occurrence = db.prepare(`
        SELECT id FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = ?
    `).get(date, service_time);

    let occurrenceId = occurrence?.id;
    if (!occurrenceId) {
        const rite = service_time.startsWith('08') ? 'Rite I' : 'Rite II';
        occurrenceId = `occ-${randomUUID()}`;
        db.prepare(`
            INSERT INTO event_occurrences (
                id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
            ) VALUES (?, 'sunday-service', ?, ?, NULL, ?, ?, 0, NULL)
        `).run(
            occurrenceId,
            date,
            service_time,
            location || DEFAULT_LOCATION_BY_TIME[service_time] || '',
            rite
        );
    } else {
        db.prepare(`
            UPDATE event_occurrences
            SET building_id = ?
            WHERE id = ?
        `).run(location || DEFAULT_LOCATION_BY_TIME[service_time] || '', occurrenceId);
    }

    const deleteAssignments = db.prepare(`
        DELETE FROM assignments
        WHERE occurrence_id = ? AND role_key = ?
    `);
    const insertAssignment = db.prepare(`
        INSERT INTO assignments (id, occurrence_id, role_key, person_id)
        VALUES (?, ?, ?, ?)
    `);

    Object.entries(normalized).forEach(([key, value]) => {
        const roleKey = ROLE_FIELD_MAP[key];
        if (!roleKey) return;
        deleteAssignments.run(occurrenceId, roleKey);
        const people = normalizeAssignmentList(value, peopleIndex);
        const uniquePeople = Array.from(new Set(people));
        uniquePeople.forEach((personId) => {
            insertAssignment.run(`asgn-${randomUUID()}`, occurrenceId, roleKey, personId);
        });
    });

    applyDefaultSundayAssignments(occurrenceId, date, service_time);
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
    const occurrence = db.prepare(`
        SELECT o.id, o.date, o.start_time, o.building_id
        FROM event_occurrences o
        WHERE o.event_id = 'sunday-service' AND o.date = ? AND o.start_time = '10:00'
        LIMIT 1
    `).get(date);
    if (!occurrence) return res.json({});
    const assignments = db.prepare(`
        SELECT role_key, person_id FROM assignments WHERE occurrence_id = ?
    `).all(occurrence.id);
    const roleMap = {};
    assignments.forEach((row) => {
        if (!roleMap[row.role_key]) roleMap[row.role_key] = [];
        roleMap[row.role_key].push(row.person_id);
    });
    res.json({
        date: occurrence.date,
        service_time: occurrence.start_time,
        location: occurrence.building_id || '',
        celebrant: (roleMap.celebrant || []).join(', '),
        preacher: (roleMap.preacher || []).join(', '),
        organist: (roleMap.organist || []).join(', '),
        lector: (roleMap.lector || []).join(', '),
        usher: (roleMap.usher || []).join(', '),
        acolyte: (roleMap.acolyte || []).join(', '),
        chalice_bearer: (roleMap.lem || []).join(', '),
        sound_engineer: (roleMap.sound || []).join(', '),
        coffee_hour: (roleMap.coffeeHour || []).join(', '),
        childcare: (roleMap.childcare || []).join(', ')
    });
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
        lem: normalizeScheduleValue(chaliceBearer, peopleIndex),
        sound: normalizeScheduleValue(sound, peopleIndex),
        coffeeHour: normalizeScheduleValue(coffeeHour, peopleIndex),
        childcare: normalizeScheduleValue(childcare, peopleIndex)
    };

    let occurrence = db.prepare(`
        SELECT id FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = '10:00'
    `).get(date);

    if (!occurrence) {
        occurrence = { id: `occ-${randomUUID()}` };
        db.prepare(`
            INSERT INTO event_occurrences (
                id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
            ) VALUES (?, 'sunday-service', ?, '10:00', NULL, ?, 'Rite II', 0, NULL)
        `).run(
            occurrence.id,
            date,
            location || DEFAULT_LOCATION_BY_TIME['10:00'] || ''
        );
    } else {
        db.prepare(`
            UPDATE event_occurrences SET building_id = ? WHERE id = ?
        `).run(location || DEFAULT_LOCATION_BY_TIME['10:00'] || '', occurrence.id);
    }

    const deleteAssignments = db.prepare(`
        DELETE FROM assignments WHERE occurrence_id = ? AND role_key = ?
    `);
    const insertAssignment = db.prepare(`
        INSERT INTO assignments (id, occurrence_id, role_key, person_id)
        VALUES (?, ?, ?, ?)
    `);

    Object.entries(normalized).forEach(([key, value]) => {
        deleteAssignments.run(occurrence.id, key);
        const people = normalizeAssignmentList(value, peopleIndex);
        Array.from(new Set(people)).forEach((personId) => {
            insertAssignment.run(`asgn-${randomUUID()}`, occurrence.id, key, personId);
        });
    });

    applyDefaultSundayAssignments(occurrence.id, date, '10:00');
    res.json({ success: true, date });
});

app.listen(PORT, () => {
    console.log(`API Server running on http://localhost:${PORT}`);
});
