import express from 'express';
import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import {
    tableExists,
    parseJsonField,
    ensureUniqueId
} from '../helpers/db-utils.js';
import { normalizeName } from '../helpers/people-utils.js';
import {
    sortTasksByPriority,
    getDefaultPriorityBase
} from '../helpers/task-utils.js';
import {
    recordTaskProgressHistory,
    listTaskProgressHistory,
    buildTaskProgressAudit
} from '../helpers/task-progress-history.js';
import {
    listTaskInstances,
    createTaskInstance,
    deleteTaskInstance,
    buildOriginRollups,
    seedSundayTasksFromTemplates,
    seedVestryTasksFromTemplates,
    seedOperationsTasksFromTemplates,
    seedEventTasksForOccurrence,
    previewOperationsSeedPlan,
    getTaskEngineHealth
} from '../services/taskEngine.js';
import { upsertEntityLink } from '../helpers/entity-utils.js';

const router = express.Router();

const filterVisibleTasks = (tasks, { includeArchived = false, includeFuture = false } = {}) => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return tasks.filter((task) => {
        if (!includeArchived && task.archived_at) return false;
        if (includeFuture) return true;
        if (!task.start_at) return true;
        return task.start_at <= todayKey;
    });
};

const createLegacyTaskEngineTask = db.transaction((payload) => {
    const {
        normalizedText,
        sourceType,
        sourceId,
        sourceEvent,
        priorityBase,
        priorityOverride,
        dueAt,
        rank,
        instanceState,
        notes
    } = payload;
    const now = new Date().toISOString();
    const taskId = `task-${randomUUID()}`;
    const taskInstanceId = `taskinst-${randomUUID()}`;

    db.prepare(`
        INSERT INTO tasks (id, title, description, status, priority_base, created_at, updated_at)
        VALUES (?, ?, NULL, 'active', ?, ?, ?)
    `).run(taskId, normalizedText, priorityBase, now, now);

    db.prepare(`
        INSERT INTO task_instances (
            id, task_id, state, priority_override, rank, due_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskInstanceId,
        taskId,
        instanceState,
        priorityOverride,
        rank,
        dueAt,
        notes,
        now,
        now
    );

    db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        `origin-${taskInstanceId}`,
        'instance',
        taskId,
        taskInstanceId,
        sourceType,
        sourceId,
        sourceEvent,
        now
    );

    return taskInstanceId;
});

const createModernTaskEngineTask = db.transaction((payload) => {
    const {
        normalizedText,
        ticketId,
        taskType,
        priorityBase,
        priorityOverride,
        dueAt,
        slaTargetAt,
        rank,
        blocked,
        computedState,
        listKey,
        listTitle,
        listMode,
        progressKey,
        progressSteps,
        notes,
        originType,
        originId,
        originEvent
    } = payload;
    const now = new Date().toISOString();
    const taskId = `taskdef-${randomUUID()}`;
    const taskInstanceId = `taskinst-${randomUUID()}`;

    db.prepare(`
        INSERT INTO tasks_new (
            id, title, description, status, priority_base, task_type, due_mode,
            default_duration_min, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskId,
        normalizedText,
        null,
        'active',
        priorityBase,
        taskType,
        'floating',
        null,
        now,
        now
    );

    db.prepare(`
        INSERT INTO task_instances (
            id, task_id, state, due_at, start_at, completed_at, generated_from,
            generation_key, priority_override, rank, sla_target_at, blocked,
            list_key, list_title, list_mode, progress_key, progress_steps, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        taskInstanceId,
        taskId,
        computedState,
        dueAt,
        null,
        null,
        ticketId ? 'ticket' : 'manual',
        null,
        priorityOverride,
        rank,
        slaTargetAt,
        Number(blocked) ? 1 : 0,
        listKey,
        listTitle,
        listMode,
        progressKey,
        progressSteps,
        notes,
    );

    db.prepare(`
        INSERT INTO task_origins (
            id, scope, task_id, task_instance_id, origin_type, origin_id, origin_event, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        `origin-${taskInstanceId}`,
        'instance',
        taskId,
        taskInstanceId,
        originType,
        originId,
        originEvent,
        now
    );

    upsertEntityLink({
        fromType: 'task_instance',
        fromId: taskInstanceId,
        toType: originType,
        toId: originId,
        role: 'source',
        metaJson: JSON.stringify({ origin_event: originEvent })
    });

    return taskInstanceId;
});

// --- Tasks ---

router.get('/tasks', (req, res) => {
    const includeArchived = String(req.query.include_archived || '').trim() === '1';
    const includeFuture = String(req.query.include_future || '').trim() === '1';
    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    const rollup = String(req.query.rollup || '').trim() === '1';
    const whereClause = originType && originId
        ? `WHERE src.origin_type = ? AND src.origin_id = ?`
        : '';
    const rows = listTaskInstances(whereClause, originType && originId ? [originType, originId] : []);
    const tasks = sortTasksByPriority(filterVisibleTasks(rows, { includeArchived, includeFuture }));
    if (!rollup) {
        return res.json(tasks);
    }
    let sortedRollup = buildOriginRollups(tasks)
        .map((origin) => origin.next_task)
        .filter(Boolean);
    const sundayCandidates = sortedRollup.filter(
        (task) => task.origin_type === 'sunday' && task.origin_id
    );
    if (sundayCandidates.length) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const sundayIds = sundayCandidates
            .map((task) => task.origin_id)
            .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
            .sort();
        const nextSundayId = sundayIds.find((value) => value >= todayKey) || sundayIds[0];
        if (nextSundayId) {
            sortedRollup = sortedRollup.filter((task) => (
                task.origin_type !== 'sunday' || task.origin_id === nextSundayId
            ));
        }
    }
    return res.json(sortedRollup);
});

router.get('/tasks/progress-audit', (req, res) => {
    const days = Math.max(7, Math.min(365, Number(req.query.days) || 120));
    const clusterWindowMinutes = Math.max(1, Math.min(60, Number(req.query.cluster_window_minutes) || 5));
    const minClusterSize = Math.max(2, Math.min(20, Number(req.query.min_cluster_size) || 3));
    const tasks = listTaskInstances('');
    return res.json(buildTaskProgressAudit(tasks, {
        days,
        cluster_window_minutes: clusterWindowMinutes,
        min_cluster_size: minClusterSize
    }));
});

router.get('/tasks/:id/progress-history', (req, res) => {
    const { id } = req.params;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const history = listTaskProgressHistory(id, limit);
    return res.json({
        task_instance_id: id,
        count: history.length,
        history
    });
});

router.post('/tasks', (req, res) => {
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const {
            text,
            source_type = 'manual',
            source_id = 'manual',
            source_event = 'created',
            priority_base = null,
            priority_override = null,
            due_at = null,
            rank = null,
            state = null,
            notes = null
        } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const basePriority = Number.isFinite(Number(priority_base)) ? Number(priority_base) : 50;
        const instanceState = state || 'open';
        const taskInstanceId = createLegacyTaskEngineTask({
            normalizedText,
            sourceType: source_type || 'manual',
            sourceId: source_id || 'manual',
            sourceEvent: source_event || 'created',
            priorityBase: basePriority,
            priorityOverride: priority_override,
            dueAt: due_at,
            rank,
            instanceState,
            notes: notes ? String(notes).trim() : null
        });

        const [created] = listTaskInstances('WHERE ti.id = ?', [taskInstanceId]);
        return res.status(201).json(created);
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const { text, ticket_id = null, notes = null } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        if (ticket_id) {
            const ticketExists = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticket_id);
            if (!ticketExists) {
                return res.status(400).json({ error: 'Ticket not found' });
            }
        }
        const id = ensureUniqueId(`task-${Date.now()}`, 'tasks');
        const createdAt = new Date().toISOString();
        db.prepare(`
            INSERT INTO tasks (id, ticket_id, text, completed, created_at, notes)
            VALUES (?, ?, ?, 0, ?, ?)
        `).run(id, ticket_id, normalizedText, createdAt, notes ? String(notes).trim() : null);
        return res.status(201).json({
            id,
            ticket_id,
            text: normalizedText,
            completed: false,
            created_at: createdAt,
            completed_at: null,
            notes: notes ? String(notes).trim() : ''
        });
    }
    const {
        text,
        ticket_id = null,
        source_type = null,
        source_id = null,
        source_event = null,
        task_type = null,
        priority_base = null,
        priority_override = null,
        due_at = null,
        sla_target_at = null,
        rank = null,
        state = null,
        blocked = 0,
        list_key = null,
        list_title = null,
        list_mode = 'sequential',
        progress_key = null,
        progress_steps = null,
        notes = null
    } = req.body || {};
    const normalizedText = normalizeName(text);
    if (!normalizedText) {
        return res.status(400).json({ error: 'Task text is required' });
    }

    if (ticket_id) {
        const ticketExists = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticket_id);
        if (!ticketExists) {
            return res.status(400).json({ error: 'Ticket not found' });
        }
    }

    const tType = task_type || (ticket_id ? 'support' : null);
    const basePriority = Number.isFinite(Number(priority_base))
        ? Number(priority_base)
        : getDefaultPriorityBase(tType);
    const computedState = state || (Number(blocked) ? 'blocked' : 'open');
    const originType = source_type || (ticket_id ? 'ticket' : 'manual');
    const originId = source_id || (ticket_id ? ticket_id : 'manual');
    const originEvent = source_event || 'created';
    const taskInstanceId = createModernTaskEngineTask({
        normalizedText,
        ticketId: ticket_id,
        taskType: tType,
        priorityBase: basePriority,
        priorityOverride: priority_override,
        dueAt: due_at,
        slaTargetAt: sla_target_at,
        rank,
        blocked,
        computedState,
        listKey: list_key,
        listTitle: list_title || list_key,
        listMode: list_mode || 'sequential',
        progressKey: progress_key,
        progressSteps: progress_steps ? JSON.stringify(progress_steps) : null,
        notes: notes ? String(notes).trim() : null,
        originType,
        originId,
        originEvent
    });

    const [created] = listTaskInstances('WHERE ti.id = ?', [taskInstanceId]);
    recordTaskProgressHistory({
        after: created,
        source: 'api',
        actor: 'create-task'
    });
    res.status(201).json(created);
});

