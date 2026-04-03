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
import { recordTaskProgressHistory } from '../helpers/task-progress-history.js';
import { normalizeWorshipTypeSlug } from '../helpers/worship-service-utils.js';

const DEFAULT_ORGANIST_ID = 'rob-hovencamp';
const STATUS_PROGRESS_STEPS = [
    { key: 'in-process', title: 'In Process', sort_order: 10 },
    { key: 'done', title: 'Done', sort_order: 20 }
];

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
const getEventTypeIdBySlug = (slug) => {
    if (!tableExists('event_types')) return null;
    const row = db.prepare('SELECT id FROM event_types WHERE slug = ? LIMIT 1').get(slug);
    return Number.isFinite(Number(row?.id)) ? Number(row.id) : null;
};

const getEventTypeIdsBySlugs = (slugs = []) => (
    slugs
        .map((slug) => ({ slug, id: getEventTypeIdBySlug(slug) }))
        .filter((entry) => Number.isFinite(entry.id))
);

const cleanupSundaySpecialEventPlaceholders = () => {
    if (tableExists('recurring_task_templates')) {
        db.prepare(`
            DELETE FROM recurring_task_templates
            WHERE origin_type = 'sunday' AND list_key = 'special-events'
        `).run();
    }
    if (!tableExists('task_instances') || !tableExists('task_origins')) return;
    const rows = db.prepare(`
        SELECT ti.id
        FROM task_instances ti
        JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        WHERE src.origin_type = 'sunday'
          AND ti.list_key = 'special-events'
    `).all();
    rows.forEach((row) => deleteTaskInstance(row.id));
};

