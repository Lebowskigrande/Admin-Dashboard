import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { addMonths, format, isSunday, parseISO } from 'date-fns';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { join, dirname, resolve, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import xlsx from 'xlsx';
import { sqlite } from './db.js';
import { runMigrations } from './db/migrate.js';
import { seedNormalized } from './db/seedNormalized.js';
import { migrateLegacyData } from './db/legacy_migrate.js';
import { applyDefaultSundayAssignments, ensureDefaultSundayServices } from './db/default_services.js';
import { seedDatabase } from './seed.js';
import { createOAuthClient, getAuthUrl, getTokensFromCode, setStoredCredentials, GOOGLE_SCOPES } from './googleAuth.js';
import { fetchGoogleCalendarEvents, fetchCalendarList } from './googleCalendar.js';
import { google } from 'googleapis';
import { syncGoogleEvents } from './eventEngine.js';
import { buildDepositSlipPdf, extractChecksFromImages } from './depositSlip.js';

dotenv.config({ path: './server/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backupDir = process.env.DB_BACKUP_DIR || 'C:\\Users\\jclar\\Dropbox\\Parish Administrator';
const backupPattern = /^church-db-.*\.db$/i;
const CC_AUTH_URL = 'https://authz.constantcontact.com/oauth2/default/v1/authorize';
const CC_TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token';
const CC_API_BASE = 'https://api.cc.email/v3';

const HGK_SUPPLY_ITEMS = [
    'Bread',
    'Peanut Butter',
    'Jelly',
    'Chips (box)',
    'Granola Bars (box)',
    'Oranges',
    'Rice Krispie Treats (box)',
    'Water',
    'Lunch Bags',
    'Sandwich Bags',
    'Gloves',
    'Napkins'
];

const HGK_STATUS_OPTIONS = ['needed', 'ordered', 'received'];

const formatMonthKey = (value) => {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})$/);
    if (match) {
        const [, year, month] = match;
        const monthNumber = Number(month);
        if (monthNumber >= 1 && monthNumber <= 12) {
            return `${year}-${month}`;
        }
    }
    const now = new Date();
    return now.toISOString().slice(0, 7);
};

const getThirdSundayFromMonth = (monthKey) => {
    const parts = String(monthKey || '').split('-');
    if (parts.length < 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!Number.isFinite(year) || Number.isNaN(month)) return null;
    const firstDay = new Date(year, month - 1, 1);
    const firstSunday = 1 + ((7 - firstDay.getDay()) % 7);
    const thirdSunday = firstSunday + 14;
    const date = new Date(year, month - 1, thirdSunday);
    return date.toISOString().slice(0, 10);
};

const findHgkOccurrenceId = (monthKey) => {
    const dateKey = getThirdSundayFromMonth(monthKey);
    if (!dateKey) return null;
    const row = sqlite.prepare(`
        SELECT o.id
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON e.event_type_id = t.id
        WHERE o.date = ?
          AND e.source = 'google'
          AND (
              lower(e.title) LIKE '%holy ghost kitchen%'
              OR lower(e.title) LIKE '%hgk%'
              OR lower(e.description) LIKE '%holy ghost kitchen%'
              OR lower(e.description) LIKE '%hgk%'
              OR (o.notes LIKE '%\"hgk\"%' OR o.notes LIKE '%#HGK%')
              OR t.slug = 'volunteer'
          )
        ORDER BY
            CASE WHEN o.notes LIKE '%\"hgk\"%' OR o.notes LIKE '%#HGK%' THEN 0 ELSE 1 END,
            o.start_time IS NULL,
            o.start_time
        LIMIT 1
    `).get(dateKey);
    return row?.id || null;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSupplyString = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeFileSegment = (value) => String(value || '')
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

const ensureEventDocDir = async (eventId, occurrenceId) => {
    const safeEvent = sanitizeFileSegment(eventId);
    const safeOccurrence = sanitizeFileSegment(occurrenceId);
    const dir = join(DROPBOX_ROOT, DROPBOX_EVENT_DOCS_DIR, safeEvent, safeOccurrence);
    await mkdir(dir, { recursive: true });
    return dir;
};

const ensureUniquePath = async (dir, filename) => {
    const base = filename.replace(/\.[^/.]+$/, '');
    const ext = extname(filename);
    let candidate = join(dir, filename);
    let counter = 1;
    while (true) {
        try {
            await access(candidate);
            candidate = join(dir, `${base}-${counter}${ext}`);
            counter += 1;
        } catch {
            return candidate;
        }
    }
};

const singularizeToken = (token) => token.endsWith('s') ? token.slice(0, -1) : token;

const tokenizeSupply = (value) => normalizeSupplyString(value)
    .split(' ')
    .map((token) => singularizeToken(token))
    .filter(Boolean);

const levenshteinDistance = (a, b) => {
    const left = a || '';
    const right = b || '';
    const rows = left.length + 1;
    const cols = right.length + 1;
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) grid[i][0] = i;
    for (let j = 0; j < cols; j += 1) grid[0][j] = j;
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            grid[i][j] = Math.min(
                grid[i - 1][j] + 1,
                grid[i][j - 1] + 1,
                grid[i - 1][j - 1] + cost
            );
        }
    }
    return grid[rows - 1][cols - 1];
};

const similarityScore = (a, b) => {
    if (!a || !b) return 0;
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length) || 1;
    return 1 - distance / maxLen;
};

const HGK_INSTACART_LIST_URL = 'https://www.instacart.com/store/list/08b147ca-259d-4fd2-b3ff-315e94880261?utm_medium=shared_list';

const HGK_ITEM_ALIASES = {
    'Jelly': ['jam'],
    'Chips (box)': ['chips'],
    'Granola Bars (box)': ['granola bars', 'granola bar'],
    'Rice Krispie Treats (box)': ['rice krispie treats', 'rice krispy treats', 'rice krispie', 'rice krispy'],
    'Oranges': ['fruit', 'tangerines', 'tangerine']
};

const decodeGmailBody = (data) => {
    if (!data) return '';
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
};

const collectGmailParts = (part, mimeType, collected = []) => {
    if (!part) return collected;
    if (part.mimeType === mimeType && part.body?.data) {
        collected.push(part.body.data);
    }
    if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => collectGmailParts(child, mimeType, collected));
    }
    return collected;
};

const extractGmailMessageText = (message) => {
    const payload = message?.payload;
    if (!payload) return '';
    const plainParts = collectGmailParts(payload, 'text/plain');
    if (plainParts.length > 0) {
        return plainParts.map(decodeGmailBody).join('\n');
    }
    const htmlParts = collectGmailParts(payload, 'text/html');
    if (htmlParts.length > 0) {
        const htmlText = htmlParts.map(decodeGmailBody).join('\n');
        return htmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (payload.body?.data) {
        return decodeGmailBody(payload.body.data);
    }
    return '';
};

const escapePsString = (value) => String(value || '')
    .replace(/`/g, '``')
    .replace(/'/g, "''");

const parseSupplyEmail = (emailText) => {
    const rawText = String(emailText || '');
    const normalized = rawText.toLowerCase();
    const entries = [];
    const detected = new Map();

    HGK_SUPPLY_ITEMS.forEach((item) => {
        const aliases = HGK_ITEM_ALIASES[item] || [];
        const candidates = [item, ...aliases];
        const patterns = candidates.map((candidate) => {
            const lowered = candidate.toLowerCase();
            return {
                forward: new RegExp(`(\\d+)\\s+${escapeRegex(lowered)}`),
                reverse: new RegExp(`${escapeRegex(lowered)}\\s+(\\d+)`)
            };
        });
        let quantity = '';
        patterns.some((pattern) => {
            const forwardMatch = normalized.match(pattern.forward);
            if (forwardMatch) {
                quantity = forwardMatch[1];
                return true;
            }
            const reverseMatch = normalized.match(pattern.reverse);
            if (reverseMatch) {
                quantity = reverseMatch[1];
                return true;
            }
            return false;
        });
        if (quantity) {
            detected.set(item, quantity);
        }
    });

    const itemProfiles = HGK_SUPPLY_ITEMS.map((item) => ({
        name: item,
        normalized: normalizeSupplyString(item),
        tokens: tokenizeSupply(item),
        aliases: (HGK_ITEM_ALIASES[item] || []).map((alias) => ({
            normalized: normalizeSupplyString(alias),
            tokens: tokenizeSupply(alias)
        }))
    }));

    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
        const qtyMatch = line.match(/(\d+(?:\.\d+)?)/);
        if (!qtyMatch) return;
        const quantity = qtyMatch[1];
        if (!quantity) return;
        const lineText = line.replace(qtyMatch[0], ' ');
        const normalizedLine = normalizeSupplyString(lineText);
        if (!normalizedLine) return;
        const lineTokens = tokenizeSupply(normalizedLine);
        let bestMatch = null;
        let bestScore = 0;
        itemProfiles.forEach((profile) => {
            const baseOverlap = profile.tokens.length
                ? profile.tokens.filter((token) => lineTokens.includes(token)).length / profile.tokens.length
                : 0;
            const baseSimilarity = similarityScore(profile.normalized, normalizedLine);
            const aliasScores = profile.aliases.map((alias) => {
                const overlap = alias.tokens.length
                    ? alias.tokens.filter((token) => lineTokens.includes(token)).length / alias.tokens.length
                    : 0;
                const similarity = similarityScore(alias.normalized, normalizedLine);
                return Math.max(overlap, similarity);
            });
            const score = Math.max(baseOverlap, baseSimilarity, ...aliasScores);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = profile.name;
            }
        });
        if (bestMatch && bestScore >= 0.6 && !detected.has(bestMatch)) {
            detected.set(bestMatch, quantity);
        }
    });

    HGK_SUPPLY_ITEMS.forEach((item) => {
        const quantity = detected.get(item) || '';
        entries.push({
            item_name: item,
            quantity: quantity || '',
            detected: !!quantity
        });
    });
    return entries;
};

const HGK_WEBHOOK_TOKEN = process.env.HGK_WEBHOOK_TOKEN || null;

const prepareHgkItemsPayload = (items) => {
    if (!Array.isArray(items)) return [];
    return items
        .map((entry) => {
            const itemName = String(entry?.item_name || entry?.name || '').trim();
            if (!itemName) return null;
            const quantity = String(entry.quantity || '').trim();
            const notes = String(entry.notes || '').trim();
            const status = HGK_STATUS_OPTIONS.includes(entry.status) ? entry.status : HGK_STATUS_OPTIONS[0];
            return {
                item_name: itemName,
                quantity,
                notes,
                status
            };
        })
        .filter(Boolean);
};

const upsertHgkSupplyRequest = (monthKey, notes = '', incomingItems = []) => {
    const normalizedMonth = formatMonthKey(monthKey);
    const now = new Date().toISOString();
    const occurrenceId = findHgkOccurrenceId(normalizedMonth);
    const existingRequest = sqlite.prepare('SELECT id FROM hgk_supply_requests WHERE month = ?').get(normalizedMonth);
    let requestId;

    if (existingRequest) {
        requestId = existingRequest.id;
        sqlite.prepare(`
            UPDATE hgk_supply_requests
            SET notes = ?, occurrence_id = ?, updated_at = ?
            WHERE id = ?
        `).run(notes || null, occurrenceId, now, requestId);
    } else {
        requestId = `hgk-${normalizedMonth}`;
        sqlite.prepare(`
            INSERT INTO hgk_supply_requests (id, month, notes, occurrence_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(requestId, normalizedMonth, notes || null, occurrenceId, now, now);
    }

    const payloadItems = Array.isArray(incomingItems) && incomingItems.length > 0
        ? prepareHgkItemsPayload(incomingItems)
        : HGK_SUPPLY_ITEMS.map((name) => ({ item_name: name, quantity: '', notes: '', status: HGK_STATUS_OPTIONS[0] }));

    sqlite.prepare('DELETE FROM hgk_supply_items WHERE request_id = ?').run(requestId);
    insertHgkSupplyItems(requestId, payloadItems, now);

    const savedRequest = sqlite.prepare('SELECT * FROM hgk_supply_requests WHERE id = ?').get(requestId);
    const savedItems = sqlite.prepare('SELECT * FROM hgk_supply_items WHERE request_id = ? ORDER BY item_name').all(requestId);
    return {
        month: normalizedMonth,
        request: savedRequest,
        items: savedItems
    };
};

const getCcUserId = (req) => req.user?.id || 'local';

const findLatestDbBackup = async () => {
    const entries = await readdir(backupDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && backupPattern.test(entry.name));
    if (files.length === 0) return null;
    const stats = await Promise.all(
        files.map(async (entry) => {
            const fullPath = join(backupDir, entry.name);
            const fileStats = await stat(fullPath);
            return { name: entry.name, path: fullPath, mtimeMs: fileStats.mtimeMs };
        })
    );
    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = stats[0];
    return {
        name: latest.name,
        path: latest.path,
        modified: new Date(latest.mtimeMs).toISOString()
    };
};

const getCcTokens = (userId) => {
    return db.prepare(`
        SELECT * FROM constant_contact_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(userId);
};

const saveCcTokens = (userId, tokens) => {
    const now = new Date().toISOString();
    const expiresAt = tokens?.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;
    db.prepare('DELETE FROM constant_contact_tokens WHERE user_id = ?').run(userId);
    db.prepare(`
        INSERT INTO constant_contact_tokens (
            id, user_id, access_token, refresh_token, expires_at, scope, token_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        `cc-token-${randomUUID()}`,
        userId,
        tokens.access_token || null,
        tokens.refresh_token || null,
        expiresAt,
        tokens.scope || null,
        tokens.token_type || null,
        now
    );
};

const refreshCcToken = async (userId, refreshToken) => {
    const clientId = process.env.CC_CLIENT_ID;
    const clientSecret = process.env.CC_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('Constant Contact credentials not configured');
    }
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    });
    const response = await fetch(CC_TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
    if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || 'Failed to refresh Constant Contact token');
    }
    const tokens = await response.json();
    saveCcTokens(userId, { ...tokens, refresh_token: tokens.refresh_token || refreshToken });
    return getCcTokens(userId);
};

const ensureCcAccessToken = async (userId) => {
    const tokens = getCcTokens(userId);
    if (!tokens?.access_token) return null;
    if (!tokens.expires_at) return tokens;
    const expiresAt = new Date(tokens.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return tokens;
    const bufferMs = 60 * 1000;
    if (expiresAt.getTime() - Date.now() < bufferMs) {
        if (!tokens.refresh_token) return tokens;
        return refreshCcToken(userId, tokens.refresh_token);
    }
    return tokens;
};

const fetchCcJson = async (url, tokens, options = {}) => {
    const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const payload = await response.text();
        const detail = payload || 'Constant Contact request failed';
        throw new Error(`${response.status} ${response.statusText} ${url} ${detail}`);
    }
    return response.json();
};

const fetchCcFromEmails = async (tokens) => {
    const data = await fetchCcJson(`${CC_API_BASE}/account/emails`, tokens);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.email_addresses)) return data.email_addresses;
    if (Array.isArray(data?.emails)) return data.emails;
    if (Array.isArray(data?.results)) return data.results;
    return [];
};

const findCcListId = async (tokens, listName) => {
    const data = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
    const lists = Array.isArray(data?.lists) ? data.lists : [];
    const match = lists.find((list) => list.name?.toLowerCase() === listName.toLowerCase());
    return match?.list_id || null;
};

const getNextSaturdayAtSix = () => {
    const now = new Date();
    const target = new Date(now);
    target.setHours(6, 0, 0, 0);
    const day = now.getDay();
    const daysUntil = (6 - day + 7) % 7;
    target.setDate(now.getDate() + daysUntil);
    if (target <= now) {
        target.setDate(target.getDate() + 7);
    }
    return target;
};

const loadEmailTemplate = async () => {
    const templatePath = join(__dirname, '../CC_livestream_email_template.txt');
    return readFile(templatePath, 'utf8');
};

const sanitizeEmailHtml = (html) => {
    if (!html) return '';
    let cleaned = html;
    cleaned = cleaned.replace(/<!doctype[\s\S]*?>/gi, '');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<meta[^>]*>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
        cleaned = `<html><body>${bodyMatch[1]}</body></html>`;
    }
    return cleaned;
};
const execFileAsync = promisify(execFile);
const dbPath = join(__dirname, 'church.db');
const DEPOSIT_OUTPUT_DIR = join(__dirname, 'deposit-outputs');
const PREVIEW_CACHE_ROOT = join(__dirname, 'preview-cache');

const app = express();
const PORT = 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const upload = multer({ dest: join(tmpdir(), 'deposit-slip-uploads') });
const depositBundleUpload = multer({ dest: join(tmpdir(), 'deposit-slip-bundle-uploads') });
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });
const eventDocUpload = multer({ dest: join(tmpdir(), 'event-doc-uploads') });

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
});

const SESSION_COOKIE = 'dashboard_session';
const SESSION_TTL_DAYS = 30;
const CC_STATE_COOKIE = 'cc_oauth_state';

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

const setCcStateCookie = (res, value) => {
    const expires = new Date(Date.now() + 10 * 60 * 1000).toUTCString();
    res.setHeader('Set-Cookie', `${CC_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
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

const DROPBOX_USER_ID = 'dropbox-local';

const getDropboxTokens = () => {
    return db.prepare(`
        SELECT * FROM user_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(DROPBOX_USER_ID);
};

const saveDropboxTokens = (tokens) => {
    const now = new Date().toISOString();
    db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(DROPBOX_USER_ID);
    db.prepare(`
        INSERT INTO user_tokens (id, user_id, access_token, refresh_token, expiry_date, scope, token_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        `token-${randomUUID()}`,
        DROPBOX_USER_ID,
        tokens.access_token || null,
        tokens.refresh_token || null,
        tokens.expiry_date || null,
        tokens.scope || null,
        tokens.token_type || null,
        now
    );
};

const refreshDropboxToken = async (refreshToken) => {
    const clientId = process.env.DROPBOX_APP_KEY;
    const clientSecret = process.env.DROPBOX_APP_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error('Missing Dropbox app credentials');
    }
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
    });
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Dropbox refresh failed');
    }
    const data = await response.json();
    return {
        access_token: data.access_token,
        refresh_token: refreshToken,
        token_type: data.token_type,
        scope: data.scope,
        expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null
    };
};

const getDropboxAccessToken = async () => {
    if (process.env.DROPBOX_ACCESS_TOKEN) {
        return process.env.DROPBOX_ACCESS_TOKEN;
    }
    const tokens = getDropboxTokens();
    if (!tokens || !tokens.access_token) {
        throw new Error('Dropbox is not connected.');
    }
    if (tokens.expiry_date && Date.now() < tokens.expiry_date - 60 * 1000) {
        return tokens.access_token;
    }
    if (!tokens.refresh_token) {
        throw new Error('Dropbox refresh token missing.');
    }
    const refreshed = await refreshDropboxToken(tokens.refresh_token);
    saveDropboxTokens(refreshed);
    return refreshed.access_token;
};

// Run migrations and seeds
runMigrations();
seedDatabase();
seedNormalized();
migrateLegacyData();
ensureDefaultSundayServices();

const db = sqlite;

const ensureBulletinStatusTable = () => {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS bulletin_status (
            date TEXT NOT NULL,
            doc_key TEXT NOT NULL,
            status TEXT NOT NULL,
            source TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (date, doc_key)
        );
    `);
};

ensureBulletinStatusTable();

const ensureTasksColumns = () => {
    const table = sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'
    `).get();
    if (!table) return;
    const columns = sqlite.prepare('PRAGMA table_info(tasks)').all().map((col) => col.name);
    const columnSet = new Set(columns);
    if (!columnSet.has('completed_at')) {
        sqlite.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT');
        columnSet.add('completed_at');
    }
    if (!columnSet.has('notes')) {
        sqlite.exec('ALTER TABLE tasks ADD COLUMN notes TEXT');
    }
};

ensureTasksColumns();

const ensureTaskInstanceNotes = () => {
    const table = sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_instances'
    `).get();
    if (!table) return;
    const columns = sqlite.prepare('PRAGMA table_info(task_instances)').all().map((col) => col.name);
    if (!columns.includes('notes')) {
        sqlite.exec('ALTER TABLE task_instances ADD COLUMN notes TEXT');
    }
    if (!columns.includes('progress_key')) {
        sqlite.exec('ALTER TABLE task_instances ADD COLUMN progress_key TEXT');
    }
    if (!columns.includes('progress_steps')) {
        sqlite.exec('ALTER TABLE task_instances ADD COLUMN progress_steps TEXT');
    }
};

ensureTaskInstanceNotes();

function seedTaskEngine() {
    if (!tableExists('tasks_new') || !tableExists('task_instances') || !tableExists('task_origins')) {
        return;
    }

    // Remove legacy placeholder manual tasks (pre-engine).
    if (tableExists('task_instances') && tableExists('task_origins')) {
        const legacyManual = db.prepare(`
            SELECT ti.id, ti.task_id
            FROM task_instances ti
            JOIN task_origins o ON o.scope = 'instance' AND o.task_instance_id = ti.id
            WHERE ti.generated_from = 'legacy_import' AND o.origin_type = 'manual'
        `).all();
        legacyManual.forEach((row) => {
            deleteTaskInstance(row.id);
        });
    }

    // Seed open ticket tasks (if none exist for the ticket).
    const openTickets = db.prepare(`
        SELECT id, title, status, created_at
        FROM tickets
        WHERE status != 'closed'
    `).all();
    openTickets.forEach((ticket) => {
        const existing = db.prepare(`
            SELECT 1
            FROM task_origins o
            JOIN task_instances ti ON ti.id = o.task_instance_id
            WHERE o.origin_type = 'ticket' AND o.origin_id = ?
              AND ti.state != 'done'
            LIMIT 1
        `).get(ticket.id);
        if (existing) return;
        createTaskInstance({
            title: `Resolve ticket: ${ticket.title}`,
            taskType: 'support',
            priorityBase: getDefaultPriorityBase('support'),
            dueAt: null,
            originType: 'ticket',
            originId: ticket.id,
            originEvent: 'ticket',
            generationKey: `ticket:${ticket.id}:resolve`
        });
    });

    seedSundayTasksFromTemplates();
    seedVestryTasksFromTemplates();
    seedOperationsTasksFromTemplates();
    seedEventTasksFromTemplates();
}

const DEFAULT_TASK_PRIORITY_BY_TYPE = {
    support: 60,
    sunday: 70,
    inventory: 50,
    cleanup: 30,
    vestry: 60,
    event: 55,
    operations: 55
};

const getPriorityPolicy = (taskType) => {
    if (!taskType) return null;
    const table = sqlite.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_priority_policy'
    `).get();
    if (!table) return null;
    return sqlite.prepare('SELECT * FROM task_priority_policy WHERE task_type = ?').get(taskType) || null;
};

const getDefaultPriorityBase = (taskType) => {
    const policy = getPriorityPolicy(taskType);
    if (policy && Number.isFinite(Number(policy.default_priority_base))) {
        return Number(policy.default_priority_base);
    }
    if (taskType && Object.prototype.hasOwnProperty.call(DEFAULT_TASK_PRIORITY_BY_TYPE, taskType)) {
        return DEFAULT_TASK_PRIORITY_BY_TYPE[taskType];
    }
    return 50;
};

const normalizeDateKey = (value) => {
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const isAfterDate = (left, right) => {
    const leftKey = normalizeDateKey(left);
    const rightKey = normalizeDateKey(right);
    if (!leftKey || !rightKey) return false;
    return leftKey > rightKey;
};

const CRITICAL_PRIORITY = 80;

const applyTaskArchiving = () => {
    if (!tableExists('task_instances')) return;
    if (!tableHasColumn('task_instances', 'archived_at')) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const rows = db.prepare(`
        SELECT id, due_at, completed_at, archive_after_due, keep_until, priority_override
        FROM task_instances
        WHERE archived_at IS NULL
    `).all();
    const bumpPriority = db.prepare('UPDATE task_instances SET priority_override = ? WHERE id = ?');
    rows.forEach((row) => {
        const dueKey = normalizeDateKey(row.due_at);
        if (!dueKey) return;
        if (row.completed_at) return;
        const keepUntil = normalizeDateKey(row.keep_until);
        const threshold = keepUntil || dueKey;
        if (threshold <= todayKey) {
            const current = Number.isFinite(Number(row.priority_override))
                ? Number(row.priority_override)
                : null;
            const next = clampPriority(Math.max(current ?? 0, CRITICAL_PRIORITY));
            bumpPriority.run(next, row.id);
        }
    });
};

const toEntityLinkId = (fromType, fromId, toType, toId, role) => {
    const safe = (value) => String(value || '').replace(/[^a-z0-9-_]/gi, '').slice(0, 40);
    return `link-${safe(fromType)}-${safe(fromId)}-${safe(toType)}-${safe(toId)}-${safe(role || 'rel')}`;
};

const upsertEntityLink = (payload) => {
    const {
        fromType,
        fromId,
        toType,
        toId,
        role,
        metaJson = null,
        createdAt = new Date().toISOString()
    } = payload || {};
    if (!fromType || !fromId || !toType || !toId) return null;
    const id = payload?.id || toEntityLinkId(fromType, fromId, toType, toId, role);
    sqlite.prepare(`
        INSERT OR IGNORE INTO entity_links (
            id, from_type, from_id, to_type, to_id, role, created_at, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, fromType, fromId, toType, toId, role || null, createdAt, metaJson);
    return id;
};

const deleteEntityLinks = ({ fromType, fromId, role }) => {
    sqlite.prepare(`
        DELETE FROM entity_links
        WHERE from_type = ? AND from_id = ? AND (? IS NULL OR role = ?)
    `).run(fromType, fromId, role || null, role || null);
};

const tableExists = (name) => {
    return !!sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name);
};

const tableHasColumn = (tableName, columnName) => {
    if (!tableExists(tableName)) return false;
    const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
    return columns.includes(columnName);
};

const listRecurringTemplates = (originType, originId = null) => {
    if (!tableExists('recurring_task_templates')) return [];
    const rows = db.prepare(`
        SELECT *
        FROM recurring_task_templates
        WHERE origin_type = ?
          AND (origin_id IS NULL OR origin_id = ?)
          AND active = 1
        ORDER BY sort_order ASC, title ASC
    `).all(originType, originId);
    return rows;
};

const normalizeListKey = (value) => String(value || '').trim().toLowerCase();
const isSpecialEventsList = (listKey) => normalizeListKey(listKey) === 'special-events';

const ensureProgressiveTemplateModes = () => {
    if (!tableExists('recurring_task_templates')) return;
    sqlite.prepare(`
        UPDATE recurring_task_templates
        SET list_mode = 'progressive'
        WHERE list_key IS NOT NULL
          AND TRIM(list_key) != ''
          AND LOWER(list_key) != 'special-events'
    `).run();
};

const buildProgressStepsFromTemplates = (templates = []) => (
    templates
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((template) => ({
            key: template.step_key,
            title: template.title,
            sort_order: template.sort_order ?? 0,
            due_offset_days: template.due_offset_days ?? null
        }))
);

const buildProgressStepsFromTasks = (tasks = []) => (
    tasks
        .slice()
        .sort((a, b) => {
            const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
            const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
            if (dueA !== dueB) return dueA - dueB;
            return String(a.text || '').localeCompare(String(b.text || ''));
        })
        .map((task, index) => ({
            key: task.origin_event || task.id || `step-${index + 1}`,
            title: task.text || `Step ${index + 1}`,
            sort_order: index + 1,
            due_offset_days: null
        }))
);

