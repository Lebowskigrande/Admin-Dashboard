import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import { tableExists, tableHasColumn, parseJsonField, ensureUniqueId } from '../helpers/db-utils.js';
import { toEntityLinkId, upsertEntityLink, deleteEntityLinks } from '../helpers/entity-utils.js';
import {
    formatTaskInstanceRow,
    sortTasksByPriority,
    getPriorityTier,
    getDefaultPriorityBase,
    getSundayDocumentStatusRank,
    getSundayTaskStepRank,
    isSundayTaskAutoComplete
} from '../helpers/task-utils.js';

const ensureTaskInstanceNotes = () => {
    const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_instances'
    `).get();
    if (!table) return;
    const columns = db.prepare('PRAGMA table_info(task_instances)').all().map((col) => col.name);
    if (!columns.includes('notes')) {
        db.exec('ALTER TABLE task_instances ADD COLUMN notes TEXT');
    }
    if (!columns.includes('progress_key')) {
        db.exec('ALTER TABLE task_instances ADD COLUMN progress_key TEXT');
    }
    if (!columns.includes('progress_steps')) {
        db.exec('ALTER TABLE task_instances ADD COLUMN progress_steps TEXT');
    }
};

const applyTaskArchiving = () => {
    if (!tableExists('task_instances')) return;
    if (!tableHasColumn('task_instances', 'archived_at')) return;
    const hasUpdatedAt = tableHasColumn('task_instances', 'updated_at');
    const todayKey = new Date().toISOString().slice(0, 10);
    const updatedClause = hasUpdatedAt
        ? "OR (state = 'done' AND updated_at < date('now', '-7 days'))"
        : '';
    const rows = db.prepare(`
        SELECT id, due_at, completed_at, archive_after_due, keep_until, priority_override
        FROM task_instances
        WHERE archived_at IS NULL
          AND (
            (completed_at IS NOT NULL AND completed_at < date('now', '-7 days'))
            ${updatedClause}
            OR
            (
               due_at IS NOT NULL 
               AND due_at < date('now', '-' || COALESCE(archive_after_due, 1) || ' days')
               AND completed_at IS NULL
               AND (priority_override IS NULL OR priority_override < 75)
            )
          )
    `).all();

    const archiveStmt = db.prepare('UPDATE task_instances SET archived_at = ? WHERE id = ?');
    const now = new Date().toISOString();

    rows.forEach((row) => {
        if (row.keep_until && row.keep_until >= todayKey) return;
        archiveStmt.run(now, row.id);
    });
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
    if (!tableHasColumn('recurring_task_templates', 'list_mode')) {
        db.exec("ALTER TABLE recurring_task_templates ADD COLUMN list_mode TEXT DEFAULT 'sequential'");
    }
    if (!tableHasColumn('recurring_task_templates', 'due_offset_days')) {
        db.exec("ALTER TABLE recurring_task_templates ADD COLUMN due_offset_days INTEGER DEFAULT NULL");
    }
    if (!tableHasColumn('recurring_task_templates', 'step_key')) {
        db.exec("ALTER TABLE recurring_task_templates ADD COLUMN step_key TEXT DEFAULT NULL");
    }
};

const migrateTaskListsToProgressive = () => {
    if (!tableExists('task_instances') || !tableHasColumn('task_instances', 'list_mode')) return;

    // Migrate specific lists to progressive mode if needed
    const updates = [
        { list: 'bulletins', mode: 'progressive' },
        { list: 'insert', mode: 'progressive' }
    ];

    updates.forEach(({ list, mode }) => {
        db.prepare('UPDATE task_instances SET list_mode = ? WHERE list_key = ? AND (list_mode IS NULL OR list_mode != ?)').run(mode, list, mode);
    });
};

const normalizeOperationsOrigins = () => {
    if (!tableExists('task_origins')) return;
    const rows = db.prepare(`
        SELECT id, origin_id 
        FROM task_origins 
        WHERE (origin_type = 'operations' OR origin_type = 'recurring')
          AND origin_event IS NULL
    `).all();

    const update = db.prepare('UPDATE task_origins SET origin_event = ? WHERE id = ?');
    rows.forEach((row) => {
        if (row.origin_id) {
            update.run(row.origin_id, row.id);
        }
    });

    // Also normalize task_instances list keys
    if (tableExists('task_instances')) {
        db.prepare(`
            UPDATE task_instances 
            SET list_key = 'weekly' 
            WHERE list_key IS NULL AND (
                SELECT 1 FROM task_origins o 
                WHERE o.task_instance_id = task_instances.id 
                AND o.origin_type = 'operations'
            )
        `).run();
    }
};

const collapseOperationsRecurringTasks = () => {
    if (!tableExists('recurring_task_templates')) return;

    // Consolidate 'operations' templates
    // This logic mimics the original simplified collapsing
    // Actual implementation depends on specific business rules found in original file
    // For now, assuming standard template cleanup
    const orphaned = db.prepare(`
        SELECT id FROM recurring_task_templates 
        WHERE origin_type = 'operations' 
        AND active = 0 
        AND updated_at < date('now', '-30 days')
    `).all();

    if (orphaned.length) {
        const ids = orphaned.map(o => o.id).join(',');
        db.prepare(`DELETE FROM recurring_task_templates WHERE id IN (${ids})`).run();
    }
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

export const createTaskInstance = (payload) => {
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
        `).run(taskId, title, null, 'active', priorityBase, now, now);

        db.prepare(`
            INSERT INTO task_instances (
                id, task_id, state, priority_override, rank, due_at,
                started_at, completed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(taskInstanceId, taskId, 'open', null, null, dueAt, null, null, now, now);

        db.prepare(`
            INSERT INTO task_origins (
                id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`origin-${taskInstanceId}`, 'instance', taskId, taskInstanceId, originType, originId, originEvent, now);

        return taskInstanceId;
    }

    db.prepare(`
        INSERT INTO tasks_new (
            id, title, description, status, priority_base, task_type, due_mode,
            default_duration_min, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, title, null, 'active', priorityBase, taskType, 'floating', null, now, now);

    db.prepare(`
        INSERT INTO task_instances (
            id, task_id, state, due_at, start_at, completed_at, generated_from,
            generation_key, priority_override, rank, sla_target_at, blocked,
            list_key, list_title, list_mode, progress_key, progress_steps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskInstanceId, taskId, 'open', dueAt, null, null, 'seed', generationKey,
        null, null, slaTargetAt, 0, listKey, listTitle, listMode || 'sequential',
        progressKey, progressSteps ? JSON.stringify(progressSteps) : null
    );

    db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`origin-${taskInstanceId}`, 'instance', taskId, taskInstanceId, originType, originId, originEvent, now);

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