const upsertRecurringTemplateDefinition = (definition) => {
    if (!tableExists('recurring_task_templates')) return;
    const now = new Date().toISOString();
    const existing = db.prepare(`
        SELECT id
        FROM recurring_task_templates
        WHERE id = ?
           OR (
                origin_type = ?
                AND COALESCE(origin_id, '') = COALESCE(?, '')
                AND COALESCE(list_key, '') = COALESCE(?, '')
                AND step_key = ?
           )
        LIMIT 1
    `).get(definition.id, definition.originType, definition.originId, definition.listKey, definition.stepKey);
    if (existing?.id) {
        db.prepare(`
            UPDATE recurring_task_templates
            SET origin_type = ?,
                origin_id = ?,
                list_key = ?,
                list_title = ?,
                list_mode = ?,
                step_key = ?,
                title = ?,
                sort_order = ?,
                due_offset_days = ?,
                priority_base = ?,
                active = 1,
                updated_at = ?
            WHERE id = ?
        `).run(
            definition.originType,
            definition.originId,
            definition.listKey,
            definition.listTitle,
            definition.listMode,
            definition.stepKey,
            definition.title,
            definition.sortOrder,
            definition.dueOffsetDays,
            definition.priorityBase,
            now,
            definition.id
        );
        return;
    }
    db.prepare(`
        INSERT INTO recurring_task_templates (
            id, origin_type, origin_id, list_key, list_title, list_mode,
            step_key, title, sort_order, due_offset_days, priority_base,
            active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
        definition.id,
        definition.originType,
        definition.originId,
        definition.listKey,
        definition.listTitle,
        definition.listMode,
        definition.stepKey,
        definition.title,
        definition.sortOrder,
        definition.dueOffsetDays,
        definition.priorityBase,
        now,
        now
    );
};

const getStatusTemplateDefinitions = ({
    templateIdPrefix,
    listKey,
    listTitle,
    dueOffsetDays,
    priorityBase
}) => STATUS_PROGRESS_STEPS.map((step, index) => ({
    id: `${templateIdPrefix}-${listKey}-${step.key}`,
    listKey,
    listTitle,
    listMode: 'progressive',
    stepKey: `${listKey}-${step.key}`,
    title: step.title,
    sortOrder: step.sort_order,
    dueOffsetDays: index === 0 ? dueOffsetDays : -1,
    priorityBase
}));

const WORSHIP_TEMPLATE_SCHEMAS = {
    'rite-i-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-ritei',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-ritei',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'rite-ii-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'insert',
            listTitle: 'Insert',
            dueOffsetDays: -4,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-riteii',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'weekly-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'insert',
            listTitle: 'Insert',
            dueOffsetDays: -4,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-weekly',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 62
        })
    ],
    'special-service': [
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'bulletin',
            listTitle: 'Bulletin',
            dueOffsetDays: -5,
            priorityBase: 70
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'clergy',
            listTitle: 'Clergy & Roles',
            dueOffsetDays: -7,
            priorityBase: 68
        }),
        ...getStatusTemplateDefinitions({
            templateIdPrefix: 'tmpl-event-worship-special',
            listKey: 'music',
            listTitle: 'Music',
            dueOffsetDays: -7,
            priorityBase: 66
        })
    ],
    'eucharist-service': []
};

const ensureDefaultWorshipServiceTemplates = () => {
    const worshipTypeIds = getEventTypeIdsBySlugs(Object.keys(WORSHIP_TEMPLATE_SCHEMAS));
    if (!worshipTypeIds.length) return;
    const originIds = worshipTypeIds.map((row) => String(row.id));
    const placeholders = originIds.map(() => '?').join(', ');
    db.prepare(`
        DELETE FROM recurring_task_templates
        WHERE origin_type = 'event'
          AND origin_id IN (${placeholders})
    `).run(...originIds);

    worshipTypeIds.forEach(({ slug, id }) => {
        const definitions = WORSHIP_TEMPLATE_SCHEMAS[slug] || [];
        definitions.forEach((definition) => upsertRecurringTemplateDefinition({
            ...definition,
            id: `${definition.id}-${slug}`,
            originType: 'event',
            originId: String(id)
        }));
    });
};
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
    if (!tableHasColumn('recurring_task_templates', 'anchor_monthdays')) {
        db.exec("ALTER TABLE recurring_task_templates ADD COLUMN anchor_monthdays TEXT DEFAULT NULL");
    }
    if (!tableHasColumn('recurring_task_templates', 'schedule_rule')) {
        db.exec("ALTER TABLE recurring_task_templates ADD COLUMN schedule_rule TEXT DEFAULT NULL");
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
    if (!tableExists('recurring_task_templates')) return 0;

    const orphaned = db.prepare(`
        SELECT id FROM recurring_task_templates
        WHERE origin_type = 'operations'
          AND active = 0
          AND updated_at < date('now', '-30 days')
    `).all();

    if (!orphaned.length) return 0;

    const placeholders = orphaned.map(() => '?').join(', ');
    const result = db.prepare(`
        DELETE FROM recurring_task_templates
        WHERE id IN (${placeholders})
    `).run(...orphaned.map((row) => row.id));

    return Number(result.changes || 0);
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

const getNthWeekdayOfMonth = (year, monthIndex, weekday, nth) => {
    const first = new Date(year, monthIndex, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, monthIndex, 1 + offset + ((nth - 1) * 7));
};

const getVestryMeetingDate = (year, monthIndex) => {
    const nth = (monthIndex === 10 || monthIndex === 11) ? 3 : 4;
    return getNthWeekdayOfMonth(year, monthIndex, 4, nth);
};

const getVestryTaskSchedule = ({ year, monthIndex, listKey, dueOffsetDays = null } = {}) => {
    const meetingDate = getVestryMeetingDate(year, monthIndex);
    const meetingKey = toDateKey(meetingDate);
    const mondayBeforeKey = addDaysIso(meetingKey, -3);
    const mondayAfterKey = addDaysIso(meetingKey, 4);
    const normalizedListKey = normalizeListKey(listKey);
    const startAt = normalizedListKey === 'postvestry' ? mondayAfterKey : mondayBeforeKey;

    if (dueOffsetDays != null && String(dueOffsetDays).trim() !== '' && Number.isFinite(Number(dueOffsetDays))) {
        return {
            meetingKey,
            startAt,
            dueAt: addDaysIso(meetingKey, Number(dueOffsetDays))
        };
    }

    if (normalizedListKey === 'postvestry') {
        return {
            meetingKey,
            startAt: mondayAfterKey,
            dueAt: addDaysIso(meetingKey, 7)
        };
    }

    if (normalizedListKey === 'email' || normalizedListKey === 'print') {
        return {
            meetingKey,
            startAt: mondayBeforeKey,
            dueAt: addDaysIso(meetingKey, -1)
        };
    }

    return {
        meetingKey,
        startAt: mondayBeforeKey,
        dueAt: meetingKey
    };
};

const getEventTaskSchedule = ({ dateKey, dueOffsets = [] } = {}) => {
    const validOffsets = (Array.isArray(dueOffsets) ? dueOffsets : [dueOffsets])
        .filter((value) => value != null && String(value).trim() !== '')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    if (!dateKey || !validOffsets.length) {
        return {
            startAt: dateKey || null,
            dueAt: dateKey || null
        };
    }
    return {
        startAt: addDaysIso(dateKey, Math.min(...validOffsets)),
        dueAt: addDaysIso(dateKey, Math.max(...validOffsets))
    };
};

const parseJsonObject = (value, fallback = {}) => {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
};

const getEventSeedContext = (occurrenceId) => {
    if (!occurrenceId || !tableExists('event_occurrences') || !tableExists('events')) return null;
    return db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.notes,
            e.id AS event_id,
            e.title,
            t.slug AS type_slug
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON t.id = e.event_type_id
        WHERE o.id = ?
        LIMIT 1
    `).get(occurrenceId);
};