const migrateTaskListsToProgressive = () => {
    if (!tableExists('task_instances') || !tableExists('tasks_new') || !tableExists('task_origins')) return;
    if (!tableHasColumn('task_instances', 'list_mode')) return;
    if (!tableHasColumn('task_instances', 'progress_steps')) return;

    ensureProgressiveTemplateModes();

    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };

    const templates = tableExists('recurring_task_templates')
        ? sqlite.prepare('SELECT * FROM recurring_task_templates WHERE active = 1').all()
        : [];
    const templateIndex = new Map();
    const sundayListKeys = new Set();
    const sundayListTitles = new Set();
    const sundayStepKeys = new Map();
    templates.forEach((template) => {
        if (!template.list_key || isSpecialEventsList(template.list_key)) return;
        if (template.origin_type === 'sunday') {
            sundayListKeys.add(template.list_key);
            if (template.list_title) sundayListTitles.add(String(template.list_title).trim().toLowerCase());
            if (!sundayStepKeys.has(template.list_key)) sundayStepKeys.set(template.list_key, new Set());
            sundayStepKeys.get(template.list_key).add(template.step_key);
        }
        const key = `${template.origin_type || ''}::${template.origin_id || ''}::${template.list_key}`;
        if (!templateIndex.has(key)) templateIndex.set(key, []);
        templateIndex.get(key).push(template);
    });
    const findTemplateSteps = (originType, originId, listKey) => {
        if (!listKey) return [];
        const exactKey = `${originType || ''}::${originId || ''}::${listKey}`;
        const fallbackKey = `${originType || ''}::${''}::${listKey}`;
        if (templateIndex.has(exactKey)) {
            return buildProgressStepsFromTemplates(templateIndex.get(exactKey));
        }
        if (templateIndex.has(fallbackKey)) {
            return buildProgressStepsFromTemplates(templateIndex.get(fallbackKey));
        }
        return [];
    };

    const hasArchived = tableHasColumn('task_instances', 'archived_at');
    const whereArchived = hasArchived ? 'AND (ti.archived_at IS NULL OR ti.archived_at = \'\')' : '';
    if (sundayListKeys.size > 0) {
        const listKeys = Array.from(sundayListKeys);
        const placeholders = listKeys.map(() => '?').join(', ');
        const orphaned = db.prepare(`
            SELECT ti.id, ti.list_key, src.origin_type, src.origin_id, src.origin_event, t.task_type
            FROM task_instances ti
            JOIN tasks_new t ON t.id = ti.task_id
            LEFT JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE ti.list_key IN (${placeholders})
              AND (src.origin_type IS NULL OR src.origin_type = '' OR src.origin_type = 'manual')
              AND (src.origin_id IS NULL OR src.origin_id = '' OR src.origin_id = 'manual')
              ${whereArchived}
        `).all(...listKeys);
        orphaned.forEach((row) => {
            const stepSet = sundayStepKeys.get(row.list_key);
            if (stepSet && row.origin_event && !stepSet.has(row.origin_event)) return;
            removeTaskInstance(row.id);
        });

        const mismatched = db.prepare(`
            SELECT ti.id, ti.list_key, src.origin_type, src.origin_id, src.origin_event
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE ti.list_key IN (${placeholders})
              AND src.origin_type != 'sunday'
              ${whereArchived}
        `).all(...listKeys);
        mismatched.forEach((row) => {
            const stepSet = sundayStepKeys.get(row.list_key);
            if (stepSet && row.origin_event && !stepSet.has(row.origin_event)) return;
            removeTaskInstance(row.id);
        });

        if (sundayListTitles.size > 0) {
            const titlePlaceholders = Array.from(sundayListTitles).map(() => '?').join(', ');
            const titleRows = db.prepare(`
                SELECT ti.id, ti.list_key, ti.list_title, src.origin_type, src.origin_id
                FROM task_instances ti
                JOIN tasks_new t ON t.id = ti.task_id
                LEFT JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
                WHERE (ti.list_key IS NULL OR TRIM(ti.list_key) = '' OR ti.list_key NOT IN (${placeholders}))
                  AND LOWER(COALESCE(ti.list_title, t.title, '')) IN (${titlePlaceholders})
                  AND (src.origin_type IS NULL OR src.origin_type = '' OR src.origin_type = 'manual')
                  ${whereArchived}
            `).all(...listKeys, ...Array.from(sundayListTitles));
            titleRows.forEach((row) => removeTaskInstance(row.id));
        }

        const cleanupOriginTypes = new Set();
        listKeys.forEach((key) => {
            cleanupOriginTypes.add(key);
            cleanupOriginTypes.add(key.replace(/s$/, ''));
        });
        cleanupOriginTypes.add('bulletin');
        cleanupOriginTypes.add('bulletins');
        cleanupOriginTypes.add('schedule email');
        cleanupOriginTypes.add('schedule-email');
        cleanupOriginTypes.add('schedule_email');
        cleanupOriginTypes.add('email');
        cleanupOriginTypes.add('insert');

        const originTypePlaceholders = Array.from(cleanupOriginTypes).map(() => '?').join(', ');
        const stray = db.prepare(`
            SELECT ti.id, ti.list_key, src.origin_type, src.origin_id, src.origin_event
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE ti.list_key IN (${placeholders})
              AND LOWER(src.origin_type) IN (${originTypePlaceholders})
              AND src.origin_type != 'sunday'
              ${whereArchived}
        `).all(...listKeys, ...Array.from(cleanupOriginTypes));
        stray.forEach((row) => removeTaskInstance(row.id));
    }
    const rows = db.prepare(`
        SELECT
            ti.id,
            ti.list_key,
            ti.list_title,
            ti.list_mode,
            ti.state,
            ti.completed_at,
            ti.due_at,
            t.priority_base,
            t.task_type,
            t.title AS task_title,
            src.origin_type,
            src.origin_id,
            src.origin_event
        FROM task_instances ti
        JOIN tasks_new t ON t.id = ti.task_id
        JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        WHERE ti.list_key IS NOT NULL
          AND TRIM(ti.list_key) != ''
          AND (ti.list_mode IS NULL OR ti.list_mode != 'progressive')
          ${whereArchived}
    `).all();

    const grouped = rows.reduce((acc, row) => {
        if (!row.list_key || isSpecialEventsList(row.list_key)) return acc;
        const key = `${row.origin_type || ''}::${row.origin_id || ''}::${row.list_key}`;
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(row);
        return acc;
    }, new Map());

    grouped.forEach((tasks, key) => {
        if (!tasks.length) return;
        const sample = tasks[0];
        const originType = sample.origin_type;
        const originId = sample.origin_id;
        const listKey = sample.list_key;
        const listTitle = sample.list_title || listKey;

        const existingProgressive = db.prepare(`
            SELECT ti.id, ti.progress_steps
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE ti.list_key = ?
              AND ti.list_mode = 'progressive'
              AND src.origin_type = ?
              AND src.origin_id = ?
            LIMIT 1
        `).get(listKey, originType, originId);

        const templateSteps = findTemplateSteps(originType, originId, listKey);
        const steps = templateSteps.length ? templateSteps : buildProgressStepsFromTasks(tasks);
        if (!steps.length) return;

        if (existingProgressive?.id) {
            if (!existingProgressive.progress_steps) {
                db.prepare('UPDATE task_instances SET progress_steps = ? WHERE id = ?')
                    .run(JSON.stringify(steps), existingProgressive.id);
            }
            tasks.forEach((task) => removeTaskInstance(task.id));
            return;
        }

        const taskType = sample.task_type || originType || null;
        const priorityBase = Math.max(
            ...tasks.map((task) => Number.isFinite(Number(task.priority_base)) ? Number(task.priority_base) : 0),
            getDefaultPriorityBase(taskType)
        );
        const dueAt = tasks
            .map((task) => task.due_at ? new Date(task.due_at).getTime() : null)
            .filter((value) => value != null && !Number.isNaN(value))
            .sort((a, b) => b - a)[0];
        const dueAtValue = dueAt != null ? new Date(dueAt).toISOString().slice(0, 10) : null;

        const stepLookup = new Map(tasks.map((task) => [task.origin_event, task]));
        let lastCompletedIndex = -1;
        steps.forEach((step, index) => {
            const task = stepLookup.get(step.key);
            if (!task) return;
            if (task.state === 'done' || task.completed_at) {
                lastCompletedIndex = Math.max(lastCompletedIndex, index);
            }
        });
        const progressKey = lastCompletedIndex >= 0 ? steps[lastCompletedIndex].key : '';

        const taskInstanceId = createTaskInstance({
            title: listTitle || listKey || 'Task',
            taskType,
            priorityBase,
            dueAt: dueAtValue,
            originType,
            originId,
            originEvent: listKey || 'progressive',
            generationKey: `migrate:${originType}:${originId}:${listKey}`,
            listKey,
            listTitle,
            listMode: 'progressive',
            progressKey,
            progressSteps: steps
        });

        if (taskInstanceId) {
            const completedAt = steps.length && progressKey && steps[steps.length - 1]?.key === progressKey
                ? (tasks.map((task) => task.completed_at).filter(Boolean).sort().pop() || new Date().toISOString())
                : null;
            if (completedAt) {
                db.prepare('UPDATE task_instances SET state = ?, completed_at = ? WHERE id = ?')
                    .run('done', completedAt, taskInstanceId);
            }
        }

        tasks.forEach((task) => removeTaskInstance(task.id));
    });
};

const auditAndCleanupOrphanTasks = () => {
    if (!tableExists('task_instances') || !tableExists('tasks_new')) return;

    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        if (tableExists('task_origins')) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        }
        if (tableExists('entity_links')) {
            db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        }
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            if (tableExists('task_origins')) {
                db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            }
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };

    if (!tableExists('recurring_task_templates')) return;
    const templates = sqlite.prepare('SELECT * FROM recurring_task_templates WHERE active = 1').all();
    const listKeys = Array.from(new Set(templates.map((row) => row.list_key).filter(Boolean)));
    const listTitles = Array.from(new Set(
        templates.map((row) => row.list_title).filter(Boolean).map((value) => String(value).trim().toLowerCase())
    ));
    if (listKeys.length === 0 && listTitles.length === 0) return;

    const keyPlaceholders = listKeys.map(() => '?').join(', ');
    const titlePlaceholders = listTitles.map(() => '?').join(', ');
    const hasArchived = tableHasColumn('task_instances', 'archived_at');
    const whereArchived = hasArchived ? 'AND (ti.archived_at IS NULL OR ti.archived_at = \'\')' : '';

    if (tableExists('task_origins')) {
        const orphaned = db.prepare(`
            SELECT ti.id
            FROM task_instances ti
            LEFT JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            JOIN tasks_new t ON t.id = ti.task_id
            WHERE (src.task_instance_id IS NULL OR src.origin_type IS NULL OR src.origin_id IS NULL OR TRIM(src.origin_type) = '' OR TRIM(src.origin_id) = '')
              AND (
                  (${listKeys.length ? `ti.list_key IN (${keyPlaceholders})` : '0'})
                  OR (${listTitles.length ? `LOWER(COALESCE(ti.list_title, t.title, '')) IN (${titlePlaceholders})` : '0'})
              )
              ${whereArchived}
        `).all(...listKeys, ...listTitles);
        orphaned.forEach((row) => removeTaskInstance(row.id));

        if (listKeys.length) {
            const sundayPlaceholders = listKeys.map(() => '?').join(', ');
            const sundayOrphans = db.prepare(`
                SELECT ti.id
                FROM task_instances ti
                JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
                WHERE ti.list_key IN (${sundayPlaceholders})
                  AND (src.origin_type IS NULL OR src.origin_type = '' OR src.origin_type = 'manual')
                  ${whereArchived}
            `).all(...listKeys);
            sundayOrphans.forEach((row) => removeTaskInstance(row.id));
        }

        const badOriginTypes = new Set(listKeys.map((value) => String(value).trim().toLowerCase()));
        listTitles.forEach((value) => badOriginTypes.add(value));
        const originTypePlaceholders = Array.from(badOriginTypes).map(() => '?').join(', ');
        if (originTypePlaceholders) {
            const badOrigins = db.prepare(`
                SELECT ti.id
                FROM task_instances ti
                JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
                WHERE LOWER(src.origin_type) IN (${originTypePlaceholders})
                  AND (src.origin_type != 'sunday')
                  ${whereArchived}
            `).all(...Array.from(badOriginTypes));
            badOrigins.forEach((row) => removeTaskInstance(row.id));
        }
    }
};

const repairMissingOrigins = () => {
    if (!tableExists('task_instances') || !tableExists('tasks_new')) return;
    if (!tableExists('task_origins')) return;

    const templates = sqlite.prepare('SELECT origin_type, list_key FROM recurring_task_templates WHERE active = 1').all();
    const templateKeys = templates.reduce((acc, row) => {
        const key = String(row.list_key || '').trim();
        if (!key) return acc;
        if (!acc[row.origin_type]) acc[row.origin_type] = new Set();
        acc[row.origin_type].add(key);
        return acc;
    }, {});
    const sundayKeys = templateKeys.sunday ? Array.from(templateKeys.sunday) : [];
    const operationsKeys = templateKeys.operations ? Array.from(templateKeys.operations) : [];
    const vestryKeys = templateKeys.vestry ? Array.from(templateKeys.vestry) : [];
    const allTemplateKeys = new Set([...sundayKeys, ...operationsKeys, ...vestryKeys]);

    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };

    const orphanRows = db.prepare(`
        SELECT ti.id, t.title, ti.list_key
        FROM task_instances ti
        JOIN tasks_new t ON t.id = ti.task_id
        LEFT JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        WHERE src.task_instance_id IS NULL
           OR src.origin_type IS NULL
           OR src.origin_id IS NULL
           OR TRIM(src.origin_type) = ''
           OR TRIM(src.origin_id) = ''
    `).all();

    const attachManual = db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, 'instance', ?, ?, 'manual', 'manual', 'created', ?)
    `);

    orphanRows.forEach((row) => {
        const listKey = String(row.list_key || '').trim();
        if (listKey && allTemplateKeys.has(listKey)) {
            removeTaskInstance(row.id);
            return;
        }
        const taskRow = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(row.id);
        if (!taskRow?.task_id) return;
        const originId = `origin-${row.id}`;
        try {
            attachManual.run(originId, taskRow.task_id, row.id, new Date().toISOString());
        } catch {
            // ignore duplicate origin rows
        }
    });
};

const purgeTemplateOrphanTasks = () => {
    if (!tableExists('task_instances') || !tableExists('tasks_new')) return;
    const templateKeys = tableExists('recurring_task_templates')
        ? sqlite.prepare('SELECT list_key FROM recurring_task_templates WHERE active = 1').all()
            .map((row) => String(row.list_key || '').trim())
            .filter(Boolean)
        : [];
    const extraKeys = ['bulletins', 'bulletins-10am', 'bulletins-8am', 'insert', 'email', 'roles', 'ops-weekly'];
    const listKeys = Array.from(new Set([...templateKeys, ...extraKeys]));
    if (!listKeys.length) return;
    const placeholders = listKeys.map(() => '?').join(', ');

    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };

    const orphanRows = db.prepare(`
        SELECT ti.id
        FROM task_instances ti
        JOIN tasks_new t ON t.id = ti.task_id
        LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
        WHERE ti.list_key IN (${placeholders})
          AND (src.origin_type IS NULL OR src.origin_id IS NULL OR TRIM(src.origin_type) = '' OR TRIM(src.origin_id) = '')
    `).all(...listKeys);
    orphanRows.forEach((row) => removeTaskInstance(row.id));
};

const normalizeOperationsOrigins = () => {
    if (!tableExists('task_origins')) return;
    const rows = db.prepare(`
        SELECT id, origin_id, scope, origin_event, task_instance_id
        FROM task_origins
        WHERE origin_type = 'operations'
          AND origin_id IS NOT NULL
          AND (
              origin_id LIKE 'weekly-%'
              OR origin_id LIKE 'timesheets-%'
              OR origin_id LIKE 'monthly-%'
              OR origin_id LIKE 'yearly-%'
          )
    `).all();
    if (!rows.length) return;
    const updateOrigin = db.prepare(`
        UPDATE task_origins
        SET origin_id = 'operations'
        WHERE id = ?
    `);
    const existsOrigin = db.prepare(`
        SELECT 1 FROM task_origins
        WHERE scope = ?
          AND origin_type = 'operations'
          AND origin_id = 'operations'
          AND origin_event = ?
        LIMIT 1
    `);
    const deleteOrigin = db.prepare(`DELETE FROM task_origins WHERE id = ?`);
    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };
    const grouped = new Map();
    rows.forEach((row) => {
        const key = `${row.scope || ''}::${row.origin_event || ''}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    });
    grouped.forEach((group) => {
        if (!group.length) return;
        const sample = group[0];
        const duplicate = existsOrigin.get(sample.scope, sample.origin_event);
        if (duplicate) {
            group.forEach((row) => {
                if (row.task_instance_id) {
                    removeTaskInstance(row.task_instance_id);
                } else {
                    deleteOrigin.run(row.id);
                }
            });
            return;
        }
        const keep = group[0];
        updateOrigin.run(keep.id);
        group.slice(1).forEach((row) => {
            if (row.task_instance_id) {
                removeTaskInstance(row.task_instance_id);
            } else {
                deleteOrigin.run(row.id);
            }
        });
    });

    if (tableExists('entity_links')) {
        const linkRows = db.prepare(`
            SELECT id, to_id
            FROM entity_links
            WHERE to_type = 'operations'
              AND (
                  to_id LIKE 'weekly-%'
                  OR to_id LIKE 'timesheets-%'
                  OR to_id LIKE 'monthly-%'
                  OR to_id LIKE 'yearly-%'
              )
        `).all();
        if (linkRows.length) {
            const updateLink = db.prepare(`
                UPDATE entity_links
                SET to_id = 'operations'
                WHERE id = ?
            `);
            linkRows.forEach((row) => updateLink.run(row.id));
        }
    }
};

const collapseOperationsRecurringTasks = () => {
    if (!tableExists('task_instances') || !tableExists('task_origins')) return;
    const rows = db.prepare(`
        SELECT ti.id, ti.list_key, ti.due_at, ti.completed_at
        FROM task_instances ti
        JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        WHERE src.origin_type = 'operations'
          AND src.origin_id = 'operations'
          AND ti.list_key IS NOT NULL
          AND TRIM(ti.list_key) != ''
    `).all();
    if (!rows.length) return;

    const removeTaskInstance = (taskInstanceId) => {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
        if (!row) return;
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
        db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
            db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
        }
    };

    rows
        .filter((row) => row.list_key === 'ops-weekly')
        .forEach((row) => removeTaskInstance(row.id));

    const byList = rows.reduce((acc, row) => {
        if (row.list_key === 'ops-weekly') return acc;
        if (!acc.has(row.list_key)) acc.set(row.list_key, []);
        acc.get(row.list_key).push(row);
        return acc;
    }, new Map());

    const pickKeep = (items) => {
        const sorted = items.slice().sort((a, b) => {
            const dueA = a.due_at ? new Date(a.due_at).getTime() : 0;
            const dueB = b.due_at ? new Date(b.due_at).getTime() : 0;
            if (dueA !== dueB) return dueB - dueA;
            const compA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
            const compB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
            return compB - compA;
        });
        const incomplete = sorted.find((row) => !row.completed_at);
        return incomplete || sorted[0];
    };

    byList.forEach((items) => {
        if (items.length <= 1) return;
        const keep = pickKeep(items);
        items.forEach((row) => {
            if (row.id !== keep.id) removeTaskInstance(row.id);
        });
    });
};

const addDaysIso = (dateKey, offsetDays) => {
    const base = new Date(`${dateKey}T00:00:00`);
    const next = new Date(base.getTime() + offsetDays * 86400000);
    return next.toISOString().slice(0, 10);
};

const getLastDayOfMonthKey = (year, monthIndex) => {
    const lastDay = new Date(year, monthIndex + 1, 0);
    return lastDay.toISOString().slice(0, 10);
};

const seedSundayTasksFromTemplates = () => {
    if (!tableExists('recurring_task_templates') || !tableExists('liturgical_days')) return;
    const templates = listRecurringTemplates('sunday', null);
    if (!templates.length) return;
    const upcomingSundays = db.prepare(`
        SELECT date
        FROM liturgical_days
        WHERE date >= date('now') AND strftime('%w', date) = '0'
        ORDER BY date
        LIMIT 6
    `).all().map((row) => row.date);
    const grouped = templates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});
    upcomingSundays.forEach((dateKey) => {
        Object.values(grouped).forEach((groupTemplates) => {
            const listKey = groupTemplates[0]?.list_key || null;
            const listTitle = groupTemplates[0]?.list_title || null;
            const listMode = groupTemplates[0]?.list_mode || 'sequential';
            if (listMode === 'progressive') {
                const steps = groupTemplates
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((template) => ({
                        key: template.step_key,
                        title: template.title,
                        sort_order: template.sort_order ?? 0,
                        due_offset_days: template.due_offset_days ?? null
                    }));
                const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
                const dueAt = addDaysIso(dateKey, maxOffset);
                if (listKey === 'bulletins') {
                    ['bulletins-10am', 'bulletins-8am'].forEach((docKey) => {
                        const label = docKey.endsWith('10am') ? 'Bulletins (10am)' : 'Bulletins (8am)';
                        createTaskInstance({
                            title: label,
                            taskType: 'sunday',
                            priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base))
                                ? Number(groupTemplates[0].priority_base)
                                : getDefaultPriorityBase('sunday'),
                            dueAt,
                            originType: 'sunday',
                            originId: dateKey,
                            originEvent: docKey,
                            generationKey: `sunday:${dateKey}:${docKey}:progressive`,
                            listKey: docKey,
                            listTitle: label,
                            listMode: 'progressive',
                            progressSteps: steps
                        });
                    });
                } else {
                    createTaskInstance({
                        title: listTitle || listKey || 'Task',
                        taskType: 'sunday',
                        priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base))
                            ? Number(groupTemplates[0].priority_base)
                            : getDefaultPriorityBase('sunday'),
                        dueAt,
                        originType: 'sunday',
                        originId: dateKey,
                        originEvent: listKey || 'progressive',
                        generationKey: `sunday:${dateKey}:${listKey || 'list'}:progressive`,
                        listKey,
                        listTitle,
                        listMode: 'progressive',
                        progressSteps: steps
                    });
                }
                return;
            }
            groupTemplates.forEach((template) => {
                const dueOffset = Number.isFinite(Number(template.due_offset_days))
                    ? Number(template.due_offset_days)
                    : null;
                const dueAt = dueOffset != null
                    ? addDaysIso(dateKey, dueOffset)
                    : dateKey;
                createTaskInstance({
                    title: template.title,
                    taskType: 'sunday',
                    priorityBase: Number.isFinite(Number(template.priority_base))
                        ? Number(template.priority_base)
                        : getDefaultPriorityBase('sunday'),
                    dueAt,
                    originType: 'sunday',
                    originId: dateKey,
                    originEvent: template.step_key,
                    generationKey: `sunday:${dateKey}:${template.list_key || 'list'}:${template.step_key}`,
                    listKey: template.list_key || null,
                    listTitle: template.list_title || null,
                    listMode: template.list_mode || 'sequential'
                });
            });
        });
    });
};

const seedVestryTasksFromTemplates = () => {
    if (!tableExists('recurring_task_templates')) return;
    const templates = listRecurringTemplates('vestry', null);
    if (!templates.length) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const grouped = templates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});
    Object.values(grouped).forEach((groupTemplates) => {
        const listKey = groupTemplates[0]?.list_key || null;
        const listTitle = groupTemplates[0]?.list_title || null;
        const listMode = groupTemplates[0]?.list_mode || 'sequential';
        if (listMode === 'progressive') {
            const steps = groupTemplates
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = addDaysIso(`${monthKey}-01`, maxOffset);
            createTaskInstance({
                title: listTitle || listKey || 'Task',
                taskType: 'vestry',
                priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base))
                    ? Number(groupTemplates[0].priority_base)
                    : getDefaultPriorityBase('vestry'),
                dueAt,
                originType: 'vestry',
                originId: monthKey,
                originEvent: listKey || 'progressive',
                generationKey: `vestry:${monthKey}:${listKey || 'list'}:progressive`,
                listKey,
                listTitle,
                listMode: 'progressive',
                progressSteps: steps
            });
            return;
        }
        groupTemplates.forEach((template) => {
            const dueOffset = Number.isFinite(Number(template.due_offset_days))
                ? Number(template.due_offset_days)
                : null;
            const dueAt = dueOffset != null
                ? addDaysIso(`${monthKey}-01`, dueOffset)
                : getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
            createTaskInstance({
                title: template.title,
                taskType: 'vestry',
                priorityBase: Number.isFinite(Number(template.priority_base))
                    ? Number(template.priority_base)
                    : getDefaultPriorityBase('vestry'),
                dueAt,
                originType: 'vestry',
                originId: monthKey,
                originEvent: template.step_key,
                generationKey: `vestry:${monthKey}:${template.list_key || 'list'}:${template.step_key}`,
                listKey: template.list_key || null,
                listTitle: template.list_title || null,
                listMode: template.list_mode || 'sequential'
            });
        });
    });
};

