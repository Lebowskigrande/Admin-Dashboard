import { getTaskProgressMeta } from './taskProgress.js';

const derivePriorityTier = (score) => {
    const value = Number.isFinite(Number(score)) ? Number(score) : 0;
    if (value >= 80) return 'Critical';
    if (value >= 60) return 'High';
    if (value >= 40) return 'Normal';
    if (value >= 20) return 'Low';
    return 'Someday';
};

const parseSortDate = (value) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [year, month, day] = text.split('-').map(Number);
        return new Date(year, month - 1, day).getTime();
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
};

const defaultSortTasks = (tasks = []) => [...tasks].sort((a, b) => {
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;
    const priorityA = Number(a?.priority_effective || 0);
    const priorityB = Number(b?.priority_effective || 0);
    if (priorityA !== priorityB) return priorityB - priorityA;
    const dueA = parseSortDate(a?.due_at);
    const dueB = parseSortDate(b?.due_at);
    return dueA - dueB;
});

const compareSequencedTasks = (a, b) => {
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;

    const orderA = a?.step_order == null ? Number.POSITIVE_INFINITY : Number(a.step_order);
    const orderB = b?.step_order == null ? Number.POSITIVE_INFINITY : Number(b.step_order);
    if (orderA !== orderB) return orderA - orderB;

    const dueA = parseSortDate(a?.due_at);
    const dueB = parseSortDate(b?.due_at);
    if (dueA !== dueB) return dueA - dueB;

    return Number(b?.priority_effective || 0) - Number(a?.priority_effective || 0);
};

const getListNextTask = (tasks = [], sortTasks = defaultSortTasks) => {
    if (!Array.isArray(tasks) || !tasks.length) return null;

    const listMode = String(tasks[0]?.list_mode || 'sequential').toLowerCase();
    if (listMode === 'progressive') {
        const task = tasks[0] || null;
        const progressMeta = getTaskProgressMeta(task);
        if (!task || progressMeta?.isComplete || task?.completed) return null;
        return { ...task, progress_meta: progressMeta };
    }

    const openTasks = tasks.filter((task) => !task?.completed);
    if (!openTasks.length) return null;

    const hasSequence = listMode === 'sequential'
        || openTasks.some((task) => task?.rank != null || task?.step_order != null);
    if (!hasSequence) {
        return sortTasks(openTasks)[0] || null;
    }

    const sorted = [...openTasks].sort(compareSequencedTasks);
    const chainMax = Math.max(...openTasks.map((task) => Number(task?.priority_effective || 0)));
    return {
        ...sorted[0],
        priority_effective: chainMax,
        priority_tier: derivePriorityTier(chainMax)
    };
};

export const normalizeOriginKey = (originType, originId) => `${originType || 'manual'}:${originId || 'manual'}`;

export const getListKey = (task) => task?.list_key || 'default';

export const buildOriginGroups = (tasks = [], {
    excludeTask = null,
    sortTasks = defaultSortTasks
} = {}) => {
    const grouped = new Map();

    tasks.forEach((task) => {
        if (!task || task.archived_at) return;
        if (typeof excludeTask === 'function' && excludeTask(task)) return;

        const originKey = normalizeOriginKey(task.origin_type, task.origin_id);
        if (!grouped.has(originKey)) {
            grouped.set(originKey, {
                key: originKey,
                origin_type: task.origin_type || 'manual',
                origin_id: task.origin_id || 'manual',
                tasks: [],
                lists: new Map(),
                sample: task
            });
        }

        const group = grouped.get(originKey);
        group.tasks.push(task);

        const listKey = getListKey(task);
        if (!group.lists.has(listKey)) {
            group.lists.set(listKey, {
                key: listKey,
                title: task.list_title || listKey,
                mode: task.list_mode || 'sequential',
                tasks: []
            });
        }
        group.lists.get(listKey).tasks.push(task);
    });

    const groups = Array.from(grouped.values()).map((group) => {
        const listSummaries = Array.from(group.lists.values()).map((list) => ({
            ...list,
            nextTask: getListNextTask(list.tasks, sortTasks)
        }));
        const listCandidates = listSummaries
            .map((list) => list.nextTask)
            .filter(Boolean);
        const nextTask = listCandidates.length ? (sortTasks(listCandidates)[0] || null) : null;
        const openCount = group.tasks.filter((task) => !task?.completed).length;

        return {
            ...group,
            lists: listSummaries,
            nextTask,
            openCount,
            totalCount: group.tasks.length,
            completedCount: group.tasks.length - openCount
        };
    });

    const withNext = groups.filter((group) => group.nextTask);
    const withoutNext = groups.filter((group) => !group.nextTask);
    const sortedWithNext = sortTasks(withNext.map((group) => group.nextTask))
        .map((task) => withNext.find((group) => group.nextTask?.id === task?.id))
        .filter(Boolean);

    return [...sortedWithNext, ...withoutNext];
};