const hasAnyAssignmentForRole = (occurrenceId, roleKey) => {
    if (!tableExists('assignments')) return false;
    const row = db.prepare(`
        SELECT 1
        FROM assignments
        WHERE occurrence_id = ?
          AND role_key = ?
        LIMIT 1
    `).get(occurrenceId, roleKey);
    return !!row;
};

const shouldSeedRegularServiceMusicTask = (occurrenceId) => !hasAnyAssignmentForRole(occurrenceId, 'organist');

const getAllowedWorshipTaskListKeys = ({ occurrenceId, typeSlug }) => {
    const normalizedType = normalizeWorshipTypeSlug(typeSlug);
    if (normalizedType === 'rite-i-service') {
        return shouldSeedRegularServiceMusicTask(occurrenceId)
            ? new Set(['bulletin', 'music'])
            : new Set(['bulletin']);
    }
    if (normalizedType === 'rite-ii-service') {
        return shouldSeedRegularServiceMusicTask(occurrenceId)
            ? new Set(['bulletin', 'insert', 'music'])
            : new Set(['bulletin', 'insert']);
    }
    if (normalizedType === 'special-service') {
        return new Set(['bulletin', 'clergy', 'music']);
    }
    if (normalizedType === 'eucharist-service') {
        return new Set();
    }
    return null;
};

const pruneSeededEventTasksForOccurrence = ({ occurrenceId, allowedListKeys }) => {
    if (!occurrenceId || !allowedListKeys || !tableExists('task_instances') || !tableExists('task_origins')) return;
    const rows = db.prepare(`
        SELECT ti.id AS task_instance_id, COALESCE(ti.list_key, '') AS list_key
        FROM task_instances ti
        JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
        WHERE src.origin_type = 'event'
          AND src.origin_id = ?
          AND ti.generated_from = 'seed'
          AND ti.archived_at IS NULL
    `).all(occurrenceId);

    rows.forEach((row) => {
        if (allowedListKeys.has(row.list_key)) return;
        deleteTaskInstance(row.task_instance_id);
    });
};