router.put('/tasks/:id', (req, res) => {
    const { id } = req.params;
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const existing = db.prepare(`
            SELECT ti.*, t.title, t.priority_base
            FROM task_instances ti
            JOIN tasks t ON t.id = ti.task_id
            WHERE ti.id = ?
        `).get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const {
            text = existing.title,
            completed = existing.state === 'done',
            priority_override = existing.priority_override,
            due_at = existing.due_at,
            rank = existing.rank,
            notes = existing.notes
        } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
        const nextState = completed ? 'done' : 'open';

        db.prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?')
            .run(normalizedText, new Date().toISOString(), existing.task_id);

        db.prepare(`
            UPDATE task_instances SET
                state = ?,
                due_at = ?,
                priority_override = ?,
                rank = ?,
                notes = ?,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            nextState,
            due_at,
            priority_override,
            rank,
            notes != null ? String(notes).trim() : null,
            completedAt,
            new Date().toISOString(),
            id
        );

        const [updated] = listTaskInstances('WHERE ti.id = ?', [id]);
        return res.json(updated);
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Task not found' });
        }
        const { text = existing.text, completed = existing.completed, notes = existing.notes } = req.body || {};
        const normalizedText = normalizeName(text);
        if (!normalizedText) {
            return res.status(400).json({ error: 'Task text is required' });
        }
        const completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
        db.prepare('UPDATE tasks SET text = ?, completed = ?, completed_at = ?, notes = ? WHERE id = ?')
            .run(normalizedText, completed ? 1 : 0, completedAt, notes != null ? String(notes).trim() : null, id);
        return res.json({
            id,
            ticket_id: existing.ticket_id,
            text: normalizedText,
            completed: !!completed,
            created_at: existing.created_at,
            completed_at: completedAt,
            notes: notes != null ? String(notes).trim() : ''
        });
    }
    const existing = db.prepare(`
        SELECT ti.*, t.title, t.task_type, t.priority_base
        FROM task_instances ti
        JOIN tasks_new t ON t.id = ti.task_id
        WHERE ti.id = ?
    `).get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Task not found' });
    }

    const {
        text = existing.title,
        completed = existing.state === 'done',
        priority_override = existing.priority_override,
        due_at = existing.due_at,
        sla_target_at = existing.sla_target_at,
        rank = existing.rank,
        blocked = existing.blocked,
        archive_after_due = existing.archive_after_due ?? 1,
        keep_until = existing.keep_until || null,
        notes = existing.notes,
        progress_key = existing.progress_key || '',
        progress_steps = null
    } = req.body || {};
    const normalizedText = normalizeName(text);
    if (!normalizedText) {
        return res.status(400).json({ error: 'Task text is required' });
    }

    let completedAt = completed ? (existing.completed_at || new Date().toISOString()) : null;
    let nextState = completed ? 'done' : (Number(blocked) ? 'blocked' : 'open');
    const progressKeyValue = progress_key != null ? String(progress_key) : (existing.progress_key || '');
    const parsedProgressSteps = Array.isArray(progress_steps)
        ? progress_steps
        : (existing.progress_steps ? parseJsonField(existing.progress_steps, []) : []);
    const sortedProgressSteps = Array.isArray(parsedProgressSteps)
        ? parsedProgressSteps.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
        : [];
    const isProgressive = String(existing.list_mode || '').toLowerCase() === 'progressive';
    const isProgressComplete = isProgressive
        && sortedProgressSteps.length > 0
        && progressKeyValue
        && sortedProgressSteps[sortedProgressSteps.length - 1]?.key === progressKeyValue;
    if (isProgressive) {
        if (isProgressComplete) {
            completedAt = completedAt || new Date().toISOString();
            nextState = 'done';
        } else {
            completedAt = null;
            nextState = Number(blocked) ? 'blocked' : 'open';
        }
    }

    db.prepare(`
        UPDATE tasks_new SET title = ?, updated_at = ?
        WHERE id = ?
    `).run(normalizedText, new Date().toISOString(), existing.task_id);

    db.prepare(`
            UPDATE task_instances SET
                state = ?,
                due_at = ?,
                sla_target_at = ?,
                priority_override = ?,
                rank = ?,
                blocked = ?,
                completed_at = ?,
                archive_after_due = ?,
                keep_until = ?,
                progress_key = ?,
                progress_steps = ?,
                notes = ?
            WHERE id = ?
        `).run(
        nextState,
        due_at,
        sla_target_at,
        priority_override,
        rank,
        Number(blocked) ? 1 : 0,
        completedAt,
        Number(archive_after_due) ? 1 : 0,
        keep_until,
        progressKeyValue,
        Array.isArray(progress_steps) ? JSON.stringify(parsedProgressSteps) : existing.progress_steps,
        notes != null ? String(notes).trim() : null,
        id
    );

    const [updated] = listTaskInstances('WHERE ti.id = ?', [id]);
    recordTaskProgressHistory({
        before: existing,
        after: updated,
        source: 'api',
        actor: 'update-task'
    });
    res.json(updated);
});

router.delete('/tasks/:id', (req, res) => {
    const { id } = req.params;
    if (tableExists('tasks') && tableExists('task_instances') && !tableExists('tasks_new')) {
        const row = db.prepare('SELECT task_id FROM task_instances WHERE id = ?').get(id);
        if (!row) {
            return res.status(404).json({ error: 'Task not found' });
        }
        db.prepare('DELETE FROM task_list_items WHERE task_instance_id = ?').run(id);
        db.prepare('DELETE FROM task_instances WHERE id = ?').run(id);
        db.prepare('DELETE FROM task_origins WHERE task_instance_id = ?').run(id);
        const remaining = db.prepare('SELECT 1 FROM task_instances WHERE task_id = ? LIMIT 1').get(row.task_id);
        if (!remaining) {
            db.prepare('DELETE FROM tasks WHERE id = ?').run(row.task_id);
        }
        return res.json({ success: true });
    }

    if (!tableExists('task_instances') || !tableExists('tasks_new')) {
        const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        if (!result.changes) {
            return res.status(404).json({ error: 'Task not found' });
        }
        return res.json({ success: true });
    }
    const ok = deleteTaskInstance(id);
    if (!ok) {
        return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ success: true });
});

router.get('/tasks/engine/health', (_req, res) => {
    try {
        const health = getTaskEngineHealth();
        res.json(health);
    } catch (error) {
        console.error('Task engine health error:', error);
        res.status(500).json({ error: 'Failed to load task engine health' });
    }
});

router.get('/tasks/generator/preview', (req, res) => {
    try {
        const originType = String(req.query.origin_type || 'operations').trim().toLowerCase();
        const rehydrate = String(req.query.rehydrate || '').trim() === '1';
        if (originType !== 'operations') {
            return res.status(400).json({ error: 'Only operations preview is currently supported' });
        }
        const preview = previewOperationsSeedPlan({ rehydrate });
        return res.json({ ok: true, origin_type: originType, preview });
    } catch (error) {
        console.error('Task generator preview error:', error);
        return res.status(500).json({ error: 'Failed to generate preview' });
    }
});

router.post('/tasks/generator/rehydrate', (req, res) => {
    try {
        const originType = String(req.query.origin_type || req.body?.origin_type || 'operations').trim().toLowerCase();
        if (originType !== 'operations') {
            return res.status(400).json({ error: 'Only operations rehydrate is currently supported' });
        }
        const result = seedOperationsTasksFromTemplates({ rehydrate: true });
        return res.json({ ok: true, origin_type: originType, result });
    } catch (error) {
        console.error('Task generator rehydrate error:', error);
        return res.status(500).json({ error: 'Failed to rehydrate recurring tasks' });
    }
});

// --- Origins ---

router.get('/task-origins', (req, res) => {
    const includeArchived = String(req.query.include_archived || '').trim() === '1';
    const includeFuture = String(req.query.include_future || '').trim() === '1';
    const tasks = filterVisibleTasks(listTaskInstances(''), { includeArchived, includeFuture });
    const rollups = buildOriginRollups(tasks).map((origin) => ({
        ...origin,
        label: origin.next_task?.text || `${origin.origin_type}:${origin.origin_id}`
    }));
    res.json(rollups);
});

router.get('/task-origins/links', (req, res) => {
    const includeAll = String(req.query.all || '').trim() === '1';
    if (includeAll) {
        const rows = db.prepare(`
            SELECT
                l.to_type AS child_origin_type,
                l.to_id AS child_origin_id,
                src.origin_type AS parent_origin_type,
                src.origin_id AS parent_origin_id,
                l.meta_json
            FROM entity_links l
            JOIN view_task_source src ON src.task_instance_id = l.from_id
            WHERE l.from_type = 'task_instance'
              AND l.role = 'origin_link'
        `).all();
        const links = rows.map((row) => {
            const meta = parseJsonField(row.meta_json);
            return {
                parent_origin_type: row.parent_origin_type,
                parent_origin_id: row.parent_origin_id,
                child_origin_type: row.child_origin_type,
                child_origin_id: row.child_origin_id,
                label: meta?.label || ''
            };
        });
        return res.json({ links });
    }

    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    if (!originType || !originId) {
        return res.status(400).json({ error: 'origin_type and origin_id are required' });
    }

    const parentLink = db.prepare(`
        SELECT l.from_id AS task_instance_id, l.meta_json
        FROM entity_links l
        WHERE l.from_type = 'task_instance'
          AND l.role = 'origin_link'
          AND l.to_type = ?
          AND l.to_id = ?
        LIMIT 1
    `).get(originType, originId);

    let parent = null;
    if (parentLink?.task_instance_id) {
        const [parentTask] = listTaskInstances('WHERE ti.id = ?', [parentLink.task_instance_id]);
        if (parentTask) {
            const meta = parseJsonField(parentLink.meta_json);
            parent = {
                origin_type: parentTask.origin_type,
                origin_id: parentTask.origin_id,
                task_instance_id: parentLink.task_instance_id,
                label: meta?.label || parentTask.text || ''
            };
        }
    }

    const childLinks = db.prepare(`
        SELECT l.from_id AS task_instance_id, l.to_type, l.to_id, l.meta_json
        FROM entity_links l
        JOIN view_task_source src ON src.task_instance_id = l.from_id
        WHERE l.from_type = 'task_instance'
          AND l.role = 'origin_link'
          AND src.origin_type = ?
          AND src.origin_id = ?
    `).all(originType, originId);

    const childTasks = childLinks.length
        ? listTaskInstances(`WHERE ti.id IN (${childLinks.map(() => '?').join(', ')})`, childLinks.map((row) => row.task_instance_id))
        : [];
    const childTaskMap = new Map(childTasks.map((task) => [task.id, task]));

    const children = childLinks.map((row) => {
        const task = childTaskMap.get(row.task_instance_id);
        const meta = parseJsonField(row.meta_json);
        return {
            task_instance_id: row.task_instance_id,
            origin_type: row.to_type,
            origin_id: row.to_id,
            label: meta?.label || task?.text || ''
        };
    });

    res.json({ parent, children });
});

router.delete('/task-origins', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    const originId = String(req.query.origin_id || '').trim();
    if (!originType || !originId) {
        return res.status(400).json({ error: 'origin_type and origin_id are required' });
    }
    const tasks = listTaskInstances(
        `WHERE src.origin_type = ? AND src.origin_id = ?`,
        [originType, originId]
    );
    tasks.forEach((task) => {
        deleteTaskInstance(task.id);
    });
    res.json({ success: true });
});

router.post('/task-origins/assign', (req, res) => {
    const {
        from_origin_type,
        from_origin_id,
        to_origin_type,
        to_origin_id,
        label
    } = req.body || {};
    if (!from_origin_type || !from_origin_id || !to_origin_type || !to_origin_id) {
        return res.status(400).json({ error: 'from_origin_type, from_origin_id, to_origin_type, and to_origin_id are required' });
    }
    const title = label || `Origin: ${from_origin_type} ${from_origin_id}`;
    const generationKey = `origin-link:${from_origin_type}:${from_origin_id}:to:${to_origin_type}:${to_origin_id}`;
    const taskInstanceId = createTaskInstance({
        title,
        taskType: 'origin-link',
        priorityBase: 50,
        dueAt: null,
        originType: to_origin_type,
        originId: to_origin_id,
        originEvent: 'origin-link',
        generationKey
    });
    if (!taskInstanceId) {
        return res.status(200).json({ success: true, task_instance_id: null });
    }
    upsertEntityLink({
        fromType: 'task_instance',
        fromId: taskInstanceId,
        toType: from_origin_type,
        toId: from_origin_id,
        role: 'origin_link',
        metaJson: JSON.stringify({ label: title })
    });
    res.json({ success: true, task_instance_id: taskInstanceId });
});

// --- Entity Links ---

router.get('/links', (req, res) => {
    const {
        from_type,
        from_id,
        to_type,
        to_id,
        role
    } = req.query || {};
    const filters = [];
    const params = [];
    if (from_type) {
        filters.push('from_type = ?');
        params.push(from_type);
    }
    if (from_id) {
        filters.push('from_id = ?');
        params.push(from_id);
    }
    if (to_type) {
        filters.push('to_type = ?');
        params.push(to_type);
    }
    if (to_id) {
        filters.push('to_id = ?');
        params.push(to_id);
    }
    if (role) {
        filters.push('role = ?');
        params.push(role);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
        SELECT id, from_type, from_id, to_type, to_id, role, created_at, meta_json
        FROM entity_links
        ${whereClause}
        ORDER BY created_at DESC
    `).all(...params);
    res.json(rows);
});

