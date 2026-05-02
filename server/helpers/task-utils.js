import { sqlite as db } from '../db.js';
import { tableExists, parseJsonField } from './db-utils.js';

const parseDateValue = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [year, month, day] = text.split('-').map(Number);
        const parsed = new Date(year, month - 1, day);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const clampPriority = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
};

export const getPriorityTier = (score) => {
    const value = clampPriority(score);
    if (value >= 80) return 'Critical';
    if (value >= 60) return 'High';
    if (value >= 40) return 'Normal';
    if (value >= 20) return 'Low';
    return 'Someday';
};

export const sortTasksByPriority = (tasks) => {
    const stateOrder = {
        open: 0,
        in_progress: 1,
        blocked: 2,
        done: 3
    };
    const parseSortDate = (value) => parseDateValue(value)?.getTime() ?? Number.POSITIVE_INFINITY;
    return [...tasks].sort((a, b) => {
        const stateA = stateOrder[a.state] ?? 99;
        const stateB = stateOrder[b.state] ?? 99;
        if (stateA !== stateB) return stateA - stateB;
        const rankA = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
        const rankB = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
        if (rankA !== rankB) return rankA - rankB;
        if (a.priority_effective !== b.priority_effective) {
            return b.priority_effective - a.priority_effective;
        }
        const dueA = parseSortDate(a.due_at);
        const dueB = parseSortDate(b.due_at);
        if (dueA !== dueB) return dueA - dueB;
        const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return createdA - createdB;
    });
};

export const getDueDate = (dueAt, slaTargetAt) => {
    const raw = dueAt || slaTargetAt;
    return parseDateValue(raw);
};

export const getUrgencyAdjustment = (dueAt, slaTargetAt, now = new Date()) => {
    const dueDate = getDueDate(dueAt, slaTargetAt);
    if (!dueDate) return 0;
    const diffMs = dueDate.getTime() - now.getTime();
    const daysToDue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (daysToDue < 0) return 40;
    if (daysToDue === 0) return 25;
    if (daysToDue === 1) return 15;
    if (daysToDue <= 3) return 8;
    if (daysToDue <= 7) return 3;
    return 0;
};

export const computeEffectivePriority = (priorityBase, priorityOverride, dueAt, slaTargetAt) => {
    if (priorityOverride != null && priorityOverride !== '') {
        return clampPriority(Number(priorityOverride));
    }
    const base = Number.isFinite(Number(priorityBase)) ? Number(priorityBase) : 50;
    const adjustment = getUrgencyAdjustment(dueAt, slaTargetAt);
    return clampPriority(base + adjustment);
};

const DEFAULT_TASK_PRIORITY_BY_TYPE = {
    ticket: 60,
    support: 60,
    finance: 75,
    communications: 50,
    vestry: 60,
    event: 55,
    operations: 55
};

