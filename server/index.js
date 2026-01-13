import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { access, copyFile, mkdir, readFile, readdir, rm, stat } from 'fs/promises';
import { join, dirname, resolve, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
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
import { buildDepositSlipPdf, convertPdfToImages, extractChecksFromImages } from './depositSlip.js';

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
    'Chips',
    'Granola Bars',
    'Oranges',
    'Rice Krispie Treats',
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
        SELECT id FROM event_occurrences
        WHERE event_id = 'hgk-volunteer' AND date = ?
        LIMIT 1
    `).get(dateKey);
    return row?.id || null;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseSupplyEmail = (emailText) => {
    const normalized = String(emailText || '').toLowerCase();
    const entries = [];
    HGK_SUPPLY_ITEMS.forEach((item) => {
        const lowered = item.toLowerCase();
        const forwardPattern = new RegExp(`(\\d+)\\s+${escapeRegex(lowered)}`);
        const reversePattern = new RegExp(`${escapeRegex(lowered)}\\s+(\\d+)`);
        let quantity = '';
        const forwardMatch = normalized.match(forwardPattern);
        if (forwardMatch) {
            quantity = forwardMatch[1];
        } else {
            const reverseMatch = normalized.match(reversePattern);
            if (reverseMatch) {
                quantity = reverseMatch[1];
            }
        }
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

const app = express();
const PORT = 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const upload = multer({ dest: join(tmpdir(), 'deposit-slip-uploads') });
const pdfUpload = multer({ dest: join(tmpdir(), 'deposit-slip-pdf-uploads') });
const vestryUpload = multer({ dest: join(tmpdir(), 'vestry-packet-uploads') });

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

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

const buildDocumentPreview = async (filePath) => {
    const cacheRoot = join(tmpdir(), 'preview-cache');
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
        try {
            await access(cachedPreview);
            const cachedData = await readFile(cachedPreview);
            return `data:image/png;base64,${cachedData.toString('base64')}`;
        } catch {
            // Cache miss, generate preview.
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

const buildDocumentStatus = async (filePath) => {
    if (!filePath) {
        return { exists: false, preview: '', path: '', name: '' };
    }
    try {
        await access(filePath);
    } catch {
        return { exists: false, preview: '', path: filePath, name: basename(filePath) };
    }
    const preview = await buildDocumentPreview(filePath);
    return {
        exists: true,
        preview,
        path: filePath,
        name: basename(filePath)
    };
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
        const bulletin10Path = await findBulletinFile(date, '10am');
        const bulletin8Path = await findBulletinFile(date, '8am');
        const year = date.slice(0, 4);
        const insertPath = join(
            DROPBOX_ROOT,
            DROPBOX_INSERTS_DIR,
            year,
            `${date} Insert.pub`
        );
        const [bulletin10, bulletin8, insert] = await Promise.all([
            buildDocumentStatus(bulletin10Path),
            buildDocumentStatus(bulletin8Path),
            buildDocumentStatus(insertPath)
        ]);
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

app.post('/api/files/print', async (req, res) => {
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
        await access(resolvedPath);
        const escaped = resolvedPath.replace(/'/g, "''");
        await execFileAsync('powershell', [
            '-NoProfile',
            '-Command',
            `Start-Process -FilePath '${escaped}' -Verb Print`
        ], { windowsHide: true });
        res.json({ success: true });
    } catch (error) {
        console.error('Print failed:', error);
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

        const listId = await findCcListId(tokens, 'Active Members');
        if (!listId) {
            return res.status(404).json({ error: 'Active Members list not found' });
        }

        const template = testEmpty ? '' : await loadEmailTemplate();
        const html = testEmpty
            ? '<html><body></body></html>'
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

        const baseActivity = {
            format_type: 'HTML',
            from_email: fromEmail,
            from_name: fromName,
            reply_to_email: replyTo,
            subject: 'Sunday Livestream',
            html_content: html,
            contact_list_ids: [listId]
        };
        const campaignPayload = {
            name: 'Sunday Bulletin',
            email_campaign_activities: [baseActivity]
        };

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
        console.error('Constant Contact email failed:', error);
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
    res.json(people);
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
        category = 'volunteer',
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
        category = 'volunteer',
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
    const buildings = rows.map(row => {
        const roomRows = db.prepare(`
            SELECT id, name, floor, capacity, rental_rate
            FROM rooms
            WHERE building_id = ?
            ORDER BY name
        `).all(row.id);
        const rooms = roomRows.map((room) => ({
            id: room.id,
            name: room.name,
            floor: room.floor,
            capacity: room.capacity,
            rental_rate: room.rental_rate
        }));
        const rentalRate = row.rental_rate_day ?? row.rental_rate_hour;
        return {
            id: row.id,
            name: row.name,
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

app.get('/api/vendors', (req, res) => {
    const rows = db.prepare(`
        SELECT id, service, vendor, contact, phone, email, notes, contract
        FROM preferred_vendors
        ORDER BY service, vendor
    `).all();
    res.json(rows);
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
        const filteredScheduled = scheduledEvents.filter(
            (event) => !(event.type_slug === 'weekly-service' && isSundayDate(event.date))
        );
        res.json([...liturgicalEvents, ...filteredScheduled]);
    } catch (error) {
        console.error('Error fetching merged events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
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
            checks: manualChecks,
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
        const pdfBase64 = pdfBytes.toString('base64');
        res.json({
            pdfBase64,
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

app.post('/api/deposit-slip/pdf', pdfUpload.single('checksPdf'), async (req, res) => {
    let conversionDir = null;
    let uploadedPath = req.file?.path || null;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'A PDF file is required' });
        }
        const configPath = resolve(__dirname, 'depositSlipConfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const templatePath = resolve(__dirname, '..', config.templatePath || 'deposit slip template.pdf');
        const maxChecks = Array.isArray(config.fieldMap?.checks)
            ? config.fieldMap.checks.length
            : 18;

        conversionDir = join(tmpdir(), `deposit-slip-pdf-${Date.now()}`);
        await mkdir(conversionDir, { recursive: true });
        const images = await convertPdfToImages(uploadedPath, conversionDir);
        const ocrChecks = await extractChecksFromImages(images, {
            ocrRegions: config.ocrRegions,
            includeOcrLines: true,
            ocrEngines: config.ocrEngines,
            ocrRegionOrigin: config.ocrRegionOrigin,
            ocrRegionAnchor: config.ocrRegionAnchor,
            ocrModel: config.ocrModel,
            ocrCropMaxSize: config.ocrCropMaxSize,
            ocrPreviewOnly: config.ocrPreviewOnly === true,
            ocrAlign: config.ocrAlign
        });
        const clientChecksPayload = parseJsonValue(req.body?.checks, []) || [];
        const { manualChecks, cashTotal } = buildManualChecks(clientChecksPayload, maxChecks);
        const manualTotals = parseJsonValue(req.body?.totals, {}) || {};
        const subtotalOverride = parseCurrencyOverride(manualTotals.subtotal);
        const totalOverride = parseCurrencyOverride(manualTotals.total);
        const manualCashOverride = parseCurrencyOverride(manualTotals.cash);
        const manualSubtotal = manualChecks.reduce((sum, check) => sum + (Number.isFinite(check.amount) ? check.amount : 0), 0);
        const subtotalValue = subtotalOverride != null ? subtotalOverride : manualSubtotal;
        const cashValue = manualCashOverride != null ? manualCashOverride : cashTotal;
        const totalValue = totalOverride != null ? totalOverride : subtotalValue + cashValue;

        const fundsReportEntries = normalizeFundsReportEntries(req.body?.fundsReport?.entries);

        const depositPath = join(conversionDir, 'deposit-slip.pdf');
        await buildDepositSlipPdf({
            templatePath,
            outputPath: depositPath,
            checks: depositChecks,
            fieldMap: config.fieldMap || {},
            totals: {
                cash: cashValue,
                subtotal: subtotalValue,
                total: totalValue
            },
            fundsReport: {
                entries: fundsReportEntries,
                total: totalValue
            }
        });

        const depositBytes = await readFile(depositPath);
        const depositDoc = await PDFDocument.load(depositBytes);
        const finalDoc = await PDFDocument.create();
        const [depositPage] = await finalDoc.copyPages(depositDoc, [0]);
        finalDoc.addPage(depositPage);

        const checkAssets = ocrChecks.map((check, index) => ({
            ...check,
            imagePath: images[index]
        }));
        await addCheckGridPages(finalDoc, checkAssets, {
            pageWidth: depositPage.getWidth(),
            pageHeight: depositPage.getHeight()
        });

        const finalBytes = await finalDoc.save();
        const finalBuffer = Buffer.from(finalBytes);
        res.json({ pdfBase64: finalBuffer.toString('base64') });
    } catch (error) {
        console.error('PDF deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build deposit slip from PDF' });
        }
    } finally {
        if (conversionDir) {
            await rm(conversionDir, { recursive: true, force: true }).catch(() => {});
        }
        if (uploadedPath) {
            await rm(uploadedPath, { force: true }).catch(() => {});
        }
    }
});

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
