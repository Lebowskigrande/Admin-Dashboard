import { sqlite as db } from '../db.js';

export const toEntityLinkId = (fromType, fromId, toType, toId, role) => {
    const safe = (value) => String(value || '').replace(/[^a-z0-9-_]/gi, '').slice(0, 40);
    return `link-${safe(fromType)}-${safe(fromId)}-${safe(toType)}-${safe(toId)}-${safe(role || 'rel')}`;
};

export const upsertEntityLink = (payload) => {
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
    db.prepare(`
        INSERT OR IGNORE INTO entity_links (
            id, from_type, from_id, to_type, to_id, role, created_at, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, fromType, fromId, toType, toId, role || null, createdAt, metaJson);
    return id;
};

export const deleteEntityLinks = ({ fromType, fromId, role }) => {
    db.prepare(`
        DELETE FROM entity_links
        WHERE from_type = ? AND from_id = ? AND (? IS NULL OR role = ?)
    `).run(fromType, fromId, role || null, role || null);
};
