import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import { tableExists, tableHasColumn } from '../helpers/db-utils.js';
import { upsertEntityLink, deleteEntityLinks } from '../helpers/entity-utils.js';
import {
    formatTaskInstanceRow,
    sortTasksByPriority,
    getPriorityTier,
    getDefaultPriorityBase
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

    let archivedCount = 0;
    rows.forEach((row) => {
        if (row.keep_until && row.keep_until >= todayKey) return;
        archiveStmt.run(now, row.id);
        archivedCount += 1;
    });
    taskEngineRuntime = {
        ...taskEngineRuntime,
        lastArchiveSweepAt: now,
        lastArchiveArchivedCount: archivedCount
    };
    return archivedCount;
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
const UNUSED_isSpecialEventsList = (listKey) => normalizeListKey(listKey) === 'special-events';
let taskEngineRuntime = {
    lastSeedAt: null,
    lastSeedSummary: null,
    lastArchiveSweepAt: null,
    lastArchiveArchivedCount: 0
};

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

const toDateKey = (dateValue) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const toMonthKey = (dateValue) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const toYearKey = (dateValue) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getFullYear());
};

const getWeekStartMonday = (dateValue = new Date()) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return new Date();
    const day = date.getDay();
    const mondayOffset = (day + 6) % 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - mondayOffset);
    return date;
};

