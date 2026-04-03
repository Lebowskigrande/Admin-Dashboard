import { join } from 'path';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { sqlite as db } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CC_AUTH_URL = 'https://authz.constantcontact.com/oauth2/default/v1/authorize';
export const CC_TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token';
export const CC_API_BASE = 'https://api.cc.email/v3';

export const getCcUserId = (req) => {
    const userId = String(req?.user?.id || '').trim();
    if (!userId) {
        throw new Error('Authentication required');
    }
    return userId;
};

export const getCcTokens = (userId) => {
    return db.prepare(`
        SELECT * FROM constant_contact_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(userId);
};

export const saveCcTokens = (userId, tokens) => {
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

export const refreshCcToken = async (userId, refreshToken) => {
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

export const ensureCcAccessToken = async (userId) => {
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

export const fetchCcJson = async (url, tokens, options = {}) => {
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

export const fetchCcFromEmails = async (tokens) => {
    const data = await fetchCcJson(`${CC_API_BASE}/account/emails`, tokens);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.email_addresses)) return data.email_addresses;
    if (Array.isArray(data?.emails)) return data.emails;
    if (Array.isArray(data?.results)) return data.results;
    return [];
};

export const findCcListId = async (tokens, listName) => {
    const data = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
    const lists = Array.isArray(data?.lists) ? data.lists : [];
    const match = lists.find((list) => list.name?.toLowerCase() === listName.toLowerCase());
    return match?.list_id || null;
};

export const getNextSaturdayAtSix = () => {
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

export const loadEmailTemplate = async () => {
    const templatePath = join(__dirname, '../../CC_livestream_email_template.txt');
    return readFile(templatePath, 'utf8');
};

export const sanitizeEmailHtml = (html) => {
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
