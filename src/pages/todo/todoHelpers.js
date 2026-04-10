import { format, startOfWeek } from 'date-fns';
import { getTaskProgressMeta } from '../../utils/taskProgress';
import { getListKey, normalizeOriginKey } from '../../../shared/taskRollups.js';
import {
    getTaskCycleLabel,
    getTaskCycleState,
    isSimpleStatusListKey
} from '../../../shared/taskStatus.js';
import { getSectionPresentation } from './sectionCatalog';
export { getListKey, normalizeOriginKey } from '../../../shared/taskRollups.js';

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

const simpleStateOrder = {
    in_progress: 0,
    open: 1,
    blocked: 2,
    done: 3
};

export const isDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
export const isMonthString = (value) => /^\d{4}-\d{2}$/.test(value || '');

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

const getSimpleStatusRepresentativeTask = (tasks = []) => (
    [...tasks].sort((a, b) => {
        const stateA = simpleStateOrder[getTaskCycleState(a)] ?? 99;
        const stateB = simpleStateOrder[getTaskCycleState(b)] ?? 99;
        if (stateA !== stateB) return stateA - stateB;
        return compareTasksIgnoreState(a, b);
    })[0] || null
);

const getAggregateSimpleStatusTask = (list) => {
    const tasks = Array.isArray(list?.tasks) ? list.tasks.filter(Boolean) : [];
    if (tasks.length <= 1) return null;
    const latestCompletedTask = tasks
        .filter((task) => task?.completed_at)
        .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
    const aggregateState = tasks.some((task) => getTaskCycleState(task) === 'done')
        ? 'done'
        : tasks.some((task) => getTaskCycleState(task) === 'in_progress')
            ? 'in_progress'
            : tasks.some((task) => getTaskCycleState(task) === 'blocked')
                ? 'blocked'
                : 'open';
    const baseTask = getSimpleStatusRepresentativeTask(tasks) || tasks[0];
    return {
        ...baseTask,
        state: aggregateState,
        completed_at: aggregateState === 'done' ? (latestCompletedTask?.completed_at || baseTask?.completed_at || null) : null,
        group_tasks: tasks
    };
};

