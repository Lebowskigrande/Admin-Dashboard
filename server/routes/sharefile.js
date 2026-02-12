import express from 'express';
import { google } from 'googleapis';
import xlsx from 'xlsx';
import { resolve } from 'path';
import { sqlite as db } from '../db.js';
import { requireAuth, SHAREFILE_GMAIL_USER_ID, saveSharefileGmailTokens, getSharefileGmailTokens, getUserTokens } from '../helpers/auth.js';
import { routeShareFileEmails, routeSharefileMessage, resolveSharefileMessageId, recordSharefileRoutingEvent } from '../services/sharefileEmailRouter.js';
import { getAuthUrlWithRedirect, getTokensFromCodeWithRedirect, GOOGLE_SCOPES } from '../googleAuth.js';

const router = express.Router();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SHAREFILE_REDIRECT_URI = process.env.SHAREFILE_GOOGLE_REDIRECT_URI
    || (process.env.GOOGLE_REDIRECT_URI
        ? process.env.GOOGLE_REDIRECT_URI.replace('/auth/google/callback', '/auth/google/sharefile/callback')
        : '');
const SHAREFILE_EXTENSION_TOKEN = process.env.SHAREFILE_EXTENSION_TOKEN || '';
const SHAREFILE_EXTENSION_USER_ID = process.env.SHAREFILE_EXTENSION_USER_ID || '';
const SHAREFILE_EXTENSION_EMAIL = process.env.SHAREFILE_EXTENSION_EMAIL || '';

const getExtensionGmailTokens = () => {
    if (SHAREFILE_EXTENSION_USER_ID) {
        return getUserTokens(SHAREFILE_EXTENSION_USER_ID);
    }
    if (SHAREFILE_EXTENSION_EMAIL) {
        const user = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(SHAREFILE_EXTENSION_EMAIL);
        if (user?.id) {
            return getUserTokens(user.id);
        }
    }
    return getSharefileGmailTokens();
};

const requireSharefileAuth = (req, res, next) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token && SHAREFILE_EXTENSION_TOKEN && token === SHAREFILE_EXTENSION_TOKEN) {
        return next();
    }
    if (req.user) {
        return next();
    }
    return res.status(401).json({ error: 'Invalid or missing token' });
};

const parseLegacyMessageId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^#?msg-f:/i, '');
    if (!/^\d+$/.test(cleaned)) return null;
    try {
        return BigInt(cleaned).toString(16);
    } catch {
        return null;
    }
};

const normalizeMessageId = (gmail = {}) => {
    const direct = String(gmail.messageId || '').trim();
    if (direct) {
        if (/^#?msg-f:/i.test(direct)) {
            const parsed = parseLegacyMessageId(direct);
            if (parsed) return parsed;
        }
        return direct;
    }
    const legacy = parseLegacyMessageId(gmail.webMessageDomId || '');
    return legacy || null;
};

const parseThreadFromGmailHref = (href) => {
    const raw = String(href || '').trim();
    if (!raw) return '';

    try {
        const hash = (raw.split('#')[1] || '').trim();
        if (!hash) return '';
        const parts = hash.split('/').filter(Boolean);
        const maybeId = parts.at(-1) || '';
        return /^[0-9a-f]{10,}$/i.test(maybeId) ? maybeId : '';
    } catch {
        return '';
    }
};

const fetchGoogleProfile = async (tokens) => {
    const oauth2 = google.oauth2('v2');
    const response = await oauth2.userinfo.get({ access_token: tokens.access_token });
    return response.data;
};

router.get('/sharefile/google/auth-url', requireAuth, (_req, res) => {
    if (!SHAREFILE_REDIRECT_URI) {
        return res.status(500).json({ error: 'Missing SHAREFILE_GOOGLE_REDIRECT_URI' });
    }
    res.json({ url: getAuthUrlWithRedirect(SHAREFILE_REDIRECT_URI), scopes: GOOGLE_SCOPES });
});

