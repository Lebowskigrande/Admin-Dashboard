import { format, startOfWeek } from 'date-fns';
import { getTaskProgressMeta } from '../../utils/taskProgress';

export const PRIORITY_OPTIONS = [
    { label: 'Critical', value: 80 },
    { label: 'High', value: 65 },
    { label: 'Normal', value: 50 },
    { label: 'Low', value: 30 },
    { label: 'Someday', value: 10 }
];

const stateOrder = {
    open: 0,
    in_progress: 1,
    blocked: 2,
    done: 3
};

export const isDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
export const isMonthString = (value) => /^\d{4}-\d{2}$/.test(value || '');
export const normalizeOriginKey = (originType, originId) => `${originType || 'manual'}:${originId || 'manual'}`;
export const getListKey = (task) => task?.list_key || 'default';

export const toDateKey = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const getDueInfo = (task) => {
    if (!task?.due_at) return null;
    const due = new Date(task.due_at);
    if (Number.isNaN(due.getTime())) return null;
    const today = new Date();
    const todayKey = toDateKey(today);
    const dueKey = toDateKey(due);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowKey = toDateKey(tomorrow);

    if (dueKey < todayKey) {
        return { rank: 0, label: 'Overdue', className: 'due-pill-overdue', due };
    }
    if (dueKey === todayKey) {
        return { rank: 1, label: 'Today', className: 'due-pill-today', due };
    }
    if (dueKey === tomorrowKey) {
        return { rank: 2, label: 'Tomorrow', className: 'due-pill-tomorrow', due };
    }
    return {
        rank: 3,
        label: `${format(due, 'MMM d')}`,
        className: 'due-pill-future',
        due
    };
};

export const isCriticalNoDue = (task) => {
    if (task?.due_at) return false;
    const tier = (task?.priority_tier || '').toLowerCase();
    if (tier === 'critical') return true;
    return Number(task?.priority_effective || 0) >= 80;
};

export const compareTasks = (a, b) => {
    const stateA = stateOrder[a?.state] ?? 99;
    const stateB = stateOrder[b?.state] ?? 99;
    if (stateA !== stateB) return stateA - stateB;
    const dueInfoA = getDueInfo(a);
    const dueInfoB = getDueInfo(b);
    const bucketA = dueInfoA
        ? (dueInfoA.rank <= 2 ? dueInfoA.rank : 4)
        : (isCriticalNoDue(a) ? 3 : 5);
    const bucketB = dueInfoB
        ? (dueInfoB.rank <= 2 ? dueInfoB.rank : 4)
        : (isCriticalNoDue(b) ? 3 : 5);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;
    if (a?.priority_effective !== b?.priority_effective) {
        return (b?.priority_effective || 0) - (a?.priority_effective || 0);
    }
    const dueA = dueInfoA?.due ? dueInfoA.due.getTime() : Number.POSITIVE_INFINITY;
    const dueB = dueInfoB?.due ? dueInfoB.due.getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return createdA - createdB;
};

export const sortTasksByPriority = (tasks) => [...tasks].sort(compareTasks);

export const compareTasksIgnoreState = (a, b) => {
    const dueInfoA = getDueInfo(a);
    const dueInfoB = getDueInfo(b);
    const bucketA = dueInfoA
        ? (dueInfoA.rank <= 2 ? dueInfoA.rank : 4)
        : (isCriticalNoDue(a) ? 3 : 5);
    const bucketB = dueInfoB
        ? (dueInfoB.rank <= 2 ? dueInfoB.rank : 4)
        : (isCriticalNoDue(b) ? 3 : 5);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;
    if (a?.priority_effective !== b?.priority_effective) {
        return (b?.priority_effective || 0) - (a?.priority_effective || 0);
    }
    const dueA = dueInfoA?.due ? dueInfoA.due.getTime() : Number.POSITIVE_INFINITY;
    const dueB = dueInfoB?.due ? dueInfoB.due.getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return createdA - createdB;
};

export const sortTasksForDetails = (tasks) => [...tasks].sort(compareTasksIgnoreState);

export const parseDueDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

export const getListProgress = (tasks = []) => {
    const total = tasks.length;
    const completed = tasks.filter((task) => task.completed).length;
    const progress = total > 0 ? completed / total : 0;
    const todayKey = toDateKey(new Date());
    const missed = tasks.filter((task) => {
        if (task.completed || !task.due_at) return false;
        const dueKey = toDateKey(new Date(task.due_at));
        return dueKey < todayKey;
    }).length;
    const warning = missed >= 2 ? 'Late' : missed >= 1 ? 'Behind' : '';
    return { total, completed, progress, warning };
};

export const getListRepresentativeTask = (list) => {
    if (!list) return null;
    const listMode = String(list.mode || '').toLowerCase();
    if (listMode === 'progressive') {
        return list.tasks[0] || null;
    }
    return list.nextTask || list.tasks[0] || null;
};

export const getTopLevelTaskTitle = (list, task) => {
    return list?.title || task?.list_title || task?.text || 'Task';
};

export const getListProgressDisplay = (list, task) => {
    const progressMeta = getTaskProgressMeta(task);
    if (progressMeta) {
        const total = progressMeta.steps.length;
        const completed = Math.max(0, progressMeta.currentIndex + 1);
        const progress = total > 0 ? completed / total : 0;
        const currentLabel = progressMeta.currentLabel || 'Not Started';
        const nextLabel = progressMeta.nextLabel || 'Complete';
        return {
            progress,
            label: `${currentLabel} | Next: ${nextLabel}`,
            warning: ''
        };
    }
    const listProgress = getListProgress(list?.tasks || []);
    const label = listProgress.total > 0
        ? `Progress ${listProgress.completed}/${listProgress.total}`
        : 'No steps';
    return {
        progress: listProgress.progress,
        label,
        warning: listProgress.warning || ''
    };
};