const seedOperationsTasksFromTemplates = () => {
    if (!tableExists('recurring_task_templates')) return;
    const weeklyTemplates = listRecurringTemplates('operations', 'weekly');
    const timesheetTemplates = listRecurringTemplates('operations', 'timesheets');
    const monthlyTemplates = listRecurringTemplates('operations', 'monthly');
    const yearlyTemplates = listRecurringTemplates('operations', 'yearly');
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = (day + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const weekKey = monday.toISOString().slice(0, 10);
    const groupedWeekly = weeklyTemplates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});

    const upsertOperationsProgressive = ({ listKey, listTitle, steps, dueAt }) => {
        if (!listKey) return;
        const existing = db.prepare(`
            SELECT ti.id
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE src.origin_type = 'operations'
              AND src.origin_id = 'operations'
              AND ti.list_key = ?
              AND ti.list_mode = 'progressive'
            LIMIT 1
        `).get(listKey);
        if (existing?.id) {
            db.prepare(`
                UPDATE task_instances
                SET due_at = ?,
                    list_title = ?,
                    progress_steps = ?
                WHERE id = ?
            `).run(
                dueAt,
                listTitle || listKey,
                JSON.stringify(steps),
                existing.id
            );
            return;
        }

        createTaskInstance({
            title: listTitle || listKey || 'Task',
            taskType: 'operations',
            priorityBase: getDefaultPriorityBase('operations'),
            dueAt,
            originType: 'operations',
            originId: 'operations',
            originEvent: listKey || 'progressive',
            generationKey: `operations:${listKey || 'list'}:progressive`,
            listKey,
            listTitle,
            listMode: 'progressive',
            progressSteps: steps
        });
    };

    const upsertOperationsTask = ({ title, listKey, dueAt, originEvent }) => {
        if (!title || !listKey) return;
        const existing = db.prepare(`
            SELECT ti.id
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE src.origin_type = 'operations'
              AND src.origin_id = 'operations'
              AND ti.list_key = ?
              AND (ti.list_mode IS NULL OR ti.list_mode = 'sequential')
            LIMIT 1
        `).get(listKey);
        if (existing?.id) {
            db.prepare(`
                UPDATE task_instances
                SET due_at = ?,
                    list_title = ?
                WHERE id = ?
            `).run(
                dueAt,
                title,
                existing.id
            );
            db.prepare(`
                UPDATE tasks_new
                SET title = ?, updated_at = ?
                WHERE id = (SELECT task_id FROM task_instances WHERE id = ?)
            `).run(title, new Date().toISOString(), existing.id);
            return;
        }
        const generationKey = `operations:${listKey}`;
        createTaskInstance({
            title,
            taskType: 'operations',
            priorityBase: getDefaultPriorityBase('operations'),
            dueAt,
            originType: 'operations',
            originId: 'operations',
            originEvent: originEvent || listKey,
            generationKey,
            listKey,
            listTitle: title,
            listMode: 'sequential'
        });
    };

    const getNextWeekdayDate = (baseDate, weekday) => {
        const next = new Date(baseDate);
        const day = next.getDay();
        const delta = (weekday - day + 7) % 7;
        next.setDate(next.getDate() + delta);
        return next;
    };

    const fridayDate = getNextWeekdayDate(now, 5);
    const fridayKey = fridayDate.toISOString().slice(0, 10);
    const mailWeekdays = [
        { key: 'mon', day: 1, label: 'Mon' },
        { key: 'wed', day: 3, label: 'Wed' },
        { key: 'fri', day: 5, label: 'Fri' }
    ];

    Object.values(groupedWeekly).forEach((groupTemplates) => {
        const listKey = groupTemplates[0]?.list_key || null;
        const listTitle = groupTemplates[0]?.list_title || null;
        const isWeeklyOps = listKey === 'ops-weekly';
        if (isWeeklyOps) {
            groupTemplates.forEach((template) => {
                const title = template.title;
                if (!title) return;
                const lowered = title.toLowerCase();
                if (lowered.includes('mail')) {
                    mailWeekdays.forEach((entry) => {
                        const nextDate = getNextWeekdayDate(now, entry.day);
                        const dueAt = nextDate.toISOString().slice(0, 10);
                        upsertOperationsTask({
                            title,
                            listKey: `mail-${entry.key}`,
                            dueAt,
                            originEvent: `mail-${entry.key}`
                        });
                    });
                    return;
                }
                upsertOperationsTask({
                    title,
                    listKey: template.step_key || normalizeListKey(title),
                    dueAt: fridayKey,
                    originEvent: template.step_key || 'weekly'
                });
            });
            return;
        }

        if (groupTemplates.length > 1 && String(groupTemplates[0]?.list_mode || '').toLowerCase() === 'progressive') {
            const steps = groupTemplates
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = addDaysIso(weekKey, maxOffset || 6);
            upsertOperationsProgressive({
                listKey,
                listTitle,
                steps,
                dueAt
            });
            return;
        }

        groupTemplates.forEach((template) => {
            const title = template.title;
            if (!title) return;
            upsertOperationsTask({
                title,
                listKey: template.step_key || normalizeListKey(title),
                dueAt: fridayKey,
                originEvent: template.step_key || 'weekly'
            });
        });
    });

    const dayOfMonth = now.getDate();
    const half = dayOfMonth <= 15 ? 'a' : 'b';
    const timesheetKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${half}`;
    const groupedTimesheets = timesheetTemplates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});
    Object.values(groupedTimesheets).forEach((groupTemplates) => {
        const listKey = groupTemplates[0]?.list_key || null;
        const listTitle = groupTemplates[0]?.list_title || null;
        const monthStartKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const halfDue = half === 'a'
            ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
            : getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
        if (groupTemplates.length > 1 && String(groupTemplates[0]?.list_mode || '').toLowerCase() === 'progressive') {
            const steps = groupTemplates
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = maxOffset ? addDaysIso(monthStartKey, maxOffset) : halfDue;
            upsertOperationsProgressive({
                listKey,
                listTitle,
                steps,
                dueAt
            });
            return;
        }

        groupTemplates.forEach((template) => {
            const title = template.title;
            if (!title) return;
            const dueAt = template.due_offset_days != null
                ? addDaysIso(monthStartKey, Number(template.due_offset_days))
                : halfDue;
            upsertOperationsTask({
                title,
                listKey: template.step_key || normalizeListKey(title),
                dueAt,
                originEvent: template.step_key || 'timesheets'
            });
        });
    });

    const seedPeriodicTasks = (templates, periodKey, fallbackDue) => {
        const grouped = templates.reduce((acc, template) => {
            const listKey = template.list_key || 'list';
            const listMode = template.list_mode || 'sequential';
            const groupKey = `${listKey}:${listMode}`;
            if (!acc[groupKey]) acc[groupKey] = [];
            acc[groupKey].push(template);
            return acc;
        }, {});

        Object.values(grouped).forEach((groupTemplates) => {
            const listKey = groupTemplates[0]?.list_key || null;
            const listTitle = groupTemplates[0]?.list_title || null;
            if (groupTemplates.length > 1 && String(groupTemplates[0]?.list_mode || '').toLowerCase() === 'progressive') {
                const steps = groupTemplates
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((template) => ({
                        key: template.step_key,
                        title: template.title,
                        sort_order: template.sort_order ?? 0,
                        due_offset_days: template.due_offset_days ?? null
                    }));
                const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
                const dueAt = maxOffset ? addDaysIso(periodKey, maxOffset) : fallbackDue;
                upsertOperationsProgressive({
                    listKey,
                    listTitle,
                    steps,
                    dueAt
                });
                return;
            }

            groupTemplates.forEach((template) => {
                const title = template.title;
                if (!title) return;
                const dueAt = template.due_offset_days != null
                    ? addDaysIso(periodKey, Number(template.due_offset_days))
                    : fallbackDue;
                upsertOperationsTask({
                    title,
                    listKey: template.step_key || normalizeListKey(title),
                    dueAt,
                    originEvent: template.step_key || 'recurring'
                });
            });
        });
    };

    if (monthlyTemplates.length) {
        const monthStartKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const monthEndKey = getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
        seedPeriodicTasks(monthlyTemplates, monthStartKey, monthEndKey);
    }

    if (yearlyTemplates.length) {
        const yearStartKey = `${now.getFullYear()}-01-01`;
        const yearEndKey = `${now.getFullYear()}-12-31`;
        seedPeriodicTasks(yearlyTemplates, yearStartKey, yearEndKey);
    }
};

const seedEventTasksForOccurrence = ({ occurrenceId, eventTypeId, dateKey }) => {
    if (!tableExists('recurring_task_templates')) return;
    if (!occurrenceId || !eventTypeId || !dateKey) return;
    const templates = listRecurringTemplates('event', String(eventTypeId));
    if (!templates.length) return;
    const grouped = templates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});
    Object.values(grouped).forEach((groupTemplates) => {
        const listKey = groupTemplates[0]?.list_key || null;
        const listTitle = groupTemplates[0]?.list_title || null;
        const listMode = groupTemplates[0]?.list_mode || 'sequential';
        if (listMode === 'progressive') {
            const steps = groupTemplates
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = addDaysIso(dateKey, maxOffset);
            createTaskInstance({
                title: listTitle || listKey || 'Task',
                taskType: 'event',
                priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base))
                    ? Number(groupTemplates[0].priority_base)
                    : getDefaultPriorityBase('event'),
                dueAt,
                originType: 'event',
                originId: occurrenceId,
                originEvent: listKey || 'progressive',
                generationKey: `event:${occurrenceId}:${listKey || 'list'}:progressive`,
                listKey,
                listTitle,
                listMode: 'progressive',
                progressSteps: steps
            });
            return;
        }
        groupTemplates.forEach((template) => {
            const dueOffset = Number.isFinite(Number(template.due_offset_days))
                ? Number(template.due_offset_days)
                : null;
            const dueAt = dueOffset != null
                ? addDaysIso(dateKey, dueOffset)
                : dateKey;
            createTaskInstance({
                title: template.title,
                taskType: 'event',
                priorityBase: Number.isFinite(Number(template.priority_base))
                    ? Number(template.priority_base)
                    : getDefaultPriorityBase('event'),
                dueAt,
                originType: 'event',
                originId: occurrenceId,
                originEvent: template.step_key,
                generationKey: `event:${occurrenceId}:${template.list_key || 'list'}:${template.step_key}`,
                listKey: template.list_key || null,
                listTitle: template.list_title || null,
                listMode: template.list_mode || 'sequential'
            });
        });
    });
};

const seedEventTasksFromTemplates = (daysAhead = 120) => {
    if (!tableExists('event_occurrences') || !tableExists('events')) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const endKey = addDaysIso(todayKey, daysAhead);
    const rows = db.prepare(`
        SELECT o.id AS occurrence_id, o.date AS date_key, e.event_type_id
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        WHERE e.event_type_id IS NOT NULL
          AND o.date >= ?
          AND o.date <= ?
        ORDER BY o.date ASC
    `).all(todayKey, endKey);
    rows.forEach((row) => {
        seedEventTasksForOccurrence({
            occurrenceId: row.occurrence_id,
            eventTypeId: row.event_type_id,
            dateKey: row.date_key
        });
    });
};

const createTaskInstance = (payload) => {
    const {
        title,
        taskType = null,
        priorityBase = 50,
        dueAt = null,
        slaTargetAt = null,
        originType,
        originId,
        originEvent = 'seed',
        generationKey,
        listKey = null,
        listTitle = null,
        listMode = 'sequential',
        progressKey = null,
        progressSteps = null
    } = payload || {};
    if (!title || !originType || !originId || !generationKey) return null;
    if (tableHasColumn('task_instances', 'generation_key')
        && db.prepare('SELECT 1 FROM task_instances WHERE generation_key = ?').get(generationKey)) {
        return null;
    }
    if (tableExists('task_origins')) {
        const existingOrigin = db.prepare(`
            SELECT id FROM task_origins
            WHERE scope = 'instance'
              AND origin_type = ?
              AND origin_id = ?
              AND origin_event = ?
            LIMIT 1
        `).get(originType, originId, originEvent);
        if (existingOrigin) {
            return null;
        }
    }
    const now = new Date().toISOString();
    const taskId = `taskdef-${randomUUID()}`;
    const taskInstanceId = `taskinst-${randomUUID()}`;

    if (!tableExists('tasks_new') && tableExists('tasks')) {
        db.prepare(`
            INSERT INTO tasks (
                id, title, description, status, priority_base, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            taskId,
            title,
            null,
            'active',
            priorityBase,
            now,
            now
        );

        db.prepare(`
            INSERT INTO task_instances (
                id, task_id, state, priority_override, rank, due_at,
                started_at, completed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            taskInstanceId,
            taskId,
            'open',
            null,
            null,
            dueAt,
            null,
            null,
            now,
            now
        );

        db.prepare(`
            INSERT INTO task_origins (
                id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            `origin-${taskInstanceId}`,
            'instance',
            taskId,
            taskInstanceId,
            originType,
            originId,
            originEvent,
            now
        );

        return taskInstanceId;
    }

    db.prepare(`
        INSERT INTO tasks_new (
            id, title, description, status, priority_base, task_type, due_mode,
            default_duration_min, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskId,
        title,
        null,
        'active',
        priorityBase,
        taskType,
        'floating',
        null,
        now,
        now
    );

    db.prepare(`
        INSERT INTO task_instances (
            id, task_id, state, due_at, start_at, completed_at, generated_from,
            generation_key, priority_override, rank, sla_target_at, blocked,
            list_key, list_title, list_mode, progress_key, progress_steps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskInstanceId,
        taskId,
        'open',
        dueAt,
        null,
        null,
        'seed',
        generationKey,
        null,
        null,
        slaTargetAt,
        0,
        listKey,
        listTitle,
        listMode || 'sequential',
        progressKey,
        progressSteps ? JSON.stringify(progressSteps) : null
    );

    db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        `origin-${taskInstanceId}`,
        'instance',
        taskId,
        taskInstanceId,
        originType,
        originId,
        originEvent,
        now
    );

    upsertEntityLink({
        fromType: 'task_instance',
        fromId: taskInstanceId,
        toType: originType,
        toId: originId,
        role: 'source',
        metaJson: JSON.stringify({ origin_event: originEvent })
    });

    return taskInstanceId;
};

migrateTaskListsToProgressive();
normalizeOperationsOrigins();
collapseOperationsRecurringTasks();
seedTaskEngine();

const BULLETIN_STATUS_RANK = {
    draft: 1,
    review: 2,
    ready: 3,
    printed: 4,
    stuffed: 5
};

const getStatusRank = (value) => {
    const key = String(value || '').toLowerCase().trim();
    return BULLETIN_STATUS_RANK[key] || 0;
};

const getStoredBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !tableExists('bulletin_status')) return '';
    try {
        const row = sqlite.prepare('SELECT status FROM bulletin_status WHERE date = ? AND doc_key = ?').get(dateKey, docKey);
        return row?.status || '';
    } catch {
        return '';
    }
};

const getSundayDocumentStatusRank = (dateKey, listKey) => {
    if (!dateKey || !listKey) return 0;
    if (listKey === 'insert') {
        return getStatusRank(getStoredBulletinStatus(dateKey, 'insert'));
    }
    if (listKey === 'bulletins') {
        const ranks = [
            getStatusRank(getStoredBulletinStatus(dateKey, 'bulletin10')),
            getStatusRank(getStoredBulletinStatus(dateKey, 'bulletin8'))
        ].filter((rank) => rank > 0);
        if (!ranks.length) return 0;
        if (ranks.length === 2) return Math.min(...ranks);
        return ranks[0];
    }
    return 0;
};

const getSundayTaskStepRank = (listKey, originEvent) => {
    const step = String(originEvent || '').toLowerCase().trim();
    if (!step) return 0;
    if (listKey === 'bulletins') {
        if (step === 'draft') return 1;
        if (step === 'review') return 2;
        if (step === 'finalize' || step === 'final') return 3;
        if (step === 'print' || step === 'printed') return 4;
    }
    if (listKey === 'insert') {
        if (step === 'draft') return 1;
        if (step === 'review') return 2;
        if (step === 'finalize' || step === 'final') return 3;
        if (step === 'print' || step === 'printed') return 4;
        if (step === 'stuff' || step === 'stuffed') return 5;
    }
    return 0;
};

const isSundayTaskAutoComplete = (row) => {
    if (row.origin_type !== 'sunday' || !row.origin_id) return false;
    if ((row.list_mode || '').toLowerCase() === 'progressive') return false;
    const listKey = row.list_key || row.list_id || '';
    if (!['bulletins', 'insert'].includes(listKey)) return false;
    const statusRank = getSundayDocumentStatusRank(row.origin_id, listKey);
    if (!statusRank) return false;
    const stepRank = getSundayTaskStepRank(listKey, row.origin_event);
    if (!stepRank) return false;
    return statusRank >= stepRank;
};

const formatTaskInstanceRow = (row) => {
    const effectivePriority = computeEffectivePriority(
        row.priority_base,
        row.priority_override,
        row.due_at,
        row.sla_target_at
    );
    const tier = getPriorityTier(effectivePriority);
    const rawState = row.instance_state || 'open';
    let completed = row.instance_state === 'done' || row.completed_at != null;
    let normalizedState = row.blocked && rawState !== 'done' ? 'blocked' : rawState;
    if (!completed && isSundayTaskAutoComplete(row)) {
        completed = true;
        normalizedState = 'done';
    }
    const listMode = row.list_mode || (row.list_type === 'parallel' ? 'parallel' : 'sequential');
    const progressKey = row.progress_key || '';
    const rawProgressSteps = row.progress_steps ? parseJsonField(row.progress_steps, []) : [];
    const progressSteps = Array.isArray(rawProgressSteps)
        ? rawProgressSteps.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
        : [];
    const isProgressiveComplete = listMode === 'progressive'
        && progressSteps.length > 0
        && progressKey
        && progressSteps[progressSteps.length - 1]?.key === progressKey;
    if (!completed && isProgressiveComplete) {
        completed = true;
        normalizedState = 'done';
    }
    return {
        id: row.task_instance_id,
        task_id: row.task_id,
        text: row.title,
        description: row.description || '',
        completed,
        created_at: row.task_created_at || row.created_at || null,
        completed_at: row.completed_at || null,
        due_at: row.due_at || null,
        sla_target_at: row.sla_target_at || null,
        start_at: row.start_at || null,
        state: normalizedState,
        blocked: !!row.blocked || row.instance_state === 'blocked',
        priority_base: Number.isFinite(Number(row.priority_base)) ? Number(row.priority_base) : 50,
        priority_override: row.priority_override != null ? Number(row.priority_override) : null,
        priority_effective: effectivePriority,
        priority_tier: tier,
        step_order: row.step_order != null ? Number(row.step_order) : null,
        rank: row.rank != null ? Number(row.rank) : null,
        notes: row.notes || '',
        archived_at: row.archived_at || null,
        archive_after_due: row.archive_after_due != null ? Number(row.archive_after_due) : 1,
        keep_until: row.keep_until || null,
        list_key: row.list_key || row.list_id || null,
        list_title: row.list_title || null,
        list_mode: listMode,
        progress_key: progressKey,
        progress_steps: progressSteps,
        task_type: row.task_type || null,
        origin_type: row.origin_type || null,
        origin_id: row.origin_id || null,
        origin_event: row.origin_event || null,
        ticket_id: row.origin_type === 'ticket' ? row.origin_id : null,
        ticket_title: row.ticket_title || '',
        event_occurrence_id: row.event_occurrence_id || null,
        event_id: row.event_id || null,
        event_title: row.event_title || '',
        event_description: row.event_description || '',
        event_date: row.event_date || null,
        event_time: row.event_start_time || null,
        event_type_id: row.event_type_id != null ? Number(row.event_type_id) : null,
        event_type_name: row.event_type_name || '',
        event_type_slug: row.event_type_slug || '',
        event_category_name: row.event_category_name || '',
        event_color: row.event_color || ''
    };
};

const sortTasksByPriority = (tasks) => {
    const stateOrder = {
        open: 0,
        in_progress: 1,
        blocked: 2,
        done: 3
    };
    return [...tasks].sort((a, b) => {
        const stateA = stateOrder[a.state] ?? 99;
        const stateB = stateOrder[b.state] ?? 99;
        if (stateA !== stateB) return stateA - stateB;
        const rankA = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
        const rankB = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
        if (rankA !== rankB) return rankA - rankB;
        if (a.priority_effective !== b.priority_effective) {
            return b.priority_effective - a.priority_effective;
        }
        const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        if (dueA !== dueB) return dueA - dueB;
        const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return createdA - createdB;
    });
};

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

const clampPriority = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
};

const getDueDate = (dueAt, slaTargetAt) => {
    const raw = dueAt || slaTargetAt;
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date;
};

const getUrgencyAdjustment = (dueAt, slaTargetAt, now = new Date()) => {
    const dueDate = getDueDate(dueAt, slaTargetAt);
    if (!dueDate) return 0;
    const diffMs = dueDate.getTime() - now.getTime();
    const daysToDue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (daysToDue < 0) return 40;
    if (daysToDue === 0) return 25;
    if (daysToDue === 1) return 15;
    if (daysToDue <= 3) return 8;
    if (daysToDue <= 7) return 3;
    return 0;
};

const computeEffectivePriority = (priorityBase, priorityOverride, dueAt, slaTargetAt) => {
    if (priorityOverride != null && priorityOverride !== '') {
        return clampPriority(Number(priorityOverride));
    }
    const base = Number.isFinite(Number(priorityBase)) ? Number(priorityBase) : 50;
    const adjustment = getUrgencyAdjustment(dueAt, slaTargetAt);
    return clampPriority(base + adjustment);
};

const getPriorityTier = (score) => {
    const value = clampPriority(score);
    if (value >= 80) return 'Critical';
    if (value >= 60) return 'High';
    if (value >= 40) return 'Normal';
    if (value >= 20) return 'Low';
    return 'Someday';
};

const DEFAULT_LOCATION_BY_TIME = {
    '08:00': 'chapel',
    '10:00': 'sanctuary'
};

const isSundayDate = (dateStr) => {
    if (!dateStr) return false;
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    return date.getDay() === 0;
};

const DROPBOX_ROOT = process.env.DROPBOX_ROOT
    || join(homedir(), 'Dropbox', 'Parish Administrator');
const DROPBOX_BULLETINS_DIR = 'Bulletins';
const DROPBOX_INSERTS_DIR = 'Bulletin Inserts';
const DROPBOX_EVENT_DOCS_DIR = 'Events';
const CERTIFICATE_TEMPLATE_DIR = join(homedir(), 'Dropbox', 'Parish Administrator', 'Vestry', 'Certificates');
const FUND_A_CERT_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Certificates', 'Certificates Fund A');
const FUND_B_CERT_BASE_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Certificates');
const FIDELITY_CERT_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Fidelity Account', 'Certificates for Transfer');
const VESTRY_PACKET_CACHE_DIR = join(__dirname, 'vestry-packet-cache');
const VESTRY_PACKET_CACHE_FILE = join(VESTRY_PACKET_CACHE_DIR, 'cache.json');

const normalizeToken = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeCompact = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const buildNameTokens = (name) => {
    if (!name) return [];
    const stopWords = new Set(['sunday', 'after', 'the', 'of', 'in', 'and', 'day']);
    return normalizeToken(name)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token && !stopWords.has(token));
};

const scoreBulletinCandidate = (fileName, tokens) => {
    if (!tokens.length) return 0;
    const normalized = normalizeCompact(fileName);
    return tokens.reduce((score, token) => (
        normalized.includes(normalizeCompact(token)) ? score + 1 : score
    ), 0);
};

const getIsoWeekNumber = (dateStr) => {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    const date = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return weekNo;
};

const findBulletinFile = async (dateStr, timeToken = '10am') => {
    const year = (dateStr || '').slice(0, 4);
    const folder = join(DROPBOX_ROOT, DROPBOX_BULLETINS_DIR, year);
    try {
        await access(folder);
    } catch {
        return null;
    }

    const entries = await readdir(folder, { withFileTypes: true });
    const weekNumber = getIsoWeekNumber(dateStr);
    const weekToken = weekNumber ? `W${String(weekNumber).padStart(2, '0')}` : '';
    const weekRegex = weekToken ? new RegExp(`^${weekToken}(\\b|\\s|-)`, 'i') : null;
    const timeRegex = new RegExp(`\\b${timeToken}\\b`, 'i');
    const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith('.docx'))
        .filter((name) => timeRegex.test(name))
        .filter((name) => (weekRegex ? weekRegex.test(name) : false));

    if (!candidates.length) return null;

    const scored = await Promise.all(candidates.map(async (name) => {
        const lower = name.toLowerCase();
        const score = (timeRegex.test(name) ? 5 : 0)
            + (/^w\d{2}/i.test(name) ? 2 : 0)
            + (weekRegex && weekRegex.test(name) ? 3 : 0);
        let modified = 0;
        try {
            const stats = await stat(join(folder, name));
            modified = stats.mtimeMs || 0;
        } catch {
            modified = 0;
        }
        return { name, score, modified };
    }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.modified - a.modified;
    });

    return scored[0]?.name ? join(folder, scored[0].name) : null;
};

const findInsertFile = async (dateStr) => {
    const year = (dateStr || '').slice(0, 4);
    const folder = join(DROPBOX_ROOT, DROPBOX_INSERTS_DIR, year);
    try {
        await access(folder);
    } catch {
        return null;
    }

    const exactName = `${dateStr} Insert.pub`;
    const exactPath = join(folder, exactName);
    try {
        await access(exactPath);
        return exactPath;
    } catch {
        // fall through
    }

    const entries = await readdir(folder, { withFileTypes: true });
    const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith('.pub'))
        .filter((name) => name.startsWith(`${dateStr}`))
        .filter((name) => /insert/i.test(name));

    if (!candidates.length) return null;

    const scored = await Promise.all(candidates.map(async (name) => {
        let modified = 0;
        try {
            const stats = await stat(join(folder, name));
            modified = stats.mtimeMs || 0;
        } catch {
            modified = 0;
        }
        return { name, modified };
    }));

    scored.sort((a, b) => b.modified - a.modified);
    return scored[0]?.name ? join(folder, scored[0].name) : null;
};

let cachedSofficePath = null;
let cachedPublisherAvailable = null;

const resolveSofficePath = async () => {
    if (cachedSofficePath) return cachedSofficePath;
    const envPath = process.env.SOFFICE_PATH;
    const candidates = [
        envPath,
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            cachedSofficePath = candidate;
            return candidate;
        } catch {
            continue;
        }
    }
    cachedSofficePath = null;
    return null;
};

const hasPublisherCom = async () => {
    if (cachedPublisherAvailable !== null) return cachedPublisherAvailable;
    try {
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            "New-Object -ComObject Publisher.Application | Out-Null"
        ], { windowsHide: true });
        cachedPublisherAvailable = true;
    } catch {
        cachedPublisherAvailable = false;
    }
    return cachedPublisherAvailable;
};

const convertPubToPdf = async (inputPath, outputPath) => {
    const canUsePublisher = await hasPublisherCom();
    if (!canUsePublisher) return null;
    const escapePath = (value) => String(value || '').replace(/'/g, "''");
    const script = [
        "$ErrorActionPreference = 'Stop';",
        '$app = New-Object -ComObject Publisher.Application;',
        '$app.Visible = $false;',
        `$doc = $app.Open('${escapePath(inputPath)}', $false, $true);`,
        `$doc.ExportAsFixedFormat('${escapePath(outputPath)}', 1);`,
        '$doc.Close();',
        '$app.Quit();'
    ].join(' ');
    try {
        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        return outputPath;
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Publisher COM export failed:', details);
        return null;
    }
};

const runSofficeConvert = async (sofficePath, args) => {
    try {
        await execFileAsync(sofficePath, args, { windowsHide: true });
        return true;
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Preview generation failed:', details);
        return false;
    }
};

const normalizeBulletinStatus = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'DRAFT') return 'draft';
    if (normalized === 'REVIEW') return 'review';
    if (normalized === 'FINAL') return 'ready';
    if (normalized === 'PRINTED') return 'printed';
    if (normalized === 'READY') return 'ready';
    if (normalized === 'NOT STARTED' || normalized === 'NOT_STARTED') return 'not_started';
    return '';
};

const normalizeBulletinStatusValue = (value) => normalizeBulletinStatus(value);

const readDocxCustomProperty = async (filePath, propName) => {
    try {
        const buffer = await readFile(filePath);
        const zip = new PizZip(buffer);
        const custom = zip.file('docProps/custom.xml');
        if (!custom) return '';
        const xml = custom.asText();
        const propRegex = /<property\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/property>/gi;
        let match = null;
        while ((match = propRegex.exec(xml))) {
            const name = String(match[1] || '').trim().toLowerCase();
            if (name !== String(propName || '').trim().toLowerCase()) continue;
            const body = match[2] || '';
            const valueMatch = body.match(/<vt:[^>]+>([\s\S]*?)<\/vt:[^>]+>/i);
            if (valueMatch) {
                return String(valueMatch[1] || '').replace(/<\/?[^>]+>/g, '').trim();
            }
            const fallback = body.replace(/<\/?[^>]+>/g, '').trim();
            return fallback;
        }
        return '';
    } catch (error) {
        const details = error?.message || error;
        console.error('Custom property read failed:', details);
        return '';
    }
};

const readDocxStatus = async (filePath) => {
    const ext = extname(filePath || '').toLowerCase();
    if (!['.doc', '.docx', '.docm'].includes(ext)) return '';
    const fromXml = await readDocxCustomProperty(filePath, 'Status');
    if (fromXml) return normalizeBulletinStatus(fromXml);
    const escaped = String(filePath || '').replace(/'/g, "''");
    const script = [
        "$ErrorActionPreference = 'Stop';",
        '$word = New-Object -ComObject Word.Application;',
        '$word.Visible = $false;',
        '$word.DisplayAlerts = 0;',
        `$doc = $word.Documents.Open('${escaped}', $false, $true);`,
        "$value = ''",
        'try {',
        '  foreach ($prop in $doc.CustomDocumentProperties) {',
        "    if ($prop.Name -and $prop.Name.ToString().Trim().ToLower() -eq 'status') {",
        '      $value = $prop.Value;',
        '      break;',
        '    }',
        '  }',
        '} catch { }',
        '$doc.Close($false);',
        '$word.Quit();',
        '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null;',
        '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null;',
        'Write-Output $value'
    ].join(' ');
    try {
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        return normalizeBulletinStatus(stdout || '');
    } catch (error) {
        const details = error?.stderr || error?.message || error;
        console.error('Bulletin status metadata read failed:', details);
        return '';
    }
};

const buildDocumentPreview = async (filePath, options = {}) => {
    const { force = false } = options;
    const cacheRoot = PREVIEW_CACHE_ROOT;
    const outputDir = join(tmpdir(), `preview-${randomUUID()}`);
    const ext = extname(filePath || '').toLowerCase();
    try {
        const sofficePath = await resolveSofficePath();
        if (!sofficePath) {
            throw new Error('soffice not found');
        }
        await mkdir(cacheRoot, { recursive: true });
        const stats = await stat(filePath);
        const cacheKey = createHash('sha1')
            .update(`${filePath}:${stats.mtimeMs}:${stats.size}`)
            .digest('hex');
        const cachedPreview = join(cacheRoot, `${cacheKey}.png`);
        if (!force) {
            try {
                await access(cachedPreview);
                const cachedData = await readFile(cachedPreview);
                return `data:image/png;base64,${cachedData.toString('base64')}`;
            } catch {
                // Cache miss, generate preview.
            }
        }

        await mkdir(outputDir, { recursive: true });
        const baseArgs = [
            '--headless',
            '--nologo',
            '--nodefault',
            '--norestore'
        ];
        const pdfPath = join(outputDir, `${basename(filePath, ext)}.pdf`);
        let pdfReady = false;

        if (ext === '.pub') {
            const converted = await convertPubToPdf(filePath, pdfPath);
            if (converted) {
                pdfReady = true;
            } else {
                const pdfArgs = [
                    ...baseArgs,
                    '--convert-to',
                    'pdf',
                    '--outdir',
                    outputDir,
                    filePath
                ];
                pdfReady = await runSofficeConvert(sofficePath, pdfArgs);
            }
        } else {
            const pdfArgs = [
                ...baseArgs,
                '--convert-to',
                'pdf',
                '--outdir',
                outputDir,
                filePath
            ];
            pdfReady = await runSofficeConvert(sofficePath, pdfArgs);
        }

        if (!pdfReady) return '';

        const pdfPngArgs = [
            ...baseArgs,
            '--convert-to',
            'png:draw_png_Export:Resolution=72',
            '--outdir',
            outputDir,
            pdfPath
        ];
        const converted = await runSofficeConvert(sofficePath, pdfPngArgs);
        if (!converted) return '';
        const files = await readdir(outputDir);
        const pngFile = files
            .filter((name) => name.toLowerCase().endsWith('.png'))
            .sort()[0];
        if (!pngFile) return '';
        const generatedPath = join(outputDir, pngFile);
        await copyFile(generatedPath, cachedPreview).catch(() => {});
        const data = await readFile(cachedPreview);
        return `data:image/png;base64,${data.toString('base64')}`;
    } catch (error) {
        console.error('Preview generation failed:', error?.message || error);
        return '';
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
};

const buildDocumentStatus = async (filePath, options = {}) => {
    const { includePreview = true, statusOverride = '', forcePreview = false } = options;
    if (!filePath) {
        return { exists: false, preview: '', path: '', name: '', status: '' };
    }
    try {
        await access(filePath);
    } catch {
        return { exists: false, preview: '', path: filePath, name: basename(filePath), status: '' };
    }
    const status = statusOverride || await readDocxStatus(filePath);
    const preview = includePreview ? await buildDocumentPreview(filePath, { force: forcePreview }) : '';
    return {
        exists: true,
        preview,
        path: filePath,
        name: basename(filePath),
        status
    };
};

const hasBulletinStatusTable = () => !!sqlite.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bulletin_status'
`).get();

const getBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return '';
    const row = sqlite.prepare(`
        SELECT status FROM bulletin_status WHERE date = ? AND doc_key = ?
    `).get(dateKey, docKey);
    return row?.status || '';
};

const upsertBulletinStatus = (dateKey, docKey, status, source = 'metadata') => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return;
    const normalized = normalizeBulletinStatusValue(status);
    if (!normalized) return;
    sqlite.prepare(`
        INSERT INTO bulletin_status (date, doc_key, status, source, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date, doc_key) DO UPDATE SET
            status = excluded.status,
            source = excluded.source,
            updated_at = excluded.updated_at
    `).run(dateKey, docKey, normalized, source, new Date().toISOString());
};

const clearBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !hasBulletinStatusTable()) return;
    sqlite.prepare('DELETE FROM bulletin_status WHERE date = ? AND doc_key = ?').run(dateKey, docKey);
};


const buildPeopleIndex = () => {
    if (!tableExists('people')) {
        return { byId: new Map(), byName: new Map(), byNameNormalized: new Map(), byFirstName: new Map() };
    }
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
    const allowedTables = new Set(['people', 'person', 'buildings', 'building', 'tickets', 'tasks', 'projects', 'vendor']);
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
    console.log('Google auth URL', authUrl);
    res.redirect(authUrl);
});

app.get('/api/google/auth-url', (_req, res) => {
    res.json({ url: getAuthUrl(), scopes: GOOGLE_SCOPES });
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

// --- Dropbox OAuth Routes ---

app.get('/auth/dropbox', (req, res) => {
    const clientId = process.env.DROPBOX_APP_KEY;
    const redirectUri = process.env.DROPBOX_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return res.status(400).send('Dropbox OAuth is not configured.');
    }
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        token_access_type: 'offline'
    });
    res.redirect(`https://www.dropbox.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/dropbox/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        const clientId = process.env.DROPBOX_APP_KEY;
        const clientSecret = process.env.DROPBOX_APP_SECRET;
        const redirectUri = process.env.DROPBOX_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(400).send('Dropbox OAuth is not configured.');
        }
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: String(code),
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri
        });
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Dropbox token exchange failed');
        }
        const data = await response.json();
        saveDropboxTokens({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_type: data.token_type,
            scope: data.scope,
            expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null
        });
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Dropbox OAuth error:', error);
        res.status(500).send('Dropbox authentication failed');
    }
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
    if (!tableExists('event_occurrences')) {
        return 0;
    }
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

