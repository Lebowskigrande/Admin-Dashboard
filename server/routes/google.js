import express from 'express';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import {
    setSessionCookie,
    requireAuth,
    getUserTokens,
    SESSION_TTL_DAYS
} from '../helpers/auth.js';
import {
    getAuthUrl,
    getTokensFromCode,
    GOOGLE_SCOPES
} from '../googleAuth.js';
import {
    fetchGoogleCalendarEvents,
    fetchCalendarList
} from '../googleCalendar.js';
import { syncGoogleEvents } from '../eventEngine.js';
import { seedEventTasksForOccurrence } from '../services/taskEngine.js';
import { recordAdminAction } from '../helpers/adminAudit.js';

const router = express.Router();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const fetchGoogleProfile = async (tokens) => {
    const oauth2 = google.oauth2('v2');
    const response = await oauth2.userinfo.get({ access_token: tokens.access_token });
    return response.data;
};

// --- Auth Routes ---

router.get('/auth/google', (req, res) => {
    const authUrl = getAuthUrl();
    console.log('Google auth URL', authUrl);
    res.redirect(authUrl);
});

router.get('/api/google/auth-url', (_req, res) => {
    res.json({ url: getAuthUrl(), scopes: GOOGLE_SCOPES });
});

router.get('/auth/google/callback', async (req, res) => {
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

router.get('/api/google/status', (req, res) => {
    if (!req.user) return res.json({ connected: false });
    const tokens = getUserTokens(req.user.id);
    res.json({ connected: !!tokens });
});

router.post('/api/google/disconnect', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM calendar_links WHERE user_id = ?').run(req.user.id);
        recordAdminAction({
            req,
            action: 'google.disconnect',
            target: req.user.id,
            status: 'success'
        });
        res.json({ success: true });
    } catch (error) {
        recordAdminAction({
            req,
            action: 'google.disconnect',
            target: req.user.id,
            status: 'failure',
            errorText: error?.message || 'Failed to disconnect Google Calendar'
        });
        res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
    }
});

// --- Calendar Routes ---

router.get('/api/google/calendars', requireAuth, async (req, res) => {
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

router.post('/api/google/calendars/select', requireAuth, async (req, res) => {
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

router.get('/api/google/events', requireAuth, async (req, res) => {
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
                },
                onOccurrence: seedEventTasksForOccurrence
            }).catch(err => {
                console.error('Background sync failed:', err);
            });
        }

        const formatted = rows.map(e => ({
            id: `google-${e.id}-${e.date}-${e.start_time || 'all-day'}`,
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

router.post('/api/google/sync', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) return res.status(401).json({ error: 'Not connected' });

        const total = await syncGoogleEvents(fetchGoogleCalendarEvents, {
            userId: req.user.id,
            tokens: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date
            },
            onOccurrence: seedEventTasksForOccurrence
        });
        recordAdminAction({
            req,
            action: 'google.sync',
            target: req.user.id,
            status: 'success',
            details: { count: total }
        });
        res.json({ success: true, count: total });
    } catch (error) {
        console.error('Sync error:', error);
        recordAdminAction({
            req,
            action: 'google.sync',
            target: req.user?.id || '',
            status: 'failure',
            errorText: error?.message || 'Sync failed'
        });
        res.status(500).json({ error: 'Sync failed' });
    }
});

export default router;
