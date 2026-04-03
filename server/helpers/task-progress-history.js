import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import { parseJsonField, tableExists } from './db-utils.js';

const HISTORY_TABLE = 'task_progress_history';
const DEFAULT_CLUSTER_WINDOW_MINUTES = 5;
const DEFAULT_MIN_CLUSTER_SIZE = 3;
const DEFAULT_DAYS = 120;

const toSortedProgressSteps = (value) => {
    const raw = Array.isArray(value)
        ? value
        : (value ? parseJsonField(value, []) : []);
    if (!Array.isArray(raw)) return [];
    return raw.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0));
};

const normalizeSnapshot = (row = {}) => {
    const progressSteps = toSortedProgressSteps(
        row.progress_steps ?? row.progressSteps ?? null
    );
    return {
        task_instance_id: row.task_instance_id || row.id || row.taskInstanceId || null,
        task_id: row.task_id || row.taskId || null,
        title: row.title || row.text || '',
        state: String(row.state || row.instance_state || 'open'),
        blocked: Number(row.blocked) ? 1 : 0,
        completed_at: row.completed_at || row.completedAt || null,
        progress_key: row.progress_key != null ? String(row.progress_key) : String(row.progressKey || ''),
        progress_steps: progressSteps,
        list_key: row.list_key || row.listKey || null,
        list_title: row.list_title || row.listTitle || null,
        list_mode: row.list_mode || row.listMode || null,
        origin_type: row.origin_type || row.originType || null,
        origin_id: row.origin_id || row.originId || null,
        origin_event: row.origin_event || row.originEvent || null
    };
};

const areStepListsEqual = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);

const getChangedFields = (before, after) => {
    if (!before) return ['created'];
    const changed = [];
    if (String(before.state || '') !== String(after.state || '')) changed.push('state');
    if (Number(before.blocked || 0) !== Number(after.blocked || 0)) changed.push('blocked');
    if (String(before.completed_at || '') !== String(after.completed_at || '')) changed.push('completed_at');
    if (String(before.progress_key || '') !== String(after.progress_key || '')) changed.push('progress_key');
    if (!areStepListsEqual(before.progress_steps, after.progress_steps)) changed.push('progress_steps');
    if (String(before.list_mode || '') !== String(after.list_mode || '')) changed.push('list_mode');
    return changed;
};

const getAction = (before, after, changedFields = []) => {
    if (!before) return 'created';
    if (String(before.completed_at || '') && !String(after.completed_at || '')) return 'reactivated';
    if (!String(before.completed_at || '') && String(after.completed_at || '')) return 'completed';
    if (changedFields.includes('progress_key') || changedFields.includes('progress_steps')) return 'progress';
    if (changedFields.includes('state') || changedFields.includes('blocked')) return 'state';
    return 'updated';
};

const getHistoryCounts = () => {
    if (!tableExists(HISTORY_TABLE)) {
        return {
            enabled: false,
            total_events: 0,
            tasks_with_history: 0
        };
    }
    const row = db.prepare(`
        SELECT
            COUNT(*) AS total_events,
            COUNT(DISTINCT task_instance_id) AS tasks_with_history
        FROM task_progress_history
    `).get();
    return {
        enabled: true,
        total_events: Number(row?.total_events || 0),
        tasks_with_history: Number(row?.tasks_with_history || 0)
    };
};

const buildClusterSummary = (rows, clusterWindowMinutes, minClusterSize) => {
    const clusterWindowMs = Math.max(1, Number(clusterWindowMinutes) || DEFAULT_CLUSTER_WINDOW_MINUTES) * 60 * 1000;
    const minSize = Math.max(2, Number(minClusterSize) || DEFAULT_MIN_CLUSTER_SIZE);
    const sorted = rows
        .filter((row) => row.completed_at)
        .sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime());
    const clusters = [];
    let current = [];
    sorted.forEach((row) => {
        if (!current.length) {
            current = [row];
            return;
        }
        const previous = current[current.length - 1];
        const delta = new Date(row.completed_at).getTime() - new Date(previous.completed_at).getTime();
        if (delta <= clusterWindowMs) {
            current.push(row);
            return;
        }
        if (current.length >= minSize) clusters.push(current);
        current = [row];
    });
    if (current.length >= minSize) clusters.push(current);
    return clusters
        .map((cluster) => {
            const progressiveFinals = cluster.filter((row) => row.final_step_completed);
            if (!progressiveFinals.length) return null;
            return {
                start_at: cluster[0].completed_at,
                end_at: cluster[cluster.length - 1].completed_at,
                task_count: cluster.length,
                progressive_finals: progressiveFinals.map((row) => ({
                    title: row.title,
                    list_key: row.list_key,
                    origin_id: row.origin_id,
                    steps_count: row.steps_count,
                    progress_key: row.progress_key,
                    completed_at: row.completed_at
                })),
                all_tasks: cluster.map((row) => ({
                    title: row.title,
                    list_key: row.list_key,
                    origin_id: row.origin_id,
                    steps_count: row.steps_count,
                    progress_key: row.progress_key,
                    completed_at: row.completed_at
                }))
            };
        })
        .filter(Boolean);
};