router.post('/links', (req, res) => {
    const {
        id,
        from_type,
        from_id,
        to_type,
        to_id,
        role = null,
        meta = null
    } = req.body || {};
    if (!from_type || !from_id || !to_type || !to_id) {
        return res.status(400).json({ error: 'from_type, from_id, to_type, and to_id are required' });
    }
    const createdAt = new Date().toISOString();
    const metaJson = meta ? JSON.stringify(meta) : null;
    const linkId = upsertEntityLink({
        id,
        fromType: from_type,
        fromId: from_id,
        toType: to_type,
        toId: to_id,
        role,
        createdAt,
        metaJson
    });
    res.status(201).json({
        id: linkId,
        from_type,
        from_id,
        to_type,
        to_id,
        role,
        created_at: createdAt,
        meta_json: metaJson
    });
});

router.delete('/links/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM entity_links WHERE id = ?').run(id);
    if (!result.changes) {
        return res.status(404).json({ error: 'Link not found' });
    }
    res.json({ success: true });
});

// --- Recurring Task Templates ---

router.get('/recurring-templates', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    if (!originType) {
        return res.status(400).json({ error: 'origin_type is required' });
    }
    if (!tableExists('recurring_task_templates')) {
        return res.json([]);
    }
    const originId = req.query.origin_id ? String(req.query.origin_id) : null;
    const rows = db.prepare(`
        SELECT *
        FROM recurring_task_templates
        WHERE origin_type = ?
          AND (origin_id IS NULL OR origin_id = ?)
        ORDER BY sort_order ASC, title ASC
    `).all(originType, originId);
    res.json(rows);
});

