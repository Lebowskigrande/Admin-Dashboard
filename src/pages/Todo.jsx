import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { FaPlus, FaCheck } from 'react-icons/fa';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { MAP_AREAS } from '../data/areas';
import './Todo.css';

const isDateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const Todo = () => {
    const navigate = useNavigate();
    const [taskList, setTaskList] = useState([]);
    const [detailTasks, setDetailTasks] = useState([]);
    const [selectedTaskId, setSelectedTaskId] = useState('');
    const [tasksLoading, setTasksLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState('');
    const [tickets, setTickets] = useState([]);
    const [newTask, setNewTask] = useState('');
    const [projectName, setProjectName] = useState('Operations');

    const areaById = useMemo(() => (
        MAP_AREAS.reduce((acc, area) => {
            acc[area.id] = area;
            return acc;
        }, {})
    ), []);

    const loadRollupTasks = useCallback(async () => {
        setTasksLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_URL}/tasks?rollup=1`);
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

    const loadDetailTasks = useCallback(async (originType, originId) => {
        if (!originType || !originId) {
            setDetailTasks([]);
            return;
        }
        setDetailLoading(true);
        try {
            const params = new URLSearchParams({
                origin_type: originType,
                origin_id: originId
            });
            const response = await fetch(`${API_URL}/tasks?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load origin tasks');
            const data = await response.json();
            setDetailTasks(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load origin tasks:', err);
            setDetailTasks([]);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const loadTickets = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/tickets`);
            if (!response.ok) throw new Error('Failed to load tickets');
            const data = await response.json();
            setTickets(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load tickets:', err);
            setTickets([]);
        }
    }, []);

    const reloadAll = useCallback(async (originType, originId) => {
        await loadRollupTasks();
        if (originType && originId) {
            await loadDetailTasks(originType, originId);
        }
    }, [loadDetailTasks, loadRollupTasks]);

    useEffect(() => {
        loadRollupTasks();
        loadTickets();
    }, [loadRollupTasks, loadTickets]);

    useEffect(() => {
        if (taskList.length === 0) {
            setSelectedTaskId('');
            setDetailTasks([]);
            return;
        }
        if (!selectedTaskId || !taskList.find((task) => task.id === selectedTaskId)) {
            setSelectedTaskId(taskList[0].id);
        }
    }, [taskList, selectedTaskId]);

    const selectedTask = useMemo(() => (
        taskList.find((task) => task.id === selectedTaskId) || null
    ), [taskList, selectedTaskId]);

    useEffect(() => {
        if (!selectedTask?.origin_type || !selectedTask?.origin_id) {
            setDetailTasks([]);
            return;
        }
        loadDetailTasks(selectedTask.origin_type, selectedTask.origin_id);
    }, [loadDetailTasks, selectedTask]);

    const selectedTicket = useMemo(() => {
        if (selectedTask?.origin_type !== 'ticket') return null;
        return tickets.find((ticket) => ticket.id === selectedTask.origin_id) || null;
    }, [tickets, selectedTask]);

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
        if (!task?.origin_type) return 'Task Origin';
        if (task.origin_type === 'sunday') return 'Sunday Planner';
        if (task.origin_type === 'vestry') return 'Vestry';
        if (task.origin_type === 'event') return 'Event';
        if (task.origin_type === 'operations') return 'Operations';
        if (task.origin_type === 'ticket') return 'Ticket';
        return task.origin_type;
    }, []);

    const formatOriginSubtitle = useCallback((task) => {
        if (!task?.origin_id) return '';
        if (isDateString(task.origin_id)) {
            return format(new Date(`${task.origin_id}T00:00:00`), 'MMM d, yyyy');
        }
        return task.origin_id;
    }, []);

    const getTicketStatusClass = useCallback((status) => {
        const normalized = (status || '').toLowerCase().replace(/\s+/g, '_');
        if (normalized === 'reviewed') return 'status-reviewed';
        if (normalized === 'in_process') return 'status-in_process';
        if (normalized === 'closed') return 'status-closed';
        return 'status-new';
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
            setNewTask('');
            await loadRollupTasks();
        } catch (err) {
            console.error('Failed to create task:', err);
            setError('Unable to add task. Please try again.');
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
            await reloadAll(task.origin_type, task.origin_id);
        } catch (err) {
            console.error('Failed to update task:', err);
            setError('Unable to update task. Please try again.');
        }
    };

    return (
        <div className="page-todo">
            <header className="page-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Tasks</h1>
                    <p className="page-header-subtitle">All active workstreams and priorities.</p>
                </div>
            </header>

            <div className="tasks-layout">
                <Card className="tasks-list-card">
                    <div className="tasks-list-header">
                        <div>
                            <h2>Task List</h2>
                            <p className="muted">Aggregated by origin, sorted by priority.</p>
                        </div>
                        <span className="count-badge" aria-label={`${taskList.length} tasks`}>
                            {taskList.length}
                        </span>
                    </div>

                    <form className="task-add-form" onSubmit={addTask}>
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

                    <div className="task-list-wrapper">
                        {tasksLoading && <div className="empty-state">Loading tasks...</div>}
                        {error && !tasksLoading && <div className="empty-state">{error}</div>}
                        {!tasksLoading && !error && taskList.length === 0 && (
                            <div className="empty-state">No active tasks.</div>
                        )}
                        {taskList.map((task) => (
                            <button
                                key={task.id}
                                type="button"
                                className={`task-row ${task.id === selectedTaskId ? 'active' : ''}`}
                                onClick={() => setSelectedTaskId(task.id)}
                            >
                                <div className="task-row-main">
                                    <div className="task-row-title">
                                        <span className={`priority-dot ${getPriorityClass(task)}`} aria-hidden="true" />
                                        <div>
                                            <div className="task-row-text">{task.text}</div>
                                            <div className="task-row-origin">
                                                {formatOriginLabel(task)}
                                                {formatOriginSubtitle(task) ? ` • ${formatOriginSubtitle(task)}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="task-row-meta">
                                        <span className={`priority-pill ${getPriorityClass(task)}`}>
                                            {formatPriorityLabel(task)}
                                        </span>
                                        {task.due_at && (
                                            <span className="task-row-due">Due {format(new Date(task.due_at), 'MMM d')}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="task-row-actions">
                                    <button
                                        type="button"
                                        className="task-action-btn"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            toggleTask(task);
                                        }}
                                        aria-label="Mark complete"
                                    >
                                        <FaCheck />
                                    </button>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                <Card className="tasks-detail-card">
                    <div className="tasks-list-header">
                        <div>
                            <h2>Task Details</h2>
                            <p className="muted">Origin context and next steps.</p>
                        </div>
                    </div>
                    {!selectedTask && <div className="empty-state">Select a task to see details.</div>}
                    {selectedTask && (
                        <div className="task-detail-body">
                            <div className="task-detail-header">
                                <div>
                                    <div className="task-detail-title">{selectedTask.text}</div>
                                    <div className="task-detail-meta">
                                        <span className={`priority-pill ${getPriorityClass(selectedTask)}`}>
                                            {formatPriorityLabel(selectedTask)}
                                        </span>
                                        {selectedTask.due_at && (
                                            <span className="muted">Due {format(new Date(selectedTask.due_at), 'MMM d')}</span>
                                        )}
                                        <span className="muted">{formatOriginLabel(selectedTask)}</span>
                                    </div>
                                </div>
                            </div>

                            {selectedTask.origin_type === 'ticket' && selectedTicket ? (
                                <div className="task-origin-panel">
                                    <div className="task-origin-header">
                                        <h3>{selectedTicket.title}</h3>
                                        <span className={`ticket-status pill ${getTicketStatusClass(selectedTicket.status)}`}>
                                            {selectedTicket.status.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <p className="text-muted">{selectedTicket.description || 'No ticket description.'}</p>
                                    <div className="ticket-area-chips">
                                        {(selectedTicket.areas || []).map((areaId) => (
                                            <span key={areaId} className="ticket-area-chip pill pill-neutral">
                                                {areaById[areaId]?.name || areaId}
                                            </span>
                                        ))}
                                    </div>
                                    <button
                                        className="btn-secondary"
                                        type="button"
                                        onClick={() => navigate(`/buildings?ticket=${selectedTicket.id}`)}
                                    >
                                        Open Ticket
                                    </button>
                                </div>
                            ) : (
                                <div className="task-origin-panel">
                                    <div className="task-origin-header">
                                        <h3>{formatOriginLabel(selectedTask)}</h3>
                                        {formatOriginSubtitle(selectedTask) && (
                                            <span className="muted">{formatOriginSubtitle(selectedTask)}</span>
                                        )}
                                    </div>
                                    {selectedTask.origin_type === 'sunday' && (
                                        <button
                                            className="btn-secondary"
                                            type="button"
                                            onClick={() => navigate(`/sunday?date=${selectedTask.origin_id}`)}
                                        >
                                            Open Sunday Planner
                                        </button>
                                    )}
                                    {selectedTask.origin_type === 'vestry' && (
                                        <button
                                            className="btn-secondary"
                                            type="button"
                                            onClick={() => navigate('/vestry')}
                                        >
                                            Open Vestry
                                        </button>
                                    )}
                                    {selectedTask.origin_type === 'event' && (
                                        <button
                                            className="btn-secondary"
                                            type="button"
                                            onClick={() => navigate('/calendar')}
                                        >
                                            Open Calendar
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="task-origin-list">
                                <div className="task-origin-title">Tasks in this origin</div>
                                {detailLoading && <div className="empty-state">Loading origin tasks...</div>}
                                {!detailLoading && detailTasks.length === 0 && (
                                    <div className="empty-state">No additional tasks found.</div>
                                )}
                                {!detailLoading && detailTasks.length > 0 && (
                                    <ul className="origin-task-list">
                                        {detailTasks.map((task) => (
                                            <li
                                                key={task.id}
                                                className={`origin-task-row ${task.completed ? 'completed' : ''}`}
                                            >
                                                <button
                                                    type="button"
                                                    className="origin-task-check"
                                                    onClick={() => toggleTask(task)}
                                                    aria-label="Toggle task"
                                                >
                                                    {task.completed && <FaCheck />}
                                                </button>
                                                <div className="origin-task-text">
                                                    <div className="origin-task-title">{task.text}</div>
                                                    {task.due_at && (
                                                        <div className="origin-task-meta">Due {format(new Date(task.due_at), 'MMM d')}</div>
                                                    )}
                                                </div>
                                                <span className={`priority-pill ${getPriorityClass(task)}`}>
                                                    {formatPriorityLabel(task)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
            </div>

        </div>
    );
};

export default Todo;
