import { join, extname } from 'path';
import { mkdir, access } from 'fs/promises';
import { homedir } from 'os';
import { sqlite as db } from '../db.js';

// Constants
export const HGK_SUPPLY_ITEMS = [
    'Bread', 'Peanut Butter', 'Jelly', 'Chips (box)', 'Granola Bars (box)',
    'Oranges', 'Rice Krispie Treats (box)', 'Water', 'Lunch Bags',
    'Sandwich Bags', 'Gloves', 'Napkins'
];

export const HGK_STATUS_OPTIONS = ['needed', 'ordered', 'received'];
export const HGK_WEBHOOK_TOKEN = process.env.HGK_WEBHOOK_TOKEN || null;

const DROPBOX_ROOT = process.env.DROPBOX_ROOT || join(homedir(), 'Dropbox', 'Parish Administrator');
const DROPBOX_EVENT_DOCS_DIR = 'Events';

const HGK_ITEM_ALIASES = {
    'Jelly': ['jam'],
    'Chips (box)': ['chips'],
    'Granola Bars (box)': ['granola bars', 'granola bar'],
    'Rice Krispie Treats (box)': ['rice krispie treats', 'rice krispy treats', 'rice krispie', 'rice krispy'],
    'Oranges': ['fruit', 'tangerines', 'tangerine'],
    'Bread': ['loaf of bread', 'loaves of bread', 'loaf bread', 'loaves bread', 'loaf', 'loaves']
};

// Date Helpers
export const formatMonthKey = (value) => {
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

export const getThirdSundayFromMonth = (monthKey) => {
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

// Database Helpers
export const findHgkOccurrenceId = (monthKey) => {
    const dateKey = getThirdSundayFromMonth(monthKey);
    if (!dateKey) return null;
    const row = db.prepare(`
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
              OR (o.notes LIKE '%"hgk"%' OR o.notes LIKE '%#HGK%')
              OR t.slug = 'volunteer'
          )
        ORDER BY
            CASE WHEN o.notes LIKE '%"hgk"%' OR o.notes LIKE '%#HGK%' THEN 0 ELSE 1 END,
            o.start_time IS NULL,
            o.start_time
        LIMIT 1
    `).get(dateKey);
    return row?.id || null;
};

export const upsertHgkSupplyRequest = (monthKey, notes = '', incomingItems = []) => {
    const normalizedMonth = formatMonthKey(monthKey);
    const now = new Date().toISOString();
    const occurrenceId = findHgkOccurrenceId(normalizedMonth);
    const existingRequest = db.prepare('SELECT id FROM hgk_supply_requests WHERE month = ?').get(normalizedMonth);
    let requestId;

    if (existingRequest) {
        requestId = existingRequest.id;
        db.prepare(`
            UPDATE hgk_supply_requests
            SET notes = ?, occurrence_id = ?, updated_at = ?
            WHERE id = ?
        `).run(notes || null, occurrenceId, now, requestId);
    } else {
        requestId = `hgk-${normalizedMonth}`;
        db.prepare(`
            INSERT INTO hgk_supply_requests (id, month, notes, occurrence_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(requestId, normalizedMonth, notes || null, occurrenceId, now, now);
    }

    const payloadItems = Array.isArray(incomingItems) && incomingItems.length > 0
        ? prepareHgkItemsPayload(incomingItems)
        : HGK_SUPPLY_ITEMS.map((name) => ({ item_name: name, quantity: '', notes: '', status: HGK_STATUS_OPTIONS[0] }));

    db.prepare('DELETE FROM hgk_supply_items WHERE request_id = ?').run(requestId);

    // insertHgkSupplyItems is defined where? It was missing from my view?
    // Let's implement it here inline or find it.
    // Line 407 in index.js called insertHgkSupplyItems. I need to define it.
    const insertItem = db.prepare(`
        INSERT INTO hgk_supply_items (id, request_id, item_name, quantity, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    payloadItems.forEach((item, index) => {
        const id = `${requestId}-item-${index}`;
        insertItem.run(id, requestId, item.item_name, item.quantity, item.notes, item.status, now, now);
    });

    const savedRequest = db.prepare('SELECT * FROM hgk_supply_requests WHERE id = ?').get(requestId);
    const savedItems = db.prepare('SELECT * FROM hgk_supply_items WHERE request_id = ? ORDER BY item_name').all(requestId);
    return {
        month: normalizedMonth,
        request: savedRequest,
        items: savedItems
    };
};

export const prepareHgkItemsPayload = (items) => {
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

// String Helpers
export const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeSupplyString = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sanitizeFileSegment = (value) => String(value || '')
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

const singularizeToken = (token) => token.endsWith('s') ? token.slice(0, -1) : token;

const tokenizeSupply = (value) => normalizeSupplyString(value)
    .split(' ')
    .map((token) => singularizeToken(token))
    .filter(Boolean);

// Math Helpers
export const levenshteinDistance = (a, b) => {
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

export const similarityScore = (a, b) => {
    if (!a || !b) return 0;
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length) || 1;
    return 1 - distance / maxLen;
};

// Email Parsing Helpers
export const decodeGmailBody = (data) => {
    if (!data) return '';
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
};

export const collectGmailParts = (part, mimeType, collected = []) => {
    if (!part) return collected;
    if (part.mimeType === mimeType && part.body?.data) {
        collected.push(part.body.data);
    }
    if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => collectGmailParts(child, mimeType, collected));
    }
    return collected;
};

const decodeHtmlEntities = (value) => String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const extractGmailMessageText = (message) => {
    const payload = message?.payload;
    if (!payload) return '';
    const plainParts = collectGmailParts(payload, 'text/plain');
    if (plainParts.length > 0) {
        return plainParts.map(decodeGmailBody).join('\n');
    }
    const htmlParts = collectGmailParts(payload, 'text/html');
    if (htmlParts.length > 0) {
        const htmlText = htmlParts.map(decodeGmailBody).join('\n');
        const normalized = decodeHtmlEntities(htmlText)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, ' ');
        return normalized
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }
    if (payload.body?.data) {
        return decodeGmailBody(payload.body.data);
    }
    return '';
};

export const parseSupplyEmail = (emailText) => {
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
        let quantity = '';
        let lineText = line;
        const leadingMatch = line.match(/^\s*(\d+(?:\.\d+)?)\s*[-x–—:]\s*(.+)$/i);
        if (leadingMatch) {
            quantity = leadingMatch[1];
            lineText = leadingMatch[2];
        } else {
            const withoutParens = line.replace(/\([^)]*\)/g, ' ');
            const qtyMatch = withoutParens.match(/(\d+(?:\.\d+)?)/);
            if (!qtyMatch) return;
            quantity = qtyMatch[1];
            lineText = withoutParens.replace(/\d+(?:\.\d+)?/g, ' ');
        }
        if (!quantity) return;
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
        if (bestMatch && bestScore >= 0.6) {
            const existing = detected.get(bestMatch);
            if (!existing) {
                detected.set(bestMatch, quantity);
            } else if (existing !== quantity && bestScore >= 0.75) {
                detected.set(bestMatch, quantity);
            }
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

export const escapePsString = (value) => String(value || '')
    .replace(/`/g, '``')
    .replace(/'/g, "''");