app.get('/api/sunday/documents', async (req, res) => {
    const { date, name } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date is required' });
    }
    try {
        const includePreview = String(req.query.preview || '').trim() !== '0';
        const forcePreview = String(req.query.forcePreview || '').trim() === '1';
        const doc = String(req.query.doc || '').trim();
        const bulletin10Path = await findBulletinFile(date, '10am');
        const bulletin8Path = await findBulletinFile(date, '8am');
        const insertPath = await findInsertFile(date);
        let insertExists = false;
        try {
            await access(insertPath);
            insertExists = true;
        } catch {
            insertExists = false;
        }
        const bulletin10Stored = getBulletinStatus(date, 'bulletin10');
        const bulletin8Stored = getBulletinStatus(date, 'bulletin8');
        const insertStored = getBulletinStatus(date, 'insert');
        const bulletin10Meta = bulletin10Path ? await readDocxStatus(bulletin10Path) : '';
        const bulletin8Meta = bulletin8Path ? await readDocxStatus(bulletin8Path) : '';
        const bulletin10Status = bulletin10Meta || bulletin10Stored;
        const bulletin8Status = bulletin8Meta || bulletin8Stored;
        if (bulletin10Path && bulletin10Meta) {
            upsertBulletinStatus(date, 'bulletin10', bulletin10Meta, 'metadata');
        }
        if (bulletin8Path && bulletin8Meta) {
            upsertBulletinStatus(date, 'bulletin8', bulletin8Meta, 'metadata');
        }
        if (!bulletin10Path && bulletin10Stored) {
            clearBulletinStatus(date, 'bulletin10');
        }
        if (!bulletin8Path && bulletin8Stored) {
            clearBulletinStatus(date, 'bulletin8');
        }
        let bulletin10 = null;
        let bulletin8 = null;
        let insert = null;
        if (!doc || doc === 'bulletin10') {
            bulletin10 = await buildDocumentStatus(bulletin10Path, { includePreview, statusOverride: bulletin10Status, forcePreview });
        }
        if (!doc || doc === 'bulletin8') {
            bulletin8 = await buildDocumentStatus(bulletin8Path, { includePreview, statusOverride: bulletin8Status, forcePreview });
        }
        if (!doc || doc === 'insert') {
            insert = await buildDocumentStatus(insertPath, { includePreview, statusOverride: insertStored, forcePreview });
        }
        console.log('Sunday docs status', {
            date,
            bulletin10: bulletin10 ? { exists: bulletin10.exists, status: bulletin10.status, stored: bulletin10Stored } : null,
            bulletin8: bulletin8 ? { exists: bulletin8.exists, status: bulletin8.status, stored: bulletin8Stored } : null,
            insert: insert ? { exists: insert.exists, status: insert.status, stored: insertStored, path: insertPath || '' } : null
        });
        if (bulletin10?.exists && bulletin10Status) bulletin10.status = bulletin10Status;
        if (bulletin8?.exists && bulletin8Status) bulletin8.status = bulletin8Status;
        if (insert?.exists && insertStored) insert.status = insertStored;
        if (!insertExists && insertStored) {
            clearBulletinStatus(date, 'insert');
        }
        res.json({ bulletin10, bulletin8, insert });
    } catch (error) {
        console.error('Error checking documents:', error);
        res.status(500).json({ error: 'Failed to check documents' });
    }
});

app.post('/api/files/open', async (req, res) => {
    const { path } = req.body || {};
    if (!path) {
        return res.status(400).json({ error: 'path is required' });
    }
    const resolvedPath = resolve(path);
    const allowedRoot = resolve(DROPBOX_ROOT);
    if (!resolvedPath.startsWith(allowedRoot)) {
        return res.status(403).json({ error: 'Path not allowed' });
    }
    try {
        const info = await stat(resolvedPath);
        const args = info.isDirectory()
            ? [resolvedPath]
            : ['/select,', resolvedPath];
        execFile('explorer.exe', args, () => {});
        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'Path not found' });
    }
});

app.get('/api/files/download', async (req, res) => {
    const path = req.query?.path;
    if (!path) {
        return res.status(400).json({ error: 'path is required' });
    }
    const resolvedPath = resolve(path);
    const allowedRoot = resolve(DROPBOX_ROOT);
    if (!resolvedPath.startsWith(allowedRoot)) {
        return res.status(403).json({ error: 'Path not allowed' });
    }
    try {
        await access(resolvedPath);
        return res.download(resolvedPath);
    } catch (error) {
        return res.status(404).json({ error: 'File not found' });
    }
});

app.post('/api/files/print', async (req, res) => {
    const { path, printer, copies } = req.body || {};
    if (!path) {
        return res.status(400).json({ error: 'path is required' });
    }
    console.log('Print request received', { path, printer, copies });
    const resolvedPath = resolve(path);
    const allowedRoot = resolve(DROPBOX_ROOT);
    if (!resolvedPath.startsWith(allowedRoot)) {
        return res.status(403).json({ error: 'Path not allowed' });
    }
    try {
        await access(resolvedPath);
        const ext = extname(resolvedPath).toLowerCase();
        const copyCount = Number.isFinite(Number(copies)) ? Math.max(1, Math.trunc(Number(copies))) : 1;
        console.log('Print resolved', { resolvedPath, ext, copyCount, printer });
        if (printer && (ext === '.doc' || ext === '.docx' || ext === '.docm')) {
            const escaped = resolvedPath.replace(/'/g, "''");
            const escapedPrinter = String(printer).replace(/'/g, "''");
            const script = [
                `$word = New-Object -ComObject Word.Application`,
                `$word.Visible = $false`,
                `$word.DisplayAlerts = 0`,
                `$missing = [System.Type]::Missing`,
                `$wdPrintAllDocument = 0`,
                `$wdDocumentContent = 0`,
                `$doc = $word.Documents.Open('${escaped}', $false, $true)`,
                `$word.ActivePrinter = '${escapedPrinter}'`,
                `$copies = [int]${copyCount}`,
                `$doc.PrintOut($false, $false, $wdPrintAllDocument, $missing, $missing, $missing, $wdDocumentContent, $copies)`,
                `$doc.Close($false)`,
                `$word.Quit()`,
                `[System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null`,
                `[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null`
            ].join('; ');
            const { stdout, stderr } = await execFileAsync('powershell', [
                '-NoProfile',
                '-Command',
                script
            ], { windowsHide: true });
            if (stdout) console.log('Print stdout', stdout.trim());
            if (stderr) console.log('Print stderr', stderr.trim());
        } else {
            const escaped = resolvedPath.replace(/'/g, "''");
            const { stdout, stderr } = await execFileAsync('powershell', [
                '-NoProfile',
                '-Command',
                `Start-Process -FilePath '${escaped}' -Verb Print`
            ], { windowsHide: true });
            if (stdout) console.log('Print stdout', stdout.trim());
            if (stderr) console.log('Print stderr', stderr.trim());
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Print failed:', error);
        if (error?.stdout) console.error('Print stdout:', String(error.stdout).trim());
        if (error?.stderr) console.error('Print stderr:', String(error.stderr).trim());
        res.status(500).json({ error: 'Print failed' });
    }
});

app.post('/api/bulletins/upload', async (req, res) => {
    const { path } = req.body || {};
    if (!path) {
        return res.status(400).json({ error: 'path is required' });
    }
    const resolvedPath = resolve(path);
    const allowedRoot = resolve(DROPBOX_ROOT);
    if (!resolvedPath.startsWith(allowedRoot)) {
        return res.status(403).json({ error: 'Path not allowed' });
    }
    try {
        const sofficePath = await resolveSofficePath();
        if (!sofficePath) {
            return res.status(500).json({ error: 'LibreOffice not available' });
        }
        const wpUrl = process.env.WP_URL;
        const wpUser = process.env.WP_USER;
        const wpAppPassword = process.env.WP_APP_PASSWORD;
        if (!wpUrl || !wpUser || !wpAppPassword) {
            return res.status(500).json({ error: 'WordPress credentials not configured' });
        }

        const outputDir = join(tmpdir(), `bulletin-upload-${randomUUID()}`);
        await mkdir(outputDir, { recursive: true });
        const ext = extname(resolvedPath).toLowerCase();
        const pdfPath = join(outputDir, `${basename(resolvedPath, ext)}.pdf`);
        const pdfArgs = [
            '--headless',
            '--nologo',
            '--nodefault',
            '--norestore',
            '--convert-to',
            'pdf',
            '--outdir',
            outputDir,
            resolvedPath
        ];
        await execFileAsync(sofficePath, pdfArgs, { windowsHide: true });
        const pdfBuffer = await readFile(pdfPath);
        const authToken = Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64');
        const wpBase = wpUrl.replace(/\/$/, '');

        const pdfForm = new FormData();
        pdfForm.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'Sunday Bulletin.pdf');
        pdfForm.append('title', 'Sunday Bulletin');

        const pdfResponse = await fetch(`${wpBase}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: { Authorization: `Basic ${authToken}` },
            body: pdfForm
        });

        if (!pdfResponse.ok) {
            const payload = await pdfResponse.text();
            console.error('WordPress upload failed:', payload);
            return res.status(502).json({ error: 'WordPress upload failed' });
        }
        const pdfPayload = await pdfResponse.json();

        const pngArgs = [
            '--headless',
            '--nologo',
            '--nodefault',
            '--norestore',
            '--convert-to',
            'png:draw_png_Export:Resolution=72',
            '--outdir',
            outputDir,
            pdfPath
        ];
        await execFileAsync(sofficePath, pngArgs, { windowsHide: true });
        const pngFiles = (await readdir(outputDir)).filter((name) => name.toLowerCase().endsWith('.png')).sort();
        let imageUrl = '';
        if (pngFiles.length > 0) {
            const pngPath = join(outputDir, pngFiles[0]);
            const pngBuffer = await readFile(pngPath);
            const imageForm = new FormData();
            imageForm.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'Sunday Bulletin.png');
            imageForm.append('title', 'Sunday Bulletin');
            const imageResponse = await fetch(`${wpBase}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: { Authorization: `Basic ${authToken}` },
                body: imageForm
            });
            if (imageResponse.ok) {
                const imagePayload = await imageResponse.json();
                imageUrl = imagePayload.source_url || '';
            } else {
                const payload = await imageResponse.text();
                console.error('WordPress image upload failed:', payload);
            }
        }

        return res.json({
            id: pdfPayload.id,
            url: pdfPayload.source_url || '',
            imageUrl
        });
    } catch (error) {
        console.error('Bulletin upload error:', error);
        return res.status(500).json({ error: 'Upload failed' });
    }
});

app.get('/api/constant-contact/status', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    res.json({ connected: !!tokens?.access_token });
});

app.get('/api/constant-contact/debug', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    if (!tokens) {
        return res.json({ connected: false });
    }
    res.json({
        connected: !!tokens.access_token,
        scope: tokens.scope || null,
        tokenType: tokens.token_type || null,
        expiresAt: tokens.expires_at || null
    });
});

app.get('/api/constant-contact/from-emails', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const emails = await fetchCcFromEmails(tokens);
        res.json({ emails });
    } catch (error) {
        console.error('Constant Contact from emails failed:', error);
        res.status(500).json({ error: 'Failed to load Constant Contact from emails' });
    }
});

app.get('/api/constant-contact/debug-emails', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const response = await fetch(`${CC_API_BASE}/account/emails`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json'
            }
        });
        const payload = await response.json().catch(() => ({}));
        res.status(response.ok ? 200 : response.status).json({
            ok: response.ok,
            status: response.status,
            payload
        });
    } catch (error) {
        console.error('Constant Contact debug emails failed:', error);
        res.status(500).json({ error: 'Failed to debug Constant Contact emails' });
    }
});

app.get('/api/constant-contact/lists', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const data = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
        const lists = Array.isArray(data?.lists) ? data.lists : [];
        res.json({ lists });
    } catch (error) {
        console.error('Constant Contact lists failed:', error);
        res.status(500).json({ error: 'Failed to load Constant Contact lists' });
    }
});

app.get('/auth/constant-contact', (req, res) => {
    const clientId = process.env.CC_CLIENT_ID;
    const redirectUri = process.env.CC_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return res.status(500).send('Constant Contact not configured');
    }
    const state = randomUUID();
    setCcStateCookie(res, state);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'campaign_data contact_data account_read offline_access',
        state
    });
    console.log('Constant Contact auth URL', `${CC_AUTH_URL}?${params.toString()}`);
    res.redirect(`${CC_AUTH_URL}?${params.toString()}`);
});

app.get('/auth/constant-contact/callback', async (req, res) => {
    const { code, error, error_description: errorDescription, state } = req.query;
    if (error) {
        return res.status(400).send(errorDescription || 'Constant Contact authorization failed');
    }
    const cookies = parseCookies(req.headers.cookie || '');
    if (!state || !cookies[CC_STATE_COOKIE] || cookies[CC_STATE_COOKIE] !== state) {
        return res.status(400).send('Invalid OAuth state');
    }
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        const clientId = process.env.CC_CLIENT_ID;
        const clientSecret = process.env.CC_CLIENT_SECRET;
        const redirectUri = process.env.CC_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(500).send('Constant Contact not configured');
        }
        const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });
        const response = await fetch(CC_TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });
        if (!response.ok) {
            const payload = await response.text();
            throw new Error(payload || 'Failed to exchange Constant Contact token');
        }
        const tokens = await response.json();
        const userId = getCcUserId(req);
        saveCcTokens(userId, tokens);
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Constant Contact OAuth failed:', error);
        res.status(500).send('Constant Contact authentication failed');
    }
});

app.post('/api/constant-contact/email', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }

        const {
            date,
            sundayName,
            youtubeLink,
            pdfUrl,
            imageUrl,
            testEmpty,
            fromEmail: requestedFromEmail
        } = req.body || {};

        if (!testEmpty && (!date || !sundayName || !youtubeLink || !pdfUrl || !imageUrl)) {
            return res.status(400).json({ error: 'Missing email data' });
        }

        let listId = await findCcListId(tokens, 'Active Members');
        if (!listId) {
            const listData = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
            const lists = Array.isArray(listData?.lists) ? listData.lists : [];
            listId = lists[0]?.list_id || null;
        }
        if (!listId) {
            return res.status(404).json({ error: 'No Constant Contact lists available' });
        }

        const template = testEmpty ? '' : await loadEmailTemplate();
        const html = testEmpty
            ? '<html><body><p>Test email</p></body></html>'
            : sanitizeEmailHtml(template
                .replace(/\[\[\[DATE\]\]\]/g, date)
                .replace(/\[\[\[SUNDAY_NAME\]\]\]/g, sundayName)
                .replace(/\[\[\[YOUTUBE_LINK\]\]\]/g, youtubeLink)
                .replace(/\[\[\[IMG_SRC\]\]\]/g, imageUrl)
                .replace(/\[\[\[PDF_SRC\]\]\]/g, pdfUrl));
        const minimalHtml = testEmpty ? html : `
<html>
  <body>
    <h1>${sundayName}</h1>
    <p>${date}</p>
    <p><a href="${youtubeLink}">Watch the livestream</a></p>
    <p><a href="${pdfUrl}">Download the bulletin</a></p>
    <img src="${imageUrl}" alt="Sunday Bulletin preview" />
  </body>
</html>`;

        const normalizeEmail = (value) => (value || '').trim().toLowerCase();
        const allowedEmails = await fetchCcFromEmails(tokens).catch(() => []);
        const confirmedEmails = allowedEmails.filter((entry) => {
            const status = (entry?.status || '').toLowerCase();
            return status === 'confirmed' || status === 'verified' || status === 'active';
        });
        const pickFirstEmail = (list) => {
            for (const entry of list) {
                const candidate = entry?.email_address || entry?.email || entry?.address || '';
                if (candidate) return candidate;
            }
            return '';
        };
        const allowedSet = new Set(
            allowedEmails.map((entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address))
        );
        let fromEmail = requestedFromEmail || process.env.CC_FROM_EMAIL || '';
        if (fromEmail && allowedSet.size > 0 && !allowedSet.has(normalizeEmail(fromEmail))) {
            fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails) || fromEmail;
        }
        if (!fromEmail) {
            fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails);
        }
        const fromName = process.env.CC_FROM_NAME || 'St Edmunds';
        const replyTo = process.env.CC_REPLY_TO_EMAIL || fromEmail;
        if (!fromEmail) {
            return res.status(500).json({ error: 'CC_FROM_EMAIL not configured' });
        }
        const normalizeEntryEmail = (entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address);
        const fromEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(fromEmail));
        const replyEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(replyTo));

        const baseActivity = {
            format_type: 'HTML',
            from_email: fromEmail,
            from_name: fromName,
            reply_to_email: replyTo,
            subject: testEmpty ? 'Test Email' : 'Sunday Livestream',
            html_content: html,
            contact_list_ids: [listId]
        };
        if (fromEntry?.email_id) {
            baseActivity.from_email_id = fromEntry.email_id;
        }
        if (replyEntry?.email_id) {
            baseActivity.reply_to_email_id = replyEntry.email_id;
        }
        const campaignPayload = {
            name: testEmpty ? `Test Email ${new Date().toISOString()}` : 'Sunday Bulletin',
            email_campaign_activities: [baseActivity]
        };
        console.log('Constant Contact email meta', { testEmpty: !!testEmpty, fromEmail, replyTo, listId });

        let campaign;
        try {
            campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
                method: 'POST',
                body: JSON.stringify(campaignPayload)
            });
        } catch (error) {
            console.error('Constant Contact create payload:', campaignPayload);
            console.error('Constant Contact HTML length:', html.length);
            campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
                method: 'POST',
                body: JSON.stringify({
                    ...campaignPayload,
                    email_campaign_activities: [
                        {
                            ...baseActivity,
                            html_content: minimalHtml
                        }
                    ]
                })
            });
        }

        const activity = campaign?.email_campaign_activities?.[0];
        const activityId = activity?.activity_id;
        if (!activityId) {
            return res.status(500).json({ error: 'Failed to create Constant Contact email activity' });
        }

        const attachedLists = Array.isArray(activity?.contact_list_ids) ? activity.contact_list_ids : [];
        if (!attachedLists.includes(listId)) {
            try {
                await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/contact_lists`, tokens, {
                    method: 'POST',
                    body: JSON.stringify({ contact_list_ids: [listId] })
                });
            } catch (error) {
                console.error('Constant Contact list attach failed:', error?.message || error);
                throw error;
            }
        }

        const scheduledDate = getNextSaturdayAtSix().toISOString();
        await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/schedules`, tokens, {
            method: 'POST',
            body: JSON.stringify({ scheduled_date: scheduledDate })
        });

        res.json({ success: true, activityId, scheduledDate });
    } catch (error) {
        console.error('Constant Contact email failed:', error?.message || error);
        if (error?.message?.includes('Constant Contact request failed')) {
            console.error('Constant Contact email error detail:', error.message);
        }
        res.status(500).json({ error: 'Failed to create Constant Contact email' });
    }
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
            },
            onOccurrence: seedEventTasksForOccurrence
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
    if (!tableExists('people')) {
        return res.json([]);
    }
    const rows = db.prepare('SELECT * FROM people ORDER BY display_name').all();
    const people = rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email || '',
        phonePrimary: row.phone_primary || '',
        phoneAlternate: row.phone_alternate || '',
        addressLine1: row.address_line1 || '',
        addressLine2: row.address_line2 || '',
        city: row.city || '',
        state: row.state || '',
        postalCode: row.postal_code || '',
        category: row.category || '',
        roles: normalizePersonRoles(row.roles),
        tags: parseJsonField(row.tags),
        teams: coerceJsonObject(row.teams)
    }));
    return res.json(people);
});

app.post('/api/people', (req, res) => {
    const {
        displayName,
        email = '',
        phonePrimary = '',
        phoneAlternate = '',
        addressLine1 = '',
        addressLine2 = '',
        city = '',
        state = '',
        postalCode = '',
        category = 'parishioner',
        roles = [],
        tags = [],
        teams = {}
    } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const baseId = slugifyName(normalizedName) || `person-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'people');
    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = normalizeTags(tags);

    db.prepare(`
        INSERT INTO people (
            id, display_name, email, phone_primary, phone_alternate,
            address_line1, address_line2, city, state, postal_code,
            category, roles, tags, teams
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams))
    );

    return res.status(201).json({
        id,
        displayName: normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        roles: normalizedRoles,
        tags: normalizedTags,
        teams: coerceJsonObject(teams)
    });
});