router.post('/recurring-templates', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const {
        origin_type,
        origin_id = null,
        list_key = null,
        list_title = null,
        list_mode = 'sequential',
        step_key,
        title,
        sort_order = 0,
        due_offset_days = null,
        priority_base = 50,
        active = 1
    } = req.body || {};
    if (!origin_type || !list_key || !step_key || !title) {
        return res.status(400).json({ error: 'origin_type, list_key, step_key, and title are required' });
    }
    const now = new Date().toISOString();
    const id = `tmpl-${randomUUID()}`;
    db.prepare(`
        INSERT INTO recurring_task_templates (
            id, origin_type, origin_id, list_key, list_title, list_mode,
            step_key, title, sort_order, due_offset_days,
            priority_base, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        origin_type,
        origin_id,
        list_key,
        list_title || list_key,
        list_mode || 'sequential',
        step_key,
        title,
        Number(sort_order) || 0,
        due_offset_days != null ? Number(due_offset_days) : null,
        Number(priority_base) || 50,
        active ? 1 : 0,
        now,
        now
    );
    res.status(201).json({ id });
});

router.put('/recurring-templates/:id', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM recurring_task_templates WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Template not found' });
    }
    const {
        title = existing.title,
        sort_order = existing.sort_order,
        due_offset_days = existing.due_offset_days,
        priority_base = existing.priority_base,
        active = existing.active,
        step_key = existing.step_key,
        list_key = existing.list_key,
        list_title = existing.list_title,
        list_mode = existing.list_mode || 'sequential'
    } = req.body || {};
    db.prepare(`
        UPDATE recurring_task_templates SET
            title = ?,
            step_key = ?,
            list_key = ?,
            list_title = ?,
            list_mode = ?,
            sort_order = ?,
            due_offset_days = ?,
            priority_base = ?,
            active = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        title,
        step_key,
        list_key,
        list_title || list_key,
        list_mode || 'sequential',
        Number(sort_order) || 0,
        due_offset_days != null ? Number(due_offset_days) : null,
        Number(priority_base) || 50,
        active ? 1 : 0,
        new Date().toISOString(),
        id
    );
    res.json({ success: true });
});

