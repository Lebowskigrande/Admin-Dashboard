import Database from 'better-sqlite3';

const db = new Database('server/church.db');
const apply = process.argv.includes('--apply');

const log = (...args) => console.log(...args);

const tableExists = (name) => !!db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
`).get(name);

const countRefs = (occurrenceId) => {
    const tasks = tableExists('task_origins')
        ? db.prepare(`
            SELECT count(*) as count
            FROM task_origins
            WHERE scope = 'instance'
              AND origin_type = 'event'
              AND origin_id = ?
        `).get(occurrenceId).count
        : 0;
    const links = tableExists('entity_links')
        ? db.prepare(`
            SELECT count(*) as count
            FROM entity_links
            WHERE from_type = 'event_occurrence'
              AND from_id = ?
        `).get(occurrenceId).count
        : 0;
    const assignments = tableExists('assignments')
        ? db.prepare(`
            SELECT count(*) as count
            FROM assignments
            WHERE occurrence_id = ?
        `).get(occurrenceId).count
        : 0;
    const hgkRequests = tableExists('hgk_supply_requests')
        ? db.prepare(`
            SELECT count(*) as count
            FROM hgk_supply_requests
            WHERE occurrence_id = ?
        `).get(occurrenceId).count
        : 0;
    return tasks + links + assignments + hgkRequests;
};

const migrateOccurrenceRefs = (fromId, toId) => {
    if (fromId === toId) return;
    if (tableExists('assignments')) {
        db.prepare('UPDATE assignments SET occurrence_id = ? WHERE occurrence_id = ?').run(toId, fromId);
    }
    if (tableExists('hgk_supply_requests')) {
        db.prepare('UPDATE hgk_supply_requests SET occurrence_id = ? WHERE occurrence_id = ?').run(toId, fromId);
    }
    if (tableExists('task_origins')) {
        db.prepare(`
            UPDATE task_origins
            SET origin_id = ?
            WHERE scope = 'instance' AND origin_type = 'event' AND origin_id = ?
        `).run(toId, fromId);
    }
    if (tableExists('entity_links')) {
        const sourceLinks = db.prepare(`
            SELECT id, to_type, to_id, role
            FROM entity_links
            WHERE from_type = 'event_occurrence' AND from_id = ?
        `).all(fromId);
        sourceLinks.forEach((link) => {
            const roleClause = link.role == null ? 'role IS NULL' : 'role = ?';
            const params = link.role == null
                ? [toId, link.to_type, link.to_id]
                : [toId, link.to_type, link.to_id, link.role];
            const existing = db.prepare(`
                SELECT id FROM entity_links
                WHERE from_type = 'event_occurrence'
                  AND from_id = ?
                  AND to_type = ?
                  AND to_id = ?
                  AND ${roleClause}
                LIMIT 1
            `).get(...params);
            if (existing?.id) {
                db.prepare('DELETE FROM entity_links WHERE id = ?').run(link.id);
            } else {
                db.prepare('UPDATE entity_links SET from_id = ? WHERE id = ?').run(toId, link.id);
            }
        });

        const targetLinks = db.prepare(`
            SELECT id, from_type, from_id, role
            FROM entity_links
            WHERE to_type = 'event' AND to_id = ?
        `).all(fromId);
        targetLinks.forEach((link) => {
            const roleClause = link.role == null ? 'role IS NULL' : 'role = ?';
            const params = link.role == null
                ? [link.from_type, link.from_id, toId]
                : [link.from_type, link.from_id, toId, link.role];
            const existing = db.prepare(`
                SELECT id FROM entity_links
                WHERE from_type = ?
                  AND from_id = ?
                  AND to_type = 'event'
                  AND to_id = ?
                  AND ${roleClause}
                LIMIT 1
            `).get(...params);
            if (existing?.id) {
                db.prepare('DELETE FROM entity_links WHERE id = ?').run(link.id);
            } else {
                db.prepare('UPDATE entity_links SET to_id = ? WHERE id = ?').run(toId, link.id);
            }
        });
    }
};

const deleteOccurrence = (occurrenceId) => {
    db.prepare('DELETE FROM event_occurrences WHERE id = ?').run(occurrenceId);
};

const cleanupOrphanEvents = () => {
    const rows = db.prepare(`
        SELECT e.id
        FROM events e
        LEFT JOIN event_occurrences o ON o.event_id = e.id
        GROUP BY e.id
        HAVING COUNT(o.id) = 0
    `).all();
    if (!rows.length) return 0;
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids);
    return ids.length;
};

const selectHgkTargetOccurrence = (dateKey) => {
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

const migrateHgkOccurrences = () => {
    const rows = db.prepare(`
        SELECT o.id, o.date
        FROM event_occurrences o
        WHERE o.event_id = 'hgk-volunteer'
    `).all();
    if (!rows.length) return { migrated: 0, skipped: 0 };
    let migrated = 0;
    let skipped = 0;
    rows.forEach((row) => {
        const targetId = selectHgkTargetOccurrence(row.date);
        if (!targetId) {
            skipped += 1;
            return;
        }
        if (apply) {
            migrateOccurrenceRefs(row.id, targetId);
            deleteOccurrence(row.id);
        }
        migrated += 1;
    });
    return { migrated, skipped };
};

const migrateDuplicateGoogleOccurrences = () => {
    const groups = db.prepare(`
        SELECT o.date, o.start_time, e.title, COUNT(*) as cnt
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        WHERE e.source = 'google'
        GROUP BY o.date, o.start_time, e.title
        HAVING COUNT(*) > 1
        ORDER BY o.date DESC
    `).all();
    let merged = 0;
    groups.forEach((group) => {
        const rows = db.prepare(`
            SELECT o.id as occurrence_id, e.id as event_id, e.title, o.date, o.start_time
            FROM event_occurrences o
            JOIN events e ON e.id = o.event_id
            WHERE e.source = 'google'
              AND e.title = ?
              AND o.date = ?
              AND o.start_time IS ?
        `).all(group.title, group.date, group.start_time);
        if (rows.length <= 1) return;
        const ranked = rows.map((row) => ({
            ...row,
            score: countRefs(row.occurrence_id)
        })).sort((a, b) => b.score - a.score);
        const canonical = ranked[0];
        ranked.slice(1).forEach((dup) => {
            if (apply) {
                migrateOccurrenceRefs(dup.occurrence_id, canonical.occurrence_id);
                deleteOccurrence(dup.occurrence_id);
            }
            merged += 1;
        });
    });
    return merged;
};

const run = () => {
    log(`Starting migration (apply=${apply})...`);
    const hgk = migrateHgkOccurrences();
    const merged = migrateDuplicateGoogleOccurrences();
    let orphaned = 0;
    if (apply) {
        orphaned = cleanupOrphanEvents();
    }
    log('HGK migrated:', hgk.migrated, 'skipped:', hgk.skipped);
    log('Duplicate google occurrences merged:', merged);
    if (apply) {
        log('Orphan events removed:', orphaned);
    }
};

if (apply) {
    const txn = db.transaction(run);
    txn();
} else {
    run();
}