router.get('/auth/google/sharefile/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        if (!SHAREFILE_REDIRECT_URI) {
            return res.status(500).send('Missing SHAREFILE_GOOGLE_REDIRECT_URI');
        }
        const tokens = await getTokensFromCodeWithRedirect(code, SHAREFILE_REDIRECT_URI);
        const profile = await fetchGoogleProfile(tokens);
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO users (id, email, display_name, avatar_url, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url
        `).run(
            SHAREFILE_GMAIL_USER_ID,
            profile.email || '',
            profile.name || profile.email || 'ShareFile Gmail',
            profile.picture || '',
            now
        );

        saveSharefileGmailTokens(tokens);
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('ShareFile Gmail OAuth callback error:', error);
        res.status(500).send('Authentication failed');
    }
});

router.get('/sharefile/google/status', requireAuth, (_req, res) => {
    const tokens = getSharefileGmailTokens();
    const user = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(SHAREFILE_GMAIL_USER_ID);
    res.json({ connected: !!tokens, account: user || null });
});

router.post('/sharefile/route-emails', requireAuth, async (req, res) => {
    try {
        const result = await routeShareFileEmails({
            archive: true
        });
        res.json(result);
    } catch (error) {
        console.error('ShareFile route emails error:', error);
        res.status(500).json({ error: error?.message || 'Failed to route emails' });
    }
});

router.post('/sharefile/route-email', requireSharefileAuth, async (req, res) => {
    const payload = req.body || {};
    const gmail = payload.gmail || {};
    const href = gmail.href || payload?.page?.url || '';
    const threadFromHref = parseThreadFromGmailHref(href);
    const extraMeta = {
        codeType: payload.codeType,
        codeValue: payload.codeValue,
        routeKind: payload.routeKind,
        clientTs: payload.client?.ts || ''
    };

    try {
        const tokensOverride = getExtensionGmailTokens();
        if (!tokensOverride) {
            recordSharefileRoutingEvent({
                messageId: normalizeMessageId(gmail),
                threadId: gmail.threadId || threadFromHref || null,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'failure',
                errorText: 'No Gmail tokens configured for ShareFile extension'
            });
            return res.status(400).json({ error: 'No Gmail tokens configured for ShareFile extension' });
        }
        const result = await routeSharefileMessage({
            messageId: normalizeMessageId(gmail),
            threadId: gmail.threadId || threadFromHref || null,
            extraMeta,
            archive: true,
            tokensOverride
        });
        res.json(result);
    } catch (error) {
        console.error('ShareFile route email error:', error);
        recordSharefileRoutingEvent({
            messageId: normalizeMessageId(gmail),
            threadId: gmail.threadId || threadFromHref || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'failure',
            errorText: error?.message || 'Failed to route email'
        });
        res.status(500).json({ error: error?.message || 'Failed to route email' });
    }
});

router.post('/sharefile/resolve-message-id', requireSharefileAuth, async (req, res) => {
    try {
        const tokensOverride = getExtensionGmailTokens();
        if (!tokensOverride) {
            return res.status(400).json({ error: 'No Gmail tokens configured for ShareFile extension' });
        }
        const threadId = String(req.body?.threadId || '').trim();
        if (!threadId) {
            return res.status(400).json({ error: 'threadId is required' });
        }
        const messageId = await resolveSharefileMessageId(threadId, tokensOverride);
        res.json({ ok: true, messageId: messageId || null, threadId });
    } catch (error) {
        console.error('ShareFile resolve message id error:', error);
        res.status(500).json({ error: error?.message || 'Failed to resolve messageId' });
    }
});

const loadBudgetCodes = () => {
    const filePath = resolve(process.cwd(), 'budget_codes.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const entries = [];
    let currentCategory = '';

    rows.forEach((row) => {
        const category = String(row[0] || '').trim();
        const codeRaw = String(row[1] || '').trim();
        const line = String(row[2] || '').trim();

        if (category) {
            currentCategory = category;
        }
        if (!currentCategory) return;

        if (line.toLowerCase() === 'div') {
            // Ignore divider marker rows; UI should render a flat category list.
            return;
        }

        if (!codeRaw) {
            if (line) {
                entries.push({ type: 'heading', category: currentCategory, label: line });
            }
            return;
        }

        entries.push({
            type: 'item',
            category: currentCategory,
            code: codeRaw,
            line
        });
    });

    return entries;
};

const loadEnvelopeNumbers = () => {
    const filePath = resolve(process.cwd(), 'envelope_numbers.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const entries = rows
        .map((row) => {
            const number = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!number || !name) return null;
            return {
                number,
                name,
                letter: name.charAt(0).toUpperCase()
            };
        })
        .filter(Boolean);
    return entries;
};

router.get('/sharefile/budget-codes', requireSharefileAuth, (_req, res) => {
    try {
        const entries = loadBudgetCodes();
        res.json({ ok: true, entries });
    } catch (error) {
        console.error('Budget codes load error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load budget codes' });
    }
});

router.get('/sharefile/envelope-numbers', requireSharefileAuth, (_req, res) => {
    try {
        const entries = loadEnvelopeNumbers();
        res.json({ ok: true, entries });
    } catch (error) {
        console.error('Envelope numbers load error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load envelope numbers' });
    }
});

export default router;
