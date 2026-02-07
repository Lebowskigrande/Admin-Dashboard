import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join('server', 'church.db');
const db = new Database(dbPath);

const args = new Set(process.argv.slice(2));
const shouldFix = args.has('--fix');

const allowedOrigins = new Set(['sunday', 'operations', 'event', 'ticket', 'vestry']);

const templates = db.prepare(`
    SELECT list_key, list_title
    FROM recurring_task_templates
    WHERE active = 1
`).all();

const listKeys = Array.from(new Set(
    templates.map((row) => String(row.list_key || '').trim()).filter(Boolean)
));
const listTitles = Array.from(new Set(
    templates
        .map((row) => String(row.list_title || '').trim().toLowerCase())
        .filter(Boolean)
));

const cleanupOriginTypes = new Set();
listKeys.forEach((key) => {
    cleanupOriginTypes.add(key);
    cleanupOriginTypes.add(key.replace(/s$/, ''));
});
listTitles.forEach((title) => cleanupOriginTypes.add(title));
['bulletin', 'bulletins', 'schedule email', 'schedule-email', 'schedule_email', 'email', 'insert'].forEach((value) => {
    cleanupOriginTypes.add(value);
});

const rows = db.prepare(`
    SELECT
        ti.id AS task_instance_id,
        t.id AS task_id,
        t.title,
        ti.due_at,
        ti.list_key,
        ti.list_title,
        ti.list_mode,
        ti.archived_at,
        src.origin_type,
        src.origin_id,
        src.origin_event
    FROM task_instances ti
    JOIN tasks_new t ON t.id = ti.task_id
    LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
`).all();

const toKey = (value) => String(value || '').trim().toLowerCase();

const isTemplateMatch = (row) => {
    if (row.list_key && listKeys.includes(row.list_key)) return true;
    const titleKey = toKey(row.list_title || row.title);
    if (titleKey && listTitles.includes(titleKey)) return true;
    return false;
};

const isOrphan = (row) => !row.origin_type || !row.origin_id;

const isBadOriginType = (row) => {
    if (!row.origin_type) return false;
    const originKey = toKey(row.origin_type);
    if (allowedOrigins.has(originKey)) return false;
    return cleanupOriginTypes.has(originKey);
};

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

const orphanRows = rows.filter((row) => isOrphan(row));
const templateOrphans = orphanRows.filter((row) => isTemplateMatch(row));
const badOriginRows = rows.filter((row) => isBadOriginType(row));

const bySignature = new Map();
rows.forEach((row) => {
    const sig = [
        toKey(row.title),
        row.due_at || '',
        row.list_key || '',
        row.list_mode || ''
    ].join('|');
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(row);
});

const duplicateOrphans = [];
bySignature.forEach((group) => {
    if (group.length < 2) return;
    const hasValid = group.some((row) => row.origin_type && row.origin_id);
    if (!hasValid) return;
    group.forEach((row) => {
        if (isOrphan(row) && isTemplateMatch(row)) {
            duplicateOrphans.push(row);
        }
    });
});

const summarize = (label, items) => {
    console.log(`${label}: ${items.length}`);
    if (items.length) {
        console.log(items.slice(0, 6).map((row) => ({
            id: row.task_instance_id,
            title: row.title,
            due_at: row.due_at,
            list_key: row.list_key,
            list_title: row.list_title,
            origin_type: row.origin_type,
            origin_id: row.origin_id
        })));
    }
};

console.log(`Task rows: ${rows.length}`);
summarize('Orphans (no origin)', orphanRows);
summarize('Template orphans (safe to remove)', templateOrphans);
summarize('Bad origin types (safe to remove)', badOriginRows);
summarize('Duplicate template orphans', duplicateOrphans);

if (!shouldFix) {
    console.log('Dry run only. Re-run with --fix to delete safe orphans/bad origin rows.');
    process.exit(0);
}

const idsToRemove = new Set([
    ...templateOrphans.map((row) => row.task_instance_id),
    ...badOriginRows.map((row) => row.task_instance_id),
    ...duplicateOrphans.map((row) => row.task_instance_id)
]);

idsToRemove.forEach((id) => removeTaskInstance(id));

console.log(`Removed ${idsToRemove.size} task instances.`);