const parseMonthdays = (value, fallback = []) => {
    if (!value) return fallback;
    const monthdays = String(value)
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((part) => Number.isInteger(part) && part >= 1 && part <= 31);
    return monthdays.length ? monthdays : fallback;
};

const getStrictPreviousMonday = (dateValue) => {
    const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    const weekday = date.getDay();
    const delta = weekday === 1 ? 7 : (weekday + 6) % 7;
    date.setDate(date.getDate() - delta);
    return date;
};

const getTimesheetTargetPeriod = (templates, now = new Date()) => {
    const configTemplate = Array.isArray(templates) ? templates.find((template) => template) : null;
    const anchorMonthdays = parseMonthdays(configTemplate?.anchor_monthdays, [10, 25]);
    const scheduleRule = String(configTemplate?.schedule_rule || 'friday_before_monday_before_anchor').trim().toLowerCase();
    const today = now instanceof Date ? new Date(now) : new Date(now);
    if (Number.isNaN(today.getTime())) return null;
    today.setHours(0, 0, 0, 0);

    const candidates = [];
    for (let monthOffset = 0; monthOffset <= 2; monthOffset += 1) {
        const cursor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
        anchorMonthdays.forEach((monthday) => {
            const anchorDate = new Date(cursor.getFullYear(), cursor.getMonth(), monthday);
            if (anchorDate.getMonth() !== cursor.getMonth()) return;
            anchorDate.setHours(0, 0, 0, 0);
            candidates.push(anchorDate);
        });
    }

    const periodEnd = candidates
        .sort((a, b) => a.getTime() - b.getTime())
        .find((candidate) => candidate.getTime() >= today.getTime());

    if (!periodEnd) return null;

    let dueDate = new Date(periodEnd);
    if (scheduleRule === 'friday_before_monday_before_anchor') {
        const mondayBeforeAnchor = getStrictPreviousMonday(periodEnd);
        dueDate = mondayBeforeAnchor ? new Date(mondayBeforeAnchor) : dueDate;
        dueDate.setDate(dueDate.getDate() - 3);
    }

    const periodMonthKey = toMonthKey(periodEnd);
    const periodHalf = periodEnd.getDate() <= 15 ? 'a' : 'b';

    return {
        originId: `timesheets-${periodMonthKey}-${periodHalf}`,
        periodEndKey: toDateKey(periodEnd),
        dueAt: toDateKey(dueDate)
    };
};