const buildSuggestedGroups = (steps = []) => {
    const titles = steps.map((step) => String(step?.title || '').trim()).filter(Boolean);
    if (titles.length <= 1) return titles;
    if (titles.length === 2) return [titles.join(' + ')];
    if (titles.length === 3) return [titles[0], `${titles[1]} + ${titles[2]}`];
    if (titles.length === 4) return [
        `${titles[0]} + ${titles[1]}`,
        `${titles[2]} + ${titles[3]}`
    ];
    if (titles.length === 5) return [
        `${titles[0]} + ${titles[1]}`,
        `${titles[2]} + ${titles[3]}`,
        titles[4]
    ];
    return [
        `${titles[0]} + ${titles[1]}`,
        `${titles[2]} + ${titles[3]}`,
        titles.slice(4).join(' + ')
    ];
};

export const recordTaskProgressHistory = ({
    before = null,
    after,
    source = 'api',
    actor = 'system'
} = {}) => {
    if (!tableExists(HISTORY_TABLE) || !after) return null;
    const beforeSnapshot = before ? normalizeSnapshot(before) : null;
    const afterSnapshot = normalizeSnapshot(after);
    if (!afterSnapshot.task_instance_id) return null;

    const changedFields = getChangedFields(beforeSnapshot, afterSnapshot);
    if (beforeSnapshot && !changedFields.length) return null;

    const now = new Date().toISOString();
    const action = getAction(beforeSnapshot, afterSnapshot, changedFields);
    const id = `taskhist-${randomUUID()}`;

    db.prepare(`
        INSERT INTO task_progress_history (
            id, task_instance_id, task_id, title, action, source, actor,
            from_state, to_state, from_progress_key, to_progress_key,
            from_completed_at, to_completed_at, changed_fields_json,
            before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        afterSnapshot.task_instance_id,
        afterSnapshot.task_id,
        afterSnapshot.title || beforeSnapshot?.title || '',
        action,
        source,
        actor,
        beforeSnapshot?.state || null,
        afterSnapshot.state || null,
        beforeSnapshot?.progress_key || null,
        afterSnapshot.progress_key || null,
        beforeSnapshot?.completed_at || null,
        afterSnapshot.completed_at || null,
        JSON.stringify(changedFields),
        beforeSnapshot ? JSON.stringify(beforeSnapshot) : null,
        JSON.stringify(afterSnapshot),
        now
    );

    return {
        id,
        action,
        changed_fields: changedFields,
        created_at: now
    };
};

export const listTaskProgressHistory = (taskInstanceId, limit = 100) => {
    if (!tableExists(HISTORY_TABLE) || !taskInstanceId) return [];
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = db.prepare(`
        SELECT *
        FROM task_progress_history
        WHERE task_instance_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(taskInstanceId, safeLimit);
    return rows.map((row) => ({
        id: row.id,
        task_instance_id: row.task_instance_id,
        task_id: row.task_id || null,
        title: row.title || '',
        action: row.action,
        source: row.source,
        actor: row.actor || '',
        from_state: row.from_state || null,
        to_state: row.to_state || null,
        from_progress_key: row.from_progress_key || '',
        to_progress_key: row.to_progress_key || '',
        from_completed_at: row.from_completed_at || null,
        to_completed_at: row.to_completed_at || null,
        changed_fields: parseJsonField(row.changed_fields_json, []),
        before: row.before_json ? JSON.parse(row.before_json) : null,
        after: row.after_json ? JSON.parse(row.after_json) : null,
        created_at: row.created_at
    }));
};

export const buildTaskProgressAudit = (tasks = [], options = {}) => {
    const nowMs = Date.now();
    const days = Math.max(7, Number(options.days) || DEFAULT_DAYS);
    const cutoffMs = nowMs - (days * 24 * 60 * 60 * 1000);
    const recentCompleted = (Array.isArray(tasks) ? tasks : [])
        .filter((task) => task.completed_at && new Date(task.completed_at).getTime() >= cutoffMs)
        .map((task) => {
            const steps = toSortedProgressSteps(task.progress_steps);
            const finalKey = steps.length ? String(steps[steps.length - 1]?.key || '') : '';
            return {
                title: task.text || task.title || '',
                list_key: task.list_key || '',
                list_title: task.list_title || '',
                list_mode: task.list_mode || 'sequential',
                origin_type: task.origin_type || '',
                origin_id: task.origin_id || '',
                progress_key: String(task.progress_key || ''),
                progress_steps: steps,
                steps_count: steps.length,
                completed_at: task.completed_at,
                final_step_completed: steps.length > 1 && String(task.progress_key || '') === finalKey
            };
        });

    const clusters = buildClusterSummary(
        recentCompleted,
        options.cluster_window_minutes,
        options.min_cluster_size
    );

    const suspiciousCounts = new Map();
    clusters.forEach((cluster) => {
        cluster.progressive_finals.forEach((task) => {
            const key = `${task.title}||${task.list_key}`;
            suspiciousCounts.set(key, (suspiciousCounts.get(key) || 0) + 1);
        });
    });

    const templateMap = new Map();
    recentCompleted.forEach((task) => {
        if (!task.steps_count) return;
        const key = `${task.title}||${task.list_key}`;
        const entry = templateMap.get(key) || {
            title: task.title,
            list_key: task.list_key,
            list_title: task.list_title,
            completed_instances: 0,
            final_step_completions: 0,
            average_steps: 0,
            sample_steps: task.progress_steps,
            suspicious_cluster_hits: suspiciousCounts.get(key) || 0
        };
        entry.completed_instances += 1;
        entry.average_steps += task.steps_count;
        if (task.final_step_completed) entry.final_step_completions += 1;
        if ((!entry.sample_steps || !entry.sample_steps.length) && task.progress_steps.length) {
            entry.sample_steps = task.progress_steps;
        }
        templateMap.set(key, entry);
    });

    const templates = [...templateMap.values()]
        .map((entry) => {
            const finalRate = entry.completed_instances
                ? entry.final_step_completions / entry.completed_instances
                : 0;
            const suspiciousRate = entry.completed_instances
                ? entry.suspicious_cluster_hits / entry.completed_instances
                : 0;
            const averageSteps = entry.completed_instances
                ? entry.average_steps / entry.completed_instances
                : 0;
            return {
                title: entry.title,
                list_key: entry.list_key,
                list_title: entry.list_title,
                completed_instances: entry.completed_instances,
                final_step_completions: entry.final_step_completions,
                final_step_completion_rate: Number(finalRate.toFixed(2)),
                average_steps: Number(averageSteps.toFixed(2)),
                suspicious_cluster_hits: entry.suspicious_cluster_hits,
                suspicious_cluster_rate: Number(suspiciousRate.toFixed(2)),
                sample_steps: entry.sample_steps || []
            };
        })
        .sort((a, b) => (
            b.final_step_completion_rate - a.final_step_completion_rate
            || b.average_steps - a.average_steps
            || b.completed_instances - a.completed_instances
        ));

    const recommendations = templates
        .filter((entry) => (
            entry.sample_steps.length > 1
            && entry.final_step_completion_rate >= 0.85
            && entry.completed_instances >= 2
        ))
        .map((entry) => {
            const suggestedGroups = buildSuggestedGroups(entry.sample_steps);
            let severity = 'medium';
            if (entry.average_steps >= 5 && entry.final_step_completion_rate >= 0.95) severity = 'high';
            if (entry.suspicious_cluster_hits >= 2 && entry.average_steps >= 4) severity = 'high';
            return {
                title: entry.title,
                list_key: entry.list_key,
                severity,
                current_steps: entry.sample_steps.map((step) => step.title),
                suggested_step_groups: suggestedGroups,
                suggested_step_count: suggestedGroups.length,
                rationale: `${entry.final_step_completions} of ${entry.completed_instances} completed instances landed on the final step, and ${entry.suspicious_cluster_hits} completions appeared inside close-out clusters.`
            };
        })
        .sort((a, b) => {
            const severityRank = { high: 2, medium: 1, low: 0 };
            return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
        });

    return {
        generated_at: new Date().toISOString(),
        analysis_basis: getHistoryCounts().total_events > 0 ? 'current-tasks-plus-history' : 'current-task-snapshots',
        window_days: days,
        history: getHistoryCounts(),
        suspicious_clusters: clusters,
        template_patterns: templates,
        recommendations
    };
};