export const getListRepresentativeTask = (list) => {
    if (!list) return null;
    if (isSimpleStatusListKey(list.key)) {
        return getSimpleStatusRepresentativeTask(list.tasks || []);
    }
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
    if (isSimpleStatusListKey(list?.key)) {
        const state = getTaskCycleState(task);
        return {
            progress: state === 'done' ? 1 : state === 'in_progress' ? 0.5 : 0,
            label: getTaskCycleLabel(state),
            warning: ''
        };
    }
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

export const getListChecklist = (list) => {
    if (!list) {
        return {
            mode: 'sequential',
            items: [],
            totalCount: 0,
            completedCount: 0,
            progress: 0,
            currentItem: null,
            representativeTask: null,
            canAdvance: false,
            canRewind: false
        };
    }

    if (isSimpleStatusListKey(list.key)) {
        const representativeTask = getAggregateSimpleStatusTask(list) || getSimpleStatusRepresentativeTask(list.tasks || []);
        const status = getTaskCycleState(representativeTask);
        const label = representativeTask?.text || list.title || 'Task';
        const item = representativeTask ? {
            key: representativeTask.id,
            label,
            status,
            task: representativeTask
        } : null;
        return {
            mode: 'status',
            items: item ? [item] : [],
            totalCount: representativeTask ? 1 : 0,
            completedCount: status === 'done' ? 1 : 0,
            progress: status === 'done' ? 1 : status === 'in_progress' ? 0.5 : 0,
            currentItem: status === 'done' ? null : item,
            representativeTask,
            canAdvance: false,
            canRewind: false
        };
    }

    const listMode = String(list.mode || '').toLowerCase();
    if (listMode === 'progressive') {
        const task = list.tasks?.[0] || null;
        const meta = getTaskProgressMeta(task);
        const steps = Array.isArray(meta?.steps) ? meta.steps : [];
        const currentIndex = Number(meta?.currentIndex ?? -1);
        const isComplete = !!(meta?.isComplete || task?.completed);
        const items = steps.map((step, index) => {
            let status = 'upcoming';
            if (isComplete || index <= currentIndex) status = 'done';
            else if ((currentIndex < 0 && index === 0) || index === currentIndex + 1) status = 'current';
            return {
                key: step.key || `step-${index}`,
                label: step.title || `Step ${index + 1}`,
                status,
                stepKey: step.key || '',
                task: task || null
            };
        });
        const completedCount = isComplete ? items.length : Math.max(0, currentIndex + 1);
        return {
            mode: 'progressive',
            items,
            totalCount: items.length,
            completedCount,
            progress: items.length ? completedCount / items.length : 0,
            currentItem: isComplete ? null : (items.find((item) => item.status === 'current') || null),
            representativeTask: task,
            canAdvance: !!meta?.nextStep,
            canRewind: !!meta?.prevStep || currentIndex >= 0
        };
    }

    const tasks = sortTasksForDetails(list.tasks || []);
    const firstOpenIndex = tasks.findIndex((task) => !task.completed);
    const items = tasks.map((task, index) => {
        let status = 'done';
        if (!task.completed) {
            if (listMode === 'parallel') status = 'open';
            else if (firstOpenIndex === -1) status = 'done';
            else if (index === firstOpenIndex) status = 'current';
            else if (index > firstOpenIndex) status = 'upcoming';
            else status = 'done';
        }
        return {
            key: task.id,
            label: task.text || task.list_title || 'Task',
            status,
            task
        };
    });
    const completedCount = items.filter((item) => item.status === 'done').length;
    return {
        mode: listMode || 'sequential',
        items,
        totalCount: items.length,
        completedCount,
        progress: items.length ? completedCount / items.length : 0,
        currentItem: items.find((item) => item.status === 'current' || item.status === 'open') || null,
        representativeTask: getListRepresentativeTask(list),
        canAdvance: !!items.find((item) => item.status === 'current' || item.status === 'open'),
        canRewind: false
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
    if (type.includes('vestry')) return 'Vestry Cycle';
    if (type.includes('event')) return 'Event Planning';
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

const getOriginSample = (originOrTask) => originOrTask?.sample || originOrTask || null;

export const getWorkPackageTitle = (originOrTask) => {
    const sample = getOriginSample(originOrTask);
    if (!sample) return 'Work Package';

    const originType = String(sample.origin_type || '').toLowerCase();
    if (originType === 'event') {
        const eventName = sample.event_title || sample.event_type_name || 'Event';
        return `${eventName} Event Planning`;
    }
    if (originType === 'sunday') {
        if (sample.origin_id && isDateString(sample.origin_id)) {
            return `${format(new Date(`${sample.origin_id}T00:00:00`), 'EEEE, MMM d')} Service Planning`;
        }
        return 'Sunday Service Planning';
    }
    if (originType === 'vestry') {
        if (sample.origin_id && isMonthString(sample.origin_id)) {
            return `${format(new Date(`${sample.origin_id}-01T00:00:00`), 'MMMM')} Vestry Cycle`;
        }
        return 'Vestry Cycle';
    }
    if (originType === 'operations') {
        if (sample.origin_id?.startsWith('weekly-')) return 'Weekly Operations';
        if (sample.origin_id?.startsWith('timesheets-')) {
            return `Timesheets ${sample.origin_id.replace('timesheets-', '')}`;
        }
        return sample.list_title || 'Operations';
    }
    if (originType === 'ticket') {
        return sample.ticket_title || `Ticket ${sample.origin_id || ''}`.trim();
    }
    return sample.list_title || sample.text || 'Work Package';
};

export const getWorkPackageSubtitle = (originOrTask) => {
    const sample = getOriginSample(originOrTask);
    if (!sample) return '';

    const originType = String(sample.origin_type || '').toLowerCase();
    if (originType === 'event') {
        const dateLabel = sample.event_date
            ? format(new Date(`${sample.event_date}T00:00:00`), 'MMM d, yyyy')
            : '';
        const timeLabel = sample.event_time ? ` at ${sample.event_time}` : '';
        const typeLabel = sample.event_type_name || 'Event';
        return [typeLabel, `${dateLabel}${timeLabel}`.trim()].filter(Boolean).join(' - ');
    }
    if (originType === 'sunday') {
        return formatOriginSubtitle(sample) || 'Sunday planning package';
    }
    if (originType === 'vestry') {
        return formatOriginSubtitle(sample) || 'Meeting preparation and follow-up';
    }
    if (originType === 'operations') {
        return formatOriginSubtitle(sample) || 'Operational work package';
    }
    return formatOriginSubtitle(sample);
};

const getSectionAttention = (task, status) => {
    if (status === 'done') return 'done';
    const dueInfo = getDueInfo(task);
    if (dueInfo?.rank === 0) return 'urgent';
    if (dueInfo?.rank === 1) return 'today';
    if (status === 'current' || status === 'in_progress') return 'active';
    return 'idle';
};

export const getWorkPackageSummary = (origin) => {
    const sections = (origin?.lists || [])
        .map((list) => {
            const checklist = getListChecklist(list);
            const representativeTask = getListRepresentativeTask(list);
            const progressMeta = checklist.mode === 'progressive'
                ? getTaskProgressMeta(checklist.representativeTask)
                : null;
            const currentTask = checklist.currentItem?.task || checklist.representativeTask || representativeTask || null;
            const presentation = getSectionPresentation({
                originType: origin?.origin_type,
                listKey: list.key,
                listTitle: list.title || getTopLevelTaskTitle(list, currentTask),
                taskText: (currentTask || representativeTask)?.text || ''
            });
            const effectiveTitle = presentation.title;
            const isDone = checklist.totalCount > 0 && checklist.completedCount >= checklist.totalCount;
            const status = checklist.mode === 'status'
                ? getTaskCycleState(representativeTask)
                : (isDone
                    ? 'done'
                    : checklist.currentItem
                        ? 'current'
                        : (checklist.totalCount > 0 ? 'open' : 'done'));
            const actionTask = checklist.mode === 'progressive'
                ? checklist.representativeTask
                : (checklist.currentItem?.task || checklist.representativeTask || representativeTask || null);
            const currentLabel = checklist.mode === 'status'
                ? getTaskCycleLabel(representativeTask)
                : (progressMeta?.currentLabel
                    || checklist.currentItem?.label
                    || (checklist.totalCount ? 'Checklist complete' : 'No checklist items'));

            return {
                key: list.key,
                title: effectiveTitle,
                shortLabel: presentation.shortLabel,
                iconKey: presentation.iconKey,
                currentLabel,
                completedCount: checklist.completedCount,
                totalCount: checklist.totalCount,
                progress: checklist.progress,
                checklist,
                currentTask,
                actionTask,
                status,
                attention: getSectionAttention(currentTask || actionTask, status)
            };
        })
        .sort((a, b) => compareTasksIgnoreState(a.currentTask || a.actionTask || {}, b.currentTask || b.actionTask || {}));

    const normalizedSections = [];
    sections.forEach((section) => {
        if (String(origin?.origin_type || '').toLowerCase() === 'sunday' && (section.key === 'bulletins' || section.key === 'bulletin')) {
            normalizedSections.push(
                {
                    ...section,
                    key: 'bulletin8',
                    title: 'Rite I Bulletin',
                    shortLabel: 'Rite I'
                },
                {
                    ...section,
                    key: 'bulletin10',
                    title: 'Rite II Bulletin',
                    shortLabel: 'Rite II'
                }
            );
            return;
        }
        normalizedSections.push(section);
    });

    const totalCount = normalizedSections.reduce((sum, section) => sum + section.totalCount, 0);
    const completedCount = normalizedSections.reduce((sum, section) => sum + section.completedCount, 0);
    const primarySection = normalizedSections.find((section) => section.status !== 'done') || normalizedSections[0] || null;

    return {
        sections: normalizedSections,
        totalCount,
        completedCount,
        progress: totalCount ? completedCount / totalCount : 0,
        primarySection,
        openSectionCount: normalizedSections.filter((section) => section.status !== 'done').length,
        doneSectionCount: normalizedSections.filter((section) => section.status === 'done').length
    };
};