app.put('/api/people/:id', (req, res) => {
    const { id } = req.params;
    const {
        displayName,
        email = '',
        phonePrimary = '',
        phoneAlternate = '',
        addressLine1 = '',
        addressLine2 = '',
        city = '',
        state = '',
        postalCode = '',
        category = 'parishioner',
        roles = [],
        tags = [],
        teams = {}
    } = req.body || {};

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
            phone_primary = ?,
            phone_alternate = ?,
            address_line1 = ?,
            address_line2 = ?,
            city = ?,
            state = ?,
            postal_code = ?,
            category = ?,
            roles = ?,
            tags = ?,
            teams = ?
        WHERE id = ?
    `).run(
        normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams)),
        id
    );

    return res.json({
        id,
        displayName: normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
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
    return res.json({ success: true });
});

// --- Buildings & Grounds ---

const buildBuildingMapId = (name = '') => {
    const normalized = slugifyName(name);
    const aliases = {
        'church': 'sanctuary',
        'sanctuary': 'sanctuary',
        'chapel': 'chapel',
        'fellows-hall': 'parish-hall',
        'parish-hall': 'parish-hall',
        'office-school': 'office',
        'office': 'office',
        'north-parking': 'parking-north',
        'south-parking': 'parking-south',
        'north-lot': 'parking-north',
        'south-lot': 'parking-south',
        'playground': 'playground',
        'close': 'close'
    };
    return aliases[normalized] || normalized;
};

const normalizeBuildingName = (value = '') => {
    const name = String(value || '').trim();
    if (!name) return '';
    if (name.toLowerCase() === 'parish hall') return 'Fellows Hall';
    return name;
};

app.get('/api/buildings', (req, res) => {
    if (!tableExists('buildings')) {
        return res.json([]);
    }
    const hasRooms = tableExists('rooms');
    const rows = db.prepare('SELECT * FROM buildings ORDER BY name').all();
    const buildings = rows.map(row => {
        const roomRows = hasRooms
            ? db.prepare(`
                SELECT id, name, floor, capacity, rental_rate, notes
                FROM rooms
                WHERE building_id = ?
                ORDER BY name
            `).all(row.id)
            : [];
        const rooms = roomRows.map((room) => ({
            id: room.id,
            name: room.name,
            floor: room.floor,
            capacity: room.capacity,
            rental_rate: room.rental_rate,
            notes: room.notes || ''
        }));
        const rentalRate = row.rental_rate_day ?? row.rental_rate_hour;
        return {
            id: row.id,
            map_id: buildBuildingMapId(row.name || ''),
            name: normalizeBuildingName(row.name),
            category: row.category,
            capacity: row.capacity,
            size_sqft: row.size_sqft,
            rental_rate_hour: row.rental_rate_hour,
            rental_rate_day: row.rental_rate_day,
            rental_rate: rentalRate || 0,
            parking_spaces: row.parking_spaces,
            event_types: parseJsonField(row.event_types),
            notes: row.notes || '',
            rooms
        };
    });
    res.json(buildings);
});

app.get('/api/vendors', async (req, res) => {
    if (!tableExists('preferred_vendors')) {
        return res.json([]);
    }
    const rows = db.prepare(`
        SELECT id, service, vendor, contact, phone, email, notes, contract
        FROM preferred_vendors
        ORDER BY service, vendor
    `).all();
    const contractsDir = join(DROPBOX_ROOT, 'Contracts');
    const vendors = await Promise.all(rows.map(async (row) => {
        const contract = await resolveContractFile(contractsDir, row.vendor, row.contract);
        return {
            ...row,
            contract_path: contract.path,
            contract_exists: contract.exists
        };
    }));
    res.json(vendors);
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
        map_id: buildBuildingMapId(normalizedName),
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
        map_id: buildBuildingMapId(normalizedName),
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

const getTicketAreaIds = (ticketId) => {
    if (!tableExists('entity_links')) {
        return db.prepare('SELECT area_id FROM ticket_areas WHERE ticket_id = ?').all(ticketId).map((r) => r.area_id);
    }
    const linkRows = db.prepare(`
        SELECT to_id FROM entity_links
        WHERE from_type = 'ticket' AND from_id = ? AND role = 'location'
    `).all(ticketId);
    if (linkRows.length) {
        return linkRows.map((row) => row.to_id);
    }
    return db.prepare('SELECT area_id FROM ticket_areas WHERE ticket_id = ?').all(ticketId).map((r) => r.area_id);
};

const setTicketAreas = (ticketId, areaIds = []) => {
    deleteEntityLinks({ fromType: 'ticket', fromId: ticketId, role: 'location' });
    db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(ticketId);
    const insertArea = db.prepare('INSERT OR IGNORE INTO ticket_areas (ticket_id, area_id) VALUES (?, ?)');
    areaIds.forEach((areaId) => {
        if (!areaId) return;
        upsertEntityLink({
            fromType: 'ticket',
            fromId: ticketId,
            toType: 'area',
            toId: areaId,
            role: 'location'
        });
        insertArea.run(ticketId, areaId);
    });
};

const listTaskInstances = (whereClause = '', params = []) => {
    if (tableExists('tasks_new') && tableExists('task_instances')) {
        applyTaskArchiving();
        const hasTemplates = tableExists('recurring_task_templates');
        const rows = db.prepare(`
            SELECT
                ti.id AS task_instance_id,
                t.id AS task_id,
                t.title,
                t.description,
                t.status AS task_status,
                ti.state AS instance_state,
                ti.due_at,
                ti.start_at,
                ti.completed_at,
                ti.priority_override,
                t.priority_base,
                t.task_type,
                ti.rank,
                ti.sla_target_at,
                ti.blocked,
                ti.archived_at,
                ti.archive_after_due,
                ti.keep_until,
                ti.list_key,
                ti.list_title,
                ti.list_mode,
                ti.progress_key,
                ti.progress_steps,
                ti.notes,
                src.origin_type,
                src.origin_id,
                src.origin_event,
                ${hasTemplates ? 'rt.sort_order AS step_order,' : 'NULL AS step_order,'}
                t.created_at AS task_created_at,
                tickets.title AS ticket_title,
                eo.id AS event_occurrence_id,
                eo.date AS event_date,
                eo.start_time AS event_start_time,
                ev.id AS event_id,
                ev.title AS event_title,
                ev.description AS event_description,
                et.id AS event_type_id,
                et.name AS event_type_name,
                et.slug AS event_type_slug,
                ec.name AS event_category_name,
                COALESCE(et.color, ec.color) AS event_color
            FROM task_instances ti
            JOIN tasks_new t ON t.id = ti.task_id
            LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
            ${hasTemplates ? `
            LEFT JOIN recurring_task_templates rt
                ON rt.origin_type = src.origin_type
                AND rt.step_key = src.origin_event
                AND (rt.origin_id IS NULL OR rt.origin_id = src.origin_id)
            ` : ''}
            LEFT JOIN tickets ON src.origin_type = 'ticket' AND src.origin_id = tickets.id
            LEFT JOIN event_occurrences eo ON src.origin_type = 'event' AND src.origin_id = eo.id
            LEFT JOIN events ev ON eo.event_id = ev.id
            LEFT JOIN event_types et ON ev.event_type_id = et.id
            LEFT JOIN event_categories ec ON et.category_id = ec.id
            ${whereClause}
        `).all(...params);
        return rows.map(formatTaskInstanceRow);
    }

    if (tableExists('task_instances') && tableExists('tasks')) {
        const resolvedWhere = whereClause.replace(/src\./g, 'o.');
        const rows = db.prepare(`
            SELECT
                ti.id AS task_instance_id,
                t.id AS task_id,
                COALESCE(ti.title_override, t.title) AS title,
                COALESCE(ti.description_override, t.description) AS description,
                t.status AS task_status,
                ti.state AS instance_state,
                ti.due_at,
                ti.started_at AS start_at,
                ti.completed_at,
                ti.priority_override,
                t.priority_base,
                ti.rank,
                ti.created_at AS task_created_at,
                ti.notes,
                o.origin_type,
                o.origin_id,
                o.origin_event,
                tli.position AS step_order,
                tl.id AS list_id,
                tl.title AS list_title,
                tl.list_type AS list_type,
                eo.id AS event_occurrence_id,
                eo.date AS event_date,
                eo.start_time AS event_start_time,
                ev.id AS event_id,
                ev.title AS event_title,
                ev.description AS event_description,
                et.id AS event_type_id,
                et.name AS event_type_name,
                et.slug AS event_type_slug,
                ec.name AS event_category_name,
                COALESCE(et.color, ec.color) AS event_color
            FROM task_instances ti
            JOIN tasks t ON t.id = ti.task_id
            LEFT JOIN task_list_items tli ON tli.task_instance_id = ti.id
            LEFT JOIN task_lists tl ON tl.id = tli.task_list_id
            LEFT JOIN task_origins o ON o.scope = 'instance' AND o.task_instance_id = ti.id
            LEFT JOIN event_occurrences eo ON o.origin_type = 'event' AND o.origin_id = eo.id
            LEFT JOIN events ev ON eo.event_id = ev.id
            LEFT JOIN event_types et ON ev.event_type_id = et.id
            LEFT JOIN event_categories ec ON et.category_id = ec.id
            ${resolvedWhere}
        `).all(...params);
        return rows.map(formatTaskInstanceRow);
    }

    return [];
};

const buildOriginRollups = (tasks) => {
    const grouped = tasks.reduce((acc, task) => {
        if (task.archived_at) return acc;
        const originType = task.origin_type || 'manual';
        const originId = task.origin_id || 'manual';
        const key = `${originType}:${originId}`;
        if (!acc[key]) {
            acc[key] = {
                key,
                origin_type: originType,
                origin_id: originId,
                tasks: []
            };
        }
        acc[key].tasks.push(task);
        return acc;
    }, {});

    const rollups = Object.values(grouped).map((group) => {
        const total = group.tasks.length;
        const openTasks = group.tasks.filter((task) => !task.completed);
        const completedCount = total - openTasks.length;
        let nextTask = null;
        if (openTasks.length) {
            const hasSequence = openTasks.some((task) => task.rank != null || task.step_order != null);
            let sorted;
            if (hasSequence) {
                sorted = [...openTasks].sort((a, b) => {
                    const rankA = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
                    const rankB = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
                    if (rankA !== rankB) return rankA - rankB;
                    const orderA = a.step_order == null ? Number.POSITIVE_INFINITY : a.step_order;
                    const orderB = b.step_order == null ? Number.POSITIVE_INFINITY : b.step_order;
                    if (orderA !== orderB) return orderA - orderB;
                    const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
                    const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
                    if (dueA !== dueB) return dueA - dueB;
                    return b.priority_effective - a.priority_effective;
                });
                const chainMax = Math.max(...openTasks.map((task) => task.priority_effective ?? 0));
                nextTask = {
                    ...sorted[0],
                    priority_effective: chainMax,
                    priority_tier: getPriorityTier(chainMax)
                };
            } else {
                sorted = sortTasksByPriority(openTasks);
                nextTask = sorted[0];
            }
        }
        return {
            key: group.key,
            origin_type: group.origin_type,
            origin_id: group.origin_id,
            total_count: total,
            open_count: openTasks.length,
            completed_count: completedCount,
            next_task: nextTask
        };
    });

    const withNext = rollups.filter((row) => row.next_task);
    const withoutNext = rollups.filter((row) => !row.next_task);
    const sortedWithNext = sortTasksByPriority(withNext.map((row) => row.next_task)).map((task) => (
        withNext.find((row) => row.next_task?.id === task.id)
    )).filter(Boolean);
    return [...sortedWithNext, ...withoutNext];
};

function deleteTaskInstance(taskInstanceId) {
    const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
    if (!row) return false;
    db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
    db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
    db.prepare('DELETE FROM entity_links WHERE from_type = ? AND from_id = ?').run('task_instance', taskInstanceId);
    const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
    if (!remaining) {
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
        db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
    }
    return true;
}

const buildTicketResponse = (ticketRow) => {
    const areas = getTicketAreaIds(ticketRow.id);
    const tasks = listTaskInstances(
        `WHERE src.origin_type = 'ticket' AND src.origin_id = ? ORDER BY t.created_at DESC`,
        [ticketRow.id]
    ).map((task) => ({
        id: task.id,
        ticket_id: task.ticket_id,
        text: task.text,
        completed: task.completed,
        created_at: task.created_at,
        completed_at: task.completed_at || null,
        priority_effective: task.priority_effective,
        priority_tier: task.priority_tier
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
    if (!tableExists('tickets')) {
        return res.json([]);
    }
    const rows = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    const tickets = rows.map(buildTicketResponse);
    res.json(tickets);
});

app.get('/api/tickets/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('tickets')) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
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

    if (Array.isArray(area_ids)) {
        setTicketAreas(id, area_ids);
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
        setTicketAreas(id, area_ids);
    }

    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.json(buildTicketResponse(row));
});

app.delete('/api/tickets/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(id);
    deleteEntityLinks({ fromType: 'ticket', fromId: id, role: 'location' });
    const ticketTasks = listTaskInstances(
        `WHERE src.origin_type = 'ticket' AND src.origin_id = ?`,
        [id]
    );
    ticketTasks.forEach((task) => {
        deleteTaskInstance(task.id);
    });
    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json({ success: true });
});

app.get('/api/tasks', (req, res) => {
    const includeArchived = String(req.query.include_archived || '').trim() === '1';
    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    const rollup = String(req.query.rollup || '').trim() === '1';
    const whereClause = originType && originId
        ? `WHERE src.origin_type = ? AND src.origin_id = ?`
        : '';
    const rows = listTaskInstances(whereClause, originType && originId ? [originType, originId] : []);
    const tasks = sortTasksByPriority(rows.filter((task) => (
        includeArchived || !task.archived_at
    )));
    if (!rollup) {
        return res.json(tasks);
    }
    const grouped = tasks.reduce((acc, task) => {
        if (task.completed) return acc;
        const originType = task.origin_type || 'manual';
        const originId = task.origin_id || 'manual';
        const key = `${originType}:${originId}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
    }, {});
    const rollupTasks = Object.values(grouped).map((group) => {
        const incomplete = group.filter((task) => !task.completed);
        if (!incomplete.length) return null;
        const listGroups = incomplete.reduce((acc, task) => {
            const listKey = task.list_key || 'default';
            if (!acc[listKey]) acc[listKey] = [];
            acc[listKey].push(task);
            return acc;
        }, {});
        const listNextTasks = Object.values(listGroups).map((listTasks) => {
            if (!listTasks.length) return null;
            const listMode = listTasks[0]?.list_mode || 'sequential';
            const hasSequence = listMode === 'sequential'
                || listTasks.some((task) => task.rank != null || task.step_order != null);
            let sorted;
            if (hasSequence) {
                sorted = [...listTasks].sort((a, b) => {
                    const rankA = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
                    const rankB = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
                    if (rankA !== rankB) return rankA - rankB;
                    const orderA = a.step_order == null ? Number.POSITIVE_INFINITY : a.step_order;
                    const orderB = b.step_order == null ? Number.POSITIVE_INFINITY : b.step_order;
                    if (orderA !== orderB) return orderA - orderB;
                    const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
                    const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
                    if (dueA !== dueB) return dueA - dueB;
                    return b.priority_effective - a.priority_effective;
                });
                const chainMax = Math.max(...listTasks.map((task) => task.priority_effective ?? 0));
                return {
                    ...sorted[0],
                    priority_effective: chainMax,
                    priority_tier: getPriorityTier(chainMax)
                };
            }
            sorted = sortTasksByPriority(listTasks);
            return sorted[0];
        }).filter(Boolean);
        if (!listNextTasks.length) return null;
        const sortedOrigin = sortTasksByPriority(listNextTasks);
        return sortedOrigin[0];
    }).filter(Boolean);
    let sortedRollup = sortTasksByPriority(rollupTasks);
    const sundayCandidates = sortedRollup.filter(
        (task) => task.origin_type === 'sunday' && task.origin_id
    );
    if (sundayCandidates.length) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const sundayIds = sundayCandidates
            .map((task) => task.origin_id)
            .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
            .sort();
        const nextSundayId = sundayIds.find((value) => value >= todayKey) || sundayIds[0];
        if (nextSundayId) {
            sortedRollup = sortedRollup.filter((task) => (
                task.origin_type !== 'sunday' || task.origin_id === nextSundayId
            ));
        }
    }
    return res.json(sortedRollup);
});

app.get('/api/task-origins', (req, res) => {
    const tasks = listTaskInstances('');
    const rollups = buildOriginRollups(tasks).map((origin) => ({
        ...origin,
        label: origin.next_task?.text || `${origin.origin_type}:${origin.origin_id}`
    }));
    res.json(rollups);
});

app.get('/api/task-origins/links', (req, res) => {
    const includeAll = String(req.query.all || '').trim() === '1';
    if (includeAll) {
        const rows = db.prepare(`
            SELECT
                l.to_type AS child_origin_type,
                l.to_id AS child_origin_id,
                src.origin_type AS parent_origin_type,
                src.origin_id AS parent_origin_id,
                l.meta_json
            FROM entity_links l
            JOIN view_task_source src ON src.task_instance_id = l.from_id
            WHERE l.from_type = 'task_instance'
              AND l.role = 'origin_link'
        `).all();
        const links = rows.map((row) => {
            const meta = parseJsonField(row.meta_json);
            return {
                parent_origin_type: row.parent_origin_type,
                parent_origin_id: row.parent_origin_id,
                child_origin_type: row.child_origin_type,
                child_origin_id: row.child_origin_id,
                label: meta?.label || ''
            };
        });
        return res.json({ links });
    }

    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    if (!originType || !originId) {
        return res.status(400).json({ error: 'origin_type and origin_id are required' });
    }

    const parentLink = db.prepare(`
        SELECT l.from_id AS task_instance_id, l.meta_json
        FROM entity_links l
        WHERE l.from_type = 'task_instance'
          AND l.role = 'origin_link'
          AND l.to_type = ?
          AND l.to_id = ?
        LIMIT 1
    `).get(originType, originId);

    let parent = null;
    if (parentLink?.task_instance_id) {
        const [parentTask] = listTaskInstances('WHERE ti.id = ?', [parentLink.task_instance_id]);
        if (parentTask) {
            const meta = parseJsonField(parentLink.meta_json);
            parent = {
                origin_type: parentTask.origin_type,
                origin_id: parentTask.origin_id,
                task_instance_id: parentLink.task_instance_id,
                label: meta?.label || parentTask.text || ''
            };
        }
    }

    const childLinks = db.prepare(`
        SELECT l.from_id AS task_instance_id, l.to_type, l.to_id, l.meta_json
        FROM entity_links l
        JOIN view_task_source src ON src.task_instance_id = l.from_id
        WHERE l.from_type = 'task_instance'
          AND l.role = 'origin_link'
          AND src.origin_type = ?
          AND src.origin_id = ?
    `).all(originType, originId);

    const childTasks = childLinks.length
        ? listTaskInstances(`WHERE ti.id IN (${childLinks.map(() => '?').join(', ')})`, childLinks.map((row) => row.task_instance_id))
        : [];
    const childTaskMap = new Map(childTasks.map((task) => [task.id, task]));

    const children = childLinks.map((row) => {
        const task = childTaskMap.get(row.task_instance_id);
        const meta = parseJsonField(row.meta_json);
        return {
            task_instance_id: row.task_instance_id,
            origin_type: row.to_type,
            origin_id: row.to_id,
            label: meta?.label || task?.text || ''
        };
    });

    res.json({ parent, children });
});

app.delete('/api/task-origins', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    if (!originType || !originId) {
        return res.status(400).json({ error: 'origin_type and origin_id are required' });
    }
    const tasks = listTaskInstances(
        `WHERE src.origin_type = ? AND src.origin_id = ?`,
        [originType, originId]
    );
    tasks.forEach((task) => {
        deleteTaskInstance(task.id);
    });
    res.json({ success: true });
});

app.post('/api/task-origins/assign', (req, res) => {
    const {
        from_origin_type,
        from_origin_id,
        to_origin_type,
        to_origin_id,
        label
    } = req.body || {};
    if (!from_origin_type || !from_origin_id || !to_origin_type || !to_origin_id) {
        return res.status(400).json({ error: 'from_origin_type, from_origin_id, to_origin_type, and to_origin_id are required' });
    }
    const title = label || `Origin: ${from_origin_type} ${from_origin_id}`;
    const generationKey = `origin-link:${from_origin_type}:${from_origin_id}:to:${to_origin_type}:${to_origin_id}`;
    const taskInstanceId = createTaskInstance({
        title,
        taskType: 'origin-link',
        priorityBase: 50,
        dueAt: null,
        originType: to_origin_type,
        originId: to_origin_id,
        originEvent: 'origin-link',
        generationKey
    });
    if (!taskInstanceId) {
        return res.status(200).json({ success: true, task_instance_id: null });
    }
    upsertEntityLink({
        fromType: 'task_instance',
        fromId: taskInstanceId,
        toType: from_origin_type,
        toId: from_origin_id,
        role: 'origin_link',
        metaJson: JSON.stringify({ label: title })
    });
    res.json({ success: true, task_instance_id: taskInstanceId });
});

app.post('/api/tasks', (req, res) => {
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const {
            text,
            source_type = 'manual',
            source_id = 'manual',
            source_event = 'created',
            priority_base = null,
            priority_override = null,
            due_at = null,
            rank = null,
            state = null,
            notes = null
        } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const now = new Date().toISOString();
        const taskId = `task-${randomUUID()}`;
        const taskInstanceId = `taskinst-${randomUUID()}`;
        const basePriority = Number.isFinite(Number(priority_base)) ? Number(priority_base) : 50;
        const instanceState = state || 'open';

        db.prepare(`
            INSERT INTO tasks (id, title, description, status, priority_base, created_at, updated_at)
            VALUES (?, ?, NULL, 'active', ?, ?, ?)
        `).run(taskId, normalizedText, basePriority, now, now);

        db.prepare(`
            INSERT INTO task_instances (
                id, task_id, state, priority_override, rank, due_at, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            taskInstanceId,
            taskId,
            instanceState,
            priority_override,
            rank,
            due_at,
            notes ? String(notes).trim() : null,
            now,
            now
        );

        db.prepare(`
            INSERT INTO task_origins (
                id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            `origin-${taskInstanceId}`,
            'instance',
            taskId,
            taskInstanceId,
            source_type || 'manual',
            source_id || 'manual',
            source_event || 'created',
            now
        );

        const [created] = listTaskInstances('WHERE ti.id = ?', [taskInstanceId]);
        return res.status(201).json(created);
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const { text, ticket_id = null, notes = null } = req.body || {};
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
            INSERT INTO tasks (id, ticket_id, text, completed, created_at, notes)
            VALUES (?, ?, ?, 0, ?, ?)
        `).run(id, ticket_id, normalizedText, createdAt, notes ? String(notes).trim() : null);
        return res.status(201).json({
            id,
            ticket_id,
            text: normalizedText,
            completed: false,
            created_at: createdAt,
            completed_at: null,
            notes: notes ? String(notes).trim() : ''
        });
    }
    const {
        text,
        ticket_id = null,
        source_type = null,
        source_id = null,
        source_event = null,
        task_type = null,
        priority_base = null,
        priority_override = null,
        due_at = null,
        sla_target_at = null,
        rank = null,
        state = null,
        blocked = 0,
        list_key = null,
        list_title = null,
        list_mode = 'sequential',
        progress_key = null,
        progress_steps = null,
        notes = null
    } = req.body || {};
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

    const now = new Date().toISOString();
    const taskType = task_type || (ticket_id ? 'support' : null);
    const basePriority = Number.isFinite(Number(priority_base))
        ? Number(priority_base)
        : getDefaultPriorityBase(taskType);
    const taskId = `taskdef-${randomUUID()}`;
    const taskInstanceId = `taskinst-${randomUUID()}`;
    const computedState = state || (Number(blocked) ? 'blocked' : 'open');

    db.prepare(`
        INSERT INTO tasks_new (
            id, title, description, status, priority_base, task_type, due_mode,
            default_duration_min, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskId,
        normalizedText,
        null,
        'active',
        basePriority,
        taskType,
        'floating',
        null,
        now,
        now
    );

    db.prepare(`
        INSERT INTO task_instances (
            id, task_id, state, due_at, start_at, completed_at, generated_from,
            generation_key, priority_override, rank, sla_target_at, blocked,
            list_key, list_title, list_mode, progress_key, progress_steps, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskInstanceId,
        taskId,
        computedState,
        due_at,
        null,
        null,
        ticket_id ? 'ticket' : 'manual',
        null,
        priority_override,
        rank,
        sla_target_at,
        Number(blocked) ? 1 : 0,
        list_key,
        list_title || list_key,
        list_mode || 'sequential',
        progress_key,
        progress_steps ? JSON.stringify(progress_steps) : null,
        notes ? String(notes).trim() : null
    );

    const originType = source_type || (ticket_id ? 'ticket' : 'manual');
    const originId = source_id || (ticket_id ? ticket_id : 'manual');
    const originEvent = source_event || 'created';
    const originIdValue = `origin-${taskInstanceId}`;
    db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        originIdValue,
        'instance',
        taskId,
        taskInstanceId,
        originType,
        originId,
        originEvent,
        now
    );

    upsertEntityLink({
        fromType: 'task_instance',
        fromId: taskInstanceId,
        toType: originType,
        toId: originId,
        role: 'source',
        metaJson: JSON.stringify({ origin_event: originEvent })
    });

    const [created] = listTaskInstances('WHERE ti.id = ?', [taskInstanceId]);
    res.status(201).json(created);
});

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const existing = db.prepare(`
            SELECT ti.*, t.title, t.priority_base
            FROM task_instances ti
            JOIN tasks t ON t.id = ti.task_id
            WHERE ti.id = ?
        `).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const {
            text = existing.title,
            completed = existing.state === 'done',
            priority_override = existing.priority_override,
            due_at = existing.due_at,
            rank = existing.rank,
            notes = existing.notes
        } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
        const nextState = completed ? 'done' : 'open';

        db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?')
            .run(normalizedText, new Date().toISOString(), existing.task_id);

        db.prepare(`
            UPDATE task_instances SET
                state = ?,
                due_at = ?,
                priority_override = ?,
                rank = ?,
                notes = ?,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            nextState,
            due_at,
            priority_override,
            rank,
            notes != null ? String(notes).trim() : null,
            completedAt,
            new Date().toISOString(),
            id
        );

        const [updated] = listTaskInstances('WHERE ti.id = ?', [id]);
        return res.json(updated);
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const { text = existing.text, completed = existing.completed, notes = existing.notes } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
        db.prepare('UPDATE tasks SET text = ?, completed = ?, completed_at = ?, notes = ? WHERE id = ?')
            .run(normalizedText, completed ? 1 : 0, completedAt, notes != null ? String(notes).trim() : null, id);
        return res.json({
            id,
            ticket_id: existing.ticket_id,
            text: normalizedText,
            completed: !!completed,
            created_at: existing.created_at,
            completed_at: completedAt,
            notes: notes != null ? String(notes).trim() : ''
        });
    }
    const existing = db.prepare(`
        SELECT ti.*, t.title, t.task_type, t.priority_base
        FROM task_instances ti
        JOIN tasks_new t ON t.id = ti.task_id
        WHERE ti.id = ?
    `).get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task not found' });
    }

    const {
        text = existing.title,
        completed = existing.state === 'done',
        priority_override = existing.priority_override,
        due_at = existing.due_at,
        sla_target_at = existing.sla_target_at,
        rank = existing.rank,
        blocked = existing.blocked,
        archive_after_due = existing.archive_after_due ?? 1,
        keep_until = existing.keep_until || null,
        notes = existing.notes,
        progress_key = existing.progress_key || '',
        progress_steps = null
    } = req.body || {};
    const normalizedText = normalizeName(text);
    if (!normalizedText) {
        return res.status(400).json({ error: 'Task text is required' });
    }

    let completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
    let nextState = completed ? 'done' : (Number(blocked) ? 'blocked' : 'open');
    const progressKeyValue = progress_key != null ? String(progress_key) : (existing.progress_key || '');
    const parsedProgressSteps = Array.isArray(progress_steps)
        ? progress_steps
        : (existing.progress_steps ? parseJsonField(existing.progress_steps, []) : []);
    const sortedProgressSteps = Array.isArray(parsedProgressSteps)
        ? parsedProgressSteps.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
        : [];
    const isProgressive = String(existing.list_mode || '').toLowerCase() === 'progressive';
    const isProgressComplete = isProgressive
        && sortedProgressSteps.length > 0
        && progressKeyValue
        && sortedProgressSteps[sortedProgressSteps.length - 1]?.key === progressKeyValue;
    if (isProgressive) {
        if (isProgressComplete) {
            completedAt = completedAt || new Date().toISOString();
            nextState = 'done';
        } else {
            completedAt = null;
            nextState = Number(blocked) ? 'blocked' : 'open';
        }
    }

    db.prepare(`
        UPDATE tasks_new SET title = ?, updated_at = ?
        WHERE id = ?
    `).run(normalizedText, new Date().toISOString(), existing.task_id);

    db.prepare(`
            UPDATE task_instances SET
                state = ?,
                due_at = ?,
                sla_target_at = ?,
                priority_override = ?,
                rank = ?,
                blocked = ?,
                completed_at = ?,
                archive_after_due = ?,
                keep_until = ?,
                progress_key = ?,
                progress_steps = ?,
                notes = ?
            WHERE id = ?
        `).run(
            nextState,
            due_at,
            sla_target_at,
            priority_override,
            rank,
            Number(blocked) ? 1 : 0,
            completedAt,
            Number(archive_after_due) ? 1 : 0,
            keep_until,
            progressKeyValue,
            Array.isArray(progress_steps) ? JSON.stringify(parsedProgressSteps) : existing.progress_steps,
            notes != null ? String(notes).trim() : null,
            id
        );

    const [updated] = listTaskInstances('WHERE ti.id = ?', [id]);
    res.json(updated);
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(id);
        if (!row) {
            return res.status(404).json({ error: 'Task not found' });
        }
        db.prepare('DELETE FROM task_list_items WHERE task_instance_id = ?').run(id);
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(id);
        db.prepare('DELETE FROM task_origins WHERE task_instance_id = ?').run(id);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM tasks WHERE id = ?').run(row.task_id);
        }
        return res.json({ success: true });
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        if (!result.changes) {
            return res.status(404).json({ error: 'Task not found' });
        }
        return res.json({ success: true });
    }
    const ok = deleteTaskInstance(id);
    if (!ok) {
        return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true });
});

// --- Entity Links ---