router.delete('/recurring-templates/:id', (req, res) => {
    if (!tableExists('recurring_task_templates')) {
        return res.status(400).json({ error: 'Recurring templates table not initialized' });
    }
    const { id } = req.params;
    const result = db.prepare('DELETE FROM recurring_task_templates WHERE id = ?').run(id);
    if (!result.changes) {
        return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true });
});

router.post('/recurring-templates/seed', (req, res) => {
    const originType = String(req.query.origin_type || req.body?.origin_type || '').trim();
    const originId = req.query.origin_id ? String(req.query.origin_id) : (req.body?.origin_id ? String(req.body.origin_id) : null);
    if (originType && !['sunday', 'vestry', 'operations', 'event'].includes(originType)) {
        return res.status(400).json({ error: 'Only sunday, vestry, operations, and event seeding is supported right now.' });
    }
    if (!originType || originType === 'sunday') seedSundayTasksFromTemplates();
    if (!originType || originType === 'vestry') seedVestryTasksFromTemplates();
    if (!originType || originType === 'operations') seedOperationsTasksFromTemplates();
    if (originType === 'event' && originId) {
        const rows = db.prepare(`
            SELECT o.id AS occurrence_id, o.date AS date_key
            FROM event_occurrences o
            JOIN events e ON e.id = o.event_id
            WHERE e.event_type_id = ?
              AND o.date >= date('now')
            ORDER BY o.date ASC
        `).all(Number(originId));
        rows.forEach((row) => {
            seedEventTasksForOccurrence({
                occurrenceId: row.occurrence_id,
                eventTypeId: Number(originId),
                dateKey: row.date_key
            });
        });
    }
    res.json({ success: true });
});

router.get('/recurring-templates/instances', (req, res) => {
    const originType = String(req.query.origin_type || '').trim();
    const originId = req.query.origin_id ? String(req.query.origin_id) : null;
    const listKey = req.query.list_key ? String(req.query.list_key) : null;
    if (!originType) {
        return res.status(400).json({ error: 'origin_type is required' });
    }

    const tasks = listTaskInstances('');
    const filtered = tasks.filter((task) => {
        if (task.origin_type !== originType) return false;
        if (listKey && (task.list_key || 'default') !== listKey) return false;
        if (originType === 'operations' && originId) {
            if (originId === 'weekly') {
                const current = String(task.origin_id || '');
                return current.startsWith('weekly-') || current === 'operations';
            }
            if (originId === 'timesheets') return String(task.origin_id || '').startsWith('timesheets-');
            if (originId === 'monthly') return String(task.origin_id || '').startsWith('monthly-');
            if (originId === 'yearly') return String(task.origin_id || '').startsWith('yearly-');
            return task.origin_id === originId;
        }
        if (originType === 'event' && originId) {
            return Number(task.event_type_id) === Number(originId);
        }
        if (originId && task.origin_id !== originId) return false;
        return true;
    });

    res.json(buildOriginRollups(filtered));
});

export default router;