const getNextWeekdayDate = (baseDate, weekday) => {
    const next = new Date(baseDate);
    const day = next.getDay();
    const delta = (weekday - day + 7) % 7;
    next.setDate(next.getDate() + delta);
    next.setHours(0, 0, 0, 0);
    return next;
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

const findExistingOperationsTaskInstance = ({
    originId,
    originEvent,
    listKey
} = {}) => {
    return db.prepare(`
        SELECT ti.id, ti.task_id, ti.state, ti.due_at, ti.completed_at, ti.archived_at, ti.list_mode, ti.progress_key,
               t.title
        FROM task_instances ti
        JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        JOIN tasks_new t ON t.id = ti.task_id
        WHERE src.origin_type = 'operations'
          AND src.origin_id = ?
          AND src.origin_event = ?
          AND COALESCE(ti.list_key, '') = COALESCE(?, '')
        LIMIT 1
    `).get(originId, originEvent, listKey);
};

const buildOperationsSeedPlan = ({ now = new Date(), rehydrate = false } = {}) => {
    const weeklyTemplates = listRecurringTemplates('operations', 'weekly');
    const timesheetTemplates = listRecurringTemplates('operations', 'timesheets');
    const monthlyTemplates = listRecurringTemplates('operations', 'monthly');
    const yearlyTemplates = listRecurringTemplates('operations', 'yearly');
    const weekStart = getWeekStartMonday(now);
    const weekKey = toDateKey(weekStart);
    const weeklyOriginId = `weekly-${weekKey}`;
    const fridayKey = toDateKey(getNextWeekdayDate(now, 5));
    const mailWeekdays = [
        { key: 'mon', day: 1 },
        { key: 'wed', day: 3 },
        { key: 'fri', day: 5 }
    ];

    const dayOfMonth = now.getDate();
    const half = dayOfMonth <= 15 ? 'a' : 'b';
    const monthKey = toMonthKey(now);
    const yearKey = toYearKey(now);
    const timesheetsOriginId = `timesheets-${monthKey}-${half}`;
    const monthlyOriginId = `monthly-${monthKey}`;
    const yearlyOriginId = `yearly-${yearKey}`;
    const monthStartKey = `${monthKey}-01`;
    const timesheetDue = half === 'a'
        ? `${monthKey}-15`
        : getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
    const monthEndKey = getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
    const yearStartKey = `${yearKey}-01-01`;
    const yearEndKey = `${yearKey}-12-31`;

    const plan = [];
    const pushPlanEntry = ({
        title,
        listKey,
        listTitle,
        listMode = 'sequential',
        originId,
        originEvent,
        dueAt,
        progressSteps = null,
        periodType = 'operations'
    }) => {
        const existing = findExistingOperationsTaskInstance({ originId, originEvent, listKey });
        if (!existing) {
            plan.push({
                action: 'create',
                title,
                listKey,
                listTitle,
                listMode,
                originId,
                originEvent,
                dueAt,
                progressSteps,
                periodType,
                generationKey: `operations:${originId}:${listKey}:${originEvent}`
            });
            return;
        }
        const dueChanged = String(existing.due_at || '') !== String(dueAt || '');
        const titleChanged = String(existing.title || '') !== String(title || '');
        const isInactive = Boolean(existing.archived_at || existing.completed_at || String(existing.state || '').toLowerCase() === 'done');
        const shouldReactivate = rehydrate && isInactive;
        const shouldUpdate = dueChanged || titleChanged;
        plan.push({
            action: shouldReactivate ? 'reactivate' : (shouldUpdate ? 'update' : 'noop'),
            existingId: existing.id,
            existingTaskId: existing.task_id,
            title,
            listKey,
            listTitle,
            listMode,
            originId,
            originEvent,
            dueAt,
            progressSteps,
            periodType,
            generationKey: `operations:${originId}:${listKey}:${originEvent}`
        });
    };

    const planGroupedTemplates = ({
        templates,
        defaultOriginId,
        fallbackDueAt,
        periodType = 'operations'
    }) => {
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
            const listMode = String(groupTemplates[0]?.list_mode || 'sequential').toLowerCase();
            const originId = defaultOriginId;

            if (groupTemplates.length > 1 && listMode === 'progressive') {
                const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((template) => ({
                        key: template.step_key,
                        title: template.title,
                        sort_order: template.sort_order ?? 0,
                        due_offset_days: template.due_offset_days ?? null
                    }));
                const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
                const dueAt = maxOffset ? addDaysIso(fallbackDueAt, maxOffset) : fallbackDueAt;
                pushPlanEntry({
                    title: listTitle || listKey || 'Task',
                    listKey,
                    listTitle: listTitle || listKey || 'Task',
                    listMode: 'progressive',
                    originId,
                    originEvent: listKey || 'progressive',
                    dueAt,
                    progressSteps: steps,
                    periodType
                });
                return;
            }

            groupTemplates.forEach((template) => {
                const title = template.title;
                if (!title) return;
                const dueAt = template.due_offset_days != null
                    ? addDaysIso(fallbackDueAt, Number(template.due_offset_days))
                    : fallbackDueAt;
                pushPlanEntry({
                    title,
                    listKey: template.step_key || normalizeListKey(title),
                    listTitle: listTitle || title,
                    listMode,
                    originId,
                    originEvent: template.step_key || periodType,
                    dueAt,
                    periodType
                });
            });
        });
    };

    const groupedWeekly = weeklyTemplates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});

    Object.values(groupedWeekly).forEach((groupTemplates) => {
        const listKey = groupTemplates[0]?.list_key || null;
        const listTitle = groupTemplates[0]?.list_title || null;
        const listMode = String(groupTemplates[0]?.list_mode || 'sequential').toLowerCase();
        const isWeeklyOps = listKey === 'ops-weekly';

        if (isWeeklyOps) {
            groupTemplates.forEach((template) => {
                const title = template.title;
                if (!title) return;
                const lowered = title.toLowerCase();
                if (lowered.includes('mail')) {
                    mailWeekdays.forEach((entry) => {
                        const dueAt = toDateKey(getNextWeekdayDate(now, entry.day));
                        pushPlanEntry({
                            title,
                            listKey: `mail-${entry.key}`,
                            listTitle: listTitle || title,
                            listMode: 'sequential',
                            originId: weeklyOriginId,
                            originEvent: `mail-${entry.key}`,
                            dueAt,
                            periodType: 'weekly'
                        });
                    });
                    return;
                }
                pushPlanEntry({
                    title,
                    listKey: template.step_key || normalizeListKey(title),
                    listTitle: listTitle || title,
                    listMode: 'sequential',
                    originId: weeklyOriginId,
                    originEvent: template.step_key || 'weekly',
                    dueAt: fridayKey,
                    periodType: 'weekly'
                });
            });
            return;
        }

        if (groupTemplates.length > 1 && listMode === 'progressive') {
            const steps = groupTemplates.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((template) => ({
                    key: template.step_key,
                    title: template.title,
                    sort_order: template.sort_order ?? 0,
                    due_offset_days: template.due_offset_days ?? null
                }));
            const maxOffset = Math.max(...steps.map((step) => Number.isFinite(Number(step.due_offset_days)) ? Number(step.due_offset_days) : 0));
            const dueAt = addDaysIso(weekKey, maxOffset || 6);
            pushPlanEntry({
                title: listTitle || listKey || 'Task',
                listKey,
                listTitle: listTitle || listKey || 'Task',
                listMode: 'progressive',
                originId: weeklyOriginId,
                originEvent: listKey || 'progressive',
                dueAt,
                progressSteps: steps,
                periodType: 'weekly'
            });
            return;
        }

        groupTemplates.forEach((template) => {
            const title = template.title;
            if (!title) return;
            pushPlanEntry({
                title,
                listKey: template.step_key || normalizeListKey(title),
                listTitle: listTitle || title,
                listMode: 'sequential',
                originId: weeklyOriginId,
                originEvent: template.step_key || 'weekly',
                dueAt: fridayKey,
                periodType: 'weekly'
            });
        });
    });

    planGroupedTemplates({
        templates: timesheetTemplates,
        defaultOriginId: timesheetsOriginId,
        fallbackDueAt: timesheetDue,
        periodType: 'timesheets'
    });

    planGroupedTemplates({
        templates: monthlyTemplates,
        defaultOriginId: monthlyOriginId,
        fallbackDueAt: monthStartKey || monthEndKey,
        periodType: 'monthly'
    });

    planGroupedTemplates({
        templates: yearlyTemplates,
        defaultOriginId: yearlyOriginId,
        fallbackDueAt: yearStartKey || yearEndKey,
        periodType: 'yearly'
    });

    return {
        generatedAt: new Date().toISOString(),
        weeklyOriginId,
        timesheetsOriginId,
        monthlyOriginId,
        yearlyOriginId,
        summary: {
            total: plan.length,
            create: plan.filter((row) => row.action === 'create').length,
            update: plan.filter((row) => row.action === 'update').length,
            reactivate: plan.filter((row) => row.action === 'reactivate').length,
            noop: plan.filter((row) => row.action === 'noop').length
        },
        items: plan
    };
};