app.get('/api/links', (req, res) => {
    const {
        from_type,
        from_id,
        to_type,
        to_id,
        role
    } = req.query || {};
    const filters = [];
    const params = [];
    if (from_type) {
        filters.push('from_type = ?');
        params.push(from_type);
    }
    if (from_id) {
        filters.push('from_id = ?');
        params.push(from_id);
    }
    if (to_type) {
        filters.push('to_type = ?');
        params.push(to_type);
    }
    if (to_id) {
        filters.push('to_id = ?');
        params.push(to_id);
    }
    if (role) {
        filters.push('role = ?');
        params.push(role);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
        SELECT id, from_type, from_id, to_type, to_id, role, created_at, meta_json
        FROM entity_links
        ${whereClause}
        ORDER BY created_at DESC
    `).all(...params);
    res.json(rows);
});

app.post('/api/links', (req, res) => {
    const {
        id,
        from_type,
        from_id,
        to_type,
        to_id,
        role = null,
        meta = null
    } = req.body || {};
    if (!from_type || !from_id || !to_type || !to_id) {
        return res.status(400).json({ error: 'from_type, from_id, to_type, and to_id are required' });
    }
    const createdAt = new Date().toISOString();
    const metaJson = meta ? JSON.stringify(meta) : null;
    const linkId = upsertEntityLink({
        id,
        fromType: from_type,
        fromId: from_id,
        toType: to_type,
        toId: to_id,
        role,
        createdAt,
        metaJson
    });
    res.status(201).json({
        id: linkId,
        from_type,
        from_id,
        to_type,
        to_id,
        role,
        created_at: createdAt,
        meta_json: metaJson
    });
});

app.delete('/api/links/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM entity_links WHERE id = ?').run(id);
    if (!result.changes) {
        return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ success: true });
});

// --- Recurring Task Templates ---

app.get('/api/recurring-templates', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    if (!originType) {
        return res.status(400).json({ error: 'origin_type is required' });
    }
    if (!tableExists('recurring_task_templates')) {
        return res.json([]);
    }
    const originId = req.query.origin_id ? String(req.query.origin_id) : null;
    const rows = db.prepare(`
        SELECT *
        FROM recurring_task_templates
        WHERE origin_type = ?
          AND (origin_id IS NULL OR origin_id = ?)
        ORDER BY sort_order ASC, title ASC
    `).all(originType, originId);
    res.json(rows);
});

app.post('/api/recurring-templates', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const {
        origin_type,
        origin_id = null,
        list_key = null,
        list_title = null,
        list_mode = 'sequential',
        step_key,
        title,
        sort_order = 0,
        due_offset_days = null,
        priority_base = 50,
        active = 1
    } = req.body || {};
    if (!origin_type || !list_key || !step_key || !title) {
        return res.status(400).json({ error: 'origin_type, list_key, step_key, and title are required' });
    }
    const now = new Date().toISOString();
    const id = `tmpl-${randomUUID()}`;
    db.prepare(`
        INSERT INTO recurring_task_templates (
            id, origin_type, origin_id, list_key, list_title, list_mode,
            step_key, title, sort_order, due_offset_days,
            priority_base, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        origin_type,
        origin_id,
        list_key,
        list_title || list_key,
        list_mode || 'sequential',
        step_key,
        title,
        Number(sort_order) || 0,
        due_offset_days != null ? Number(due_offset_days) : null,
        Number(priority_base) || 50,
        active ? 1 : 0,
        now,
        now
    );
    res.status(201).json({ id });
});

app.put('/api/recurring-templates/:id', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM recurring_task_templates WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
    }
    const {
        title = existing.title,
        sort_order = existing.sort_order,
        due_offset_days = existing.due_offset_days,
        priority_base = existing.priority_base,
        active = existing.active,
        step_key = existing.step_key,
        list_key = existing.list_key,
        list_title = existing.list_title,
        list_mode = existing.list_mode || 'sequential'
    } = req.body || {};
    db.prepare(`
        UPDATE recurring_task_templates SET
            title = ?,
            step_key = ?,
            list_key = ?,
            list_title = ?,
            list_mode = ?,
            sort_order = ?,
            due_offset_days = ?,
            priority_base = ?,
            active = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        title,
        step_key,
        list_key,
        list_title || list_key,
        list_mode || 'sequential',
        Number(sort_order) || 0,
        due_offset_days != null ? Number(due_offset_days) : null,
        Number(priority_base) || 50,
        active ? 1 : 0,
        new Date().toISOString(),
        id
    );
    res.json({ success: true });
});

app.delete('/api/recurring-templates/:id', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const { id } = req.params;
    const result = db.prepare('DELETE FROM recurring_task_templates WHERE id = ?').run(id);
    if (!result.changes) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true });
});

app.post('/api/recurring-templates/seed', (req, res) => {
    const originType = String(req.query.origin_type || req.body?.origin_type || '').trim();
    const originId = req.query.origin_id ? String(req.query.origin_id) : (req.body?.origin_id ? String(req.body.origin_id) : null);
    if (originType && !['sunday', 'vestry', 'operations', 'event'].includes(originType)) {
        return res.status(400).json({ error: 'Only sunday, vestry, operations, and event seeding is supported right now.' });
    }
    if (!originType || originType === 'sunday') seedSundayTasksFromTemplates();
    if (!originType || originType === 'vestry') seedVestryTasksFromTemplates();
    if (!originType || originType === 'operations') seedOperationsTasksFromTemplates();
    if (originType === 'event' && originId) {
        const rows = db.prepare(`
            SELECT o.id AS occurrence_id, o.date AS date_key
            FROM event_occurrences o
            JOIN events e ON e.id = o.event_id
            WHERE e.event_type_id = ?
              AND o.date >= date('now')
            ORDER BY o.date ASC
        `).all(Number(originId));
        rows.forEach((row) => {
            seedEventTasksForOccurrence({
                occurrenceId: row.occurrence_id,
                eventTypeId: Number(originId),
                dateKey: row.date_key
            });
        });
    }
    res.json({ success: true });
});

app.get('/api/recurring-templates/instances', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    const originId = req.query.origin_id ? String(req.query.origin_id) : null;
    const listKey = req.query.list_key ? String(req.query.list_key) : null;
    if (!originType) {
        return res.status(400).json({ error: 'origin_type is required' });
    }

    const tasks = listTaskInstances('');
    const filtered = tasks.filter((task) => {
        if (task.origin_type !== originType) return false;
        if (listKey && (task.list_key || 'default') !== listKey) return false;
        if (originType === 'operations' && originId) {
            if (originId === 'weekly') return String(task.origin_id || '').startsWith('weekly-');
            if (originId === 'timesheets') return String(task.origin_id || '').startsWith('timesheets-');
            return task.origin_id === originId;
        }
        if (originType === 'event' && originId) {
            return Number(task.event_type_id) === Number(originId);
        }
        if (originId && task.origin_id !== originId) return false;
        return true;
    });

    const grouped = filtered.reduce((acc, task) => {
        const originIdValue = task.origin_id || 'manual';
        const key = `${task.origin_type}:${originIdValue}`;
        if (!acc[key]) {
            acc[key] = {
                key,
                origin_type: task.origin_type,
                origin_id: originIdValue,
                tasks: [],
                sample: task
            };
        }
        acc[key].tasks.push(task);
        return acc;
    }, {});

    const instances = Object.values(grouped).map((group) => {
        const openTasks = group.tasks.filter((task) => !task.completed);
        let nextTask = null;
        if (openTasks.length) {
            const listMode = openTasks[0]?.list_mode || 'sequential';
            const hasSequence = listMode === 'sequential'
                || openTasks.some((task) => task.rank != null || task.step_order != null);
            if (hasSequence) {
                const sorted = [...openTasks].sort((a, b) => {
                    const rankA = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
                    const rankB = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
                    if (rankA !== rankB) return rankA - rankB;
                    const orderA = a.step_order == null ? Number.POSITIVE_INFINITY : a.step_order;
                    const orderB = b.step_order == null ? Number.POSITIVE_INFINITY : b.step_order;
                    if (orderA !== orderB) return orderA - orderB;
                    const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
                    const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
                    if (dueA !== dueB) return dueA - dueB;
                    return b.priority_effective - a.priority_effective;
                });
                const chainMax = Math.max(...openTasks.map((task) => task.priority_effective ?? 0));
                nextTask = {
                    ...sorted[0],
                    priority_effective: chainMax,
                    priority_tier: getPriorityTier(chainMax)
                };
            } else {
                nextTask = sortTasksByPriority(openTasks)[0];
            }
        }
        return {
            key: group.key,
            origin_type: group.origin_type,
            origin_id: group.origin_id,
            total_count: group.tasks.length,
            open_count: openTasks.length,
            next_task: nextTask,
            sample: group.sample
        };
    });

    const withNext = instances.filter((row) => row.next_task);
    const withoutNext = instances.filter((row) => !row.next_task);
    const sortedWithNext = sortTasksByPriority(withNext.map((row) => row.next_task)).map((task) => (
        withNext.find((row) => row.next_task?.id === task.id)
    )).filter(Boolean);
    res.json([...sortedWithNext, ...withoutNext]);
});

// Get all events (merged)
app.get('/api/events', async (req, res) => {
    try {
        if (!tableExists('events') || !tableExists('event_occurrences')) {
            return res.json([]);
        }
        // 1. Get liturgical events
        const days = tableExists('liturgical_days')
            ? db.prepare('SELECT * FROM liturgical_days ORDER BY date').all()
            : [];
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
                   o.id AS occurrence_id, o.date, o.start_time, o.end_time, o.building_id,
                   t.name as type_name, t.slug as type_slug, c.name as category_name,
                   COALESCE(t.color, c.color) as type_color
            FROM events e
            JOIN event_occurrences o ON o.event_id = e.id
            LEFT JOIN event_types t ON e.event_type_id = t.id
            LEFT JOIN event_categories c ON t.category_id = c.id
            WHERE e.id <> 'sunday-service'
        `).all();

        const scheduledEvents = eventRows.map(e => ({
            id: e.occurrence_id,
            occurrence_id: e.occurrence_id,
            event_id: e.id,
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
        const filteredScheduled = scheduledEvents.filter(
            (event) => !(event.type_slug === 'weekly-service' && isSundayDate(event.date))
        );
        res.json([...liturgicalEvents, ...filteredScheduled]);
    } catch (error) {
        console.error('Error fetching merged events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

app.get('/api/event-occurrences/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('events') || !tableExists('event_occurrences')) {
        return res.status(404).json({ error: 'Events not available' });
    }
    const row = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.end_time,
            o.building_id,
            o.notes,
            e.id AS event_id,
            e.title,
            e.description,
            e.event_type_id,
            e.source,
            e.metadata,
            t.name AS type_name,
            t.slug AS type_slug,
            c.name AS category_name,
            COALESCE(t.color, c.color) AS type_color
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON e.event_type_id = t.id
        LEFT JOIN event_categories c ON t.category_id = c.id
        WHERE o.id = ?
        LIMIT 1
    `).get(id);
    if (!row) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const notes = parseNotes(row.notes);
    const metadata = row.metadata ? parseNotes(row.metadata) : {};
    res.json({
        occurrence: {
            id: row.occurrence_id,
            date: row.date,
            start_time: row.start_time,
            end_time: row.end_time,
            building_id: row.building_id
        },
        event: {
            id: row.event_id,
            title: row.title,
            description: row.description,
            event_type_id: row.event_type_id,
            source: row.source,
            type_name: row.type_name,
            type_slug: row.type_slug,
            category_name: row.category_name,
            color: row.type_color
        },
        notes,
        metadata
    });
});

app.put('/api/event-occurrences/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('event_occurrences')) {
        return res.status(404).json({ error: 'Events not available' });
    }
    const existing = db.prepare('SELECT notes FROM event_occurrences WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const { internal_notes: internalNotes, template_data: templateData } = req.body || {};
    const notes = parseNotes(existing.notes);
    notes.internal = String(internalNotes || '').trim();
    if (templateData && typeof templateData === 'object') {
        notes.template = templateData;
    }
    db.prepare('UPDATE event_occurrences SET notes = ? WHERE id = ?').run(JSON.stringify(notes), id);
    res.json({ success: true, notes });
});

app.get('/api/event-occurrences/:id/documents', async (req, res) => {
    if (!tableExists('event_documents')) {
        return res.json([]);
    }
    const { id } = req.params;
    const includePreview = String(req.query.preview || '').trim() === '1';
    const rows = db.prepare(`
        SELECT id, occurrence_id, event_id, doc_type, label, file_name, file_path, created_at
        FROM event_documents
        WHERE occurrence_id = ?
        ORDER BY created_at DESC
    `).all(id);
    if (!includePreview) {
        return res.json(rows);
    }
    const withPreview = await Promise.all(rows.map(async (row) => {
        let preview = '';
        try {
            preview = await buildDocumentPreview(row.file_path);
        } catch {
            preview = '';
        }
        return { ...row, preview };
    }));
    res.json(withPreview);
});

app.post('/api/event-occurrences/:id/documents', eventDocUpload.single('file'), async (req, res) => {
    if (!tableExists('event_documents')) {
        return res.status(400).json({ error: 'Event documents not available' });
    }
    const { id } = req.params;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'file is required' });
    }
    const occurrence = db.prepare('SELECT id, event_id FROM event_occurrences WHERE id = ?').get(id);
    if (!occurrence) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const docType = String(req.body?.doc_type || 'attachment').toLowerCase();
    const label = String(req.body?.label || '').trim();
    try {
        const targetDir = await ensureEventDocDir(occurrence.event_id, occurrence.id);
        const originalName = file.originalname || file.filename || 'document';
        const safeName = originalName.replace(/[<>:"/\\|?*]+/g, '_');
        const targetPath = await ensureUniquePath(targetDir, safeName);
        try {
            await rename(file.path, targetPath);
        } catch {
            await copyFile(file.path, targetPath);
        }

        if (docType === 'contract') {
            const existing = db.prepare(`
                SELECT id, file_path FROM event_documents
                WHERE occurrence_id = ? AND doc_type = 'contract'
            `).all(occurrence.id);
            existing.forEach((row) => {
                db.prepare('DELETE FROM event_documents WHERE id = ?').run(row.id);
                if (row.file_path) {
                    rm(row.file_path, { force: true }).catch(() => {});
                }
            });
        }

        const docId = `doc-${randomUUID()}`;
        const createdAt = new Date().toISOString();
        db.prepare(`
            INSERT INTO event_documents (
                id, occurrence_id, event_id, doc_type, label, file_name, file_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            docId,
            occurrence.id,
            occurrence.event_id,
            docType,
            label || null,
            basename(targetPath),
            targetPath,
            createdAt
        );

        res.status(201).json({
            id: docId,
            occurrence_id: occurrence.id,
            event_id: occurrence.event_id,
            doc_type: docType,
            label: label || null,
            file_name: basename(targetPath),
            file_path: targetPath,
            created_at: createdAt
        });
    } catch (error) {
        console.error('Event document upload error:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

app.get('/api/event-template-fields', (req, res) => {
    if (!tableExists('event_template_fields')) {
        return res.json([]);
    }
    const eventTypeId = Number(req.query.event_type_id);
    if (!Number.isFinite(eventTypeId)) {
        return res.status(400).json({ error: 'event_type_id is required' });
    }
    const rows = db.prepare(`
        SELECT *
        FROM event_template_fields
        WHERE event_type_id = ?
        ORDER BY sort_order ASC, label ASC
    `).all(eventTypeId);
    res.json(rows.map((row) => ({
        id: row.id,
        event_type_id: row.event_type_id,
        field_key: row.field_key,
        label: row.label,
        field_type: row.field_type,
        options: row.options_json ? parseJsonField(row.options_json, []) : [],
        placeholder: row.placeholder || '',
        help_text: row.help_text || '',
        sort_order: row.sort_order || 0,
        required: !!row.required
    })));
});

app.put('/api/event-template-fields/:eventTypeId', (req, res) => {
    if (!tableExists('event_template_fields')) {
        return res.status(400).json({ error: 'event_template_fields table not initialized' });
    }
    const eventTypeId = Number(req.params.eventTypeId);
    if (!Number.isFinite(eventTypeId)) {
        return res.status(400).json({ error: 'Invalid eventTypeId' });
    }
    const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const now = new Date().toISOString();
    const insert = db.prepare(`
        INSERT INTO event_template_fields (
            id, event_type_id, field_key, label, field_type, options_json,
            placeholder, help_text, sort_order, required, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM event_template_fields WHERE event_type_id = ?').run(eventTypeId);
        fields.forEach((field, index) => {
            const fieldKey = String(field.field_key || '').trim();
            const label = String(field.label || '').trim();
            const fieldType = String(field.field_type || 'text').trim();
            if (!fieldKey || !label) return;
            const options = Array.isArray(field.options) ? field.options : [];
            insert.run(
                `tmplfield-${randomUUID()}`,
                eventTypeId,
                fieldKey,
                label,
                fieldType,
                options.length ? JSON.stringify(options) : null,
                field.placeholder ? String(field.placeholder) : null,
                field.help_text ? String(field.help_text) : null,
                Number.isFinite(Number(field.sort_order)) ? Number(field.sort_order) : index,
                field.required ? 1 : 0,
                now,
                now
            );
        });
    });
    tx();
    res.json({ success: true });
});

app.post('/api/events', (req, res) => {
    try {
        const {
            title,
            description = '',
            date,
            time = '',
            location = '',
            type_id = null,
            metadata = null
        } = req.body || {};

        if (!title || !date) {
            return res.status(400).json({ error: 'title and date are required' });
        }

        const eventId = `event-${randomUUID()}`;
        const occurrenceId = `occ-${randomUUID()}`;
        const now = new Date().toISOString();
        const parsedTypeId = type_id !== null && type_id !== '' ? Number(type_id) : null;

        db.prepare(`
            INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
        `).run(
            eventId,
            title,
            description,
            Number.isNaN(parsedTypeId) ? null : parsedTypeId,
            metadata ? JSON.stringify(metadata) : null,
            now,
            now
        );

        db.prepare(`
            INSERT INTO event_occurrences (
                id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL)
        `).run(
            occurrenceId,
            eventId,
            date,
            time || null,
            null,
            location || null
        );

        seedEventTasksForOccurrence({
            occurrenceId,
            eventTypeId: Number.isNaN(parsedTypeId) ? null : parsedTypeId,
            dateKey: date
        });

        res.json({
            id: eventId,
            occurrenceId,
            title,
            description,
            date,
            time: time || '',
            location: location || '',
            type_id: Number.isNaN(parsedTypeId) ? null : parsedTypeId,
            source: 'manual'
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

app.get('/api/db-backups/latest', async (req, res) => {
    try {
        const latest = await findLatestDbBackup();
        if (!latest) {
            return res.status(404).json({ error: 'No database backups found' });
        }
        res.json(latest);
    } catch (error) {
        console.error('Failed to fetch latest db backup:', error);
        res.status(500).json({ error: 'Failed to fetch latest db backup' });
    }
});

app.post('/api/db-backups/restore', async (req, res) => {
    try {
        const requestedPath = req.body?.path;
        const latest = await findLatestDbBackup();
        const target = requestedPath || latest?.path;
        if (!target) {
            return res.status(404).json({ error: 'No database backup available to restore' });
        }

        const resolvedTarget = resolve(target);
        const resolvedDir = resolve(backupDir);
        if (!resolvedTarget.startsWith(resolvedDir)) {
            return res.status(400).json({ error: 'Invalid backup path' });
        }

        const filename = basename(resolvedTarget);
        if (!backupPattern.test(filename)) {
            return res.status(400).json({ error: 'Invalid backup filename' });
        }

        const dbPath = join(__dirname, 'church.db');
        sqlite.close();
        await copyFile(resolvedTarget, dbPath);

        res.json({
            success: true,
            restored: resolvedTarget,
            restartRequired: true
        });

        setTimeout(() => process.exit(0), 250);
    } catch (error) {
        console.error('Failed to restore db backup:', error);
        res.status(500).json({ error: 'Failed to restore database backup' });
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

const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist'];
const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];

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

const parseJsonArray = (value) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const parseJsonObject = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const getSundayIndex = (dateStr) => {
    const date = new Date(`${dateStr}T00:00:00`);
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstDow = firstOfMonth.getDay();
    const firstSunday = 1 + ((7 - firstDow) % 7);
    const index = Math.floor((date.getDate() - firstSunday) / 7) + 1;
    return index;
};

const getRotationAssignmentsForDate = (dateStr, roleKeys) => {
    const teamNumber = getSundayIndex(dateStr);
    if (teamNumber > 4 || teamNumber < 1) return { __skipRotation: true };
    const rows = db.prepare('SELECT id, roles, teams FROM people').all();
    const assignments = {};
    roleKeys.forEach((roleKey) => {
        assignments[roleKey] = [];
    });
    rows.forEach((row) => {
        const roles = parseJsonArray(row.roles);
        const teams = parseJsonObject(row.teams);
        roleKeys.forEach((roleKey) => {
            if (!roles.includes(roleKey)) return;
            const teamList = Array.isArray(teams?.[roleKey]) ? teams[roleKey] : [];
            if (teamList.map(Number).includes(teamNumber)) {
                assignments[roleKey].push(row.id);
            }
        });
    });
    return assignments;
};

const ensureSundayOccurrence = (date, serviceTime) => {
    const existing = db.prepare(`
        SELECT id FROM event_occurrences
        WHERE event_id = 'sunday-service' AND date = ? AND start_time = ?
    `).get(date, serviceTime);
    if (existing?.id) return existing.id;
    const rite = serviceTime.startsWith('08') ? 'Rite I' : 'Rite II';
    const occurrenceId = `occ-${randomUUID()}`;
    db.prepare(`
        INSERT INTO event_occurrences (
            id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
        ) VALUES (?, 'sunday-service', ?, ?, NULL, ?, ?, 0, NULL)
    `).run(
        occurrenceId,
        date,
        serviceTime,
        DEFAULT_LOCATION_BY_TIME[serviceTime] || '',
        rite
    );
    return occurrenceId;
};

const replaceAssignmentsForRole = (occurrenceId, roleKey, personIds) => {
    db.prepare('DELETE FROM assignments WHERE occurrence_id = ? AND role_key = ?')
        .run(occurrenceId, roleKey);
    const uniquePeople = Array.from(new Set(personIds || []));
    uniquePeople.forEach((personId) => {
        db.prepare(`
            INSERT INTO assignments (id, occurrence_id, role_key, person_id)
            VALUES (?, ?, ?, ?)
        `).run(`asgn-${randomUUID()}`, occurrenceId, roleKey, personId);
    });
};

const formatDateKey = (date) => date.toISOString().slice(0, 10);

const applyRotationForDate = (date) => {
    const rotationTen = getRotationAssignmentsForDate(date, TEN_AM_ROLE_KEYS);
    const rotationEight = getRotationAssignmentsForDate(date, EIGHT_AM_ROLE_KEYS);
    const skipRotation = rotationTen.__skipRotation || rotationEight.__skipRotation;

    const occurrenceTen = ensureSundayOccurrence(date, '10:00');
    if (!skipRotation) {
        Object.entries(rotationTen).forEach(([roleKey, personIds]) => {
            if (roleKey === '__skipRotation') return;
            if (!personIds.length) return;
            replaceAssignmentsForRole(occurrenceTen, roleKey, personIds);
        });
    } else {
        const keepRoles = new Set(['celebrant', 'preacher', 'organist', 'sound']);
        TEN_AM_ROLE_KEYS.forEach((roleKey) => {
            if (keepRoles.has(roleKey)) return;
            replaceAssignmentsForRole(occurrenceTen, roleKey, []);
        });
    }
    applyDefaultSundayAssignments(occurrenceTen, date, '10:00', { skipTeams: skipRotation });

    const occurrenceEight = ensureSundayOccurrence(date, '08:00');
    if (!skipRotation) {
        Object.entries(rotationEight).forEach(([roleKey, personIds]) => {
            if (roleKey === '__skipRotation') return;
            if (!personIds.length) return;
            replaceAssignmentsForRole(occurrenceEight, roleKey, personIds);
        });
    } else {
        const keepRoles = new Set(['celebrant', 'preacher', 'organist', 'sound']);
        EIGHT_AM_ROLE_KEYS.forEach((roleKey) => {
            if (keepRoles.has(roleKey)) return;
            replaceAssignmentsForRole(occurrenceEight, roleKey, []);
        });
    }
    applyDefaultSundayAssignments(occurrenceEight, date, '08:00');

    return { date, serviceTimes: ['08:00', '10:00'], skipRotation };
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

const ROLE_LABELS = {
    celebrant: 'Celebrant',
    preacher: 'Preacher',
    organist: 'Organist',
    lector: 'Lector',
    usher: 'Usher',
    acolyte: 'Acolyte',
    lem: 'LEM',
    sound: 'Sound',
    coffeeHour: 'Coffee Hour',
    childcare: 'Childcare'
};

const buildUpcomingSundaySchedule = (startDate) => {
    const liturgicalDays = db.prepare(`
        SELECT date, feast, color
        FROM liturgical_days
        WHERE date >= ?
        ORDER BY date
    `).all(startDate);
    const liturgicalByDate = new Map(liturgicalDays.map((day) => [day.date, day]));

    const peopleRows = db.prepare('SELECT id, display_name FROM people').all();
    const peopleById = new Map(peopleRows.map((row) => [row.id, row.display_name]));

    const buildingRows = db.prepare('SELECT id, name FROM buildings').all();
    const buildingsById = new Map(buildingRows.map((row) => [row.id, row.name]));

    const occurrencesByDate = loadSundayOccurrences(startDate, null);
    const dates = Object.keys(occurrencesByDate)
        .filter((date) => {
            const parsed = parseISO(date);
            return !Number.isNaN(parsed.getTime()) && isSunday(parsed);
        })
        .sort((a, b) => a.localeCompare(b));

    const entries = dates.map((date) => {
        const dateObj = parseISO(date);
        const liturgical = liturgicalByDate.get(date);
            const services = (occurrencesByDate[date] || [])
                .filter((occurrence) => ['08:00', '10:00'].includes(occurrence.start_time || '10:00'))
                .map((occurrence) => {
                const time = occurrence.start_time || '10:00';
                const rite = occurrence.rite || (time.startsWith('08') ? 'Rite I' : 'Rite II');
                const locationName = buildingsById.get(occurrence.building_id) || occurrence.building_id || '';
                const roles = ROLE_KEYS.reduce((acc, roleKey) => {
                    const ids = occurrence.roles?.[roleKey] || [];
                    const names = ids
                        .map((id) => peopleById.get(id) || id)
                        .filter(Boolean)
                        .join(', ');
                    acc[roleKey] = names;
                    return acc;
                }, {});
                return { time, rite, location: locationName, roles };
            })
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        return {
            date,
            dateObj,
            feast: liturgical?.feast || 'Sunday',
            color: liturgical?.color || '',
            services
        };
    });

    const grouped = new Map();
    entries.forEach((entry) => {
        const monthKey = format(entry.dateObj, 'MMMM yyyy');
        if (!grouped.has(monthKey)) grouped.set(monthKey, []);
        grouped.get(monthKey).push(entry);
    });

    return Array.from(grouped.entries()).map(([month, items]) => ({ month, items }));
};

const wrapTextLines = (text, font, size, maxWidth) => {
    const raw = String(text || '').trim();
    if (!raw) return [''];
    const words = raw.split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        const width = font.widthOfTextAtSize(next, size);
        if (width <= maxWidth) {
            current = next;
            return;
        }
        if (current) lines.push(current);
        current = word;
    });
    if (current) lines.push(current);
    return lines.length ? lines : [''];
};

const parseReadings = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean);
};

const classifyReading = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'unknown';
    if (/\bpsalm\b/i.test(raw)) return 'psalm';
    if (/\bgospel\b/i.test(raw)) return 'gospel';

    const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    const book = normalize(raw);
    const startsWith = (name) => new RegExp(`^${name}\\b`, 'i').test(book);

    const gospelBooks = ['matthew', 'mark', 'luke', 'john'];
    if (gospelBooks.some((name) => startsWith(name))) return 'gospel';

    const ntBooks = [
        'acts',
        'romans',
        '1 corinthians',
        '2 corinthians',
        'corinthians',
        'galatians',
        'ephesians',
        'philippians',
        'colossians',
        '1 thessalonians',
        '2 thessalonians',
        'thessalonians',
        '1 timothy',
        '2 timothy',
        'timothy',
        'titus',
        'philemon',
        'hebrews',
        'james',
        '1 peter',
        '2 peter',
        'peter',
        '1 john',
        '2 john',
        '3 john',
        'jude',
        'revelation'
    ];
    if (ntBooks.some((name) => startsWith(name))) return 'nt';

    const otBooks = [
        'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy',
        'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', 'samuel',
        '1 kings', '2 kings', 'kings', '1 chronicles', '2 chronicles', 'chronicles',
        'ezra', 'nehemiah', 'esther', 'job', 'proverbs', 'ecclesiastes', 'song of solomon',
        'song of songs', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel',
        'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk',
        'zephaniah', 'haggai', 'zechariah', 'malachi'
    ];
    if (otBooks.some((name) => startsWith(name))) return 'ot';

    return 'unknown';
};

const mergeReadingFragments = (list) => {
    const merged = [];
    list.forEach((item) => {
        const trimmed = String(item || '').trim();
        if (!trimmed) return;
        const isContinuation = /^(?:\d+\s*[:\[]|\[\d|\(\d|or\b)/i.test(trimmed);
        if (isContinuation && merged.length > 0) {
            merged[merged.length - 1] = `${merged[merged.length - 1]}; ${trimmed}`;
            return;
        }
        merged.push(trimmed);
    });
    return merged;
};

const getReadingPair = (readings) => {
    const list = Array.isArray(readings) ? readings : parseReadings(readings);
    const merged = mergeReadingFragments(list);
    const filtered = merged.filter((item) => {
        const type = classifyReading(item);
        return type !== 'psalm' && type !== 'gospel';
    });

    const oldTestament = filtered.find((item) => classifyReading(item) === 'ot') || '';
    const newTestament = filtered.find((item) => classifyReading(item) === 'nt') || '';

    return {
        oldTestament: oldTestament || filtered[0] || '',
        newTestament: newTestament || filtered[1] || ''
    };
};

const pickReadingForService = (readings, serviceTime) => {
    const { oldTestament, newTestament } = getReadingPair(readings);
    if (String(serviceTime || '').startsWith('08')) return oldTestament || newTestament || '';
    return newTestament || oldTestament || '';
};

const wrapCellLines = (text, font, size, maxWidth) => {
    const segments = String(text || '')
        .split('\n')
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (segments.length === 0) return [''];
    const lines = [];
    segments.forEach((segment) => {
        wrapTextLines(segment, font, size, maxWidth).forEach((line) => lines.push(line));
    });
    return lines.length ? lines : [''];
};

const buildScheduleForMonths = (monthKeys = []) => {
    const validKeys = Array.from(new Set(monthKeys))
        .map((key) => String(key || '').trim())
        .filter((key) => /^\d{4}-\d{2}$/.test(key));
    if (validKeys.length === 0) return [];

    const peopleRows = db.prepare('SELECT id, display_name FROM people').all();
    const peopleById = new Map(peopleRows.map((row) => [row.id, row.display_name]));

    const buildingRows = db.prepare('SELECT id, name FROM buildings').all();
    const buildingsById = new Map(buildingRows.map((row) => [row.id, row.name]));

    const monthData = [];
    validKeys.forEach((monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0);
        const startKey = formatDateKey(monthStart);
        const endKey = formatDateKey(monthEnd);

        const liturgicalDays = db.prepare(`
            SELECT date, feast, readings
            FROM liturgical_days
            WHERE date BETWEEN ? AND ?
            ORDER BY date
        `).all(startKey, endKey);
        const liturgicalByDate = new Map(liturgicalDays.map((day) => [day.date, day]));

        const occurrencesByDate = loadSundayOccurrences(startKey, endKey);
        const dates = Object.keys(occurrencesByDate)
            .filter((date) => {
                const parsed = parseISO(date);
                return !Number.isNaN(parsed.getTime()) && isSunday(parsed);
            })
            .sort((a, b) => a.localeCompare(b));

        const rows = [];
        dates.forEach((date) => {
            const dateObj = parseISO(date);
            const liturgical = liturgicalByDate.get(date);
            const readings = parseReadings(liturgical?.readings || '');
            const services = (occurrencesByDate[date] || [])
                .filter((occurrence) => ['08:00', '10:00'].includes(occurrence.start_time || '10:00'))
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

            services.forEach((occurrence) => {
                const time = occurrence.start_time || '10:00';
                const locationName = buildingsById.get(occurrence.building_id) || occurrence.building_id || '';
                const feast = liturgical?.feast || 'Sunday';
                const reading = pickReadingForService(readings, time);

                const getRoleNames = (roleKey, { numbered = false } = {}) => {
                    const ids = occurrence.roles?.[roleKey] || [];
                    const names = ids.map((id) => peopleById.get(id) || id).filter(Boolean);
                    if (!numbered) return names.join('\n');
                    return names.map((name, index) => `${index + 1}: ${name}`).join('\n');
                };

                rows.push({
                    date,
                    dateObj,
                    time,
                    feast,
                    location: locationName,
                    lector: getRoleNames('lector', { numbered: time.startsWith('10') }),
                    lem: getRoleNames('lem'),
                    acolyte: getRoleNames('acolyte'),
                    usher: getRoleNames('usher'),
                    sound: getRoleNames('sound'),
                    reading
                });
            });
        });

        if (rows.length) {
            monthData.push({
                monthLabel: format(monthStart, 'MMMM yyyy'),
                rows
            });
        }
    });

    return monthData;
};

const loadSundayOccurrences = (start, end) => {
    const params = [];
    let sql = `
        SELECT o.id as occurrence_id, o.date, o.start_time, o.building_id, o.rite,
               a.role_key, a.person_id
        FROM event_occurrences o
        LEFT JOIN assignments a ON a.occurrence_id = o.id
        WHERE o.event_id = 'sunday-service'
          AND o.start_time IN ('08:00','10:00')
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
    const allowedTimes = new Set(['08:00', '10:00']);
    const rows = [];
    Object.values(occurrencesByDate).forEach((occurrences) => {
        occurrences.forEach((occurrence) => {
            if (occurrence.start_time && !allowedTimes.has(occurrence.start_time)) return;
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

    if (service_time === '10:00') {
        const mirrorOccurrenceId = ensureSundayOccurrence(date, '08:00');
        const mirrorRoles = ['celebrant', 'preacher'];
        mirrorRoles.forEach((roleKey) => {
            const apiKey = ROLE_FIELD_MAP[roleKey];
            if (!apiKey) return;
            deleteAssignments.run(mirrorOccurrenceId, roleKey);
            const people = normalizeAssignmentList(normalized[apiKey], peopleIndex);
            const uniquePeople = Array.from(new Set(people));
            uniquePeople.forEach((personId) => {
                insertAssignment.run(`asgn-${randomUUID()}`, mirrorOccurrenceId, roleKey, personId);
            });
        });
        applyDefaultSundayAssignments(mirrorOccurrenceId, date, '08:00');
    }
    res.json({ success: true, date, service_time });
});

app.post('/api/schedule-roles/auto-next-month', (req, res) => {
    try {
        const now = new Date();
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        const startKey = formatDateKey(nextMonthStart);
        const endKey = formatDateKey(nextMonthEnd);

        const sundayRows = db.prepare(`
            SELECT date
            FROM liturgical_days
            WHERE date BETWEEN ? AND ?
              AND CAST(strftime('%w', date) AS INTEGER) = 0
            ORDER BY date
        `).all(startKey, endKey);

        const results = sundayRows.map(({ date }) => applyRotationForDate(date));

        res.json({ ok: true, month: format(nextMonthStart, 'MMMM yyyy'), dates: results.length });
    } catch (error) {
        console.error('Auto schedule next month error:', error);
        res.status(500).json({ error: 'Failed to schedule next month' });
    }
});

app.post('/api/schedule-roles/auto-week', (req, res) => {
    try {
        const date = String(req.body?.date || '').trim();
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }
        const parsed = parseISO(date);
        if (Number.isNaN(parsed.getTime()) || !isSunday(parsed)) {
            return res.status(400).json({ error: 'Date must be a Sunday' });
        }
        const result = applyRotationForDate(date);
        res.json({ ok: true, ...result });
    } catch (error) {
        console.error('Auto schedule week error:', error);
        res.status(500).json({ error: 'Failed to schedule week' });
    }
});

app.post('/api/dev/restart', (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const isLocal = ip.includes('127.0.0.1') || ip === '::1' || ip.endsWith('::1');
    if (process.env.NODE_ENV === 'production' || !isLocal) {
        return res.status(403).json({ error: 'Restart not allowed' });
    }
    try {
        const scriptPath = resolve(__dirname, '../scripts/restart-dev.ps1');
        const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        res.json({ ok: true });
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({ error: 'Failed to restart dev services' });
    }
});

app.get('/api/liturgical-schedule/pdf', async (req, res) => {
    try {
        const todayKey = new Date().toISOString().slice(0, 10);
        const scheduleGroups = buildUpcomingSundaySchedule(todayKey);

        const doc = await PDFDocument.create();
        const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const pageMargin = 36;
        const headingSize = 16;
        const subheadingSize = 13;
        const bodySize = 10;
        const lineHeight = 12;

        const drawHeader = (page, monthLabel, isContinued = false) => {
            const { width, height } = page.getSize();
            const title = 'Liturgical Schedule';
            page.drawText(title, {
                x: pageMargin,
                y: height - pageMargin - headingSize,
                size: headingSize,
                font: fontBold,
                color: rgb(0.12, 0.16, 0.23)
            });
            const monthText = isContinued ? `${monthLabel} (continued)` : monthLabel;
            page.drawText(monthText, {
                x: pageMargin,
                y: height - pageMargin - headingSize - 18,
                size: subheadingSize,
                font: fontRegular,
                color: rgb(0.25, 0.31, 0.39)
            });
            return height - pageMargin - headingSize - 34;
        };

        scheduleGroups.forEach(({ month, items }) => {
            let page = doc.addPage();
            const { width, height } = page.getSize();
            let cursorY = drawHeader(page, month);
            const maxTextWidth = width - pageMargin * 2;

            items.forEach((entry) => {
                const dateLabel = `${format(entry.dateObj, 'MMM d, yyyy')} — ${entry.feast || 'Sunday'}`;
                const dateLines = wrapTextLines(dateLabel, fontBold, bodySize, maxTextWidth);
                dateLines.forEach((line) => {
                    cursorY -= lineHeight;
                    if (cursorY < pageMargin + 40) {
                        page = doc.addPage();
                        cursorY = drawHeader(page, month, true);
                    }
                    page.drawText(line, {
                        x: pageMargin,
                        y: cursorY,
                        size: bodySize,
                        font: fontBold,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                });

                entry.services.forEach((service) => {
                    const serviceLabel = `${service.time || '10:00'}${service.location ? ` • ${service.location}` : ''}${service.rite ? ` • ${service.rite}` : ''}`;
                    cursorY -= lineHeight;
                    if (cursorY < pageMargin + 40) {
                        page = doc.addPage();
                        cursorY = drawHeader(page, month, true);
                    }
                    page.drawText(serviceLabel, {
                        x: pageMargin + 10,
                        y: cursorY,
                        size: bodySize,
                        font: fontRegular,
                        color: rgb(0.32, 0.38, 0.45)
                    });

                    ROLE_KEYS.forEach((roleKey) => {
                        const names = service.roles?.[roleKey] || '';
                        if (!names) return;
                        const label = ROLE_LABELS[roleKey] || roleKey;
                        const linePrefix = `${label}: `;
                        const labelWidth = fontRegular.widthOfTextAtSize(linePrefix, bodySize);
                        const availableWidth = maxTextWidth - 32 - labelWidth;
                        const lines = wrapTextLines(names, fontRegular, bodySize, availableWidth);
                        lines.forEach((line, index) => {
                            cursorY -= lineHeight;
                            if (cursorY < pageMargin + 40) {
                                page = doc.addPage();
                                cursorY = drawHeader(page, month, true);
                            }
                            if (index === 0) {
                                page.drawText(linePrefix, {
                                    x: pageMargin + 24,
                                    y: cursorY,
                                    size: bodySize,
                                    font: fontRegular,
                                    color: rgb(0.15, 0.2, 0.26)
                                });
                            }
                            page.drawText(line, {
                                x: pageMargin + 24 + labelWidth,
                                y: cursorY,
                                size: bodySize,
                                font: fontRegular,
                                color: rgb(0.15, 0.2, 0.26)
                            });
                        });
                    });
                });

                cursorY -= lineHeight * 0.6;
            });
        });

        const pdfBytes = await doc.save();
        const fileName = `liturgical-schedule-${todayKey}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Liturgical schedule PDF error:', error);
        res.status(500).json({ error: 'Failed to build liturgical schedule PDF' });
    }
});

app.post('/api/liturgical-schedule/pdf-months', async (req, res) => {
    try {
        const months = Array.isArray(req.body?.months) ? req.body.months : [];
        const scheduleGroups = buildScheduleForMonths(months);
        if (scheduleGroups.length === 0) {
            return res.status(400).json({ error: 'No schedule data for selected months' });
        }

        const doc = await PDFDocument.create();
        const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const pageMargin = 36;
        const headingSize = 14;
        const subheadingSize = 12;
        const bodySize = 9;
        const lineHeight = 11;
        const tableWidth = 720;
        const columns = [
            { key: 'service', label: '', width: 220 },
            { key: 'lector', label: 'Lector', width: 90 },
            { key: 'lem', label: 'LEM', width: 80 },
            { key: 'acolyte', label: 'Acolytes', width: 90 },
            { key: 'usher', label: 'Ushers', width: 90 },
            { key: 'sound', label: 'Sound/Stream', width: 80 },
            { key: 'reading', label: '', width: 70 }
        ];

        const drawPageHeader = (page, monthLabel, continued = false) => {
            const { width, height } = page.getSize();
            const title = 'St. Edmund\'s Episcopal Church - Liturgical Schedule';
            const titleWidth = fontBold.widthOfTextAtSize(title, headingSize);
            page.drawText(title, {
                x: (width - titleWidth) / 2,
                y: height - pageMargin - headingSize,
                size: headingSize,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1)
            });
            const monthText = continued ? `${monthLabel} (continued)` : monthLabel;
            const monthWidth = fontRegular.widthOfTextAtSize(monthText, subheadingSize);
            page.drawText(monthText, {
                x: (width - monthWidth) / 2,
                y: height - pageMargin - headingSize - 16,
                size: subheadingSize,
                font: fontRegular,
                color: rgb(0.2, 0.2, 0.2)
            });
            return height - pageMargin - headingSize - 34;
        };

        const drawTableHeader = (page, topY, monthLabel) => {
            const { width } = page.getSize();
            const left = (width - tableWidth) / 2;
            const headerHeight = lineHeight + 8;
            page.drawRectangle({
                x: left,
                y: topY - headerHeight,
                width: tableWidth,
                height: headerHeight,
                color: rgb(0.86, 0.86, 0.86),
                borderWidth: 1,
                borderColor: rgb(0.1, 0.1, 0.1)
            });
            let cursorX = left;
            columns.forEach((col, index) => {
                if (index > 0) {
                    page.drawLine({
                        start: { x: cursorX, y: topY },
                        end: { x: cursorX, y: topY - headerHeight },
                        thickness: 1,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                }
                const label = index === 0 ? monthLabel.toUpperCase() : col.label;
                if (label) {
                    const textWidth = fontBold.widthOfTextAtSize(label, bodySize);
                    page.drawText(label, {
                        x: cursorX + (col.width - textWidth) / 2,
                        y: topY - headerHeight + 4,
                        size: bodySize,
                        font: fontBold,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                }
                cursorX += col.width;
            });
            return topY - headerHeight;
        };

        const drawFooter = (page) => {
            const { width } = page.getSize();
            const leftText = 'Lector 1: Reads Old Testament Lesson';
            const rightText = 'Lector 2: Reads Epistle';
            page.drawText(leftText, {
                x: pageMargin + 40,
                y: pageMargin - 8,
                size: 9,
                font: fontRegular,
                color: rgb(0.1, 0.1, 0.1)
            });
            const rightWidth = fontRegular.widthOfTextAtSize(rightText, 9);
            page.drawText(rightText, {
                x: width - pageMargin - 40 - rightWidth,
                y: pageMargin - 8,
                size: 9,
                font: fontRegular,
                color: rgb(0.1, 0.1, 0.1)
            });
        };

        const drawRow = (page, topY, cells, rowIndex) => {
            const { width } = page.getSize();
            const left = (width - tableWidth) / 2;
            const lineSets = columns.map((col) => wrapCellLines(cells[col.key] || '', fontRegular, bodySize, col.width - 8));
            const rowHeight = Math.max(...lineSets.map((lines) => lines.length)) * lineHeight + 6;
            let cursorX = left;
            const stripeFill = Math.floor(rowIndex / 2) % 2 === 0 ? rgb(0.92, 0.92, 0.92) : null;
            lineSets.forEach((lines, index) => {
                page.drawRectangle({
                    x: cursorX,
                    y: topY - rowHeight,
                    width: columns[index].width,
                    height: rowHeight,
                    color: stripeFill || undefined,
                    borderWidth: 1,
                    borderColor: rgb(0.1, 0.1, 0.1)
                });
                lines.forEach((line, lineIndex) => {
                    const color = columns[index].key === 'reading'
                        ? rgb(0.1, 0.1, 0.8)
                        : rgb(0.1, 0.1, 0.1);
                    page.drawText(line, {
                        x: cursorX + 4,
                        y: topY - 10.5 - lineIndex * lineHeight,
                        size: bodySize,
                        font: fontRegular,
                        color
                    });
                });
                cursorX += columns[index].width;
            });
            return rowHeight;
        };

        scheduleGroups.forEach(({ monthLabel, rows }) => {
            let page = doc.addPage([792, 612]);
            let cursorY = drawPageHeader(page, monthLabel);
            cursorY = drawTableHeader(page, cursorY, monthLabel);

            rows.forEach((row, index) => {
                const timeLabel = String(row.time || '')
                    .replace(/^0/, '')
                    .replace(':00', ':00 AM');
                const serviceLines = [
                    `Sunday, ${format(row.dateObj, 'MMMM d')}`,
                    timeLabel,
                    row.location ? `${row.feast} (${row.location})` : row.feast
                ].filter(Boolean);

                const cells = {
                    service: serviceLines.join('\n'),
                    lector: row.lector,
                    lem: row.lem,
                    acolyte: row.acolyte,
                    usher: row.usher,
                    sound: row.sound,
                    reading: row.reading
                };

                const rowHeight = Math.max(
                    ...columns.map((col) => wrapCellLines(cells[col.key] || '', fontRegular, bodySize, col.width - 8).length)
                ) * lineHeight + 6;
                if (cursorY - rowHeight < pageMargin + 28) {
                    drawFooter(page);
                    page = doc.addPage([792, 612]);
                    cursorY = drawPageHeader(page, monthLabel, true);
                    cursorY = drawTableHeader(page, cursorY, monthLabel);
                }
                const usedHeight = drawRow(page, cursorY, cells, index);
                cursorY -= usedHeight;
            });

            drawFooter(page);
        });

        const pdfBytes = await doc.save();
        const fileName = `liturgical-schedule-table-${months.join('-')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('X-Liturgical-Layout', 'table-v2');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Liturgical schedule months PDF error:', error);
        res.status(500).json({ error: 'Failed to build liturgical schedule PDF' });
    }
});

app.post('/api/liturgical-schedule/xlsx-months', async (req, res) => {
    try {
        const months = Array.isArray(req.body?.months) ? req.body.months : [];
        const scheduleGroups = buildScheduleForMonths(months);
        if (scheduleGroups.length === 0) {
            return res.status(400).json({ error: 'No schedule data for selected months' });
        }

        const dateSet = new Set();
        scheduleGroups.forEach((group) => {
            group.rows.forEach((row) => dateSet.add(row.date));
        });
        const dates = Array.from(dateSet);
        const readingsMap = new Map();
        if (dates.length > 0) {
            const placeholders = dates.map(() => '?').join(',');
            const rows = db.prepare(`SELECT date, readings FROM liturgical_days WHERE date IN (${placeholders})`).all(...dates);
            rows.forEach((row) => readingsMap.set(row.date, row.readings));
        }

        const sheetRows = [];
        scheduleGroups.forEach((group) => {
            group.rows.forEach((row) => {
                const readings = readingsMap.get(row.date) || '';
                const { oldTestament, newTestament } = getReadingPair(readings);
                sheetRows.push({
                    Month: group.monthLabel,
                    Date: format(row.dateObj, 'yyyy-MM-dd'),
                    Service: row.time || '10:00',
                    Feast: row.location ? `${row.feast} (${row.location})` : row.feast,
                    Lector: row.lector || '',
                    LEM: row.lem || '',
                    Acolytes: row.acolyte || '',
                    Ushers: row.usher || '',
                    'Sound/Stream': row.sound || '',
                    'Old Testament': oldTestament || '',
                    'New Testament': newTestament || ''
                });
            });
        });

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(sheetRows);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Liturgical Schedule');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const fileName = `liturgical-schedule-${months.join('-')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Liturgical schedule XLSX error:', error);
        res.status(500).json({ error: 'Failed to build liturgical schedule spreadsheet' });
    }
});

// --- Vestry Packet Builder ---

app.post('/api/vestry/packet', vestryUpload.any(), async (req, res) => {
    const files = req.files || [];
    const filesById = new Map(files.map((file) => [file.fieldname, file]));
    const convertedFiles = [];
    const convertedDirs = [];
    try {
        const order = JSON.parse(req.body?.order || '[]');
        const cached = JSON.parse(req.body?.cached || '[]');
        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ error: 'Packet order is required' });
        }

        const packetDoc = await PDFDocument.create();

        const cachedMap = new Map(
            Array.isArray(cached)
                ? cached.filter((item) => item?.id && item?.cacheId).map((item) => [item.id, item.cacheId])
                : []
        );
        const cacheEntries = await readVestryPacketCache();

        const ensurePdf = async ({ filePath, originalName = '', mimetype = '' }) => {
            const originalExt = extname(originalName).toLowerCase();
            const isPdf = originalExt === '.pdf' || mimetype === 'application/pdf';
            if (isPdf) return filePath;
            const outputDir = join(tmpdir(), `vestry-packet-convert-${randomUUID()}`);
            await mkdir(outputDir, { recursive: true });
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
                convertedDirs.push(outputDir);
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
            let fileDescriptor = null;
            if (file) {
                fileDescriptor = {
                    filePath: file.path,
                    originalName: file.originalname || '',
                    mimetype: file.mimetype || ''
                };
            } else {
                const cacheId = cachedMap.get(item.id);
                const entry = cacheId ? cacheEntries?.[item.id] : null;
                if (entry && entry.cacheId === cacheId && entry.path) {
                    try {
                        await access(entry.path);
                        fileDescriptor = {
                            filePath: entry.path,
                            originalName: entry.originalName || basename(entry.path),
                            mimetype: ''
                        };
                    } catch {
                        fileDescriptor = null;
                    }
                }
            }
            if (!fileDescriptor) {
                if (item.required) {
                    return res.status(400).json({ error: `Missing required document: ${item.label || item.id}` });
                }
                continue;
            }
            const pdfPath = await ensurePdf(fileDescriptor);
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
        await Promise.all(
            convertedDirs.map((dirPath) => rm(dirPath, { recursive: true, force: true }).catch(() => {}))
        );
    }
});

app.get('/api/vestry/packet/cache', async (req, res) => {
    try {
        const cache = await readVestryPacketCache();
        const items = Object.entries(cache || {}).map(([id, entry]) => ({
            id,
            cacheId: entry.cacheId,
            originalName: entry.originalName,
            updatedAt: entry.updatedAt || null
        }));
        res.json({ items });
    } catch (error) {
        console.error('Vestry packet cache list error:', error);
        res.status(500).json({ error: 'Failed to load cached files' });
    }
});

app.post('/api/vestry/packet/cache', vestryUpload.single('file'), async (req, res) => {
    const file = req.file;
    const itemId = String(req.body?.itemId || '').trim();
    if (!itemId || !file) {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => {});
        }
        return res.status(400).json({ error: 'itemId and file are required' });
    }
    const safeId = safePacketCacheId(itemId);
    if (!safeId) {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => {});
        }
        return res.status(400).json({ error: 'Invalid itemId' });
    }
    const cacheId = `${safeId}-${Date.now()}`;
    const originalName = file.originalname || 'document';
    const ext = extname(originalName) || extname(file.path) || '';
    const targetName = `${cacheId}${ext}`;
    const targetPath = join(VESTRY_PACKET_CACHE_DIR, targetName);
    try {
        await mkdir(VESTRY_PACKET_CACHE_DIR, { recursive: true });
        await copyFile(file.path, targetPath);
        const cache = await readVestryPacketCache();
        const existing = cache?.[itemId];
        await removeCachedPacketFile(existing);
        cache[itemId] = {
            cacheId,
            originalName,
            path: targetPath,
            updatedAt: new Date().toISOString()
        };
        await writeVestryPacketCache(cache);
        res.json({
            itemId,
            cacheId,
            originalName
        });
    } catch (error) {
        console.error('Vestry packet cache upload error:', error);
        res.status(500).json({ error: 'Failed to cache file' });
    } finally {
        if (file?.path) {
            await rm(file.path, { force: true }).catch(() => {});
        }
    }
});

app.delete('/api/vestry/packet/cache', async (req, res) => {
    try {
        const cache = await readVestryPacketCache();
        const entries = Object.values(cache || {});
        await Promise.all(entries.map((entry) => removeCachedPacketFile(entry)));
        await writeVestryPacketCache({});
        res.json({ success: true });
    } catch (error) {
        console.error('Vestry packet cache clear error:', error);
        res.status(500).json({ error: 'Failed to clear cached files' });
    }
});

app.post('/api/vestry/certificate', async (req, res) => {
    try {
        const { data, templatePath, outputName, outputDir } = await prepareVestryCertificate(req.body);
        await mkdir(outputDir, { recursive: true });
        const docBuffer = await renderDocxTemplate(templatePath, data);
        await writeFile(join(outputDir, outputName), docBuffer);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
        res.send(docBuffer);
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate error:', error);
        res.status(status).json({ error: error?.message || 'Failed to build certificate' });
    }
});

app.post('/api/vestry/certificate/preview', async (req, res) => {
    try {
        const { data, templatePath, outputName } = await prepareVestryCertificate(req.body);
        const docBuffer = await renderDocxTemplate(templatePath, data);
        const pngBase64 = await convertDocxBufferToPreviewBase64(docBuffer, outputName);
        res.json({
            filename: outputName,
            pngBase64
        });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate preview error:', error);
        res.status(status).json({ error: error?.message || 'Failed to build certificate preview' });
    }
});

app.post('/api/vestry/certificate/save', async (req, res) => {
    try {
        const { data, templatePath, outputName, outputDir } = await prepareVestryCertificate(req.body);
        await mkdir(outputDir, { recursive: true });
        const docBuffer = await renderDocxTemplate(templatePath, data);
        await writeFile(join(outputDir, outputName), docBuffer);
        res.json({ filename: outputName });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate save error:', error);
        res.status(status).json({ error: error?.message || 'Failed to save certificate' });
    }
});

app.post('/api/vestry/certificate/print', async (req, res) => {
    try {
        const { data, templatePath } = await prepareVestryCertificate(req.body);
        const docBuffer = await renderDocxTemplate(templatePath, data);
        await printDocxBuffer(docBuffer);
        res.json({ success: true });
    } catch (error) {
        const status = error?.status || 500;
        console.error('Vestry certificate print error:', error);
        res.status(status).json({ error: error?.message || 'Failed to print certificate' });
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

app.post('/api/people/backup-db', async (req, res) => {
    try {
        const token = await getDropboxAccessToken();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `church-db-${timestamp}.db`;
        const dropboxPath = `/Parish Administrator/Dashboard/${filename}`;
        const dbBuffer = await readFile(dbPath);
        const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify({
                    path: dropboxPath,
                    mode: 'add',
                    autorename: true,
                    mute: false
                })
            },
            body: dbBuffer
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Dropbox upload failed');
        }

        return res.json({ path: dropboxPath, name: filename });
    } catch (error) {
        console.error('Dropbox backup error:', error);
        return res.status(500).json({ error: error?.message || 'Failed to back up database' });
    }
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

const parseCurrencyOverride = (value) => {
    if (value == null) return null;
    const normalized = String(value).trim().replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatCurrencyValue = (value) => {
    const parsed = parseCurrencyOverride(value);
    if (!Number.isFinite(parsed)) return '';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(parsed);
};

const sumCurrencyValues = (...values) => {
    const total = values.reduce((acc, entry) => {
        const parsed = parseCurrencyOverride(entry);
        return Number.isFinite(parsed) ? acc + parsed : acc;
    }, 0);
    if (!Number.isFinite(total) || total === 0) return '';
    return formatCurrencyValue(total);
};

const getQuarterWord = (meetingDate) => {
    const previousMonth = (meetingDate.getMonth() + 11) % 12;
    const quarterIndex = Math.floor(previousMonth / 3);
    return ['first', 'second', 'third', 'fourth'][quarterIndex] || 'first';
};

const getQuarterMonthLabels = (meetingDate) => {
    const previousMonth = (meetingDate.getMonth() + 11) % 12;
    const quarterIndex = Math.floor(previousMonth / 3);
    const startMonthIndex = quarterIndex * 3;
    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ];
    return {
        start: monthNames[startMonthIndex],
        end: monthNames[startMonthIndex + 2]
    };
};

const findVestryClerkName = () => {
    if (!tableExists('people')) {
        return 'Anne Sirimane';
    }
    const rows = db.prepare('SELECT display_name, roles, tags FROM people ORDER BY display_name').all();
    const matches = rows.find((row) => {
        const roleTokens = normalizePersonRoles(row.roles).map((role) => normalizeToken(role));
        const tagTokens = parseJsonField(row.tags).map((tag) => normalizeToken(tag));
        const allTokens = [...roleTokens, ...tagTokens];
        return allTokens.some((token) => token === 'vestry clerk' || token === 'vestryclerk' || token === 'clerk');
    });
    return matches?.display_name || 'Anne Sirimane';
};

const resolveCertificateTemplatePath = (fundKey, isQuarterly) => {
    if (fundKey === 'fidelity') {
        return join(CERTIFICATE_TEMPLATE_DIR, 'CERTIFICATE FOR TRANSFER-- Fidelity template.docx');
    }
    if (!isQuarterly) return '';
    const fundLabel = fundKey === 'funda' ? 'Fund A' : 'Fund B';
    return join(CERTIFICATE_TEMPLATE_DIR, `CERTIFICATE FOR REIMBURSEMENT-- ${fundLabel} template QTR.docx`);
};

const resolveCertificateOutputDir = (fundKey, yearLabel) => {
    if (fundKey === 'fidelity') return FIDELITY_CERT_DIR;
    if (fundKey === 'funda') return FUND_A_CERT_DIR;
    return join(FUND_B_CERT_BASE_DIR, `Certificates Fund B ${yearLabel}`);
};

const renderDocxTemplate = async (templatePath, data) => {
    const content = await readFile(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '[[', end: ']]' },
        nullGetter: () => ''
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'nodebuffer' });
};

async function prepareVestryCertificate(payload) {
    const rawFund = String(payload?.fund || '').toLowerCase();
    const normalizedFund = rawFund.replace(/[^a-z]/g, '');
    if (!['funda', 'fundb', 'fidelity'].includes(normalizedFund)) {
        const error = new Error('Unknown fund selected.');
        error.status = 400;
        throw error;
    }

    const meetingDate = new Date(payload?.meetingDate || '');
    if (Number.isNaN(meetingDate.getTime())) {
        const error = new Error('A valid meeting date is required.');
        error.status = 400;
        throw error;
    }

    const isQuarterly = payload?.quarterly === true;
    if (!isQuarterly) {
        const error = new Error('Quarterly templates are not configured yet.');
        error.status = 400;
        throw error;
    }

    const amounts = payload?.amounts || {};
    const monthlyAmount = String(amounts?.monthly || '');
    const interestAmount = String(amounts?.interest || '');

    const templatePath = resolveCertificateTemplatePath(normalizedFund, isQuarterly);
    if (!templatePath) {
        const error = new Error('Certificate template is not available.');
        error.status = 400;
        throw error;
    }
    await access(templatePath);

    const coveredMonthDate = addMonths(meetingDate, -1);
    const monthLabel = format(coveredMonthDate, 'MMMM');
    const yearLabel = format(coveredMonthDate, 'yyyy');
    const meetingLabel = format(meetingDate, 'MMMM d, yyyy');
    const quarterWord = getQuarterWord(meetingDate);
    const quarterLabels = getQuarterMonthLabels(meetingDate);
    const clerkName = findVestryClerkName();

    const totalValue = normalizedFund === 'fidelity'
        ? sumCurrencyValues(interestAmount)
        : sumCurrencyValues(monthlyAmount, interestAmount);

    const data = {
        MTG_DATE: meetingLabel,
        AMT_TOTAL: totalValue,
        AMT: totalValue,
        AMT_JL: normalizedFund === 'fundb' ? formatCurrencyValue(monthlyAmount) : '',
        AMT_INT: formatCurrencyValue(interestAmount),
        AMT_AR: normalizedFund === 'funda' ? formatCurrencyValue(monthlyAmount) : '',
        MONTH: monthLabel,
        YEAR: yearLabel,
        QUARTER: quarterWord,
        QTR_START: quarterLabels.start,
        QTR_END: quarterLabels.end,
        CLERK: clerkName,
        CLERK_NAME: clerkName
    };

    const outputPrefix = normalizedFund === 'fidelity'
        ? 'CERTIFICATE FOR TRANSFER--'
        : 'CERTIFICATE FOR REIMBURSEMENT--';
    const outputName = `${outputPrefix}${monthLabel} ${yearLabel}.docx`;
    const outputDir = resolveCertificateOutputDir(normalizedFund, yearLabel);

    return {
        data,
        templatePath,
        outputName,
        outputDir
    };
}

async function convertDocxBufferToPreviewBase64(docBuffer, outputName) {
    const baseName = sanitizeFileName(basename(outputName || 'certificate', extname(outputName || ''))) || 'certificate';
    const outputDir = join(tmpdir(), `vestry-certificate-preview-${randomUUID()}`);
    const docxPath = join(outputDir, `${baseName}.docx`);
    await mkdir(outputDir, { recursive: true });
    try {
        await writeFile(docxPath, docBuffer);
        const previewDataUrl = await buildDocumentPreview(docxPath);
        if (!previewDataUrl) {
            throw new Error('Preview image could not be generated.');
        }
        const match = previewDataUrl.match(/^data:image\/png;base64,(.+)$/i);
        if (!match) {
            throw new Error('Preview image could not be generated.');
        }
        return match[1];
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function getDefaultPrinterName() {
    const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name"
    ], { windowsHide: true });
    const name = String(stdout || '')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
    if (!name) {
        throw new Error('Default printer not found.');
    }
    return name;
}

const resolveSumatraPdfPath = async () => {
    const override = String(process.env.SUMATRA_PDF_PATH || '').trim();
    const candidates = [
        override,
        'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
        'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try next candidate.
        }
    }
    return null;
};

async function printDocxBuffer(docBuffer) {
    const scriptPath = resolve(__dirname, '..', 'Print-WordToPrinter.ps1');
    await access(scriptPath);
    const printerName = await getDefaultPrinterName();
    const outputDir = join(tmpdir(), `vestry-certificate-print-${randomUUID()}`);
    const docxPath = join(outputDir, 'vestry-certificate.docx');
    await mkdir(outputDir, { recursive: true });
    try {
        await writeFile(docxPath, docBuffer);
        await execFileAsync('powershell', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-DocPath',
            docxPath,
            '-PrinterName',
            printerName
        ], { windowsHide: true });
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
}

const sanitizeFileName = (value) => String(value || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();

const ensureDepositOutputDir = async () => {
    await mkdir(DEPOSIT_OUTPUT_DIR, { recursive: true });
    return DEPOSIT_OUTPUT_DIR;
};

const sanitizeDepositFileId = (value) => String(value || '')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 64);

const buildDepositFilePath = (fileId) => {
    const safeId = sanitizeDepositFileId(fileId);
    if (!safeId) return null;
    return join(DEPOSIT_OUTPUT_DIR, `${safeId}.pdf`);
};

const saveDepositPdf = async (pdfBuffer) => {
    await ensureDepositOutputDir();
    const fileId = randomUUID();
    const filePath = buildDepositFilePath(fileId);
    await writeFile(filePath, pdfBuffer);
    return { fileId, filePath };
};

const safePacketCacheId = (value) => String(value || '')
    .replace(/[^a-z0-9-_]/gi, '')
    .slice(0, 80);

async function readVestryPacketCache() {
    try {
        const raw = await readFile(VESTRY_PACKET_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function writeVestryPacketCache(cache) {
    await mkdir(VESTRY_PACKET_CACHE_DIR, { recursive: true });
    await writeFile(VESTRY_PACKET_CACHE_FILE, JSON.stringify(cache || {}, null, 2));
}

async function removeCachedPacketFile(entry) {
    if (!entry?.path) return;
    await rm(entry.path, { force: true }).catch(() => {});
}

const resolveContractFile = async (contractsDir, vendorName, contractField) => {
    const baseRaw = contractField || vendorName || '';
    const baseName = sanitizeFileName(baseRaw);
    if (!baseName) return { path: '', exists: false };
    const ext = extname(baseName);
    const extensions = ext ? [''] : ['.pdf', '.docx', '.doc', '.rtf'];
    const candidates = ext ? [baseName] : extensions.map((suffix) => `${baseName}${suffix}`);
    for (const candidate of candidates) {
        const fullPath = join(contractsDir, candidate);
        try {
            await access(fullPath);
            return { path: fullPath, exists: true };
        } catch {
            // keep searching
        }
    }
    return { path: join(contractsDir, candidates[0]), exists: false };
};

const parseJsonValue = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
};

const buildManualChecks = (payload, maxChecks) => {
    const manualChecks = [];
    let cashTotal = 0;
    (Array.isArray(payload) ? payload : []).forEach((entry) => {
        if (!entry) return;
        const checkNumber = String(entry.checkNumber || '').trim();
        const rawAmount = String(entry.amount || '').trim().replace(/[^0-9.-]/g, '');
        const amount = Number.parseFloat(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        if (checkNumber && manualChecks.length < maxChecks) {
            manualChecks.push({ checkNumber, amount });
        } else {
            cashTotal += amount;
        }
    });
    return { manualChecks, cashTotal };
};

const normalizeFundsReportEntries = (value) => {
    const entries = Array.isArray(value) ? value : parseJsonValue(value, []);
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => {
            const code = String(entry?.code || '').trim();
            const amount = parseCurrencyOverride(entry?.amount);
            if (!code || amount == null) return null;
            return { code, amount };
        })
        .filter(Boolean)
        .sort((a, b) => a.code.localeCompare(b.code));
};

app.post('/api/deposit-slip/manual', async (req, res) => {
    let outputDir = null;
    try {
        const configPath = resolve(__dirname, 'depositSlipConfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const templatePath = resolve(__dirname, '..', config.templatePath || 'deposit slip template.pdf');

        const maxChecks = Array.isArray(config.fieldMap?.checks)
            ? config.fieldMap.checks.length
            : 18;
        const { manualChecks, cashTotal } = buildManualChecks(req.body?.checks || [], maxChecks);

        const clientTotals = parseJsonValue(req.body?.totals, {}) || {};
        const subtotalOverride = parseCurrencyOverride(clientTotals.subtotal);
        const totalOverride = parseCurrencyOverride(clientTotals.total);
        const subtotalValue = subtotalOverride != null
            ? subtotalOverride
            : manualChecks.reduce((sum, check) => sum + (Number.isFinite(check.amount) ? check.amount : 0), 0);
        const totalValue = totalOverride != null ? totalOverride : subtotalValue + cashTotal;

        const fundsReportEntries = normalizeFundsReportEntries(req.body?.fundsReport?.entries);
        const depositChecks = manualChecks;

        outputDir = join(tmpdir(), `deposit-slip-${Date.now()}`);
        const outputPath = join(outputDir, 'deposit-slip.pdf');

        await buildDepositSlipPdf({
            templatePath,
            outputPath,
            checks: depositChecks,
            fieldMap: config.fieldMap || {},
            totals: {
                cash: cashTotal,
                subtotal: subtotalValue,
                total: totalValue
            },
            fundsReport: {
                entries: fundsReportEntries,
                total: totalValue
            }
        });

        const pdfBytes = await readFile(outputPath);
        const saved = await saveDepositPdf(pdfBytes);
        res.json({
            fileId: saved.fileId,
            cashTotal: Number.isFinite(cashTotal) ? cashTotal : 0
        });
    } catch (error) {
        console.error('Manual deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build manual deposit slip' });
        }
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => {});
        }
    }
});

app.post('/api/deposit-slip/print-base64', async (req, res) => {
    let outputDir = null;
    try {
        console.log('Deposit slip print request received');
        const rawBase64 = String(req.body?.pdfBase64 || '').trim();
        if (!rawBase64) {
            return res.status(400).json({ error: 'pdfBase64 is required' });
        }
        const normalized = rawBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        const pdfBuffer = Buffer.from(normalized, 'base64');
        outputDir = join(tmpdir(), `deposit-slip-print-${randomUUID()}`);
        await mkdir(outputDir, { recursive: true });
        const pdfPath = join(outputDir, 'deposit-slip.pdf');
        await writeFile(pdfPath, pdfBuffer);
        const escaped = pdfPath.replace(/'/g, "''");
        const preferredPrinter = String(process.env.DEPOSIT_PRINTER_NAME || '').trim();
        const printerName = preferredPrinter || await getDefaultPrinterName().catch(() => null);
        const escapedPrinter = printerName ? printerName.replace(/'/g, "''") : '';
        const sumatraPath = await resolveSumatraPdfPath();
        if (sumatraPath) {
            const sumatraArgs = printerName
                ? ['-silent', '-print-to', printerName, '-exit-on-print', pdfPath]
                : ['-silent', '-print-to-default', '-exit-on-print', pdfPath];
            await execFileAsync(sumatraPath, sumatraArgs, { windowsHide: true });
            console.log('Deposit slip print dispatched', { printer: printerName || null, method: 'sumatra' });
            return res.json({ success: true, printer: printerName || null, method: 'sumatra' });
        }
        const script = [
            `$path = '${escaped}'`,
            printerName ? `$printer = '${escapedPrinter}'` : `$printer = $null`,
            `$printed = $false`,
            `if ($printer) {`,
            `  try { Start-Process -FilePath $path -Verb PrintTo -ArgumentList $printer; $printed = $true } catch { }`,
            `}`,
            `if (-not $printed) { Start-Process -FilePath $path -Verb Print }`
        ].join('; ');
        const { stdout, stderr } = await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            script
        ], { windowsHide: true });
        console.log('Deposit slip print dispatched', { printer: printerName || null, method: 'shell' });
        if (stdout) console.log('Deposit slip print stdout:', stdout.trim());
        if (stderr) console.log('Deposit slip print stderr:', stderr.trim());
        res.json({ success: true, printer: printerName || null, method: 'shell' });
    } catch (error) {
        console.error('Deposit slip print error:', error);
        if (error?.stdout) console.error('Deposit slip print stdout:', String(error.stdout).trim());
        if (error?.stderr) console.error('Deposit slip print stderr:', String(error.stderr).trim());
        res.status(500).json({ error: 'Failed to print deposit slip' });
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => {});
        }
    }
});

app.post('/api/sunday/insert-status', async (req, res) => {
    try {
        const date = String(req.body?.date || '').trim();
        const status = String(req.body?.status || '').trim();
        if (!date || !status) {
            return res.status(400).json({ error: 'date and status are required' });
        }
        const normalized = normalizeBulletinStatusValue(status);
        if (!normalized) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        upsertBulletinStatus(date, 'insert', normalized, 'publisher');
        console.log('Insert status updated', { date, status: normalized, source: 'publisher' });
        res.json({ success: true, status: normalized });
    } catch (error) {
        console.error('Insert status update failed:', error);
        res.status(500).json({ error: 'Failed to update insert status' });
    }
});

app.get('/api/deposit-slip/file/:id', async (req, res) => {
    const filePath = buildDepositFilePath(req.params.id);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid file id' });
    }
    try {
        await access(filePath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="deposit-slip-${req.params.id}.pdf"`);
        return res.sendFile(filePath);
    } catch {
        return res.status(404).json({ error: 'Deposit file not found' });
    }
});

app.delete('/api/deposit-slip/file/:id', async (req, res) => {
    const filePath = buildDepositFilePath(req.params.id);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid file id' });
    }
    try {
        await rm(filePath, { force: true });
        return res.json({ success: true });
    } catch (error) {
        console.error('Deposit slip delete error:', error);
        return res.status(500).json({ error: 'Failed to delete deposit file' });
    }
});

app.post('/api/deposit-slip/print-file', async (req, res) => {
    try {
        const fileId = String(req.body?.fileId || '').trim();
        const filePath = buildDepositFilePath(fileId);
        if (!filePath) {
            return res.status(400).json({ error: 'fileId is required' });
        }
        await access(filePath);
        const escaped = filePath.replace(/'/g, "''");
        const preferredPrinter = String(process.env.DEPOSIT_PRINTER_NAME || '').trim();
        const printerName = preferredPrinter || await getDefaultPrinterName().catch(() => null);
        const sumatraPath = await resolveSumatraPdfPath();
        if (sumatraPath) {
            const sumatraArgs = printerName
                ? ['-silent', '-print-to', printerName, '-exit-on-print', filePath]
                : ['-silent', '-print-to-default', '-exit-on-print', filePath];
            await execFileAsync(sumatraPath, sumatraArgs, { windowsHide: true });
            console.log('Deposit slip print dispatched', { printer: printerName || null, method: 'sumatra' });
            return res.json({ success: true, printer: printerName || null, method: 'sumatra' });
        }
        const escapedPrinter = printerName ? printerName.replace(/'/g, "''") : '';
        const script = [
            `$path = '${escaped}'`,
            printerName ? `$printer = '${escapedPrinter}'` : `$printer = $null`,
            `$printed = $false`,
            `if ($printer) {`,
            `  try { Start-Process -FilePath $path -Verb PrintTo -ArgumentList $printer; $printed = $true } catch { }`,
            `}`,
            `if (-not $printed) { Start-Process -FilePath $path -Verb Print }`
        ].join('; ');
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            script
        ], { windowsHide: true });
        console.log('Deposit slip print dispatched', { printer: printerName || null, method: 'shell' });
        return res.json({ success: true, printer: printerName || null, method: 'shell' });
    } catch (error) {
        console.error('Deposit slip print error:', error);
        if (error?.stdout) console.error('Deposit slip print stdout:', String(error.stdout).trim());
        if (error?.stderr) console.error('Deposit slip print stderr:', String(error.stderr).trim());
        return res.status(500).json({ error: 'Failed to print deposit slip' });
    }
});

const insertHgkSupplyItems = (requestId, items, now) => {
    const insert = sqlite.prepare(`
        INSERT INTO hgk_supply_items (
            id, request_id, item_name, quantity, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach((entry) => {
        const itemName = String(entry.item_name || entry.name || '').trim();
        if (!itemName) return;
        insert.run(
            randomUUID(),
            requestId,
            itemName,
            entry.quantity != null ? String(entry.quantity).trim() : '',
            entry.notes != null ? String(entry.notes).trim() : '',
            entry.status || 'needed',
            now,
            now
        );
    });
};

app.get('/api/hgk/items', (req, res) => {
    res.json(HGK_SUPPLY_ITEMS);
});

app.get('/api/hgk/supplies', (req, res) => {
    const monthKey = formatMonthKey(req.query.month);
    const request = sqlite.prepare('SELECT * FROM hgk_supply_requests WHERE month = ?').get(monthKey);
    const items = request
        ? sqlite.prepare('SELECT * FROM hgk_supply_items WHERE request_id = ? ORDER BY item_name').all(request.id)
        : [];
    res.json({
        month: monthKey,
        request: request || null,
        items
    });
});

app.post('/api/hgk/supplies', (req, res) => {
    try {
        const monthKey = formatMonthKey(req.body?.month);
        const notes = String(req.body?.notes || '').trim();
        const incomingItems = Array.isArray(req.body?.items) && req.body.items.length > 0
            ? req.body.items
            : HGK_SUPPLY_ITEMS.map((name) => ({ item_name: name }));
        const result = upsertHgkSupplyRequest(monthKey, notes, incomingItems);
        res.json(result);
    } catch (error) {
        console.error('Save HGK supplies error:', error);
        res.status(500).json({ error: 'Failed to persist HGK supplies' });
    }
});

app.post('/api/hgk/gmail-search', requireAuth, async (req, res) => {
    try {
        const tokens = getUserTokens(req.user.id);
        if (!tokens) {
            return res.status(401).json({ error: 'Not connected to Google' });
        }
        const client = createOAuthClient();
        setStoredCredentials(client, tokens);
        const gmail = google.gmail({ version: 'v1', auth: client });
        const query = 'subject:supplies (HGK OR "Holy Ghost Kitchen")';
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5
        });
        const messageId = listResponse.data.messages?.[0]?.id;
        if (!messageId) {
            return res.json({ message: null, items: [] });
        }
        const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });
        const payload = messageResponse.data.payload;
        const headers = Array.isArray(payload?.headers) ? payload.headers : [];
        const subject = headers.find((header) => header.name?.toLowerCase() === 'subject')?.value || '';
        const date = headers.find((header) => header.name?.toLowerCase() === 'date')?.value || '';
        const bodyText = extractGmailMessageText(messageResponse.data) || messageResponse.data.snippet || '';
        const parsedItems = parseSupplyEmail(bodyText);
        res.json({
            message: { id: messageId, subject, date },
            items: parsedItems
        });
    } catch (error) {
        console.error('HGK Gmail search error:', error);
        res.status(500).json({ error: 'Failed to search Gmail' });
    }
});

app.post('/api/hgk/email/webhook', (req, res) => {
    try {
        if (HGK_WEBHOOK_TOKEN) {
            const incomingToken = String(req.headers['x-hgk-webhook-token'] || '').trim();
            if (!incomingToken || incomingToken !== HGK_WEBHOOK_TOKEN) {
                return res.status(403).json({ error: 'Invalid webhook token' });
            }
        }
        const emailText = String(req.body?.text || '').trim();
        if (!emailText) {
            return res.status(400).json({ error: 'Email body text is required' });
        }
        const monthKey = formatMonthKey(req.body?.month);
        const notes = String(req.body?.notes || req.body?.subject || '').trim();
        const parsedItems = parseSupplyEmail(emailText);
        const result = upsertHgkSupplyRequest(monthKey, notes, parsedItems);
        res.json({
            ...result,
            parsed: parsedItems
        });
    } catch (error) {
        console.error('HGK email webhook error:', error);
        res.status(500).json({ error: 'Failed to process HGK email' });
    }
});

app.post('/api/hgk/email', (req, res) => {
    const text = String(req.body?.text || '');
    const monthKey = formatMonthKey(req.body?.month);
    const parsedItems = parseSupplyEmail(text);
    res.json({
        month: monthKey,
        items: parsedItems
    });
});

app.post('/api/hgk/instacart', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const title = String(req.body?.title || 'HGK Supplies').trim() || 'HGK Supplies';
        if (items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }
        const lines = items
            .map((item) => {
                const name = String(item?.name || '').trim();
                const display = String(item?.display || '').trim();
                if (!name || !display) return null;
                return `${name}: ${display}`;
            })
            .filter(Boolean);
        if (lines.length === 0) {
            return res.status(400).json({ error: 'No valid items provided' });
        }

        const listText = lines.join('\r\n');
        const listTextBase64 = Buffer.from(listText, 'utf8').toString('base64');
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("gdi32.dll", SetLastError=true)]
    public static extern IntPtr CreateRoundRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidthEllipse, int nHeightEllipse);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);
}
public struct MARGINS {
    public int cxLeftWidth;
    public int cxRightWidth;
    public int cyTopHeight;
    public int cyBottomHeight;
}
public class Dwm {
    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMargins);
}
"@

