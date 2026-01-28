import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FaPlus, FaSave, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import './TaskAdmin.css';

const TaskAdmin = () => {
    const [origins, setOrigins] = useState([]);
    const [originsLoading, setOriginsLoading] = useState(true);
    const [originError, setOriginError] = useState('');
    const [selectedOriginKey, setSelectedOriginKey] = useState('');
    const [originLinksAll, setOriginLinksAll] = useState([]);

    const [originTasks, setOriginTasks] = useState([]);
    const [tasksLoading, setTasksLoading] = useState(false);
    const [tasksError, setTasksError] = useState('');
    const [showCompleted, setShowCompleted] = useState(true);

    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templatesError, setTemplatesError] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [templateInstances, setTemplateInstances] = useState([]);
    const [instancesLoading, setInstancesLoading] = useState(false);
    const [instancesError, setInstancesError] = useState('');
    const [eventTypes, setEventTypes] = useState([]);
    const [templateOriginType, setTemplateOriginType] = useState('sunday');
    const [templateOriginId, setTemplateOriginId] = useState(null);

    const [newTaskText, setNewTaskText] = useState('');
    const [newTaskDue, setNewTaskDue] = useState('');
    const [contextMenu, setContextMenu] = useState({
        visible: false,
        x: 0,
        y: 0,
        origin: null
    });
    const [newTemplate, setNewTemplate] = useState({
        list_title: '',
        list_key: '',
        list_mode: 'sequential',
        title: '',
        step_key: '',
        sort_order: 0,
        due_offset_days: '',
        priority_base: 50,
        active: true
    });

    const selectedOrigin = useMemo(() => (
        origins.find((origin) => origin.key === selectedOriginKey) || null
    ), [origins, selectedOriginKey]);

    const selectedTemplate = useMemo(() => (
        templates.find((template) => template.id === selectedTemplateId) || null
    ), [templates, selectedTemplateId]);

    const getTemplateOriginId = useCallback((originType, originId) => {
        if (!originType) return null;
        if (originType === 'operations') return originId || 'weekly';
        if (originType === 'event') return originId || null;
        return null;
    }, []);

    const loadOrigins = useCallback(async () => {
        setOriginsLoading(true);
        setOriginError('');
        try {
            const response = await fetch(`${API_URL}/task-origins`);
            if (!response.ok) throw new Error('Failed to load origins');
            const data = await response.json();
            const list = Array.isArray(data) ? data : [];
            setOrigins(list);
            if (list.length && !selectedOriginKey) {
                setSelectedOriginKey(list[0].key);
            }
        } catch (err) {
            console.error('Failed to load origins:', err);
            setOrigins([]);
            setOriginError('Unable to load task origins.');
        } finally {
            setOriginsLoading(false);
        }
    }, [selectedOriginKey]);

    const loadOriginLinksAll = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/task-origins/links?all=1`);
            if (!response.ok) throw new Error('Failed to load origin links');
            const data = await response.json();
            setOriginLinksAll(Array.isArray(data?.links) ? data.links : []);
        } catch (err) {
            console.error('Failed to load origin links:', err);
            setOriginLinksAll([]);
        }
    }, []);

    const loadOriginTasks = useCallback(async (originType, originId) => {
        if (!originType || !originId) {
            setOriginTasks([]);
            return;
        }
        setTasksLoading(true);
        setTasksError('');
        try {
            const params = new URLSearchParams({
                origin_type: originType,
                origin_id: originId
            });
            const response = await fetch(`${API_URL}/tasks?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load origin tasks');
            const data = await response.json();
            setOriginTasks(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load origin tasks:', err);
            setOriginTasks([]);
            setTasksError('Unable to load origin tasks.');
        } finally {
            setTasksLoading(false);
        }
    }, []);

    const loadTemplates = useCallback(async (originType, originId) => {
        if (!originType) {
            setTemplates([]);
            return;
        }
        setTemplatesLoading(true);
        setTemplatesError('');
        try {
            const params = new URLSearchParams({ origin_type: originType });
            if (originId) {
                params.set('origin_id', originId);
            }
            const response = await fetch(`${API_URL}/recurring-templates?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load templates');
            const data = await response.json();
            setTemplates(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load templates:', err);
            setTemplates([]);
            setTemplatesError('Unable to load templates.');
        } finally {
            setTemplatesLoading(false);
        }
    }, []);

    const loadTemplateInstances = useCallback(async (template) => {
        if (!template) {
            setTemplateInstances([]);
            return;
        }
        setInstancesLoading(true);
        setInstancesError('');
        try {
            const params = new URLSearchParams({
                origin_type: template.origin_type
            });
            if (template.origin_id) params.set('origin_id', template.origin_id);
            if (template.list_key) params.set('list_key', template.list_key);
            const response = await fetch(`${API_URL}/recurring-templates/instances?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load template instances');
            const data = await response.json();
            setTemplateInstances(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load template instances:', err);
            setTemplateInstances([]);
            setInstancesError('Unable to load template instances.');
        } finally {
            setInstancesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOrigins();
    }, [loadOrigins]);

    useEffect(() => {
        loadOriginLinksAll();
    }, [loadOriginLinksAll]);

    useEffect(() => {
        const loadEventTypes = async () => {
            try {
                const response = await fetch(`${API_URL}/event-types`);
                if (!response.ok) throw new Error('Failed to load event types');
                const data = await response.json();
                setEventTypes(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Failed to load event types:', err);
                setEventTypes([]);
            }
        };
        loadEventTypes();
    }, []);

    useEffect(() => {
        if (templateOriginType !== 'event') return;
        if (templateOriginId) return;
        if (eventTypes.length === 0) return;
        setTemplateOriginId(String(eventTypes[0].id));
    }, [eventTypes, templateOriginId, templateOriginType]);

    useEffect(() => {
        if (!selectedOrigin) return;
        loadOriginTasks(selectedOrigin.origin_type, selectedOrigin.origin_id);
    }, [selectedOrigin, loadOriginTasks]);

    useEffect(() => {
        const normalizedId = getTemplateOriginId(templateOriginType, templateOriginId);
        loadTemplates(templateOriginType, normalizedId);
    }, [templateOriginType, templateOriginId, loadTemplates, getTemplateOriginId]);

    useEffect(() => {
        loadTemplateInstances(selectedTemplate);
    }, [loadTemplateInstances, selectedTemplate]);

    useEffect(() => {
        if (!templates.length) {
            setSelectedTemplateId('');
            return;
        }
        if (!selectedTemplateId || !templates.find((template) => template.id === selectedTemplateId)) {
            setSelectedTemplateId(templates[0].id);
        }
    }, [templates, selectedTemplateId]);

    useEffect(() => {
        if (!contextMenu.visible) return undefined;
        const handleClose = (event) => {
            if (event.type === 'keydown' && event.key !== 'Escape') return;
            setContextMenu((prev) => ({ ...prev, visible: false }));
        };
        window.addEventListener('click', handleClose);
        window.addEventListener('keydown', handleClose);
        return () => {
            window.removeEventListener('click', handleClose);
            window.removeEventListener('keydown', handleClose);
        };
    }, [contextMenu.visible]);

    const updateTaskField = (taskId, field, value) => {
        setOriginTasks((prev) => prev.map((task) => (
            task.id === taskId ? { ...task, [field]: value } : task
        )));
    };

    const saveTask = async (task) => {
        try {
                    const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text: task.text,
                            completed: task.completed,
                            due_at: task.due_at || null,
                            priority_override: task.priority_override === '' ? null : task.priority_override,
                            rank: task.rank === '' ? null : task.rank,
                            archive_after_due: task.archive_after_due,
                            keep_until: task.keep_until || null
                        })
                    });
            if (!response.ok) throw new Error('Failed to save task');
            await loadOriginTasks(selectedOrigin.origin_type, selectedOrigin.origin_id);
            await loadOrigins();
        } catch (err) {
            console.error('Failed to save task:', err);
            setTasksError('Unable to save task changes.');
        }
    };

    const deleteTask = async (taskId) => {
        try {
            const response = await fetch(`${API_URL}/tasks/${taskId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete task');
            await loadOriginTasks(selectedOrigin.origin_type, selectedOrigin.origin_id);
            await loadOrigins();
        } catch (err) {
            console.error('Failed to delete task:', err);
            setTasksError('Unable to delete task.');
        }
    };

    const createTask = async (event) => {
        event.preventDefault();
        if (!selectedOrigin || !newTaskText.trim()) return;
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: newTaskText.trim(),
                    source_type: selectedOrigin.origin_type,
                    source_id: selectedOrigin.origin_id,
                    source_event: 'manual',
                    due_at: newTaskDue || null
                })
            });
            if (!response.ok) throw new Error('Failed to create task');
            setNewTaskText('');
            setNewTaskDue('');
            await loadOriginTasks(selectedOrigin.origin_type, selectedOrigin.origin_id);
            await loadOrigins();
        } catch (err) {
            console.error('Failed to create task:', err);
            setTasksError('Unable to add task.');
        }
    };

    const deleteOrigin = async (origin) => {
        if (!origin) return;
        const confirmDelete = window.confirm(`Delete all tasks for ${origin.label || origin.key}?`);
        if (!confirmDelete) return;
        try {
            const params = new URLSearchParams({
                origin_type: origin.origin_type,
                origin_id: origin.origin_id
            });
            const response = await fetch(`${API_URL}/task-origins?${params.toString()}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete origin');
            setSelectedOriginKey('');
            await loadOrigins();
            await loadOriginLinksAll();
            setOriginTasks([]);
        } catch (err) {
            console.error('Failed to delete origin:', err);
            setOriginError('Unable to delete origin.');
        }
    };

    const assignOrigin = async (origin, target) => {
        if (!origin || !target || origin.key === target.key) return;
        try {
            const response = await fetch(`${API_URL}/task-origins/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_origin_type: origin.origin_type,
                    from_origin_id: origin.origin_id,
                    to_origin_type: target.origin_type,
                    to_origin_id: target.origin_id,
                    label: origin.label
                })
            });
            if (!response.ok) throw new Error('Failed to assign origin');
            await loadOrigins();
            await loadOriginLinksAll();
            if (selectedOrigin?.key === target.key) {
                await loadOriginTasks(target.origin_type, target.origin_id);
            }
        } catch (err) {
            console.error('Failed to assign origin:', err);
            setOriginError('Unable to assign origin.');
        }
    };

    const updateTemplateField = (templateId, field, value) => {
        setTemplates((prev) => prev.map((template) => (
            template.id === templateId ? { ...template, [field]: value } : template
        )));
    };

    const saveTemplate = async (template) => {
        try {
            const response = await fetch(`${API_URL}/recurring-templates/${template.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    list_key: template.list_key,
                    list_title: template.list_title,
                    list_mode: template.list_mode,
                    title: template.title,
                    step_key: template.step_key,
                    sort_order: Number(template.sort_order) || 0,
                    due_offset_days: template.due_offset_days === '' ? null : Number(template.due_offset_days),
                    priority_base: Number(template.priority_base) || 50,
                    active: template.active ? 1 : 0
                })
            });
            if (!response.ok) throw new Error('Failed to save template');
            await loadTemplates(templateOriginType, getTemplateOriginId(templateOriginType, templateOriginId));
        } catch (err) {
            console.error('Failed to save template:', err);
            setTemplatesError('Unable to save template changes.');
        }
    };

    const deleteTemplate = async (templateId) => {
        try {
            const response = await fetch(`${API_URL}/recurring-templates/${templateId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete template');
            await loadTemplates(templateOriginType, getTemplateOriginId(templateOriginType, templateOriginId));
        } catch (err) {
            console.error('Failed to delete template:', err);
            setTemplatesError('Unable to delete template.');
        }
    };

    const createTemplate = async (event) => {
        event.preventDefault();
        const templateOriginValue = getTemplateOriginId(templateOriginType, templateOriginId);
        if (!templateOriginType || !newTemplate.title.trim() || !newTemplate.step_key.trim()) return;
        if (templateOriginType === 'event' && !templateOriginValue) return;
        try {
            const response = await fetch(`${API_URL}/recurring-templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin_type: templateOriginType,
                    origin_id: templateOriginValue,
                    list_key: newTemplate.list_key.trim(),
                    list_title: newTemplate.list_title.trim() || newTemplate.list_key.trim(),
                    list_mode: newTemplate.list_mode,
                    step_key: newTemplate.step_key.trim(),
                    title: newTemplate.title.trim(),
                    sort_order: Number(newTemplate.sort_order) || 0,
                    due_offset_days: newTemplate.due_offset_days === '' ? null : Number(newTemplate.due_offset_days),
                    priority_base: Number(newTemplate.priority_base) || 50,
                    active: newTemplate.active ? 1 : 0
                })
            });
            if (!response.ok) throw new Error('Failed to create template');
            setNewTemplate({
                list_title: '',
                list_key: '',
                list_mode: 'sequential',
                title: '',
                step_key: '',
                sort_order: 0,
                due_offset_days: '',
                priority_base: 50,
                active: true
            });
            await loadTemplates(templateOriginType, templateOriginValue);
        } catch (err) {
            console.error('Failed to create template:', err);
            setTemplatesError('Unable to create template.');
        }
    };

    const seedTemplates = async () => {
        try {
            const params = new URLSearchParams({
                origin_type: templateOriginType
            });
            const originId = getTemplateOriginId(templateOriginType, templateOriginId);
            if (originId) params.set('origin_id', originId);
            const response = await fetch(`${API_URL}/recurring-templates/seed?${params.toString()}`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Failed to seed templates');
            if (selectedOrigin) {
                await loadOriginTasks(selectedOrigin.origin_type, selectedOrigin.origin_id);
            }
            await loadOrigins();
        } catch (err) {
            console.error('Failed to seed templates:', err);
            setTemplatesError('Unable to seed templates.');
        }
    };

    const filteredTasks = useMemo(() => (
        showCompleted ? originTasks : originTasks.filter((task) => !task.completed)
    ), [originTasks, showCompleted]);

    const formatInstanceLabel = useCallback((instance) => {
        const sample = instance?.sample || instance?.next_task || {};
        if (sample.event_title) return sample.event_title;
        if (instance?.next_task?.text) return instance.next_task.text;
        if (sample.text) return sample.text;
        return `${instance?.origin_type || 'origin'}:${instance?.origin_id || 'unknown'}`;
    }, []);

    const formatInstanceSubtitle = useCallback((instance) => {
        const sample = instance?.sample || {};
        if (sample.event_date) {
            const dateLabel = format(new Date(`${sample.event_date}T00:00:00`), 'MMM d, yyyy');
            return sample.event_time ? `${dateLabel} at ${sample.event_time}` : dateLabel;
        }
        if (typeof instance?.origin_id === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(instance.origin_id)) {
                return format(new Date(`${instance.origin_id}T00:00:00`), 'MMM d, yyyy');
            }
            if (/^\d{4}-\d{2}$/.test(instance.origin_id)) {
                return format(new Date(`${instance.origin_id}-01T00:00:00`), 'MMM yyyy');
            }
        }
        return `${instance?.origin_type || ''} - ${instance?.origin_id || ''}`.trim();
    }, []);

    const originMap = useMemo(() => (
        new Map(origins.map((origin) => [origin.key, origin]))
    ), [origins]);

    const outlineOrigins = useMemo(() => {
        const childrenMap = new Map();
        const childSet = new Set();
        originLinksAll.forEach((link) => {
            const parentKey = `${link.parent_origin_type}:${link.parent_origin_id}`;
            const childKey = `${link.child_origin_type}:${link.child_origin_id}`;
            if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
            childrenMap.get(parentKey).push(childKey);
            childSet.add(childKey);
        });

        const roots = origins
            .filter((origin) => !childSet.has(origin.key))
            .sort((a, b) => String(a.label).localeCompare(String(b.label)));

        const ordered = [];
        const visited = new Set();
        const visit = (origin, depth) => {
            if (!origin || visited.has(origin.key)) return;
            visited.add(origin.key);
            ordered.push({ origin, depth });
            const children = (childrenMap.get(origin.key) || [])
                .map((key) => originMap.get(key))
                .filter(Boolean)
                .sort((a, b) => String(a.label).localeCompare(String(b.label)));
            children.forEach((child) => visit(child, depth + 1));
        };
        roots.forEach((origin) => visit(origin, 0));
        origins
            .filter((origin) => !visited.has(origin.key))
            .forEach((origin) => ordered.push({ origin, depth: 0 }));
        return ordered;
    }, [originLinksAll, originMap, origins]);

    return (
        <div className="page-task-admin">
            <header className="page-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Task Origins & Templates</h1>
                    <p className="page-header-subtitle">Inspect and edit origin task lists and recurring templates.</p>
                </div>
                <div className="page-header-actions">
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

            <div className="task-admin-grid">
                <Card className="task-admin-card">
                    <div className="task-admin-card-header">
                        <h2>Origins</h2>
                    </div>
                    {originsLoading && <div className="empty-state">Loading origins...</div>}
                    {originError && <div className="empty-state">{originError}</div>}
                    {!originsLoading && !originError && origins.length === 0 && (
                        <div className="empty-state">No origins found.</div>
                    )}
                    <div className="origin-list">
                        {outlineOrigins.map(({ origin, depth }) => (
                            <button
                                key={origin.key}
                                type="button"
                                className={`origin-row outline ${origin.key === selectedOriginKey ? 'active' : ''}`}
                                onClick={() => setSelectedOriginKey(origin.key)}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    setContextMenu({
                                        visible: true,
                                        x: event.clientX,
                                        y: event.clientY,
                                        origin
                                    });
                                }}
                                style={{ paddingLeft: `${0.7 + depth * 1.25}rem` }}
                            >
                                <div>
                                    <div className="origin-title">{origin.label}</div>
                                    <div className="origin-meta">{origin.origin_type} - {origin.origin_id}</div>
                                </div>
                                <div className="origin-counts">
                                    <span>{origin.open_count} open</span>
                                    <span>{origin.total_count} total</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                <div className="task-admin-column">
                    <Card className="task-admin-card">
                        <div className="task-admin-card-header">
                            <h2>Recurring Templates</h2>
                            <div className="template-scope-controls">
                                <select
                                    className="template-select"
                                    value={templateOriginType}
                                    onChange={(e) => {
                                        const nextType = e.target.value;
                                        setTemplateOriginType(nextType);
                                        if (nextType === 'operations') {
                                            setTemplateOriginId('weekly');
                                        } else if (nextType === 'event') {
                                            setTemplateOriginId(eventTypes[0]?.id ? String(eventTypes[0].id) : '');
                                        } else {
                                            setTemplateOriginId(null);
                                        }
                                    }}
                                >
                                    <option value="sunday">Sunday</option>
                                    <option value="vestry">Vestry</option>
                                    <option value="operations">Operations</option>
                                    <option value="event">Event Type</option>
                                </select>
                                {templateOriginType === 'operations' && (
                                    <select
                                        className="template-select"
                                        value={templateOriginId || 'weekly'}
                                        onChange={(e) => setTemplateOriginId(e.target.value)}
                                    >
                                        <option value="weekly">Weekly</option>
                                        <option value="timesheets">Timesheets</option>
                                    </select>
                                )}
                                {templateOriginType === 'event' && (
                                    <select
                                        className="template-select"
                                        value={templateOriginId || ''}
                                        onChange={(e) => setTemplateOriginId(e.target.value)}
                                    >
                                        {eventTypes.length === 0 && <option value="">No event types</option>}
                                        {eventTypes.map((type) => (
                                            <option key={type.id} value={String(type.id)}>
                                                {type.name}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={seedTemplates}
                                    disabled={templateOriginType === 'event' && !templateOriginId}
                                >
                                    Seed Tasks
                                </button>
                            </div>
                        </div>
                        {templatesLoading && <div className="empty-state">Loading templates...</div>}
                        {templatesError && <div className="empty-state">{templatesError}</div>}
                        {!templatesLoading && !templatesError && templates.length === 0 && (
                            <div className="empty-state">No templates for this origin type.</div>
                        )}
                        <form className="template-add-row" onSubmit={createTemplate}>
                            <input
                                type="text"
                                placeholder="List title"
                                value={newTemplate.list_title}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, list_title: e.target.value }))}
                            />
                            <input
                                type="text"
                                placeholder="list_key"
                                value={newTemplate.list_key}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, list_key: e.target.value }))}
                            />
                            <select
                                className="template-select"
                                value={newTemplate.list_mode}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, list_mode: e.target.value }))}
                            >
                                <option value="sequential">Sequential</option>
                                <option value="parallel">Parallel</option>
                            </select>
                            <input
                                type="text"
                                placeholder="Step title"
                                value={newTemplate.title}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, title: e.target.value }))}
                            />
                            <input
                                type="text"
                                placeholder="step_key"
                                value={newTemplate.step_key}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, step_key: e.target.value }))}
                            />
                            <input
                                type="number"
                                placeholder="Order"
                                value={newTemplate.sort_order}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, sort_order: e.target.value }))}
                            />
                            <input
                                type="number"
                                placeholder="Offset"
                                value={newTemplate.due_offset_days}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, due_offset_days: e.target.value }))}
                            />
                            <input
                                type="number"
                                placeholder="Priority"
                                value={newTemplate.priority_base}
                                onChange={(e) => setNewTemplate((prev) => ({ ...prev, priority_base: e.target.value }))}
                            />
                            <label className="toggle-inline">
                                <input
                                    type="checkbox"
                                    checked={newTemplate.active}
                                    onChange={(e) => setNewTemplate((prev) => ({ ...prev, active: e.target.checked }))}
                                />
                                Active
                            </label>
                            <button
                                type="submit"
                                className="btn-primary"
                                disabled={
                                    !newTemplate.list_key.trim()
                                    || !newTemplate.title.trim()
                                    || !newTemplate.step_key.trim()
                                    || (templateOriginType === 'event' && !templateOriginId)
                                }
                            >
                                <FaPlus /> Add
                            </button>
                        </form>
                        <div className="template-list">
                            {templates.map((template) => (
                                <div
                                    key={template.id}
                                    className={`template-row ${template.id === selectedTemplateId ? 'selected' : ''}`}
                                    onClick={() => setSelectedTemplateId(template.id)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            setSelectedTemplateId(template.id);
                                        }
                                    }}
                                >
                                    <input
                                        type="text"
                                        value={template.list_title || ''}
                                        onChange={(e) => updateTemplateField(template.id, 'list_title', e.target.value)}
                                    />
                                    <input
                                        type="text"
                                        value={template.list_key || ''}
                                        onChange={(e) => updateTemplateField(template.id, 'list_key', e.target.value)}
                                    />
                                    <select
                                        className="template-select"
                                        value={template.list_mode || 'sequential'}
                                        onChange={(e) => updateTemplateField(template.id, 'list_mode', e.target.value)}
                                    >
                                        <option value="sequential">Sequential</option>
                                        <option value="parallel">Parallel</option>
                                    </select>
                                    <input
                                        type="text"
                                        value={template.title}
                                        onChange={(e) => updateTemplateField(template.id, 'title', e.target.value)}
                                    />
                                    <input
                                        type="text"
                                        value={template.step_key}
                                        onChange={(e) => updateTemplateField(template.id, 'step_key', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        value={template.sort_order}
                                        onChange={(e) => updateTemplateField(template.id, 'sort_order', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        value={template.due_offset_days ?? ''}
                                        onChange={(e) => updateTemplateField(template.id, 'due_offset_days', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        value={template.priority_base}
                                        onChange={(e) => updateTemplateField(template.id, 'priority_base', e.target.value)}
                                    />
                                    <label className="toggle-inline">
                                        <input
                                            type="checkbox"
                                            checked={!!template.active}
                                            onChange={(e) => updateTemplateField(template.id, 'active', e.target.checked)}
                                        />
                                    </label>
                                    <div className="row-actions">
                                        <button type="button" className="btn-secondary" onClick={() => saveTemplate(template)}>
                                            <FaSave />
                                        </button>
                                        <button type="button" className="btn-delete" onClick={() => deleteTemplate(template.id)}>
                                            <FaTrash />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card className="task-admin-card">
                        <div className="task-admin-card-header">
                            <h2>Template Instances</h2>
                            <span className="muted">
                                {selectedTemplate?.list_title || selectedTemplate?.list_key || 'Select a template'}
                            </span>
                        </div>
                        {!selectedTemplate && (
                            <div className="empty-state">Select a template to see instances.</div>
                        )}
                        {instancesLoading && <div className="empty-state">Loading instances...</div>}
                        {instancesError && <div className="empty-state">{instancesError}</div>}
                        {selectedTemplate && !instancesLoading && !instancesError && templateInstances.length === 0 && (
                            <div className="empty-state">No seeded instances found.</div>
                        )}
                        {selectedTemplate && templateInstances.length > 0 && (
                            <div className="origin-list">
                                {templateInstances.map((instance) => (
                                    <button
                                        key={instance.key}
                                        type="button"
                                        className={`origin-row ${instance.key === selectedOriginKey ? 'active' : ''}`}
                                        onClick={() => setSelectedOriginKey(instance.key)}
                                    >
                                        <div>
                                            <div className="origin-title">{formatInstanceLabel(instance)}</div>
                                            <div className="origin-meta">{formatInstanceSubtitle(instance)}</div>
                                        </div>
                                        <div className="origin-counts">
                                            <span>{instance.open_count} open</span>
                                            <span>{instance.total_count} total</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card className="task-admin-card">
                        <div className="task-admin-card-header">
                            <h2>Origin Tasks</h2>
                            <span className="muted">{selectedOrigin?.label || 'Select an origin'}</span>
                        </div>
                        {tasksLoading && <div className="empty-state">Loading tasks...</div>}
                        {tasksError && <div className="empty-state">{tasksError}</div>}
                        {!tasksLoading && !tasksError && filteredTasks.length === 0 && (
                            <div className="empty-state">No tasks for this origin.</div>
                        )}
                        <form className="task-add-row" onSubmit={createTask}>
                            <input
                                type="text"
                                placeholder="New task text"
                                value={newTaskText}
                                onChange={(e) => setNewTaskText(e.target.value)}
                            />
                            <input
                                type="date"
                                value={newTaskDue}
                                onChange={(e) => setNewTaskDue(e.target.value)}
                            />
                            <button type="submit" className="btn-primary" disabled={!newTaskText.trim() || !selectedOrigin}>
                                <FaPlus /> Add
                            </button>
                        </form>
                        <div className="task-list">
                            {filteredTasks.map((task) => (
                                <div key={task.id} className={`task-row-admin ${task.completed ? 'completed' : ''}`}>
                                    <label className="toggle-inline">
                                        <input
                                            type="checkbox"
                                            checked={task.completed}
                                            onChange={(e) => updateTaskField(task.id, 'completed', e.target.checked)}
                                        />
                                        Done
                                    </label>
                                    <input
                                        type="text"
                                        value={task.text}
                                        onChange={(e) => updateTaskField(task.id, 'text', e.target.value)}
                                    />
                                    <input
                                        type="date"
                                        value={task.due_at || ''}
                                        onChange={(e) => updateTaskField(task.id, 'due_at', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Priority"
                                        value={task.priority_override ?? ''}
                                        onChange={(e) => updateTaskField(task.id, 'priority_override', e.target.value)}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Rank"
                                        value={task.rank ?? ''}
                                        onChange={(e) => updateTaskField(task.id, 'rank', e.target.value)}
                                    />
                                    <label className="toggle-inline">
                                        <input
                                            type="checkbox"
                                            checked={task.archive_after_due !== 0}
                                            onChange={(e) => updateTaskField(task.id, 'archive_after_due', e.target.checked ? 1 : 0)}
                                        />
                                        Auto-archive
                                    </label>
                                    <input
                                        type="date"
                                        placeholder="Keep until"
                                        value={task.keep_until || ''}
                                        onChange={(e) => updateTaskField(task.id, 'keep_until', e.target.value)}
                                    />
                                    <div className="row-actions">
                                        <button type="button" className="btn-secondary" onClick={() => saveTask(task)}>
                                            <FaSave />
                                        </button>
                                        <button type="button" className="btn-delete" onClick={() => deleteTask(task.id)}>
                                            <FaTrash />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            {contextMenu.visible && contextMenu.origin && (
                <div
                    className="origin-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onContextMenu={(event) => event.preventDefault()}
                >
                    <button
                        type="button"
                        className="menu-item"
                        onClick={() => deleteOrigin(contextMenu.origin)}
                    >
                        Delete Origin
                    </button>
                    <div className="menu-submenu">
                        <span className="menu-label">Assign as task in</span>
                        <div className="menu-submenu-list">
                            {origins
                                .filter((origin) => origin.key !== contextMenu.origin.key)
                                .map((origin) => (
                                    <button
                                        key={origin.key}
                                        type="button"
                                        className="menu-item"
                                        onClick={() => assignOrigin(contextMenu.origin, origin)}
                                    >
                                        {origin.label}
                                    </button>
                                ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskAdmin;
