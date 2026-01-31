import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfWeek, endOfWeek, addWeeks, isWithinInterval, parseISO } from 'date-fns';
import { FaPlus, FaCheck } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import './Todo.css';

const isDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const isMonthString = (value) => /^\d{4}-\d{2}$/.test(value || '');
const normalizeOriginKey = (originType, originId) => `${originType || 'manual'}:${originId || 'manual'}`;
const getListKey = (task) => task?.list_key || 'default';
const LIST_COLLAPSE_THRESHOLD = 8;
const PRIORITY_OPTIONS = [
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

const compareTasks = (a, b) => {
    const stateA = stateOrder[a?.state] ?? 99;
    const stateB = stateOrder[b?.state] ?? 99;
    if (stateA !== stateB) return stateA - stateB;
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;
    if (a?.priority_effective !== b?.priority_effective) {
        return (b?.priority_effective || 0) - (a?.priority_effective || 0);
    }
    const dueA = a?.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
    const dueB = b?.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return createdA - createdB;
};

const sortTasksByPriority = (tasks) => [...tasks].sort(compareTasks);
const compareTasksIgnoreState = (a, b) => {
    const rankA = a?.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
    const rankB = b?.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
    if (rankA !== rankB) return rankA - rankB;
    if (a?.priority_effective !== b?.priority_effective) {
        return (b?.priority_effective || 0) - (a?.priority_effective || 0);
    }
    const dueA = a?.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
    const dueB = b?.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return createdA - createdB;
};
const sortTasksForDetails = (tasks) => [...tasks].sort(compareTasksIgnoreState);
const parseDueDate = (value) => {
    if (!value) return null;
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const toTitleCase = (value) => String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getContextLabel = (task) => {
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

const formatTaskTitle = (task) => {
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

const Todo = () => {
    const navigate = useNavigate();
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
    const [expandedLists, setExpandedLists] = useState({});

    const renderCountBadge = useCallback((count, label) => (
        count === 0 ? (
            <span className="check-badge count-badge-check" aria-label={label}>
                ✓
            </span>
        ) : (
            <span className="count-badge" aria-label={label}>
                {count}
            </span>
        )
    ), []);

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
        const grouped = new Map();
        taskList.forEach((task) => {
            if (task.archived_at) return;
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
                const totalCount = list.tasks.length;
                const openTasks = list.tasks.filter((task) => !task.completed);
                const completedCount = totalCount - openTasks.length;
                const listMode = list.mode || 'sequential';
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

    const originGroupMap = useMemo(() => {
        const map = new Map();
        originGroups.forEach((group) => map.set(group.key, group));
        return map;
    }, [originGroups]);

    const visibleOriginGroups = useMemo(() => (
        showCompleted ? originGroups : originGroups.filter((group) => group.openCount > 0)
    ), [originGroups, showCompleted]);

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

        visibleOriginGroups.forEach((group) => {
            const due = group.originDue || (group.nextTask?.due_at ? parseDueDate(group.nextTask.due_at) : null);
            if (!due) {
                bucketed.later.push(group);
                return;
            }
            if (isWithinInterval(due, { start: weekStart, end: weekEnd })) {
                bucketed.thisWeek.push(group);
            } else if (isWithinInterval(due, { start: nextWeekStart, end: nextWeekEnd })) {
                bucketed.nextWeek.push(group);
            } else {
                bucketed.later.push(group);
            }
        });

        return {
            weekStart,
            weekEnd,
            nextWeekStart,
            nextWeekEnd,
            ...bucketed
        };
    }, [visibleOriginGroups]);

    useEffect(() => {
        if (originGroups.length === 0) {
            setSelectedOriginKey('');
            setSelectedTaskId('');
            return;
        }
        if (!selectedOriginKey || !originGroups.find((group) => group.key === selectedOriginKey)) {
            const fallback = visibleOriginGroups[0] || originGroups[0];
            if (fallback) {
                setSelectedOriginKey(fallback.key);
            }
            setSelectedTaskId('');
        }
    }, [originGroups, selectedOriginKey, visibleOriginGroups]);

    const selectedOrigin = useMemo(() => (
        originGroups.find((group) => group.key === selectedOriginKey) || null
    ), [originGroups, selectedOriginKey]);

    useEffect(() => {
        if (!selectedOrigin) {
            setOriginLinks({ parent: null, children: [] });
            setNestedExpanded({});
            setNestedTasks({});
            setExpandedLists({});
            return;
        }
        loadOriginLinks(selectedOrigin.origin_type, selectedOrigin.origin_id);
        setNestedExpanded({});
        setNestedTasks({});
        setNestedLoading({});
        setExpandedLists({});
    }, [loadOriginLinks, selectedOrigin]);

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

    const formatOriginLabel = useCallback((task) => {
        const rawType = task?.origin_type;
        if (!rawType) return 'Task Origin';
        const type = rawType.toLowerCase();
        if (type.includes('sunday')) return 'Sunday Planner';
        if (type.includes('vestry')) return 'Vestry';
        if (type.includes('event')) return 'Event';
        if (type.includes('operation')) return 'Operations';
        if (type.includes('ticket')) return 'Ticket';
        if (type.includes('project')) return 'Project';
        if (type.includes('general')) return 'General Operations';
        return rawType;
    }, []);

    const formatOriginSubtitle = useCallback((task) => {
        if (!task?.origin_id) return '';
        if (task.origin_type === 'event' && task.event_date) {
            const dateLabel = format(new Date(`${task.event_date}T00:00:00`), 'MMM d, yyyy');
            const timeLabel = task.event_time ? ` at ${task.event_time}` : '';
            const typeLabel = task.event_type_name ? `${task.event_type_name} - ` : '';
            return `${typeLabel}${dateLabel}${timeLabel}`;
        }
        if (isDateString(task.origin_id)) {
            return format(new Date(`${task.origin_id}T00:00:00`), 'MMM d, yyyy');
        }
        if (isMonthString(task.origin_id)) {
            return format(new Date(`${task.origin_id}-01T00:00:00`), 'MMM yyyy');
        }
        if (task.origin_id.startsWith('weekly-')) {
            const dateKey = task.origin_id.replace('weekly-', '');
            if (isDateString(dateKey)) {
                return `Week of ${format(new Date(`${dateKey}T00:00:00`), 'MMM d, yyyy')}`;
            }
        }
        if (task.origin_id.startsWith('timesheets-')) {
            return `Timesheets ${task.origin_id.replace('timesheets-', '')}`;
        }
        return task.origin_id;
    }, []);

    const buildDueDateInput = useCallback((dueAt) => {
        if (!dueAt) return '';
        try {
            const parsed = parseISO(dueAt);
            return format(parsed, 'yyyy-MM-dd');
        } catch {
            return '';
        }
    }, []);

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
    }, [buildDueDateInput]);

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

    const toggleTask = async (task) => {
        if (!task) return;
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
        if (!selectedOrigin) return null;
        const searchId = selectedTaskId || selectedOrigin?.nextTask?.id;
        if (!searchId) return null;
        for (const list of selectedOrigin.lists) {
            const match = list.tasks.find((task) => task.id === searchId);
            if (match) return match;
        }
        return null;
    }, [selectedOrigin, selectedTaskId]);

    useEffect(() => {
        setTaskNotesDraft(selectedTask?.notes || '');
    }, [selectedTask?.id]);

    const selectedOriginTitle = selectedOrigin?.sample
        ? (selectedOrigin.sample.event_title || formatTaskTitle(selectedOrigin.sample) || 'Task Origin')
        : 'Task Origin';
    const selectedOriginSubtitle = selectedOrigin?.sample ? formatOriginSubtitle(selectedOrigin.sample) : '';

    const parentOriginKey = originLinks.parent
        ? normalizeOriginKey(originLinks.parent.origin_type, originLinks.parent.origin_id)
        : '';
    const parentOriginGroup = parentOriginKey ? originGroupMap.get(parentOriginKey) : null;
    const parentOriginLabel = parentOriginGroup?.sample
        ? (parentOriginGroup.sample.event_title || formatTaskTitle(parentOriginGroup.nextTask || parentOriginGroup.sample))
        : (originLinks.parent?.label || '');

    return (
        <div className="page-todo">
            <header className="page-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Tasks</h1>
                    <p className="page-header-subtitle">Due this week first, then next week and later.</p>
                </div>
                <div className="page-header-actions">
                    <form className="task-add-form task-add-form--header" onSubmit={addTask}>
                        <input
                            type="text"
                            className="task-project-input"
                            placeholder="Project"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="Quick add a task..."
                            value={newTask}
                            onChange={(e) => setNewTask(e.target.value)}
                        />
                        <button type="submit" className="btn-primary" disabled={!newTask.trim()}>
                            <FaPlus /> Add
                        </button>
                    </form>
                    <label className="toggle-inline">
                        <input
                            type="checkbox"
                            checked={showCompleted}
                            onChange={(e) => setShowCompleted(e.target.checked)}
                        />
                        Show completed
                    </label>
                </div>
            </header>

            <div className="tasks-layout">
                <div className="tasks-stack">
                    <Card className="tasks-list-card allow-overflow">
                    <div className="tasks-list-header">
                        <div>
                            <h2>This Week</h2>
                            <p className="muted">
                                Due {format(weekBuckets.weekStart, 'MMM d')} - {format(weekBuckets.weekEnd, 'MMM d')}
                            </p>
                        </div>
                        {renderCountBadge(
                            weekBuckets.thisWeek.length,
                            weekBuckets.thisWeek.length === 0
                                ? "This week's tasks complete"
                                : `${weekBuckets.thisWeek.length} origins`
                        )}
                    </div>

                    <div className="task-list-wrapper">
                        {tasksLoading && <div className="empty-state">Loading tasks...</div>}
                        {error && !tasksLoading && <div className="empty-state">{error}</div>}
                        {!tasksLoading && !error && weekBuckets.thisWeek.length === 0 && (
                            <div className="empty-state">This week's tasks complete.</div>
                        )}
                        {!tasksLoading && !error && weekBuckets.thisWeek.length > 0 && (
                            <div className="origin-summary-table">
                                <div className="origin-summary-header" role="row">
                                    <span>Origin</span>
                                    <span>Next step</span>
                                    <span>Next due</span>
                                    <span>Origin due</span>
                                    <span>Priority</span>
                                </div>
                                <div className="origin-summary-body">
                                    {weekBuckets.thisWeek.map((group) => {
                                        const nextTask = group.nextTask;
                                        const originLabel = formatOriginLabel(group.sample);
                                        const originSubtitle = formatOriginSubtitle(group.sample);
                                        const originTitle = group.sample?.event_title
                                            || group.sample?.ticket_title
                                            || group.sample?.list_title
                                            || originLabel
                                            || 'Task Origin';
                                        const nextDue = nextTask?.due_at
                                            ? format(new Date(nextTask.due_at), 'MMM d')
                                            : '-';
                                        const originDue = group.originDue
                                            ? format(group.originDue, 'MMM d')
                                            : '-';
                                        return (
                                            <button
                                                key={group.key}
                                                type="button"
                                                className={`origin-summary-row ${group.key === selectedOriginKey ? 'active' : ''}`}
                                                onClick={() => {
                                                    setSelectedOriginKey(group.key);
                                                    setSelectedTaskId('');
                                                }}
                                            >
                                                <div className="origin-cell origin-cell-main">
                                                    <div className="origin-title">{originTitle}</div>
                                                    <div className="origin-meta">
                                                        {originLabel}
                                                        {originSubtitle ? ` - ${originSubtitle}` : ''}
                                                    </div>
                                                </div>
                                                <div className="origin-cell origin-cell-next">
                                                    {nextTask && (
                                                        <button
                                                            type="button"
                                                            className="origin-summary-check"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleTask(nextTask);
                                                            }}
                                                            aria-label="Mark next step complete"
                                                        >
                                                            {nextTask.completed && <FaCheck />}
                                                        </button>
                                                    )}
                                                    <span className="origin-next-text">
                                                        {nextTask ? nextTask.text : 'No open tasks'}
                                                    </span>
                                                </div>
                                                <div className="origin-cell origin-cell-date">{nextDue}</div>
                                                <div className="origin-cell origin-cell-date">{originDue}</div>
                                                <div className="origin-cell origin-cell-priority">
                                                    {nextTask ? (
                                                        <span className={`priority-pill ${getPriorityClass(nextTask)}`}>
                                                            {formatPriorityLabel(nextTask)}
                                                        </span>
                                                    ) : (
                                                        <span className="muted">-</span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    </Card>

                    <Card className="tasks-list-card allow-overflow">
                    <div className="tasks-list-header">
                        <div>
                            <h2>Next Week</h2>
                            <p className="muted">
                                {format(weekBuckets.nextWeekStart, 'MMM d')} - {format(weekBuckets.nextWeekEnd, 'MMM d')}
                            </p>
                        </div>
                        {renderCountBadge(
                            weekBuckets.nextWeek.length,
                            weekBuckets.nextWeek.length === 0
                                ? "Next week's tasks complete"
                                : `${weekBuckets.nextWeek.length} origins`
                        )}
                    </div>
                    {tasksLoading && <div className="empty-state">Loading tasks...</div>}
                    {error && !tasksLoading && <div className="empty-state">{error}</div>}
                    {!tasksLoading && !error && weekBuckets.nextWeek.length === 0 && (
                        <div className="empty-state">Next week's tasks complete.</div>
                    )}
                    {!tasksLoading && !error && weekBuckets.nextWeek.length > 0 && (
                        <div className="origin-summary-table">
                            <div className="origin-summary-header" role="row">
                                <span>Origin</span>
                                <span>Next step</span>
                                <span>Next due</span>
                                <span>Origin due</span>
                                <span>Priority</span>
                            </div>
                            <div className="origin-summary-body">
                                {weekBuckets.nextWeek.map((group) => {
                                    const nextTask = group.nextTask;
                                    const originLabel = formatOriginLabel(group.sample);
                                    const originSubtitle = formatOriginSubtitle(group.sample);
                                    const originTitle = group.sample?.event_title
                                        || group.sample?.ticket_title
                                        || group.sample?.list_title
                                        || originLabel
                                        || 'Task Origin';
                                    const nextDue = nextTask?.due_at
                                        ? format(new Date(nextTask.due_at), 'MMM d')
                                        : '-';
                                    const originDue = group.originDue
                                        ? format(group.originDue, 'MMM d')
                                        : '-';
                                    return (
                                        <button
                                            key={group.key}
                                            type="button"
                                            className={`origin-summary-row ${group.key === selectedOriginKey ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedOriginKey(group.key);
                                                setSelectedTaskId('');
                                            }}
                                        >
                                            <div className="origin-cell origin-cell-main">
                                                <div className="origin-title">{originTitle}</div>
                                                <div className="origin-meta">
                                                    {originLabel}
                                                    {originSubtitle ? ` - ${originSubtitle}` : ''}
                                                </div>
                                            </div>
                                            <div className="origin-cell origin-cell-next">
                                                {nextTask && (
                                                    <button
                                                        type="button"
                                                        className="origin-summary-check"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleTask(nextTask);
                                                        }}
                                                        aria-label="Mark next step complete"
                                                    >
                                                        {nextTask.completed && <FaCheck />}
                                                    </button>
                                                )}
                                                <span className="origin-next-text">
                                                    {nextTask ? nextTask.text : 'No open tasks'}
                                                </span>
                                            </div>
                                            <div className="origin-cell origin-cell-date">{nextDue}</div>
                                            <div className="origin-cell origin-cell-date">{originDue}</div>
                                            <div className="origin-cell origin-cell-priority">
                                                {nextTask ? (
                                                    <span className={`priority-pill ${getPriorityClass(nextTask)}`}>
                                                        {formatPriorityLabel(nextTask)}
                                                    </span>
                                                ) : (
                                                    <span className="muted">-</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    </Card>

                    <Card className="tasks-list-card allow-overflow">
                    <div className="tasks-list-header">
                        <div>
                            <h2>Later</h2>
                            <p className="muted">Beyond next week</p>
                        </div>
                        {renderCountBadge(
                            weekBuckets.later.length,
                            weekBuckets.later.length === 0
                                ? 'Later tasks complete'
                                : `${weekBuckets.later.length} origins`
                        )}
                    </div>
                    {tasksLoading && <div className="empty-state">Loading tasks...</div>}
                    {error && !tasksLoading && <div className="empty-state">{error}</div>}
                    {!tasksLoading && !error && weekBuckets.later.length === 0 && (
                        <div className="empty-state">Later tasks complete.</div>
                    )}
                    {!tasksLoading && !error && weekBuckets.later.length > 0 && (
                        <div className="origin-summary-table">
                            <div className="origin-summary-header" role="row">
                                <span>Origin</span>
                                <span>Next step</span>
                                <span>Next due</span>
                                <span>Origin due</span>
                                <span>Priority</span>
                            </div>
                            <div className="origin-summary-body">
                                {weekBuckets.later.map((group) => {
                                    const nextTask = group.nextTask;
                                    const originLabel = formatOriginLabel(group.sample);
                                    const originSubtitle = formatOriginSubtitle(group.sample);
                                    const originTitle = group.sample?.event_title
                                        || group.sample?.ticket_title
                                        || group.sample?.list_title
                                        || originLabel
                                        || 'Task Origin';
                                    const nextDue = nextTask?.due_at
                                        ? format(new Date(nextTask.due_at), 'MMM d')
                                        : '-';
                                    const originDue = group.originDue
                                        ? format(group.originDue, 'MMM d')
                                        : '-';
                                    return (
                                        <button
                                            key={group.key}
                                            type="button"
                                            className={`origin-summary-row ${group.key === selectedOriginKey ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedOriginKey(group.key);
                                                setSelectedTaskId('');
                                            }}
                                        >
                                            <div className="origin-cell origin-cell-main">
                                                <div className="origin-title">{originTitle}</div>
                                                <div className="origin-meta">
                                                    {originLabel}
                                                    {originSubtitle ? ` - ${originSubtitle}` : ''}
                                                </div>
                                            </div>
                                            <div className="origin-cell origin-cell-next">
                                                {nextTask && (
                                                    <button
                                                        type="button"
                                                        className="origin-summary-check"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleTask(nextTask);
                                                        }}
                                                        aria-label="Mark next step complete"
                                                    >
                                                        {nextTask.completed && <FaCheck />}
                                                    </button>
                                                )}
                                                <span className="origin-next-text">
                                                    {nextTask ? nextTask.text : 'No open tasks'}
                                                </span>
                                            </div>
                                            <div className="origin-cell origin-cell-date">{nextDue}</div>
                                            <div className="origin-cell origin-cell-date">{originDue}</div>
                                            <div className="origin-cell origin-cell-priority">
                                                {nextTask ? (
                                                    <span className={`priority-pill ${getPriorityClass(nextTask)}`}>
                                                        {formatPriorityLabel(nextTask)}
                                                    </span>
                                                ) : (
                                                    <span className="muted">-</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    </Card>
                </div>

                <Card className="tasks-detail-card">
                    <div className="tasks-list-header">
                        <div>
                            <h2>Task Details</h2>
                            <p className="muted">Origin list first, next step highlighted.</p>
                        </div>
                        <button
                            type="button"
                            className="btn-secondary btn-compact"
                            onClick={() => openTaskModal(selectedTask)}
                            disabled={!selectedTask}
                        >
                            Edit Task
                        </button>
                    </div>
                    {!selectedOrigin && <div className="empty-state">Select a task or origin to see details.</div>}
                    {selectedOrigin && (
                        <div className="task-detail-body">
                            {selectedTask && (
                                <div className="task-selected-summary">
                                    <div className="task-selected-header">
                                        <div>
                                            <div className="task-selected-title">
                                                {formatTaskTitle(selectedTask) || selectedTask.text}
                                            </div>
                                            <div className="task-selected-meta">
                                                {toTitleCase(selectedTask.state || 'open')}
                                                {selectedTask.list_title ? ` • ${selectedTask.list_title}` : ''}
                                                {selectedTask.origin_event ? ` • ${toTitleCase(selectedTask.origin_event)}` : ''}
                                            </div>
                                        </div>
                                        <span className={`priority-pill ${getPriorityClass(selectedTask)}`}>
                                            {formatPriorityLabel(selectedTask)}
                                        </span>
                                    </div>
                                    <div className="task-selected-grid">
                                        <div>
                                            <div className="task-selected-label">Due</div>
                                            <div>
                                                {selectedTask.due_at
                                                    ? format(new Date(selectedTask.due_at), 'MMM d, yyyy')
                                                    : 'Later'}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="task-selected-label">Priority</div>
                                            <div>{formatPriorityLabel(selectedTask)}</div>
                                        </div>
                                        <div>
                                            <div className="task-selected-label">Status</div>
                                            <div>{toTitleCase(selectedTask.state || 'open')}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="task-origin-panel">
                                <div className="task-origin-header">
                                    <div>
                                        <h3>{selectedOriginTitle}</h3>
                                        <div className="origin-meta">
                                            {formatOriginLabel(selectedOrigin.sample)}
                                            {selectedOriginSubtitle ? ` - ${selectedOriginSubtitle}` : ''}
                                        </div>
                                    </div>
                                    {selectedOrigin.origin_type === 'sunday' && (
                                        <button
                                            className="btn-secondary btn-compact"
                                            type="button"
                                            onClick={() => navigate(`/sunday?date=${selectedOrigin.origin_id}`)}
                                        >
                                            Open
                                        </button>
                                    )}
                                    {selectedOrigin.origin_type === 'vestry' && (
                                        <button
                                            className="btn-secondary btn-compact"
                                            type="button"
                                            onClick={() => navigate('/vestry')}
                                        >
                                            Open
                                        </button>
                                    )}
                                    {selectedOrigin.origin_type === 'event' && (
                                        <button
                                            className="btn-secondary btn-compact"
                                            type="button"
                                            onClick={() => navigate('/calendar')}
                                        >
                                            Open
                                        </button>
                                    )}
                                    {selectedOrigin.origin_type === 'ticket' && (
                                        <button
                                            className="btn-secondary btn-compact"
                                            type="button"
                                            onClick={() => navigate(`/buildings?ticket=${selectedOrigin.origin_id}`)}
                                        >
                                            Open
                                        </button>
                                    )}
                                </div>
                                {originLinks.parent && (
                                    <button
                                        type="button"
                                        className="origin-link-note"
                                        onClick={() => {
                                            if (!parentOriginKey) return;
                                            setSelectedOriginKey(parentOriginKey);
                                            setSelectedTaskId('');
                                        }}
                                    >
                                        Part of {parentOriginLabel || 'another origin'} - view list
                                    </button>
                                )}
                            </div>

                            {selectedTask && (
                                <div className="task-notes-card">
                                    <div className="task-notes-header">
                                        <div>
                                            <div className="task-notes-title">Notes</div>
                                            <div className="task-notes-subtitle">Private notes for this task.</div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-secondary btn-compact"
                                            onClick={saveTaskNotes}
                                        >
                                            Save Notes
                                        </button>
                                    </div>
                                    <textarea
                                        className="task-notes-input"
                                        rows={4}
                                        placeholder="Add any extra details, reminders, or context."
                                        value={taskNotesDraft}
                                        onChange={(event) => setTaskNotesDraft(event.target.value)}
                                    />
                                </div>
                            )}

                            <div className="task-origin-list">
                                <div className="task-origin-title">Tasks in this origin</div>
                                {selectedOrigin.lists.length === 0 && (
                                    <div className="empty-state">No tasks found.</div>
                                )}
                                {selectedOrigin.lists.map((list) => {
                                    const displayTasks = list.tasks;
                                    const hasSequence = list.mode === 'sequential'
                                        || list.tasks.some((task) => task.rank != null || task.step_order != null);
                                    const sortedTasks = hasSequence
                                        ? [...displayTasks].sort((a, b) => {
                                            const rankA = a.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
                                            const rankB = b.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
                                            if (rankA !== rankB) return rankA - rankB;
                                            const orderA = a.step_order == null ? Number.POSITIVE_INFINITY : Number(a.step_order);
                                            const orderB = b.step_order == null ? Number.POSITIVE_INFINITY : Number(b.step_order);
                                            if (orderA !== orderB) return orderA - orderB;
                                            return compareTasksIgnoreState(a, b);
                                        })
                                        : sortTasksForDetails(displayTasks);
                                    const listKey = `${selectedOrigin.key}:${list.key}`;
                                    const shouldCollapse = sortedTasks.length > LIST_COLLAPSE_THRESHOLD;
                                    const isExpanded = expandedLists[listKey] || !shouldCollapse;
                                    const visibleTasks = isExpanded
                                        ? sortedTasks
                                        : sortedTasks.slice(0, LIST_COLLAPSE_THRESHOLD);
                                    return (
                                        <div key={list.key} className="origin-list-card">
                                            <div className="origin-list-header">
                                                <div>
                                                    <div className="origin-list-title">{list.title || 'Tasks'}</div>
                                                    <div className="origin-list-meta">
                                                        {list.mode === 'parallel' ? 'Parallel' : 'Sequential'} - {list.openCount} open / {list.totalCount} total
                                                    </div>
                                                </div>
                                                {shouldCollapse && (
                                                    <button
                                                        type="button"
                                                        className="btn-secondary btn-compact"
                                                        onClick={() => setExpandedLists((prev) => ({
                                                            ...prev,
                                                            [listKey]: !prev[listKey]
                                                        }))}
                                                    >
                                                        {isExpanded ? 'Collapse' : `Show ${sortedTasks.length}`}
                                                    </button>
                                                )}
                                            </div>
                                            {sortedTasks.length === 0 && (
                                                <div className="empty-state">No tasks in this list.</div>
                                            )}
                                            {sortedTasks.length > 0 && (
                                                <ul className="origin-task-list">
                                                    {visibleTasks.map((task) => (
                                                        <li
                                                            key={task.id}
                                                            className={`origin-task-row ${task.completed ? 'completed' : ''} ${task.id === selectedTaskId ? 'selected' : ''} ${selectedOrigin?.nextTask?.id === task.id ? 'next-step' : ''}`}
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={() => setSelectedTaskId(task.id)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault();
                                                                    setSelectedTaskId(task.id);
                                                                }
                                                            }}
                                                        >
                                                            <button
                                                                type="button"
                                                                className="origin-task-check"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    toggleTask(task);
                                                                }}
                                                                aria-label="Toggle task"
                                                            >
                                                                {task.completed && <FaCheck />}
                                                            </button>
                                                            <div className="origin-task-text">
                                                                <div className="origin-task-title">{formatTaskTitle(task)}</div>
                                                                <div className="origin-task-meta">
                                                                    {task.due_at && `Due ${format(new Date(task.due_at), 'MMM d')}`}
                                                                    {task.step_order != null && ` - Step ${task.step_order}`}
                                                                    {task.rank != null && ` - Rank ${task.rank}`}
                                                                </div>
                                                            </div>
                                                            <span className={`priority-pill ${getPriorityClass(task)}`}>
                                                                {formatPriorityLabel(task)}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {originLinks.children.length > 0 && (
                                <div className="task-origin-list">
                                    <div className="task-origin-title">Nested lists</div>
                                    <div className="origin-list-stack">
                                        {originLinks.children.map((child) => {
                                            const childKey = normalizeOriginKey(child.origin_type, child.origin_id);
                                            const childGroup = originGroupMap.get(childKey);
                                            const childLabel = childGroup?.sample?.event_title
                                                ? childGroup.sample.event_title
                                                : (childGroup?.nextTask?.text || childGroup?.sample?.text || child.label || 'Origin');
                                            const childSubtitle = childGroup?.sample ? formatOriginSubtitle(childGroup.sample) : '';
                                            const expanded = !!nestedExpanded[childKey];
                                            const childTasks = nestedTasks[childKey] || [];
                                            const loading = nestedLoading[childKey];
                                            return (
                                                <div key={childKey} className="origin-list-card">
                                                    <div className="origin-list-header">
                                                        <div>
                                                            <div className="origin-list-title">{childLabel}</div>
                                                            <div className="origin-list-meta">
                                                                {childSubtitle || `${child.origin_type}:${child.origin_id}`}
                                                            </div>
                                                        </div>
                                                        <div className="nested-actions">
                                                            <button
                                                                type="button"
                                                                className="btn-secondary btn-compact"
                                                                onClick={() => handleToggleNested(child)}
                                                            >
                                                                {expanded ? 'Hide' : 'Show'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn-secondary btn-compact"
                                                                onClick={() => {
                                                                    setSelectedOriginKey(childKey);
                                                                    setSelectedTaskId('');
                                                                }}
                                                            >
                                                                Focus
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {expanded && (
                                                        <>
                                                            {loading && <div className="empty-state">Loading nested tasks...</div>}
                                                            {!loading && childTasks.length === 0 && (
                                                                <div className="empty-state">No tasks in this list.</div>
                                                            )}
                                    {!loading && childTasks.length > 0 && (
                                        <ul className="origin-task-list">
                                            {sortTasksForDetails(childTasks).map((task) => (
                                                <li
                                                    key={task.id}
                                                    className={`origin-task-row ${task.completed ? 'completed' : ''} ${selectedOrigin?.nextTask?.id === task.id ? 'next-step' : ''}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => {
                                                        setSelectedOriginKey(childKey);
                                                        setSelectedTaskId(task.id);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            setSelectedOriginKey(childKey);
                                                            setSelectedTaskId(task.id);
                                                        }
                                                    }}
                                                >
                                                                            <button
                                                                                type="button"
                                                                                className="origin-task-check"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    toggleTask(task);
                                                                                }}
                                                                                aria-label="Toggle task"
                                                                            >
                                                                                {task.completed && <FaCheck />}
                                                                            </button>
                                                                            <div className="origin-task-text">
                                                                                <div className="origin-task-title">{formatTaskTitle(task)}</div>
                                                                                <div className="origin-task-meta">
                                                                                    {task.due_at && `Due ${format(new Date(task.due_at), 'MMM d')}`}
                                                                                </div>
                                                                            </div>
                                                                            <span className={`priority-pill ${getPriorityClass(task)}`}>
                                                                                {formatPriorityLabel(task)}
                                                                            </span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            </div>

            <Modal
                isOpen={taskModalOpen}
                onClose={() => setTaskModalOpen(false)}
                title="Add Task Details"
            >
                <div className="task-detail-modal">
                    <div className="form-group">
                        <label>Task</label>
                        <input
                            type="text"
                            value={taskDraft.text}
                            onChange={(e) => setTaskDraft((prev) => ({ ...prev, text: e.target.value }))}
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Due date</label>
                            <input
                                type="date"
                                value={taskDraft.dueDate}
                                onChange={(e) => setTaskDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                            />
                        </div>
                        <div className="form-group">
                            <label>Priority</label>
                            <select
                                value={taskDraft.priorityOverride}
                                onChange={(e) => setTaskDraft((prev) => ({ ...prev, priorityOverride: e.target.value }))}
                            >
                                <option value="">Use default</option>
                                {PRIORITY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            rows={4}
                            value={taskDraft.notes}
                            onChange={(e) => setTaskDraft((prev) => ({ ...prev, notes: e.target.value }))}
                            placeholder="Add any reminders or context."
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setTaskModalOpen(false)}>
                            Not now
                        </button>
                        <button type="button" className="btn-primary" onClick={saveTaskDetails} disabled={!taskDraft.text.trim()}>
                            Save Details
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Todo;
