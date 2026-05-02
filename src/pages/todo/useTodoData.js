import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, isWithinInterval, parseISO } from 'date-fns';

import { API_URL } from '../../services/apiConfig';
import { getOriginRoute } from '../../config/appRoutes';
import { getTaskProgressMeta, getTaskNextStepLabel } from '../../utils/taskProgress';
import { buildOriginGroups } from '../../../shared/taskRollups.js';
import {
    getNextTaskCycleState,
    getTaskCycleState,
    isSimpleStatusListKey
} from '../../../shared/taskStatus.js';
import {
    PRIORITY_OPTIONS,
    isDateString,
    normalizeOriginKey,
    parseDueDate,
    sortTasksByPriority,
    sortTasksForDetails,
    getListRepresentativeTask,
    getTopLevelTaskTitle,
    getListProgressDisplay,
    getListChecklist,
    formatTaskTitle,
    formatOriginLabel,
    formatOriginSubtitle,
    getWorkPackageTitle,
    getWorkPackageSubtitle,
    getWorkPackageSummary,
    getPackageDueInfo,
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

const toDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const getDueAtFromPreset = (preset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let due = null;
    if (preset === 'today') {
        due = new Date(today);
    } else if (preset === 'tomorrow') {
        due = new Date(today);
        due.setDate(due.getDate() + 1);
    } else if (preset === 'friday') {
        due = new Date(today);
        const day = due.getDay(); // 0..6
        const delta = (5 - day + 7) % 7;
        due.setDate(due.getDate() + delta);
    } else if (preset === 'next-monday') {
        due = new Date(today);
        const day = due.getDay(); // 0..6
        let delta = (1 - day + 7) % 7;
        if (delta === 0) delta = 7;
        due.setDate(due.getDate() + delta);
    }
    if (!due) return null;
    return `${toDateKey(due)}T00:00:00`;
};

const initialSelectionState = {
    originKey: '',
    sectionKey: '',
    taskId: ''
};

const selectionReducer = (state, action) => {
    switch (action.type) {
    case 'select-focus':
        return {
            originKey: action.originKey || '',
            sectionKey: action.sectionKey || '',
            taskId: action.taskId || ''
        };
    case 'select-origin':
        return {
            originKey: action.originKey || '',
            sectionKey: '',
            taskId: ''
        };
    case 'select-section':
        return {
            ...state,
            sectionKey: action.sectionKey || '',
            taskId: action.taskId || ''
        };
    case 'select-task':
        return {
            ...state,
            taskId: action.taskId || ''
        };
    default:
        return state;
    }
};

export const useTodoData = () => {
    const [taskList, setTaskList] = useState([]);
    const [selection, dispatchSelection] = useReducer(selectionReducer, initialSelectionState);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [error, setError] = useState('');
    const [newTask, setNewTask] = useState('');
    const [newTaskDuePreset, setNewTaskDuePreset] = useState('');
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
    const setSelectedOriginKey = useCallback((originKey) => {
        dispatchSelection({ type: 'select-origin', originKey });
    }, []);
    const setSelectedSectionKey = useCallback((sectionKey) => {
        dispatchSelection({ type: 'select-section', sectionKey });
    }, []);
    const setSelectedTaskId = useCallback((taskId) => {
        dispatchSelection({ type: 'select-task', taskId });
    }, []);
    const selectFocus = useCallback(({ originKey = '', sectionKey = '', taskId = '' }) => {
        dispatchSelection({ type: 'select-focus', originKey, sectionKey, taskId });
    }, []);

    const upsertTaskInState = useCallback((nextTask) => {
        if (!nextTask?.id) return;
        const nextOriginKey = normalizeOriginKey(nextTask.origin_type, nextTask.origin_id);
        setTaskList((prev) => {
            const index = prev.findIndex((task) => task.id === nextTask.id);
            if (index === -1) return [...prev, nextTask];
            const next = [...prev];
            next[index] = nextTask;
            return next;
        });
        setNestedTasks((prev) => Object.fromEntries(
            Object.entries(prev).map(([key, tasks]) => {
                if (!Array.isArray(tasks)) return [key, tasks];
                const index = tasks.findIndex((task) => task.id === nextTask.id);
                if (index >= 0) {
                    const next = [...tasks];
                    next[index] = nextTask;
                    return [key, next];
                }
                if (key === nextOriginKey) {
                    return [key, [...tasks, nextTask]];
                }
                return [key, tasks];
            })
        ));
    }, []);

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
        const mailGroups = taskList.reduce((acc, task) => {
            const originType = String(task?.origin_type || '').toLowerCase();
            const listKey = String(task?.list_key || '').toLowerCase();
            if (originType !== 'operations' || !/^mail-(mon|wed|fri)$/.test(listKey)) return acc;
            const originId = String(task?.origin_id || '');
            if (!acc[originId]) acc[originId] = [];
            acc[originId].push(task);
            return acc;
        }, {});

        const normalizedMailMeta = Object.fromEntries(
            Object.entries(mailGroups).map(([originId, tasks]) => {
                const representativeTask = [...tasks].sort((a, b) => {
                    const order = {
                        in_progress: 0,
                        open: 1,
                        blocked: 2,
                        done: 3
                    };
                    const aState = order[getTaskCycleState(a)] ?? 99;
                    const bState = order[getTaskCycleState(b)] ?? 99;
                    if (aState !== bState) return aState - bState;
                    return String(a?.due_at || '').localeCompare(String(b?.due_at || ''));
                })[0] || null;
                const latestCompleted = tasks
                    .filter((task) => task?.completed_at)
                    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')))[0] || null;
                const state = getTaskCycleState(representativeTask);
                return [originId, {
                    state,
                    completedAt: state === 'done' ? (latestCompleted?.completed_at || null) : null
                }];
            })
        );

        const normalizedTasks = taskList.map((task) => {
            if (!task) return task;
            const nextTask = { ...task };
            const originType = String(nextTask.origin_type || '').toLowerCase();
            const listKey = String(nextTask.list_key || '').toLowerCase();

            if (originType === 'operations' && /^mail-(mon|wed|fri)$/.test(listKey)) {
                nextTask.list_key = 'mail';
                nextTask.list_title = 'Mail';
                const mailMeta = normalizedMailMeta[String(nextTask.origin_id || '')];
                if (mailMeta) {
                    nextTask.state = mailMeta.state;
                    nextTask.completed_at = mailMeta.completedAt;
                }
            }

            if (originType === 'operations' && String(nextTask.origin_id || '').startsWith('timesheets-')) {
                const dueDate = parseDueDate(nextTask.due_at);
                if (dueDate) {
                    const weekStart = startOfWeek(dueDate, { weekStartsOn: 1 });
                    nextTask.source_origin_id = nextTask.origin_id;
                    nextTask.origin_id = `weekly-${toDateKey(weekStart)}`;
                }
            }

            return nextTask;
        });
        const isLegacyOrCanonicalSundayServiceEventTask = (task) => {
            const originType = String(task?.origin_type || '').toLowerCase();
            const listKey = String(task?.list_key || '').toLowerCase();
            const eventTypeSlug = String(task?.event_type_slug || '').toLowerCase();
            const eventTypeName = String(task?.event_type_name || '').toLowerCase();

            if (originType === 'sunday') {
                return listKey === 'bulletins-10am' || listKey === 'bulletins-8am';
            }

            if (originType !== 'event') return false;
            if (['weekly-service', 'rite-i-service', 'rite-ii-service'].includes(eventTypeSlug)) return true;
            return eventTypeName === 'sunday service (legacy)' || eventTypeName === 'rite i' || eventTypeName === 'rite ii';
        };
        return buildOriginGroups(normalizedTasks, {
            excludeTask: isLegacyOrCanonicalSundayServiceEventTask,
            sortTasks: sortTasksByPriority
        });
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
        return visibleOriginGroups.map((group) => ({
            originKey: group.key,
            origin: group,
            task: group.nextTask || group.sample || null,
            packageDueInfo: getPackageDueInfo(group),
            isComplete: group.openCount === 0
        })).sort((a, b) => {
            const rankA = a.packageDueInfo?.rank ?? Number.POSITIVE_INFINITY;
            const rankB = b.packageDueInfo?.rank ?? Number.POSITIVE_INFINITY;
            if (rankA !== rankB) return rankA - rankB;
            const dueA = a.packageDueInfo?.due?.getTime?.() ?? Number.POSITIVE_INFINITY;
            const dueB = b.packageDueInfo?.due?.getTime?.() ?? Number.POSITIVE_INFINITY;
            if (dueA !== dueB) return dueA - dueB;
            const priorityA = Number(a.task?.priority_effective || 0);
            const priorityB = Number(b.task?.priority_effective || 0);
            if (priorityA !== priorityB) return priorityB - priorityA;
            return String(a.originKey || '').localeCompare(String(b.originKey || ''));
        });
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
            overdue: [],
            today: [],
            thisWeek: [],
            nextWeek: [],
            later: []
        };

        visibleTaskRows.forEach((row) => {
            const bucket = row.packageDueInfo?.bucket || 'later';
            if (bucket === 'overdue') {
                bucketed.overdue.push(row);
            } else if (bucket === 'today') {
                bucketed.today.push(row);
            } else if (bucket === 'this_week') {
                bucketed.thisWeek.push(row);
            } else if (bucket === 'next_week') {
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

    const selectedOrigin = useMemo(() => {
        if (!selection.originKey) return null;
        return filteredOriginGroups.find((group) => group.key === selection.originKey) || null;
    }, [filteredOriginGroups, selection.originKey]);

    const selectedOriginKey = selectedOrigin?.key || '';

    const selectedWorkPackage = useMemo(() => (
        selectedOrigin ? getWorkPackageSummary(selectedOrigin) : null
    ), [selectedOrigin]);

    const selectedSection = useMemo(() => {
        if (!selectedWorkPackage) return null;
        return selectedWorkPackage.sections.find((section) => section.key === selection.sectionKey)
            || selectedWorkPackage.primarySection
            || selectedWorkPackage.sections[0]
            || null;
    }, [selection.sectionKey, selectedWorkPackage]);

    const selectedSectionKey = selectedSection?.key || '';

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
            dispatchSelection({ type: 'select-task', taskId: '' });
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

    const createTaskFromQuickAdd = async ({ openDetails = false } = {}) => {
        const trimmed = newTask.trim();
        if (!trimmed) return;
        const projectLabel = projectName.trim() || 'Operations';
        const dueAt = getDueAtFromPreset(newTaskDuePreset);
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: trimmed,
                    source_type: 'operations',
                    source_id: projectLabel.toLowerCase().replace(/\s+/g, '-'),
                    due_at: dueAt
                })
            });
            if (!response.ok) throw new Error('Failed to create task');
            const created = await response.json();
            upsertTaskInState(created);
            setNewTask('');
            setNewTaskDuePreset('');
            selectFocus({
                originKey: normalizeOriginKey(created.origin_type, created.origin_id),
                taskId: created.id || ''
            });
            if (openDetails) {
                openTaskModal(created);
            }
        } catch (err) {
            console.error('Failed to create task:', err);
            setError('Unable to add task. Please try again.');
        }
    };

    const addTask = async (event) => {
        event.preventDefault();
        await createTaskFromQuickAdd({ openDetails: false });
    };

    const addTaskWithDetails = async () => {
        await createTaskFromQuickAdd({ openDetails: true });
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
            const updated = await response.json();
            upsertTaskInState(updated);
            setTaskModalOpen(false);
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const saveTaskNotes = async () => {
        if (!focusTask?.id) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${focusTask.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: taskNotesDraft || '' })
            });
            if (!response.ok) throw new Error('Failed to update task notes');
            const updated = await response.json();
            upsertTaskInState(updated);
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
            const updated = await response.json();
            upsertTaskInState(updated);
        } catch (err) {
            console.error('Failed to update task progress:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const updateTaskState = async (task, nextState) => {
        if (!task) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: task.text,
                    state: nextState,
                    progress_key: ''
                })
            });
            if (!response.ok) throw new Error('Failed to update task state');
            const updated = await response.json();
            upsertTaskInState(updated);
        } catch (err) {
            console.error('Failed to update task state:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const ensureTaskInProgress = async (task) => {
        if (!task) return;
        if (getTaskCycleState(task) === 'done' || getTaskCycleState(task) === 'in_progress') return;
        await updateTaskState(task, 'in_progress');
    };

    const markTaskDone = async (task) => {
        if (!task) return;
        await updateTaskState(task, 'done');
    };

    const resetTaskState = async (task) => {
        if (!task) return;
        await updateTaskState(task, 'open');
    };

    const toggleTask = async (task) => {
        if (!task) return;
        if (isSimpleStatusListKey(task.list_key)) {
            await updateTaskState(task, getNextTaskCycleState(task));
            return;
        }
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
            const updated = await response.json();
            upsertTaskInState(updated);
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    const selectedTask = useMemo(() => {
        if (!selectedOrigin || !selection.taskId) return null;
        const allTasks = selectedOrigin.lists.flatMap((list) => list.tasks || []);
        return allTasks.find((task) => task.id === selection.taskId) || null;
    }, [selectedOrigin, selection.taskId]);

    const focusTask = selectedTask
        || selectedSection?.actionTask
        || selectedSection?.currentTask
        || null;

    useEffect(() => {
        setTaskNotesDraft(focusTask?.notes || '');
    }, [focusTask?.notes]);

    const selectedTaskId = selectedTask?.id || '';
    const selectedTaskKey = selectedTask?.id || focusTask?.id || selection.taskId || '';

    const selectedOriginSubtitle = selectedOrigin?.sample ? getWorkPackageSubtitle(selectedOrigin) : '';
    const selectedOriginTitle = selectedOrigin?.sample
        ? getWorkPackageTitle(selectedOrigin)
        : 'Task Origin';

    const getOriginLink = useCallback((origin) => getOriginRoute({
        originType: origin?.origin_type,
        originId: origin?.origin_id,
        taskId: focusTask?.id
    }), [focusTask?.id]);

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
        taskList,
        newTask,
        newTaskDuePreset,
        projectName,
        showCompleted,
        taskModalOpen,
        taskDraft,
        taskNotesDraft,
        selectedOriginKey,
        selectedSectionKey,
        selectedTaskId,
        selectedTaskKey,
        selectedOrigin,
        selectedWorkPackage,
        selectedSection,
        selectedOriginTitle,
        selectedOriginSubtitle,
        selectedTask,
        focusTask,
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
        setNewTaskDuePreset,
        setShowCompleted,
        setTaskModalOpen,
        setTaskDraft,
        setTaskNotesDraft,
        setSelectedOriginKey,
        setSelectedSectionKey,
        setSelectedTaskId,
        setNestedExpanded,
        setNestedTasks,
        setNestedLoading,
        reloadTasks: loadAllTasks,
        addTask,
        addTaskWithDetails,
        saveTaskDetails,
        saveTaskNotes,
        updateTaskProgress,
        updateTaskState,
        ensureTaskInProgress,
        markTaskDone,
        resetTaskState,
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
        getListChecklist,
        getWorkPackageTitle,
        getWorkPackageSubtitle,
        getWorkPackageSummary,
        sortTasksForDetails,
        formatTaskTitle,
        handleToggleNested
    };
};

