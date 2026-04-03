import { sqlite as db } from '../db.js';

export const SESSION_COOKIE = 'dashboard_session';
export const SESSION_TTL_DAYS = 30;
export const CC_STATE_COOKIE = 'cc_oauth_state';

const LOCAL_DEV_SESSION_ID = process.env.LOCAL_DEV_SESSION_ID || 'sess-local-dev-admin';
const LOCAL_DEV_USER_ID = process.env.LOCAL_DEV_USER_ID || 'local-dev-admin';
const LOCAL_DEV_EMAIL = process.env.LOCAL_DEV_EMAIL || 'local-admin@localhost';
const LOCAL_DEV_DISPLAY_NAME = process.env.LOCAL_DEV_DISPLAY_NAME || 'Local Admin';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const splitCsv = (value) => String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const ADMIN_USER_IDS = new Set(splitCsv(process.env.ADMIN_USER_IDS));
const ADMIN_EMAILS = new Set(splitCsv(process.env.ADMIN_EMAILS).map(normalizeEmail));
const REQUIRE_EXPLICIT_ADMIN = String(process.env.ADMIN_REQUIRE_EXPLICIT || '0') === '1';

const appendSetCookie = (res, cookieValue) => {
    const current = res.getHeader('Set-Cookie');
    if (!current) {
        res.setHeader('Set-Cookie', cookieValue);
        return;
    }
    const next = Array.isArray(current) ? [...current, cookieValue] : [current, cookieValue];
    res.setHeader('Set-Cookie', next);
};

export const parseCookies = (cookieHeader = '') => {
    return cookieHeader.split(';').reduce((acc, pair) => {
        const [rawKey, ...rest] = pair.trim().split('=');
        if (!rawKey) return acc;
        try {
            acc[rawKey] = decodeURIComponent(rest.join('='));
        } catch {
            acc[rawKey] = rest.join('=');
        }
        return acc;
    }, {});
};

export const setSessionCookie = (res, value, days = SESSION_TTL_DAYS) => {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    appendSetCookie(res, `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
};

export const clearSessionCookie = (res) => {
    appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
};

export const setCcStateCookie = (res, value) => {
    const expires = new Date(Date.now() + 10 * 60 * 1000).toUTCString();
    appendSetCookie(res, `${CC_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
};

const isLoopbackToken = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '::1'
        || normalized === '127.0.0.1'
        || normalized.startsWith('127.')
        || normalized === 'localhost'
        || normalized.endsWith('.localhost')
        || normalized === '::ffff:127.0.0.1';
};

const getHeaderHostName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return new URL(raw).hostname.toLowerCase();
    } catch {
        return raw.split(':')[0].toLowerCase();
    }
};

const isLocalDevRequest = (req) => {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return false;
    if (String(process.env.LOCAL_DEV_AUTH || '1') === '0') return false;

    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
    const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    const ip = req.ip || '';
    const host = getHeaderHostName(req.headers.host || '');
    const originHost = getHeaderHostName(req.headers.origin || '');
    const refererHost = getHeaderHostName(req.headers.referer || '');

    return [ip, remoteAddress, forwardedFor, host, originHost, refererHost].some(isLoopbackToken);
};

const hydrateUserFlags = (user, { isLocalDev = false } = {}) => {
    if (!user) return null;
    const hasExplicitAdmins = ADMIN_USER_IDS.size > 0 || ADMIN_EMAILS.size > 0;
    const isConfiguredAdmin = ADMIN_USER_IDS.has(String(user.id || '').trim())
        || ADMIN_EMAILS.has(normalizeEmail(user.email));
    const isAdmin = isLocalDev
        || isConfiguredAdmin
        || (!REQUIRE_EXPLICIT_ADMIN && !hasExplicitAdmins);
    return {
        ...user,
        is_admin: isAdmin,
        auth_mode: isLocalDev ? 'local-dev' : 'session'
    };
};

