import { sqlite as db } from '../db.js';

export const tableExists = (name) => {
    return !!db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name);
};

export const tableHasColumn = (tableName, columnName) => {
    if (!tableExists(tableName)) return false;
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name);
    return columns.includes(columnName);
};

export const coerceJsonArray = (value) => {
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

export const coerceJsonObject = (value) => {
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

export const parseNotes = (value) => coerceJsonObject(value);

export const parseJsonField = (value, fallback = []) => {
    if (!value) return fallback;
    const parsed = coerceJsonArray(value);
    return parsed.length ? parsed : fallback;
};

export const ensureUniqueId = (baseId, table) => {
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