export const previewOperationsSeedPlan = ({ now = new Date(), rehydrate = false } = {}) => {
    return buildOperationsSeedPlan({ now, rehydrate });
};

const applyOperationsSeedPlan = (plan = { items: [] }) => {
    const items = Array.isArray(plan?.items) ? plan.items : [];
    const counters = {
        total: items.length,
        create: 0,
        update: 0,
        reactivate: 0,
        noop: 0,
        failed: 0
    };

    items.forEach((item) => {
        try {
            if (item.action === 'create') {
                const created = createTaskInstance({
                    title: item.title,
                    taskType: 'operations',
                    priorityBase: getDefaultPriorityBase('operations'),
                    dueAt: item.dueAt,
                    originType: 'operations',
                    originId: item.originId,
                    originEvent: item.originEvent,
                    generationKey: item.generationKey,
                    listKey: item.listKey,
                    listTitle: item.listTitle || item.title,
                    listMode: item.listMode || 'sequential',
                    progressSteps: Array.isArray(item.progressSteps) ? item.progressSteps : null,
                    progressKey: Array.isArray(item.progressSteps) && item.progressSteps[0]?.key
                        ? item.progressSteps[0].key
                        : null
                });
                if (created) counters.create += 1;
                else counters.noop += 1;
                return;
            }

            if (item.action === 'update' || item.action === 'reactivate') {
                const firstStepKey = Array.isArray(item.progressSteps) ? (item.progressSteps[0]?.key || null) : null;
                db.prepare(`
                    UPDATE task_instances
                    SET due_at = ?,
                        list_title = ?,
                        list_mode = ?,
                        progress_steps = ?,
                        progress_key = CASE
                            WHEN ? = 1 THEN ?
                            ELSE progress_key
                        END,
                        archived_at = CASE
                            WHEN ? = 1 THEN NULL
                            ELSE archived_at
                        END,
                        completed_at = CASE
                            WHEN ? = 1 THEN NULL
                            ELSE completed_at
                        END,
                        state = CASE
                            WHEN ? = 1 THEN 'open'
                            ELSE state
                        END,
                        blocked = CASE
                            WHEN ? = 1 THEN 0
                            ELSE blocked
                        END
                    WHERE id = ?
                `).run(
                    item.dueAt || null,
                    item.listTitle || item.title || item.listKey || null,
                    item.listMode || 'sequential',
                    Array.isArray(item.progressSteps) ? JSON.stringify(item.progressSteps) : null,
                    item.action === 'reactivate' && String(item.listMode || '').toLowerCase() === 'progressive' && Boolean(firstStepKey) ? 1 : 0,
                    firstStepKey,
                    item.action === 'reactivate' ? 1 : 0,
                    item.action === 'reactivate' ? 1 : 0,
                    item.action === 'reactivate' ? 1 : 0,
                    item.action === 'reactivate' ? 1 : 0,
                    item.action === 'reactivate' ? 1 : 0,
                    item.existingId
                );
                db.prepare('UPDATE tasks_new SET title = ?, updated_at = ? WHERE id = ?').run(
                    item.title,
                    new Date().toISOString(),
                    item.existingTaskId
                );
                counters[item.action] += 1;
                return;
            }

            counters.noop += 1;
        } catch {
            counters.failed += 1;
        }
    });

    return counters;
};

