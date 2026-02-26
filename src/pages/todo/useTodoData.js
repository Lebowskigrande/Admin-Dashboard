import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, isWithinInterval, parseISO } from 'date-fns';

import { API_URL } from '../../services/apiConfig';
import { getTaskProgressMeta, getTaskNextStepLabel } from '../../utils/taskProgress';
import {
    PRIORITY_OPTIONS,
    isDateString,
    normalizeOriginKey,
    getListKey,
    parseDueDate,
    sortTasksByPriority,
    sortTasksForDetails,
    getListRepresentativeTask,
    getTopLevelTaskTitle,
    getListProgressDisplay,
    formatTaskTitle,
    formatOriginLabel,
    formatOriginSubtitle,
    getOriginColorClass,
    getDueInfo
} from './todoHelpers';

const buildDueDateInput = (dueAt) => {
    if (!dueAt) return '';
    try {
        const parsed = parseISO(dueAt);
        return format(parsed, 'yyyy-MM-dd');
    } catch {
        return '';
    }
};

export const useTodoData = () => {
    const [taskList, setTaskList] = useState([]);
    const [selectedOriginKey, setSelectedOriginKey] = useState('');
    const [selectedTaskId, setSelectedTaskId] = useState('');
    const [tasksLoading, setTasksLoading] = useState(true);
    const [error, setError] = useState('');
    const [newTask, setNewTask] = useState('');
    const [projectName, setProjectName] = useState('Operations');
    const [taskModalOpen, setTaskModalOpen] = useState(false);
    const [taskDraft, setTaskDraft] = useState({
        id: '',
        text: '',
        dueDate: '',
        priorityOverride: '',
        notes: ''
    });
    const [taskNotesDraft, setTaskNotesDraft] = useState('');
    const [showCompleted, setShowCompleted] = useState(false);
    const [originLinks, setOriginLinks] = useState({ parent: null, children: [] });
    const [nestedExpanded, setNestedExpanded] = useState({});
    const [nestedTasks, setNestedTasks] = useState({});
    const [nestedLoading, setNestedLoading] = useState({});

    const loadAllTasks = useCallback(async () => {
        setTasksLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_URL}/tasks`);
            if (!response.ok) throw new Error('Failed to load tasks');
            const data = await response.json();
            setTaskList(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load tasks:', err);
            setTaskList([]);
            setError('Unable to load tasks. Please refresh and try again.');
        } finally {
            setTasksLoading(false);
        }
    }, []);

    const loadOriginLinks = useCallback(async (originType, originId) => {
        if (!originType || !originId) {
            setOriginLinks({ parent: null, children: [] });
            return;
        }
        try {
            const params = new URLSearchParams({
                origin_type: originType,
                origin_id: originId
            });
            const response = await fetch(`${API_URL}/task-origins/links?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load origin links');
            const data = await response.json();
            setOriginLinks({
                parent: data?.parent || null,
                children: Array.isArray(data?.children) ? data.children : []
            });
        } catch (err) {
            console.error('Failed to load origin links:', err);
            setOriginLinks({ parent: null, children: [] });
        }
    }, []);

    const loadOriginTasks = useCallback(async (originType, originId) => {
        if (!originType || !originId) return [];
        try {
            const params = new URLSearchParams({
                origin_type: originType,
                origin_id: originId
            });
            const response = await fetch(`${API_URL}/tasks?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load origin tasks');
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('Failed to load origin tasks:', err);
            return [];
        }
    }, []);

    const handleToggleNested = useCallback(async (child) => {
        const childKey = normalizeOriginKey(child.origin_type, child.origin_id);
        setNestedExpanded((prev) => ({ ...prev, [childKey]: !prev[childKey] }));
        if (nestedTasks[childKey]) return;
        setNestedLoading((prev) => ({ ...prev, [childKey]: true }));
        const tasks = await loadOriginTasks(child.origin_type, child.origin_id);
        setNestedTasks((prev) => ({ ...prev, [childKey]: tasks }));
        setNestedLoading((prev) => ({ ...prev, [childKey]: false }));
    }, [loadOriginTasks, nestedTasks]);

    useEffect(() => {
        loadAllTasks();
    }, [loadAllTasks]);

    const originGroups = useMemo(() => {
        const isLegacySundayBulletinList = (task) => {
            if (String(task?.origin_type || '').toLowerCase() !== 'sunday') return false;
            const listKey = String(task?.list_key || '').toLowerCase();
            return listKey === 'bulletins-10am' || listKey === 'bulletins-8am';
        };
        const grouped = new Map();
        taskList.forEach((task) => {
            if (task.archived_at) return;
            if (isLegacySundayBulletinList(task)) return;
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
            const openTasks = group.tasks.filter((task) => !task.completed && !task.archived_at);
            const originDueDates = openTasks
                .map((task) => parseDueDate(task.due_at))
                .filter(Boolean)
                .sort((a, b) => a.getTime() - b.getTime());
            const originDue = originDueDates.length ? originDueDates[0] : null;
            const listSummaries = Array.from(group.lists.values()).map((list) => {
                const listMode = list.mode || 'sequential';
                if (listMode === 'progressive') {
                    const task = list.tasks[0] || null;
                    const progressMeta = getTaskProgressMeta(task);
                    const isComplete = progressMeta?.isComplete || task?.completed;
                    const totalCount = progressMeta?.steps?.length ?? (task ? 1 : 0);
                    const completedCount = progressMeta
                        ? Math.max(0, progressMeta.currentIndex + 1)
                        : (task?.completed ? totalCount : 0);
                    const openCount = isComplete ? 0 : (task ? 1 : 0);
                    const nextTask = !isComplete && task
                        ? { ...task, progress_meta: progressMeta }
                        : null;
                    return {
                        ...list,
                        totalCount,
                        openCount,
                        completedCount,
                        nextTask
                    };
                }

                const totalCount = list.tasks.length;
                const openTasks = list.tasks.filter((task) => !task.completed);
                const completedCount = totalCount - openTasks.length;
                const hasSequence = listMode === 'sequential'
                    || openTasks.some((task) => task.rank != null || task.step_order != null);
                let nextTask = null;
                if (openTasks.length) {
                    if (hasSequence) {
                        const sorted = [...openTasks].sort((a, b) => {
                            const rankA = a.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
                            const rankB = b.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
                            if (rankA !== rankB) return rankA - rankB;
                            const orderA = a.step_order == null ? Number.POSITIVE_INFINITY : Number(a.step_order);
                            const orderB = b.step_order == null ? Number.POSITIVE_INFINITY : Number(b.step_order);
                            if (orderA !== orderB) return orderA - orderB;
                            const dueA = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
                            const dueB = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
                            if (dueA !== dueB) return dueA - dueB;
                            return (b.priority_effective || 0) - (a.priority_effective || 0);
                        });
                        const chainMax = Math.max(...openTasks.map((task) => task.priority_effective ?? 0));
                        nextTask = {
                            ...sorted[0],
                            priority_effective: chainMax
                        };
                    } else {
                        nextTask = sortTasksByPriority(openTasks)[0];
                    }
                }
                return {
                    ...list,
                    totalCount,
                    openCount: openTasks.length,
                    completedCount,
                    nextTask
                };
            });

            const listNext = listSummaries.map((list) => list.nextTask).filter(Boolean);
            const nextTask = listNext.length ? sortTasksByPriority(listNext)[0] : null;
            return {
                ...group,
                lists: listSummaries,
                totalCount: group.tasks.length,
                openCount: group.tasks.filter((task) => !task.completed).length,
                completedCount: group.tasks.filter((task) => task.completed).length,
                nextTask,
                originDue
            };
        });

        const withNext = groups.filter((group) => group.nextTask);
        const withoutNext = groups.filter((group) => !group.nextTask);
        const sortedWithNext = sortTasksByPriority(withNext.map((group) => group.nextTask)).map((task) => (
            withNext.find((group) => group.nextTask?.id === task.id)
        )).filter(Boolean);
        return [...sortedWithNext, ...withoutNext];
    }, [taskList]);

    const filteredOriginGroups = useMemo(() => {
        const today = new Date();
        const weekStart = startOfWeek(today, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
        return originGroups.filter((group) => {
            if (group.origin_type !== 'sunday') return true;
            if (!group.origin_id || !isDateString(group.origin_id)) return false;
            const sundayDate = parseISO(`${group.origin_id}T00:00:00`);
            if (Number.isNaN(sundayDate.getTime())) return false;
            return isWithinInterval(sundayDate, { start: weekStart, end: weekEnd });
        });
    }, [originGroups]);

    const originGroupMap = useMemo(() => {
        const map = new Map();
        filteredOriginGroups.forEach((group) => map.set(group.key, group));
        return map;
    }, [filteredOriginGroups]);

    const visibleOriginGroups = useMemo(() => (
        showCompleted ? filteredOriginGroups : filteredOriginGroups.filter((group) => group.openCount > 0)
    ), [filteredOriginGroups, showCompleted]);

    const topLevelRows = useMemo(() => {
        const rows = [];
        visibleOriginGroups.forEach((group) => {
            group.lists.forEach((list) => {
                const task = getListRepresentativeTask(list);
                if (!task) return;
                const progressMeta = getTaskProgressMeta(task);
                const isComplete = progressMeta?.isComplete || task.completed;
                rows.push({
                    originKey: group.key,
                    origin: group,
                    list,
                    task,
                    isComplete
                });
            });
        });
        return rows;
    }, [visibleOriginGroups]);

    const visibleTaskRows = useMemo(() => (
        showCompleted ? topLevelRows : topLevelRows.filter((row) => !row.isComplete)
    ), [topLevelRows, showCompleted]);

    const weekBuckets = useMemo(() => {
        const today = new Date();
        const weekStart = startOfWeek(today, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
        const nextWeekStart = addWeeks(weekStart, 1);
        const nextWeekEnd = endOfWeek(nextWeekStart, { weekStartsOn: 1 });

        const bucketed = {
            thisWeek: [],
            nextWeek: [],
            later: []
        };

        visibleTaskRows.forEach((row) => {
            const due = row.task?.due_at ? parseDueDate(row.task.due_at) : null;
            if (!due) {
                bucketed.later.push(row);
                return;
            }
            if (isWithinInterval(due, { start: weekStart, end: weekEnd })) {
                bucketed.thisWeek.push(row);
            } else if (isWithinInterval(due, { start: nextWeekStart, end: nextWeekEnd })) {
                bucketed.nextWeek.push(row);
            } else {
                bucketed.later.push(row);
            }
        });

        return {
            weekStart,
            weekEnd,
            nextWeekStart,
            nextWeekEnd,
            ...bucketed
        };
    }, [visibleTaskRows]);

    useEffect(() => {
        if (filteredOriginGroups.length === 0 || visibleTaskRows.length === 0) {
            setSelectedOriginKey('');
            setSelectedTaskId('');
            return;
        }
        const hasOrigin = selectedOriginKey
            && filteredOriginGroups.some((group) => group.key === selectedOriginKey);
        if (!hasOrigin) {
            const fallback = visibleTaskRows[0];
            if (fallback) {
                setSelectedOriginKey(fallback.originKey);
            }
            return;
        }
    }, [filteredOriginGroups, selectedOriginKey, visibleTaskRows]);

    const selectedOrigin = useMemo(() => (
        filteredOriginGroups.find((group) => group.key === selectedOriginKey) || null
    ), [filteredOriginGroups, selectedOriginKey]);

    useEffect(() => {
        if (!selectedOrigin) {
            setOriginLinks({ parent: null, children: [] });
            setNestedExpanded({});
            setNestedTasks({});
            return;
        }
        loadOriginLinks(selectedOrigin.origin_type, selectedOrigin.origin_id);
        setNestedExpanded({});
        setNestedTasks({});
        setNestedLoading({});
    }, [loadOriginLinks, selectedOrigin]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            const target = event.target;
            if (target.closest('.tasks-detail-card')) return;
            if (target.closest('.origin-summary-row')) return;
            if (target.closest('.task-detail-task')) return;
            if (target.closest('.origin-task-row')) return;
            setSelectedTaskId('');
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, []);

    const formatPriorityLabel = useCallback((task) => {
        const tier = task?.priority_tier || 'Normal';
        return tier;
    }, []);

    const getPriorityClass = useCallback((task) => {
        const tier = (task?.priority_tier || '').toLowerCase();
        if (tier === 'critical') return 'priority-critical';
        if (tier === 'high') return 'priority-high';
        if (tier === 'low') return 'priority-low';
        if (tier === 'someday') return 'priority-someday';
        return 'priority-normal';
    }, []);

    const getDisplayLabel = useCallback((task) => {
        const dueInfo = getDueInfo(task);
        return dueInfo?.label || formatPriorityLabel(task);
    }, [formatPriorityLabel]);

    const getDisplayClass = useCallback((task) => {
        const dueInfo = getDueInfo(task);
        if (dueInfo?.className) return dueInfo.className;
        return getPriorityClass(task);
    }, [getPriorityClass]);

    const openTaskModal = useCallback((task) => {
        if (!task) return;
        setTaskDraft({
            id: task.id,
            text: task.text || '',
            dueDate: buildDueDateInput(task.due_at),
            priorityOverride: task.priority_override ?? '',
            notes: task.notes || ''
        });
        setTaskModalOpen(true);
    }, []);

    const addTask = async (event) => {
        event.preventDefault();
        const trimmed = newTask.trim();
        if (!trimmed) return;
        const projectLabel = projectName.trim() || 'Operations';
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: trimmed,
                    source_type: 'operations',
                    source_id: projectLabel.toLowerCase().replace(/\s+/g, '-')
                })
            });
            if (!response.ok) throw new Error('Failed to create task');
            const created = await response.json();
            setNewTask('');
            await loadAllTasks();
            openTaskModal(created);
        } catch (err) {
            console.error('Failed to create task:', err);
            setError('Unable to add task. Please try again.');
        }
    };

    const saveTaskDetails = async () => {
        if (!taskDraft.id) return;
        try {
            const payload = {
                text: taskDraft.text || '',
                due_at: taskDraft.dueDate ? `${taskDraft.dueDate}T00:00:00` : null,
                priority_override: taskDraft.priorityOverride !== '' ? Number(taskDraft.priorityOverride) : null,
                notes: taskDraft.notes || ''
            };
            const response = await fetch(`${API_URL}/tasks/${taskDraft.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('Failed to update task');
            setTaskModalOpen(false);
            await loadAllTasks();
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const saveTaskNotes = async () => {
        if (!selectedTask?.id) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${selectedTask.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: taskNotesDraft || '' })
            });
            if (!response.ok) throw new Error('Failed to update task notes');
            await loadAllTasks();
        } catch (err) {
            console.error('Failed to update task notes:', err);
            setError('Unable to update task notes. Please try again.');
        }
    };

    const updateTaskProgress = async (task, nextKey) => {
        if (!task) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: task.text, progress_key: nextKey })
            });
            if (!response.ok) throw new Error('Failed to update task');
            await loadAllTasks();
        } catch (err) {
            console.error('Failed to update task progress:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const toggleTask = async (task) => {
        if (!task) return;
        const progressMeta = getTaskProgressMeta(task);
        if (progressMeta?.nextStep) {
            await updateTaskProgress(task, progressMeta.nextStep.key);
            return;
        }
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: task.text, completed: !task.completed })
            });
            if (!response.ok) throw new Error('Failed to update task');
            await loadAllTasks();
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const selectedTask = useMemo(() => {
        if (!selectedOrigin || !selectedTaskId) return null;
        const representativeTasks = selectedOrigin.lists
            .map((list) => getListRepresentativeTask(list))
            .filter(Boolean);
        if (!representativeTasks.length) return null;
        return representativeTasks.find((task) => task.id === selectedTaskId) || null;
    }, [selectedOrigin, selectedTaskId]);

    useEffect(() => {
        setTaskNotesDraft(selectedTask?.notes || '');
    }, [selectedTask?.notes]);

    const selectedTaskKey = selectedTask?.id || selectedTaskId || '';

    const selectedOriginSubtitle = selectedOrigin?.sample ? formatOriginSubtitle(selectedOrigin.sample) : '';
    const selectedOriginTitle = selectedOrigin?.sample
        ? formatOriginLabel(selectedOrigin.sample)
        : 'Task Origin';

    const getOriginLink = useCallback((origin) => {
        if (!origin) return '';
        if (origin.origin_type === 'sunday') {
            const dateParam = origin.origin_id ? `date=${encodeURIComponent(origin.origin_id)}` : '';
            const extra = selectedTask?.id ? `&task=${encodeURIComponent(selectedTask.id)}` : '';
            return `/sunday${dateParam ? `?${dateParam}${extra}` : ''}`;
        }
        if (origin.origin_type === 'vestry') return '/vestry';
        if (origin.origin_type === 'event') return '/calendar';
        if (origin.origin_type === 'ticket') {
            const ticketParam = origin.origin_id ? `ticket=${encodeURIComponent(origin.origin_id)}` : '';
            return `/buildings${ticketParam ? `?${ticketParam}` : ''}`;
        }
        if (origin.origin_type === 'operations') return '/tasks';
        return '';
    }, [selectedTask?.id]);

    const parentOriginKey = originLinks.parent
        ? normalizeOriginKey(originLinks.parent.origin_type, originLinks.parent.origin_id)
        : '';
    const parentOriginGroup = parentOriginKey ? originGroupMap.get(parentOriginKey) : null;
    const parentOriginLabel = parentOriginGroup?.sample
        ? (parentOriginGroup.sample.event_title || formatTaskTitle(parentOriginGroup.nextTask || parentOriginGroup.sample))
        : (originLinks.parent?.label || '');

    return {
        PRIORITY_OPTIONS,
        tasksLoading,
        error,
        newTask,
        projectName,
        showCompleted,
        taskModalOpen,
        taskDraft,
        taskNotesDraft,
        selectedOriginKey,
        selectedTaskId,
        selectedTaskKey,
        selectedOrigin,
        selectedOriginTitle,
        selectedOriginSubtitle,
        selectedTask,
        originLinks,
        nestedExpanded,
        nestedTasks,
        nestedLoading,
        originGroupMap,
        weekBuckets,
        parentOriginGroup,
        parentOriginLabel,
        setProjectName,
        setNewTask,
        setShowCompleted,
        setTaskModalOpen,
        setTaskDraft,
        setTaskNotesDraft,
        setSelectedOriginKey,
        setSelectedTaskId,
        setNestedExpanded,
        setNestedTasks,
        setNestedLoading,
        addTask,
        saveTaskDetails,
        saveTaskNotes,
        updateTaskProgress,
        toggleTask,
        openTaskModal,
        getDisplayClass,
        getDisplayLabel,
        getOriginLink,
        getOriginColorClass,
        formatOriginLabel,
        formatOriginSubtitle,
        getTopLevelTaskTitle,
        getTaskNextStepLabel,
        getTaskProgressMeta,
        getListRepresentativeTask,
        getListProgressDisplay,
        sortTasksForDetails,
        formatTaskTitle,
        handleToggleNested
    };
};