$rawList = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${listTextBase64}'))

$shadow = New-Object System.Windows.Forms.Form
$shadow.FormBorderStyle = 'None'
$shadow.ShowInTaskbar = $false
$shadow.StartPosition = 'Manual'
$shadow.BackColor = [System.Drawing.Color]::Black
$shadow.Opacity = 0.18
$shadow.TopMost = $true
$shadow.Size = New-Object System.Drawing.Size(374, 454)
$shadow.Location = New-Object System.Drawing.Point([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Right - 377, 47)

$form = New-Object System.Windows.Forms.Form
$form.Text = '${escapePsString(title)}'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::White
$form.Size = New-Object System.Drawing.Size(360, 440)
$form.Location = New-Object System.Drawing.Point([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Right - 370, 40)

$form.Add_Shown({
    $radius = 20
    $rgn = [Win32]::CreateRoundRectRgn(0, 0, $form.Width + 1, $form.Height + 1, $radius, $radius)
    [Win32]::SetWindowRgn($form.Handle, $rgn, $true) | Out-Null
    $margins = New-Object MARGINS
    $margins.cxLeftWidth = -1
    $margins.cxRightWidth = -1
    $margins.cyTopHeight = -1
    $margins.cyBottomHeight = -1
    [Dwm]::DwmExtendFrameIntoClientArea($form.Handle, [ref]$margins) | Out-Null
})

$syncShadow = {
    $shadow.Location = New-Object System.Drawing.Point($form.Location.X - 7, $form.Location.Y - 7)
    $shadow.Size = New-Object System.Drawing.Size($form.Width + 14, $form.Height + 14)
}

$form.Add_LocationChanged({ & $syncShadow })
$form.Add_SizeChanged({ & $syncShadow })
$form.Add_Shown({ & $syncShadow })
$form.Add_FormClosed({ $shadow.Close() })

$shell = New-Object System.Windows.Forms.Panel
$shell.Dock = 'Fill'
$shell.Padding = New-Object System.Windows.Forms.Padding(16, 14, 16, 12)
$shell.BackColor = [System.Drawing.Color]::White
$shell.BorderStyle = 'FixedSingle'

$title = New-Object System.Windows.Forms.Label
$title.Text = '${escapePsString(title)}'
$title.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
$title.Dock = 'Top'
$title.Height = 32
$title.Padding = New-Object System.Windows.Forms.Padding(0, 0, 0, 0)
$title.TextAlign = 'MiddleLeft'

$divider = New-Object System.Windows.Forms.Panel
$divider.Dock = 'Top'
$divider.Height = 1
$divider.BackColor = [System.Drawing.Color]::FromArgb(226, 232, 240)

$listPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$listPanel.Dock = 'Fill'
$listPanel.FlowDirection = 'TopDown'
$listPanel.WrapContents = $false
$listPanel.AutoScroll = $true
$listPanel.Padding = New-Object System.Windows.Forms.Padding(0, 8, 0, 8)

$lines = $rawList -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 }

foreach ($line in $lines) {
    $row = New-Object System.Windows.Forms.Panel
    $row.Height = 30
    $row.Width = 300
    $row.Margin = New-Object System.Windows.Forms.Padding(0, 2, 0, 2)

    $check = New-Object System.Windows.Forms.CheckBox
    $check.Width = 22
    $check.Height = 22
    $check.Location = New-Object System.Drawing.Point(0, 3)
    $check.FlatStyle = 'Flat'
    $check.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
    $check.FlatAppearance.CheckedBackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
    $check.BackColor = [System.Drawing.Color]::White

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $line
    $label.AutoSize = $false
    $label.Location = New-Object System.Drawing.Point(28, 0)
    $label.Size = New-Object System.Drawing.Size(260, 30)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $label.TextAlign = 'MiddleLeft'

    $row.Controls.Add($check)
    $row.Controls.Add($label)
    $listPanel.Controls.Add($row)
}

$close = New-Object System.Windows.Forms.Button
$close.Text = 'Close'
$close.Dock = 'Bottom'
$close.Height = 32
$close.FlatStyle = 'Flat'
$close.BackColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$close.ForeColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$close.FlatAppearance.BorderSize = 0
$close.Add_Click({ $form.Close() })

$shell.Controls.Add($listPanel)
$shell.Controls.Add($divider)
$shell.Controls.Add($title)
$form.Controls.Add($shell)
$form.Controls.Add($close)

Start-Process '${escapePsString(HGK_INSTACART_LIST_URL)}'

[void]$shadow.Show()
[System.Windows.Forms.Application]::Run($form)
`;

        const scriptPath = resolve(tmpdir(), `hgk-instacart-${randomUUID()}.ps1`);
        await writeFile(scriptPath, script, 'utf8');
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true }, () => {
            rm(scriptPath, { force: true }).catch(() => {});
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('HGK Instacart overlay error:', error);
        res.status(500).json({ error: 'Failed to open Instacart list' });
    }
});

app.post('/api/deposit-slip/pdf', depositBundleUpload.fields([
    { name: 'checksPdf', maxCount: 1 },
    { name: 'cashPdf', maxCount: 1 }
]), async (req, res) => {
    let checksPath = null;
    let cashPath = null;
    try {
        const checksFile = req.files?.checksPdf?.[0] || null;
        const cashFile = req.files?.cashPdf?.[0] || null;
        if (!checksFile) {
            return res.status(400).json({ error: 'Checks PDF is required' });
        }
        const slipFileId = String(req.body?.slipFileId || '').trim();
        const slipPath = buildDepositFilePath(slipFileId);
        if (!slipPath) {
            return res.status(400).json({ error: 'Deposit slip file is required' });
        }
        try {
            await access(slipPath);
        } catch {
            return res.status(404).json({ error: 'Deposit slip file not found' });
        }
        checksPath = checksFile.path;
        cashPath = cashFile?.path || null;

        const depositBytes = await readFile(slipPath);
        const depositDoc = await PDFDocument.load(depositBytes);
        const depositForm = depositDoc.getForm();
        depositForm.flatten();
        const finalDoc = await PDFDocument.create();
        const [depositPage] = await finalDoc.copyPages(depositDoc, [0]);
        finalDoc.addPage(depositPage);

        if (cashPath) {
            const cashBytes = await readFile(cashPath);
            const cashDoc = await PDFDocument.load(cashBytes);
            if (cashDoc.getPageCount() > 0) {
                const [cashPage] = await finalDoc.copyPages(cashDoc, [0]);
                finalDoc.addPage(cashPage);
            }
        }

        const checksBytes = await readFile(checksPath);
        const checksDoc = await PDFDocument.load(checksBytes);
        await addChecksGridFromPdf(finalDoc, checksDoc, {
            pageWidth: depositPage.getWidth(),
            pageHeight: depositPage.getHeight()
        });

        const finalBytes = await finalDoc.save();
        const finalBuffer = Buffer.from(finalBytes);
        const saved = await saveDepositPdf(finalBuffer);
        res.json({ fileId: saved.fileId });
    } catch (error) {
        console.error('PDF deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build deposit packet' });
        }
    } finally {
        if (checksPath) {
            await rm(checksPath, { force: true }).catch(() => {});
        }
        if (cashPath) {
            await rm(cashPath, { force: true }).catch(() => {});
        }
    }
});

const addChecksGridFromPdf = async (pdfDoc, checksDoc, options = {}) => {
    const {
        pageWidth = 612,
        pageHeight = 792,
        margin = 36,
        columns = 2,
        rows = 3,
        colGap = 12,
        rowGap = 12
    } = options;
    if (!checksDoc) return;
    const pages = checksDoc.getPages();
    if (!pages.length) return;
    const perPage = columns * rows;
    const cellWidth = (pageWidth - margin * 2 - colGap * (columns - 1)) / columns;
    const cellHeight = (pageHeight - margin * 2 - rowGap * (rows - 1)) / rows;
    let pageIndex = 0;
    while (pageIndex < pages.length) {
        const gridPage = pdfDoc.addPage([pageWidth, pageHeight]);
        for (let slot = 0; slot < perPage && pageIndex < pages.length; slot += 1) {
            const column = slot % columns;
            const row = Math.floor(slot / columns);
            const targetX = margin + column * (cellWidth + colGap);
            const targetYTop = pageHeight - margin - row * (cellHeight + rowGap);
            const sourcePage = pages[pageIndex];
            const embedded = await pdfDoc.embedPage(sourcePage);
            const baseRotation = ((sourcePage.getRotation()?.angle || 0) % 360 + 360) % 360;
            const baseIsRotated = baseRotation === 90 || baseRotation === 270;
            const baseDisplayWidth = baseIsRotated ? embedded.height : embedded.width;
            const baseDisplayHeight = baseIsRotated ? embedded.width : embedded.height;
            const isPortrait = baseDisplayHeight > baseDisplayWidth;
            const rotation = (baseRotation + (isPortrait ? 180 : 0)) % 360;
            const isRotated = rotation === 90 || rotation === 270;
            const displayWidth = isRotated ? embedded.height : embedded.width;
            const displayHeight = isRotated ? embedded.width : embedded.height;
            const scale = Math.min(cellWidth / displayWidth, cellHeight / displayHeight, 1);
            const drawWidth = embedded.width * scale;
            const drawHeight = embedded.height * scale;
            const scaledDisplayWidth = displayWidth * scale;
            const scaledDisplayHeight = displayHeight * scale;
            const offsetX = targetX + (cellWidth - scaledDisplayWidth) / 2;
            const offsetY = targetYTop - scaledDisplayHeight - (cellHeight - scaledDisplayHeight) / 2;
            let drawX = offsetX;
            let drawY = offsetY;
            if (rotation === 90) {
                drawX = offsetX + scaledDisplayWidth;
            } else if (rotation === 180) {
                drawX = offsetX + scaledDisplayWidth;
                drawY = offsetY + scaledDisplayHeight;
            } else if (rotation === 270) {
                drawY = offsetY + scaledDisplayHeight;
            }
            gridPage.drawPage(embedded, {
                x: drawX,
                y: drawY,
                width: drawWidth,
                height: drawHeight,
                rotate: rotation ? degrees(rotation) : undefined
            });
            pageIndex += 1;
        }
    }
};

const addCheckGridPages = async (pdfDoc, checks, options = {}) => {
    const {
        pageWidth = 612,
        pageHeight = 792,
        margin = 36,
        columns = 2,
        rows = 3,
        colGap = 12,
        rowGap = 12
    } = options;
    const perPage = columns * rows;
    if (!checks || checks.length === 0) return;
    let page = null;
    let drawn = 0;
    for (let index = 0; index < checks.length; index += 1) {
        const entry = checks[index];
        const base64 = entry?.alignedPreviewBase64;
        let imageBytes = null;
        if (base64) {
            imageBytes = Buffer.from(base64, 'base64');
        } else if (entry?.imagePath) {
            try {
                imageBytes = await readFile(entry.imagePath);
            } catch {
                imageBytes = null;
            }
        }
        if (!imageBytes) continue;
        if (drawn % perPage === 0) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
        }
        const position = drawn % perPage;
        const column = position % columns;
        const row = Math.floor(position / columns);
        const cellWidth = (pageWidth - margin * 2 - colGap * (columns - 1)) / columns;
        const cellHeight = (pageHeight - margin * 2 - rowGap * (rows - 1)) / rows;
        const targetX = margin + column * (cellWidth + colGap);
        const targetYTop = pageHeight - margin - row * (cellHeight + rowGap);
        const image = await pdfDoc.embedPng(imageBytes);
        const scaled = image.scale(Math.min(cellWidth / image.width, cellHeight / image.height, 1));
        const offsetX = targetX + (cellWidth - scaled.width) / 2;
        const offsetY = targetYTop - scaled.height;
        page.drawImage(image, {
            x: offsetX,
            y: offsetY,
            width: scaled.width,
            height: scaled.height
        });
        drawn += 1;
    }
};

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