export const createTaskInstance = (payload) => {
    const {
        title,
        taskType = null,
        priorityBase = 50,
        dueAt = null,
        startAt = null,
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
        taskInstanceId, taskId, 'open', dueAt, startAt, null, 'seed', generationKey,
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

    recordTaskProgressHistory({
        after: {
            id: taskInstanceId,
            task_id: taskId,
            title,
            state: 'open',
            blocked: 0,
            completed_at: null,
            progress_key: progressKey || '',
            progress_steps: Array.isArray(progressSteps) ? progressSteps : [],
            list_key: listKey,
            list_title: listTitle,
            list_mode: listMode || 'sequential',
            origin_type: originType,
            origin_id: originId,
            origin_event: originEvent
        },
        source: 'task-engine',
        actor: 'seed'
    });

    return taskInstanceId;
};

const syncSeededTaskInstance = ({
    generationKey,
    title,
    taskType = null,
    priorityBase = 50,
    dueAt = null,
    startAt = null,
    slaTargetAt = null,
    listKey = null,
    listTitle = null,
    listMode = 'sequential',
    progressSteps = null
} = {}) => {
    if (!generationKey || !tableHasColumn('task_instances', 'generation_key')) return null;
    const existing = db.prepare(`
        SELECT ti.id, ti.task_id, ti.completed_at, ti.progress_key
        FROM task_instances ti
        WHERE ti.generation_key = ?
        LIMIT 1
    `).get(generationKey);
    if (!existing) return null;

    const now = new Date().toISOString();
    const normalizedSteps = Array.isArray(progressSteps) ? progressSteps : [];
    const stepKeys = new Set(normalizedSteps.map((step) => String(step?.key || '').trim()).filter(Boolean));
    const firstStepKey = normalizedSteps[0]?.key || '';
    const nextProgressKey = stepKeys.size === 0
        ? existing.progress_key || ''
        : (stepKeys.has(String(existing.progress_key || '').trim())
            ? String(existing.progress_key || '').trim()
            : (existing.progress_key ? firstStepKey : ''));

    db.prepare(`
        UPDATE tasks_new
        SET title = ?, priority_base = ?, task_type = ?, updated_at = ?
        WHERE id = ?
    `).run(title, priorityBase, taskType, now, existing.task_id);

    db.prepare(`
        UPDATE task_instances
        SET due_at = ?,
            start_at = ?,
            sla_target_at = ?,
            list_key = ?,
            list_title = ?,
            list_mode = ?,
            progress_key = ?,
            progress_steps = ?,
            archived_at = CASE WHEN completed_at IS NULL THEN NULL ELSE archived_at END
        WHERE id = ?
    `).run(
        dueAt,
        startAt,
        slaTargetAt,
        listKey,
        listTitle,
        listMode || 'sequential',
        nextProgressKey,
        progressSteps ? JSON.stringify(progressSteps) : null,
        existing.id
    );

    return existing.id;
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
    const grouped = templates.reduce((acc, template) => {
        const listKey = template.list_key || 'list';
        const listMode = template.list_mode || 'sequential';
        const groupKey = `${listKey}:${listMode}`;
        if (!acc[groupKey]) acc[groupKey] = [];
        acc[groupKey].push(template);
        return acc;
    }, {});
    const targetMonths = [0, 1].map((offset) => {
        const monthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        return {
            year: monthDate.getFullYear(),
            monthIndex: monthDate.getMonth(),
            monthKey: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
        };
    });

    targetMonths.forEach(({ year, monthIndex, monthKey }) => {
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
                const explicitOffsets = steps
                    .filter((step) => step.due_offset_days != null && String(step.due_offset_days).trim() !== '')
                    .map((step) => Number(step.due_offset_days))
                    .filter((value) => Number.isFinite(value));
                const schedule = getVestryTaskSchedule({
                    year,
                    monthIndex,
                    listKey,
                    dueOffsetDays: explicitOffsets.length ? Math.max(...explicitOffsets) : null
                });
                const generationKey = `vestry:${monthKey}:${listKey || 'list'}:progressive`;
                const payload = {
                    title: listTitle || listKey || 'Task',
                    taskType: 'vestry',
                    priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('vestry'),
                    dueAt: schedule.dueAt,
                    startAt: schedule.startAt,
                    originType: 'vestry',
                    originId: monthKey,
                    originEvent: listKey || 'progressive',
                    generationKey,
                    listKey,
                    listTitle,
                    listMode: 'progressive',
                    progressSteps: steps
                };
                if (!syncSeededTaskInstance(payload)) {
                    createTaskInstance(payload);
                }
                return;
            }
            groupTemplates.forEach((template) => {
                const schedule = getVestryTaskSchedule({
                    year,
                    monthIndex,
                    listKey: template.list_key || listKey,
                    dueOffsetDays: template.due_offset_days
                });
                const payload = {
                    title: template.title,
                    taskType: 'vestry',
                    priorityBase: Number.isFinite(Number(template.priority_base)) ? Number(template.priority_base) : getDefaultPriorityBase('vestry'),
                    dueAt: schedule.dueAt,
                    startAt: schedule.startAt,
                    originType: 'vestry',
                    originId: monthKey,
                    originEvent: template.step_key,
                    generationKey: `vestry:${monthKey}:${template.list_key || 'list'}:${template.step_key}`,
                    listKey: template.list_key || null,
                    listTitle: template.list_title || null,
                    listMode: template.list_mode || 'sequential'
                };
                if (!syncSeededTaskInstance(payload)) {
                    createTaskInstance(payload);
                }
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

    const monthKey = toMonthKey(now);
    const yearKey = toYearKey(now);
    const monthlyOriginId = `monthly-${monthKey}`;
    const yearlyOriginId = `yearly-${yearKey}`;
    const monthStartKey = `${monthKey}-01`;
    const monthEndKey = getLastDayOfMonthKey(now.getFullYear(), now.getMonth());
    const yearStartKey = `${yearKey}-01-01`;
    const yearEndKey = `${yearKey}-12-31`;
    const timesheetPeriod = getTimesheetTargetPeriod(timesheetTemplates, now);
    const timesheetsOriginId = timesheetPeriod?.originId || `timesheets-${monthKey}-a`;
    const timesheetDue = timesheetPeriod?.dueAt || `${monthKey}-10`;

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
                const existingRow = db.prepare(`
                    SELECT ti.id, ti.task_id, ti.state, ti.blocked, ti.completed_at, ti.progress_key, ti.progress_steps,
                           ti.list_key, ti.list_title, ti.list_mode, t.title,
                           src.origin_type, src.origin_id, src.origin_event
                    FROM task_instances ti
                    JOIN tasks_new t ON t.id = ti.task_id
                    LEFT JOIN task_origins src ON src.scope = 'instance' AND src.task_instance_id = ti.id
                    WHERE ti.id = ?
                `).get(item.existingId);
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
                recordTaskProgressHistory({
                    before: existingRow,
                    after: {
                        ...existingRow,
                        title: item.title,
                        state: item.action === 'reactivate' ? 'open' : existingRow?.state,
                        blocked: item.action === 'reactivate' ? 0 : existingRow?.blocked,
                        completed_at: item.action === 'reactivate' ? null : existingRow?.completed_at,
                        progress_key: item.action === 'reactivate'
                            && String(item.listMode || '').toLowerCase() === 'progressive'
                            && firstStepKey
                            ? firstStepKey
                            : existingRow?.progress_key,
                        progress_steps: Array.isArray(item.progressSteps) ? item.progressSteps : [],
                        list_key: item.listKey,
                        list_title: item.listTitle || item.title || item.listKey || null,
                        list_mode: item.listMode || 'sequential',
                        origin_type: existingRow?.origin_type || 'operations',
                        origin_id: existingRow?.origin_id || item.originId,
                        origin_event: existingRow?.origin_event || item.originEvent
                    },
                    source: 'task-engine',
                    actor: item.action
                });
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
    const context = getEventSeedContext(occurrenceId);
    const allowedWorshipListKeys = context?.type_slug
        ? getAllowedWorshipTaskListKeys({
            occurrenceId,
            typeSlug: context.type_slug
        })
        : null;
    if (allowedWorshipListKeys) {
        pruneSeededEventTasksForOccurrence({
            occurrenceId,
            allowedListKeys: allowedWorshipListKeys
        });
    }
    const templates = listRecurringTemplates('event', String(eventTypeId));
    const filteredTemplates = allowedWorshipListKeys
        ? templates.filter((template) => allowedWorshipListKeys.has(template.list_key || ''))
        : templates;
    if (!filteredTemplates.length) return;
    const grouped = filteredTemplates.reduce((acc, template) => {
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
            const schedule = getEventTaskSchedule({
                dateKey,
                dueOffsets: steps.map((step) => step.due_offset_days)
            });
            const payload = {
                title: listTitle || listKey || 'Task',
                taskType: 'event',
                priorityBase: Number.isFinite(Number(groupTemplates[0]?.priority_base)) ? Number(groupTemplates[0].priority_base) : getDefaultPriorityBase('event'),
                dueAt: schedule.dueAt,
                startAt: schedule.startAt,
                originType: 'event',
                originId: occurrenceId,
                originEvent: listKey || 'progressive',
                generationKey: `event:${occurrenceId}:${listKey || 'list'}:progressive`,
                listKey,
                listTitle,
                listMode: 'progressive',
                progressSteps: steps
            };
            if (!syncSeededTaskInstance(payload)) {
                createTaskInstance(payload);
            }
            return;
        }
        groupTemplates.forEach((template) => {
            const schedule = getEventTaskSchedule({
                dateKey,
                dueOffsets: [template.due_offset_days]
            });
            const payload = {
                title: template.title,
                taskType: 'event',
                priorityBase: Number.isFinite(Number(template.priority_base)) ? Number(template.priority_base) : getDefaultPriorityBase('event'),
                dueAt: schedule.dueAt,
                startAt: schedule.startAt,
                originType: 'event',
                originId: occurrenceId,
                originEvent: template.step_key,
                generationKey: `event:${occurrenceId}:${template.list_key || 'list'}:${template.step_key}`,
                listKey: template.list_key || null,
                listTitle: template.list_title || null,
                listMode: template.list_mode || 'sequential'
            };
            if (!syncSeededTaskInstance(payload)) {
                createTaskInstance(payload);
            }
        });
    });
};

export const seedEventTasksFromTemplates = (daysAhead = 400) => {
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

const cleanupDuplicateEventServiceReadyTasks = () => {
    if (!tableExists('task_instances') || !tableExists('task_origins')) return 0;
    const rows = db.prepare(`
        SELECT legacy.task_instance_id AS task_instance_id
        FROM view_task_source legacy
        JOIN view_task_source canonical
          ON canonical.origin_type = 'event'
         AND canonical.origin_id = legacy.origin_id
         AND canonical.origin_event = 'service-ready'
        WHERE legacy.origin_type = 'event'
          AND legacy.origin_event = 'ready'
    `).all();
    rows.forEach((row) => deleteTaskInstance(row.task_instance_id));
    return rows.length;
};

const getListRollupCandidate = (listTasks = []) => {
    if (!Array.isArray(listTasks) || !listTasks.length) return null;
    const listMode = listTasks[0]?.list_mode || 'sequential';
    const hasSequence = listMode === 'sequential'
        || listTasks.some((task) => task.rank != null || task.step_order != null);
    if (!hasSequence) {
        return sortTasksByPriority(listTasks)[0] || null;
    }

    const sorted = [...listTasks].sort((a, b) => {
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
    const chainMax = Math.max(...listTasks.map((task) => task.priority_effective ?? 0));
    return {
        ...sorted[0],
        priority_effective: chainMax,
        priority_tier: getPriorityTier(chainMax)
    };
};

const getOriginNextTask = (openTasks = []) => {
    if (!Array.isArray(openTasks) || !openTasks.length) return null;
    const listGroups = openTasks.reduce((acc, task) => {
        const listKey = task.list_key || 'default';
        if (!acc[listKey]) acc[listKey] = [];
        acc[listKey].push(task);
        return acc;
    }, {});
    const listCandidates = Object.values(listGroups)
        .map((listTasks) => getListRollupCandidate(listTasks))
        .filter(Boolean);
    if (!listCandidates.length) return null;
    return sortTasksByPriority(listCandidates)[0] || null;
};

export const listTaskInstances = (whereClause = '', params = []) => {
    if (tableExists('tasks_new') && tableExists('task_instances')) {
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

export const runTaskMaintenance = () => {
    ensureTaskInstanceNotes();
    const archivedCount = applyTaskArchiving() || 0;
    return {
        archivedCount,
        archivedAt: taskEngineRuntime.lastArchiveSweepAt
    };
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
        const nextTask = getOriginNextTask(openTasks);
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
    cleanupSundaySpecialEventPlaceholders();
    ensureDefaultWorshipServiceTemplates();
    cleanupDuplicateEventServiceReadyTasks();

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

