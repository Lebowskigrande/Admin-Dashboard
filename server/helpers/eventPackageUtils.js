import { createHash } from 'crypto';
import { sqlite as db } from '../db.js';
import { tableExists } from './db-utils.js';

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeString = (value) => String(value || '').trim();
const EVENT_DATA_ONLY_LIST_KEYS = new Set(['people', 'setup']);

export const normalizePackageTaskDefinition = (task, fallbackIndex = 0) => {
    const listKey = normalizeString(task?.list_key || task?.listKey).toLowerCase();
    const title = normalizeString(task?.title || task?.list_title || task?.listTitle || listKey || 'Task');
    if (!listKey || !title) return null;
    const stepKey = normalizeString(task?.step_key || task?.stepKey || listKey).toLowerCase() || listKey;
    return {
        id: normalizeString(task?.id) || `pkg-${listKey}-${fallbackIndex}`,
        list_key: listKey,
        list_title: normalizeString(task?.list_title || task?.listTitle || title) || title,
        list_mode: 'sequential',
        step_key: stepKey,
        title,
        sort_order: Number.isFinite(Number(task?.sort_order))
            ? Number(task.sort_order)
            : fallbackIndex,
        due_offset_days: toNumberOrNull(task?.due_offset_days ?? task?.dueOffsetDays),
        priority_base: toNumberOrNull(task?.priority_base ?? task?.priorityBase) ?? 50,
        active: task?.active === false || Number(task?.active) === 0 ? 0 : 1
    };
};

export const normalizePackageTaskDefinitions = (tasks = []) => (
    (Array.isArray(tasks) ? tasks : [])
        .map((task, index) => normalizePackageTaskDefinition(task, index))
        .filter(Boolean)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title))
);

export const filterEventPackageDefinitions = (tasks = []) => (
    normalizePackageTaskDefinitions(tasks).filter((task) => !EVENT_DATA_ONLY_LIST_KEYS.has(String(task?.list_key || '').trim().toLowerCase()))
);

const listDefaultEventTemplates = (eventTypeId) => {
    if (!eventTypeId || !tableExists('recurring_task_templates')) return [];
    return db.prepare(`
        SELECT
            id,
            list_key,
            list_title,
            list_mode,
            step_key,
            title,
            sort_order,
            due_offset_days,
            priority_base,
            active
        FROM recurring_task_templates
        WHERE origin_type = 'event'
          AND origin_id = ?
          AND active = 1
        ORDER BY sort_order ASC, title ASC
    `).all(String(eventTypeId));
};

export const getEventPackageDefinitions = ({ eventTypeId = null, metadata = null } = {}) => {
    const taskPackage = metadata?.task_package;
    const hasOverride = !!(taskPackage && typeof taskPackage === 'object' && (
        taskPackage.override === true || Array.isArray(taskPackage.tasks)
    ));
    const eventTasks = filterEventPackageDefinitions(taskPackage?.tasks || metadata?.packageTasks || []);
    if (hasOverride) {
        return {
            source: 'event',
            tasks: eventTasks
        };
    }
    return {
        source: 'type-default',
        tasks: filterEventPackageDefinitions(listDefaultEventTemplates(eventTypeId))
    };
};

const stablePackageTaskPayload = (task = {}) => ({
    list_key: normalizeString(task.list_key).toLowerCase(),
    list_title: normalizeString(task.list_title),
    title: normalizeString(task.title),
    due_offset_days: toNumberOrNull(task.due_offset_days),
    priority_base: toNumberOrNull(task.priority_base) ?? 50,
    active: task.active === 0 ? 0 : 1
});

export const buildPackageTaskSignature = (task = {}) => (
    createHash('sha1')
        .update(JSON.stringify(stablePackageTaskPayload(task)))
        .digest('hex')
);

export const buildPackageSignatureMap = (tasks = []) => (
    normalizePackageTaskDefinitions(tasks).reduce((acc, task) => {
        acc[task.list_key] = buildPackageTaskSignature(task);
        return acc;
    }, {})
);

export const normalizeRecurringCompletionMap = (value = {}) => {
    const raw = value && typeof value === 'object' ? value : {};
    return Object.entries(raw).reduce((acc, [key, entry]) => {
        const listKey = normalizeString(key).toLowerCase();
        if (!listKey || !entry || typeof entry !== 'object') return acc;
        const completedAt = normalizeString(entry.completedAt || entry.completed_at);
        const fromDate = normalizeString(entry.fromDate || entry.from_date);
        const templateSignature = normalizeString(entry.templateSignature || entry.template_signature);
        if (!completedAt || !fromDate || !templateSignature) return acc;
        acc[listKey] = {
            completedAt,
            fromDate,
            templateSignature
        };
        return acc;
    }, {});
};