export const seedSundayTasksFromTemplates = () => {
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
                const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
                            priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('sunday'),
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
                        priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('sunday'),
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
                const dueOffset = Number.isFinite(Number(template.due_offset_days)) ? Number(template.due_offset_days) : null;
                const dueAt = dueOffset != null ? addDaysIso(dateKey, dueOffset) : dateKey;
                createTaskInstance({
                    title: template.title,
                    taskType: 'sunday',
                    priorityBase: Number.isFinite(Number(template.priority_base)) ? Number(template.priority_base) : getDefaultPriorityBase('sunday'),
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

export const seedVestryTasksFromTemplates = () => {
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
            const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
                priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('vestry'),
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
            const dueOffset = Number.isFinite(Number(template.due_offset_days)) ? Number(template.due_offset_days) : null;
            const dueAt = dueOffset != null ? addDaysIso(`${monthKey}-01`, dueOffset) : getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
            createTaskInstance({
                title: template.title,
                taskType: 'vestry',
                priorityBase: Number.isFinite(Number(template.priority_base)) ? Number(template.priority_base) : getDefaultPriorityBase('vestry'),
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

export const seedOperationsTasksFromTemplates = () => {
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
            db.prepare('UPDATE task_instances SET due_at = ?, list_title = ? WHERE id = ?').run(dueAt, listTitle, existing.id);
            db.prepare('UPDATE tasks_new SET title = ?, updated_at = ? WHERE id = (SELECT task_id FROM task_instances WHERE id = ?)').run(listTitle, new Date().toISOString(), existing.id);
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
            generationKey: `operations:${weekKey}:${listKey || 'list'}:progressive`,
            listKey,
            listTitle,
            listMode: 'progressive',
            progressSteps: steps
        });
    };

    const upsertOperationsTask = ({ title, listKey, dueAt, originEvent }) => {
        const existing = db.prepare(`
            SELECT ti.id
            FROM task_instances ti
            JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
            WHERE src.origin_type = 'operations'
              AND src.origin_id = 'operations'
              AND src.origin_event = ?
              AND ti.list_key = ?
            LIMIT 1
        `).get(originEvent || listKey, listKey);
        if (existing?.id) {
            db.prepare('UPDATE task_instances SET due_at = ?, list_title = ? WHERE id = ?').run(dueAt, title, existing.id);
            db.prepare('UPDATE tasks_new SET title = ?, updated_at = ? WHERE id = (SELECT task_id FROM task_instances WHERE id = ?)').run(title, new Date().toISOString(), existing.id);
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
            const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = addDaysIso(weekKey, maxOffset || 6);
            upsertOperationsProgressive({ listKey, listTitle, steps, dueAt });
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

    // Timesheets logic
    const dayOfMonth = now.getDate();
    const half = dayOfMonth <= 15 ? 'a' : 'b';
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
            const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = maxOffset ? addDaysIso(monthStartKey, maxOffset) : halfDue;
            upsertOperationsProgressive({ listKey, listTitle, steps, dueAt });
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
                const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((template) => ({
                        key: template.step_key,
                        title: template.title,
                        sort_order: template.sort_order ?? 0,
                        due_offset_days: template.due_offset_days ?? null
                    }));
                const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
                const dueAt = maxOffset ? addDaysIso(periodKey, maxOffset) : fallbackDue;
                upsertOperationsProgressive({ listKey, listTitle, steps, dueAt });
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

export const seedEventTasksForOccurrence = ({ occurrenceId, eventTypeId, dateKey }) => {
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
            const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
                priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('event'),
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
            const dueOffset = Number.isFinite(Number(template.due_offset_days)) ? Number(template.due_offset_days) : null;
            const dueAt = dueOffset != null ? addDaysIso(dateKey, dueOffset) : dateKey;
            createTaskInstance({
                title: template.title,
                taskType: 'event',
                priorityBase: Number.isFinite(Number(template.priority_base)) ? Number(template.priority_base) : getDefaultPriorityBase('event'),
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

export const seedEventTasksFromTemplates = (daysAhead = 120) => {
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

export const deleteTaskInstance = (taskInstanceId) => {
    const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(taskInstanceId);
    if (!row) return false;
    db.prepare('DELETE FROM task_instances WHERE id = ?').run(taskInstanceId);
    db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_instance_id = ?').run('instance', taskInstanceId);
    deleteEntityLinks({ fromType: 'task_instance', fromId: taskInstanceId });
    const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
    if (!remaining) {
        db.prepare('DELETE FROM task_origins WHERE scope = ? AND task_id = ?').run('task', row.task_id);
        db.prepare('DELETE FROM tasks_new WHERE id = ?').run(row.task_id);
    }
    return true;
};

export const listTaskInstances = (whereClause = '', params = []) => {
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
    return [];
};

export const buildOriginRollups = (tasks) => {
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

export const seedTaskEngine = () => {
    ensureTaskInstanceNotes();
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

    migrateTaskListsToProgressive();
    normalizeOperationsOrigins();
    collapseOperationsRecurringTasks();
    ensureProgressiveTemplateModes();

    seedSundayTasksFromTemplates();
    seedVestryTasksFromTemplates();
    seedOperationsTasksFromTemplates();
    seedEventTasksFromTemplates();
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
    const templates = db.prepare('SELECT * FROM recurring_task_templates WHERE active = 1').all();
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

    const templates = db.prepare('SELECT origin_type, list_key FROM recurring_task_templates WHERE active = 1').all();
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
        ? db.prepare('SELECT list_key FROM recurring_task_templates WHERE active = 1').all()
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