const getPriorityPolicy = (taskType) => {
    if (!taskType) return null;
    const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_priority_policy'
    `).get();
    if (!table) return null;
    return db.prepare('SELECT * FROM task_priority_policy WHERE task_type = ?').get(taskType) || null;
};

export const getDefaultPriorityBase = (taskType) => {
    const policy = getPriorityPolicy(taskType);
    if (policy && Number.isFinite(Number(policy.default_priority_base))) {
        return Number(policy.default_priority_base);
    }
    if (taskType && Object.prototype.hasOwnProperty.call(DEFAULT_TASK_PRIORITY_BY_TYPE, taskType)) {
        return DEFAULT_TASK_PRIORITY_BY_TYPE[taskType];
    }
    return 50;
};

const BULLETIN_STATUS_RANK = {
    draft: 1,
    review: 2,
    ready: 3,
    printed: 4,
    stuffed: 5
};

const getStatusRank = (value) => {
    const key = String(value || '').toLowerCase().trim();
    return BULLETIN_STATUS_RANK[key] || 0;
};

const getStoredBulletinStatus = (dateKey, docKey) => {
    if (!dateKey || !docKey || !tableExists('bulletin_status')) return '';
    try {
        const row = db.prepare('SELECT status FROM bulletin_status WHERE date = ? AND doc_key = ?').get(dateKey, docKey);
        return row?.status || '';
    } catch {
        return '';
    }
};

export const getSundayDocumentStatusRank = (dateKey, listKey) => {
    if (!dateKey || !listKey) return 0;
    if (listKey === 'insert') {
        return getStatusRank(getStoredBulletinStatus(dateKey, 'insert'));
    }
    if (listKey === 'bulletins') {
        const ranks = [
            getStatusRank(getStoredBulletinStatus(dateKey, 'bulletin10')),
            getStatusRank(getStoredBulletinStatus(dateKey, 'bulletin8'))
        ].filter((rank) => rank > 0);
        if (!ranks.length) return 0;
        if (ranks.length === 2) return Math.min(...ranks);
        return ranks[0];
    }
    return 0;
};

export const getSundayTaskStepRank = (listKey, originEvent) => {
    const step = String(originEvent || '').toLowerCase().trim();
    if (!step) return 0;
    if (listKey === 'bulletins') {
        if (step === 'draft') return 1;
        if (step === 'review') return 2;
        if (step === 'finalize' || step === 'final') return 3;
        if (step === 'print' || step === 'printed') return 4;
        if (step === 'stuff' || step === 'stuffed') return 5;
    }
    if (listKey === 'insert') {
        if (step === 'draft') return 1;
        if (step === 'review') return 2;
        if (step === 'finalize' || step === 'final') return 3;
    }
    return 0;
};

export const isSundayTaskAutoComplete = (row) => {
    if (row.origin_type !== 'sunday' || !row.origin_id) return false;
    if ((row.list_mode || '').toLowerCase() === 'progressive') return false;
    const listKey = row.list_key || row.list_id || '';
    if (!['bulletins', 'insert'].includes(listKey)) return false;
    const statusRank = getSundayDocumentStatusRank(row.origin_id, listKey);
    if (!statusRank) return false;
    const stepRank = getSundayTaskStepRank(listKey, row.origin_event);
    if (!stepRank) return false;
    return statusRank >= stepRank;
};

export const formatTaskInstanceRow = (row) => {
    const effectivePriority = computeEffectivePriority(
        row.priority_base,
        row.priority_override,
        row.due_at,
        row.sla_target_at
    );
    const tier = getPriorityTier(effectivePriority);
    const rawState = row.instance_state || 'open';
    let completed = row.instance_state === 'done' || row.completed_at != null;
    let normalizedState = row.blocked && rawState !== 'done' ? 'blocked' : rawState;
    if (!completed && isSundayTaskAutoComplete(row)) {
        completed = true;
        normalizedState = 'done';
    }
    const listMode = row.list_mode || (row.list_type === 'parallel' ? 'parallel' : 'sequential');
    const progressKey = row.progress_key || '';
    const rawProgressSteps = row.progress_steps ? parseJsonField(row.progress_steps, []) : [];
    const progressSteps = Array.isArray(rawProgressSteps)
        ? rawProgressSteps.slice().sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0))
        : [];
    const isProgressiveComplete = listMode === 'progressive'
        && progressSteps.length > 0
        && progressKey
        && progressSteps[progressSteps.length - 1]?.key === progressKey;
    if (!completed && isProgressiveComplete) {
        completed = true;
        normalizedState = 'done';
    }
    return {
        id: row.task_instance_id,
        task_id: row.task_id,
        text: row.title,
        description: row.description || '',
        completed,
        created_at: row.task_created_at || row.created_at || null,
        completed_at: row.completed_at || null,
        due_at: row.due_at || null,
        sla_target_at: row.sla_target_at || null,
        start_at: row.start_at || null,
        state: normalizedState,
        blocked: !!row.blocked || row.instance_state === 'blocked',
        priority_base: Number.isFinite(Number(row.priority_base)) ? Number(row.priority_base) : 50,
        priority_override: row.priority_override != null ? Number(row.priority_override) : null,
        priority_effective: effectivePriority,
        priority_tier: tier,
        step_order: row.step_order != null ? Number(row.step_order) : null,
        rank: row.rank != null ? Number(row.rank) : null,
        notes: row.notes || '',
        archived_at: row.archived_at || null,
        archive_after_due: row.archive_after_due != null ? Number(row.archive_after_due) : 1,
        keep_until: row.keep_until || null,
        list_key: row.list_key || row.list_id || null,
        list_title: row.list_title || null,
        list_mode: listMode,
        progress_key: progressKey,
        progress_steps: progressSteps,
        task_type: row.task_type || null,
        origin_type: row.origin_type || null,
        origin_id: row.origin_id || null,
        origin_event: row.origin_event || null,
        ticket_id: row.origin_type === 'ticket' ? row.origin_id : null,
        ticket_title: row.ticket_title || '',
        event_occurrence_id: row.event_occurrence_id || null,
        event_id: row.event_id || null,
        event_title: row.event_title || '',
        event_description: row.event_description || '',
        event_date: row.event_date || null,
        event_time: row.event_start_time || null,
        event_type_id: row.event_type_id != null ? Number(row.event_type_id) : null,
        event_type_name: row.event_type_name || '',
        event_type_slug: row.event_type_slug || '',
        event_category_name: row.event_category_name || '',
        event_color: row.event_color || ''
    };
};