const getSessionUserById = (sessionId) => {
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

const ensureLocalDevSession = (res) => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
        INSERT INTO users (id, email, display_name, avatar_url, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            display_name = excluded.display_name
    `).run(
        LOCAL_DEV_USER_ID,
        LOCAL_DEV_EMAIL,
        LOCAL_DEV_DISPLAY_NAME,
        '',
        now
    );

    db.prepare(`
        INSERT INTO user_sessions (id, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at
    `).run(LOCAL_DEV_SESSION_ID, LOCAL_DEV_USER_ID, now, expiresAt);

    setSessionCookie(res, LOCAL_DEV_SESSION_ID);
    const user = db.prepare(`
        SELECT id, email, display_name, avatar_url FROM users WHERE id = ?
    `).get(LOCAL_DEV_USER_ID);
    return hydrateUserFlags(user, { isLocalDev: true });
};

export const loadSessionUser = (req) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies[SESSION_COOKIE];
    return hydrateUserFlags(getSessionUserById(sessionId));
};

export const attachRequestUser = (req, res, next) => {
    const sessionUser = loadSessionUser(req);
    if (sessionUser) {
        req.user = sessionUser;
        return next();
    }
    if (isLocalDevRequest(req)) {
        req.user = ensureLocalDevSession(res);
        return next();
    }
    req.user = null;
    return next();
};

export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    return next();
};

export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.user.is_admin) {
        return res.status(403).json({ error: 'Administrator access required' });
    }
    return next();
};

export const getUserTokens = (userId) => {
    return db.prepare('SELECT * FROM user_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
};

export const SHAREFILE_GMAIL_USER_ID = 'sharefile-gmail';

export const getSharefileRoutingAccounts = () => {
    const rows = db.prepare(`
        SELECT a.user_id, a.is_default, a.enabled, a.created_at, u.email, u.display_name
        FROM sharefile_routing_accounts a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.is_default DESC, a.created_at ASC
    `).all();
    return rows.map((row) => ({
        userId: row.user_id,
        email: row.email || '',
        displayName: row.display_name || row.email || row.user_id,
        isDefault: Number(row.is_default || 0) === 1,
        enabled: Number(row.enabled || 0) === 1,
        connected: !!getUserTokens(row.user_id),
        createdAt: row.created_at
    }));
};

export const ensureSharefileRoutingAccount = (userId) => {
    const id = String(userId || '').trim();
    if (!id) return null;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO sharefile_routing_accounts (user_id, is_default, enabled, created_at)
        VALUES (?, 0, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            enabled = 1
    `).run(id, now);

    const hasDefault = db.prepare(`
        SELECT 1 FROM sharefile_routing_accounts
        WHERE is_default = 1 AND enabled = 1
        LIMIT 1
    `).get();
    if (!hasDefault) {
        db.prepare('UPDATE sharefile_routing_accounts SET is_default = CASE WHEN user_id = ? THEN 1 ELSE 0 END').run(id);
    }
    return id;
};

export const setDefaultSharefileRoutingAccount = (userId) => {
    const id = String(userId || '').trim();
    if (!id) return false;
    const exists = db.prepare('SELECT user_id FROM sharefile_routing_accounts WHERE user_id = ? LIMIT 1').get(id);
    if (!exists) return false;
    db.prepare('UPDATE sharefile_routing_accounts SET is_default = CASE WHEN user_id = ? THEN 1 ELSE 0 END').run(id);
    db.prepare('UPDATE sharefile_routing_accounts SET enabled = 1 WHERE user_id = ?').run(id);
    return true;
};

export const removeSharefileRoutingAccount = (userId, { removeTokens = true } = {}) => {
    const id = String(userId || '').trim();
    if (!id) return false;
    const existing = db.prepare('SELECT user_id, is_default FROM sharefile_routing_accounts WHERE user_id = ? LIMIT 1').get(id);
    if (!existing) return false;

    db.prepare('DELETE FROM sharefile_routing_accounts WHERE user_id = ?').run(id);
    if (removeTokens) {
        db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(id);
    }

    if (Number(existing.is_default || 0) === 1) {
        const next = db.prepare('SELECT user_id FROM sharefile_routing_accounts WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1').get();
        if (next?.user_id) {
            db.prepare('UPDATE sharefile_routing_accounts SET is_default = CASE WHEN user_id = ? THEN 1 ELSE 0 END').run(next.user_id);
        }
    }
    return true;
};

export const getDefaultSharefileRoutingAccountUserId = () => {
    const row = db.prepare(`
        SELECT user_id FROM sharefile_routing_accounts
        WHERE enabled = 1
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
    `).get();
    return row?.user_id || null;
};

export const getSharefileGmailTokens = () => {
    const defaultUserId = getDefaultSharefileRoutingAccountUserId();
    if (defaultUserId) {
        const tokens = getUserTokens(defaultUserId);
        if (tokens) return tokens;
    }
    return db.prepare('SELECT * FROM user_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(SHAREFILE_GMAIL_USER_ID);
};

export const saveSharefileGmailTokens = (tokens) => {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO user_tokens (id, user_id, access_token, refresh_token, expiry_date, scope, token_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expiry_date = excluded.expiry_date,
            scope = excluded.scope,
            token_type = excluded.token_type
    `).run(
        `token-${SHAREFILE_GMAIL_USER_ID}`,
        SHAREFILE_GMAIL_USER_ID,
        tokens.access_token || null,
        tokens.refresh_token || null,
        tokens.expiry_date || null,
        tokens.scope || null,
        tokens.token_type || null,
        now
    );
};