export const toTitleCase = (value) => String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const getContextLabel = (task) => {
    if (!task) return '';
    if (task.origin_type === 'event') {
        const dateLabel = task.event_date ? format(new Date(`${task.event_date}T00:00:00`), 'MMM d') : '';
        const base = task.event_title || task.event_type_name || 'Event';
        return dateLabel ? `${base} (${dateLabel})` : base;
    }
    if (task.origin_type === 'sunday') {
        const dateLabel = task.origin_id && isDateString(task.origin_id)
            ? format(new Date(`${task.origin_id}T00:00:00`), 'MMM d')
            : '';
        const listLabel = task.list_title || '';
        if (listLabel && dateLabel) return `${listLabel} (${dateLabel})`;
        if (listLabel) return listLabel;
        return dateLabel ? `Sunday ${dateLabel}` : 'Sunday';
    }
    if (task.origin_type === 'vestry') {
        if (task.origin_id && isMonthString(task.origin_id)) {
            return `Vestry ${format(new Date(`${task.origin_id}-01T00:00:00`), 'MMM yyyy')}`;
        }
        return 'Vestry';
    }
    if (task.origin_type === 'operations') {
        if (task.origin_id && task.origin_id.startsWith('weekly-')) {
            const dateKey = task.origin_id.replace('weekly-', '');
            if (isDateString(dateKey)) {
                return `Weekly Ops (Week of ${format(new Date(`${dateKey}T00:00:00`), 'MMM d')})`;
            }
        }
        if (task.origin_id && task.origin_id.startsWith('timesheets-')) {
            return `Timesheets ${task.origin_id.replace('timesheets-', '')}`;
        }
        return task.list_title || 'Operations';
    }
    if (task.origin_type === 'ticket') {
        return task.ticket_title ? `Ticket - ${task.ticket_title}` : `Ticket ${task.origin_id || ''}`.trim();
    }
    if (task.list_title) return task.list_title;
    if (task.origin_type) return toTitleCase(task.origin_type);
    return '';
};

export const formatTaskTitle = (task) => {
    if (!task?.text) return '';
    const base = task.text.trim();
    const context = getContextLabel(task);
    if (!context) return base;
    const normalizedBase = base.toLowerCase();
    const normalizedContext = context.toLowerCase();
    if (normalizedBase.includes(normalizedContext)) return base;
    if (base.length <= 24) return `${base} - ${context}`;
    if (!base.includes(' - ')) return `${base} - ${context}`;
    return base;
};

export const formatOriginLabel = (task) => {
    const rawType = task?.origin_type;
    if (!rawType) return 'Task Origin';
    const type = rawType.toLowerCase();
    if (type.includes('sunday')) return 'Sunday Planning';
    if (type.includes('vestry')) return 'Vestry';
    if (type.includes('event')) return 'Event';
    if (type.includes('operation')) return 'Operations';
    if (type.includes('ticket')) return 'Ticket';
    if (type.includes('project')) return 'Project';
    if (type.includes('general')) return 'General Operations';
    return rawType;
};

export const getOriginColorClass = (originType) => {
    const type = String(originType || '').toLowerCase();
    if (type === 'sunday') return 'origin-color-sunday';
    if (type === 'operations') return 'origin-color-operations';
    if (type === 'event') return 'origin-color-event';
    if (type === 'ticket') return 'origin-color-ticket';
    return '';
};

export const formatOriginSubtitle = (task) => {
    if (!task?.origin_id) return '';
    if (task.origin_type === 'event' && task.event_date) {
        const dateLabel = format(new Date(`${task.event_date}T00:00:00`), 'MMM d, yyyy');
        const timeLabel = task.event_time ? ` at ${task.event_time}` : '';
        const typeLabel = task.event_type_name ? `${task.event_type_name} - ` : '';
        return `${typeLabel}${dateLabel}${timeLabel}`;
    }

    const today = new Date();
    if (task.origin_type === 'sunday' && isDateString(task.origin_id)) {
        const day = today.getDay();
        const daysUntilSunday = (7 - day) % 7;
        const sunday = new Date(today);
        sunday.setDate(today.getDate() + daysUntilSunday);
        const sundayKey = sunday.toISOString().slice(0, 10);
        if (task.origin_id === sundayKey) {
            return 'This Sunday';
        }
    }

    if (task.origin_id.startsWith('weekly-')) {
        const dateKey = task.origin_id.replace('weekly-', '');
        if (isDateString(dateKey)) {
            const weekStart = startOfWeek(today, { weekStartsOn: 1 });
            const weekKey = weekStart.toISOString().slice(0, 10);
            if (dateKey === weekKey) {
                return 'This Week';
            }
            return `Week of ${format(new Date(`${dateKey}T00:00:00`), 'MMM d, yyyy')}`;
        }
    }

    if (isDateString(task.origin_id)) {
        return format(new Date(`${task.origin_id}T00:00:00`), 'MMM d, yyyy');
    }
    if (isMonthString(task.origin_id)) {
        return format(new Date(`${task.origin_id}-01T00:00:00`), 'MMM yyyy');
    }
    if (task.origin_id.startsWith('timesheets-')) {
        return `Timesheets ${task.origin_id.replace('timesheets-', '')}`;
    }
    return task.origin_id;
};