export const seedOperationsTasksFromTemplates = ({ now = new Date(), rehydrate = false, dryRun = false } = {}) => {
    if (!tableExists('recurring_task_templates')) return;
    const plan = buildOperationsSeedPlan({ now, rehydrate });
    if (dryRun) return plan;
    const summary = applyOperationsSeedPlan(plan);
    return {
        ...plan,
        summary: {
            ...plan.summary,
            ...summary
        }
    };
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
    const operationsSeed = seedOperationsTasksFromTemplates();
    seedEventTasksFromTemplates();
    taskEngineRuntime = {
        ...taskEngineRuntime,
        lastSeedAt: new Date().toISOString(),
        lastSeedSummary: {
            operations: operationsSeed?.summary || null
        }
    };
};

export const getTaskEngineHealth = () => {
    const canQueryOrigins = tableExists('task_instances') && tableExists('task_origins');
    const byOriginType = canQueryOrigins
        ? db.prepare(`
            SELECT
                COALESCE(src.origin_type, 'unknown') AS origin_type,
                COUNT(*) AS total,
                SUM(CASE WHEN ti.archived_at IS NULL THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN ti.completed_at IS NULL THEN 1 ELSE 0 END) AS openish
            FROM task_instances ti
            LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
            GROUP BY COALESCE(src.origin_type, 'unknown')
            ORDER BY origin_type
        `).all()
        : [];

    const operationsByOrigin = canQueryOrigins
        ? db.prepare(`
            SELECT
                COALESCE(src.origin_id, '<null>') AS origin_id,
                COUNT(*) AS total,
                SUM(CASE WHEN ti.archived_at IS NULL THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN ti.completed_at IS NULL THEN 1 ELSE 0 END) AS openish
            FROM task_instances ti
            LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
            WHERE src.origin_type = 'operations'
            GROUP BY COALESCE(src.origin_id, '<null>')
            ORDER BY origin_id
        `).all()
        : [];

    const templatesByOrigin = tableExists('recurring_task_templates')
        ? db.prepare(`
            SELECT origin_type, COALESCE(origin_id, '<null>') AS origin_id, COUNT(*) AS total
            FROM recurring_task_templates
            WHERE active = 1
            GROUP BY origin_type, COALESCE(origin_id, '<null>')
            ORDER BY origin_type, origin_id
        `).all()
        : [];

    return {
        now: new Date().toISOString(),
        runtime: taskEngineRuntime,
        templatesByOrigin,
        byOriginType,
        operationsByOrigin
    };
};

const UNUSED_auditAndCleanupOrphanTasks = () => {
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

const UNUSED_repairMissingOrigins = () => {
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

const UNUSED_purgeTemplateOrphanTasks = () => {
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
