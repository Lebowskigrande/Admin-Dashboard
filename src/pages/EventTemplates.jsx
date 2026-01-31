import { useEffect, useMemo, useRef, useState } from 'react';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import './EventTemplates.css';

const FIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'url', label: 'URL' },
    { value: 'select', label: 'Select' },
    { value: 'checkbox', label: 'Checkbox' }
];

const slugify = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const EventTemplates = () => {
    const [eventTypes, setEventTypes] = useState([]);
    const [selectedTypeId, setSelectedTypeId] = useState('');
    const [fields, setFields] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [cloneSourceId, setCloneSourceId] = useState('');
    const [saving, setSaving] = useState(false);
    const initialTemplateIds = useRef(new Set());

    useEffect(() => {
        const loadTypes = async () => {
            const response = await fetch(`${API_URL}/event-types`);
            const payload = await response.json();
            const next = Array.isArray(payload) ? payload : [];
            setEventTypes(next);
            if (!selectedTypeId && next.length) {
                setSelectedTypeId(String(next[0].id));
            }
        };
        loadTypes().catch((error) => console.error('Failed to load event types:', error));
    }, [selectedTypeId]);

    useEffect(() => {
        if (!selectedTypeId) return;
        const loadTemplate = async () => {
            const [fieldResponse, templateResponse] = await Promise.all([
                fetch(`${API_URL}/event-template-fields?event_type_id=${selectedTypeId}`),
                fetch(`${API_URL}/recurring-templates?origin_type=event&origin_id=${selectedTypeId}`)
            ]);
            const fieldPayload = fieldResponse.ok ? await fieldResponse.json() : [];
            const templatePayload = templateResponse.ok ? await templateResponse.json() : [];
            const nextFields = Array.isArray(fieldPayload) ? fieldPayload : [];
            const nextTemplates = Array.isArray(templatePayload) ? templatePayload : [];
            setFields(nextFields);
            setTemplates(nextTemplates);
            initialTemplateIds.current = new Set(nextTemplates.map((item) => item.id));
        };
        loadTemplate().catch((error) => console.error('Failed to load template:', error));
    }, [selectedTypeId]);

    const fieldList = useMemo(() => (
        [...fields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    ), [fields]);

    const listGroups = useMemo(() => {
        const grouped = templates.reduce((acc, item) => {
            const key = item.list_key || 'tasks';
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
        }, {});
        return Object.entries(grouped).map(([listKey, items]) => {
            const listTitle = items[0]?.list_title || listKey;
            const listMode = items[0]?.list_mode || 'sequential';
            return {
                listKey,
                listTitle,
                listMode,
                items: items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            };
        });
    }, [templates]);

    const updateField = (index, patch) => {
        setFields((prev) => prev.map((field, idx) => (
            idx === index ? { ...field, ...patch } : field
        )));
    };

    const addField = () => {
        setFields((prev) => ([
            ...prev,
            {
                id: '',
                field_key: '',
                label: '',
                field_type: 'text',
                options: [],
                placeholder: '',
                help_text: '',
                sort_order: prev.length,
                required: false
            }
        ]));
    };

    const removeField = (index) => {
        setFields((prev) => prev.filter((_, idx) => idx !== index));
    };

    const updateListMeta = (listKey, patch) => {
        setTemplates((prev) => prev.map((item) => {
            if (item.list_key !== listKey) return item;
            return { ...item, ...patch };
        }));
    };

    const renameListKey = (listKey, nextKey) => {
        setTemplates((prev) => prev.map((item) => (
            item.list_key === listKey ? { ...item, list_key: nextKey } : item
        )));
    };

    const addTaskList = () => {
        const baseKey = `list_${Date.now()}`;
        setTemplates((prev) => ([
            ...prev,
            {
                id: '',
                origin_type: 'event',
                origin_id: selectedTypeId,
                list_key: baseKey,
                list_title: 'New List',
                list_mode: 'sequential',
                step_key: 'step_1',
                title: 'New task',
                sort_order: 0,
                due_offset_days: null,
                priority_base: 50,
                active: 1
            }
        ]));
    };

    const addTask = (listKey) => {
        setTemplates((prev) => {
            const listItems = prev.filter((item) => item.list_key === listKey);
            const nextSort = listItems.length;
            return [
                ...prev,
                {
                    id: '',
                    origin_type: 'event',
                    origin_id: selectedTypeId,
                    list_key: listKey,
                    list_title: listItems[0]?.list_title || listKey,
                    list_mode: listItems[0]?.list_mode || 'sequential',
                    step_key: `step_${nextSort + 1}`,
                    title: 'New task',
                    sort_order: nextSort,
                    due_offset_days: null,
                    priority_base: 50,
                    active: 1
                }
            ];
        });
    };

    const updateTaskAtIndex = (listKey, index, patch) => {
        setTemplates((prev) => {
            const listItems = prev.filter((item) => item.list_key === listKey);
            const target = listItems[index];
            if (!target) return prev;
            return prev.map((item) => (
                item === target ? { ...item, ...patch } : item
            ));
        });
    };

    const removeTask = (listKey, index) => {
        setTemplates((prev) => {
            const listItems = prev.filter((item) => item.list_key === listKey);
            const target = listItems[index];
            if (!target) return prev;
            return prev.filter((item) => item !== target);
        });
    };

    const handleClone = async () => {
        if (!cloneSourceId || !selectedTypeId || cloneSourceId === selectedTypeId) return;
        const [fieldResponse, templateResponse] = await Promise.all([
            fetch(`${API_URL}/event-template-fields?event_type_id=${cloneSourceId}`),
            fetch(`${API_URL}/recurring-templates?origin_type=event&origin_id=${cloneSourceId}`)
        ]);
        const fieldPayload = fieldResponse.ok ? await fieldResponse.json() : [];
        const templatePayload = templateResponse.ok ? await templateResponse.json() : [];
        const nextFields = Array.isArray(fieldPayload) ? fieldPayload : [];
        const nextTemplates = Array.isArray(templatePayload) ? templatePayload : [];
        setFields(nextFields.map((field, index) => ({
            ...field,
            id: '',
            sort_order: index
        })));
        setTemplates(nextTemplates.map((item, index) => ({
            ...item,
            id: '',
            origin_id: selectedTypeId,
            sort_order: item.sort_order ?? index
        })));
        initialTemplateIds.current = new Set();
    };

    const handleSave = async () => {
        if (!selectedTypeId) return;
        setSaving(true);
        try {
            await fetch(`${API_URL}/event-template-fields/${selectedTypeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fields: fields.map((field, index) => ({
                        field_key: field.field_key || slugify(field.label),
                        label: field.label,
                        field_type: field.field_type,
                        options: Array.isArray(field.options) ? field.options : [],
                        placeholder: field.placeholder || '',
                        help_text: field.help_text || '',
                        sort_order: Number.isFinite(field.sort_order) ? field.sort_order : index,
                        required: !!field.required
                    }))
                })
            });

            const currentIds = new Set(templates.filter((item) => item.id).map((item) => item.id));
            const removedIds = [...initialTemplateIds.current].filter((id) => !currentIds.has(id));

            await Promise.all(templates.map(async (item, index) => {
                const payload = {
                    origin_type: 'event',
                    origin_id: selectedTypeId,
                    list_key: item.list_key,
                    list_title: item.list_title,
                    list_mode: item.list_mode,
                    step_key: item.step_key,
                    title: item.title,
                    sort_order: Number.isFinite(item.sort_order) ? item.sort_order : index,
                    due_offset_days: item.due_offset_days === '' ? null : item.due_offset_days,
                    priority_base: item.priority_base ?? 50,
                    active: item.active ? 1 : 0
                };
                if (item.id) {
                    await fetch(`${API_URL}/recurring-templates/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else if (item.list_key && item.step_key && item.title) {
                    await fetch(`${API_URL}/recurring-templates`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }
            }));

            await Promise.all(removedIds.map((id) => (
                fetch(`${API_URL}/recurring-templates/${id}`, { method: 'DELETE' })
            )));

            const refresh = await fetch(`${API_URL}/recurring-templates?origin_type=event&origin_id=${selectedTypeId}`);
            const refreshed = refresh.ok ? await refresh.json() : [];
            setTemplates(Array.isArray(refreshed) ? refreshed : []);
            initialTemplateIds.current = new Set((Array.isArray(refreshed) ? refreshed : []).map((item) => item.id));
        } catch (error) {
            console.error('Failed to save template:', error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-event-templates">
            <header className="page-header-bar">
                <div className="page-header-title">
                    <h1>Event Templates</h1>
                    <p className="page-header-subtitle">Define event variables and task lists for each event type.</p>
                </div>
                <div className="page-header-actions">
                    <button className="btn-secondary" type="button" onClick={handleSave} disabled={saving || !selectedTypeId}>
                        {saving ? 'Saving…' : 'Save Template'}
                    </button>
                </div>
            </header>

            <div className="event-template-layout">
                <Card className="event-template-types">
                    <h3>Event Types</h3>
                    <div className="event-template-type-list">
                        {eventTypes.map((type) => (
                            <button
                                key={type.id}
                                type="button"
                                className={`event-template-type ${selectedTypeId === String(type.id) ? 'active' : ''}`}
                                onClick={() => setSelectedTypeId(String(type.id))}
                            >
                                <span>{type.name}</span>
                                <small>{type.category_name}</small>
                            </button>
                        ))}
                    </div>
                    <div className="event-template-clone">
                        <label>Clone from</label>
                        <select value={cloneSourceId} onChange={(e) => setCloneSourceId(e.target.value)}>
                            <option value="">Select event type</option>
                            {eventTypes.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
                        <button type="button" className="btn-secondary" onClick={handleClone} disabled={!cloneSourceId || cloneSourceId === selectedTypeId}>
                            Clone Template
                        </button>
                    </div>
                </Card>

                <div className="event-template-editor">
                    <Card className="event-template-section">
                        <div className="section-header">
                            <h3>Template Fields</h3>
                            <button type="button" className="btn-secondary" onClick={addField}>Add Field</button>
                        </div>
                        {fieldList.length === 0 ? (
                            <p className="text-muted">No fields yet. Add variables for this event type.</p>
                        ) : (
                            <div className="event-template-fields">
                                {fieldList.map((field, index) => (
                                    <div key={`${field.field_key}-${index}`} className="event-template-field-row">
                                        <input
                                            type="text"
                                            placeholder="Label"
                                            value={field.label}
                                            onChange={(e) => updateField(index, {
                                                label: e.target.value,
                                                field_key: field.field_key || slugify(e.target.value)
                                            })}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Key"
                                            value={field.field_key}
                                            onChange={(e) => updateField(index, { field_key: slugify(e.target.value) })}
                                        />
                                        <select
                                            value={field.field_type}
                                            onChange={(e) => updateField(index, { field_type: e.target.value })}
                                        >
                                            {FIELD_TYPES.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="Placeholder"
                                            value={field.placeholder || ''}
                                            onChange={(e) => updateField(index, { placeholder: e.target.value })}
                                        />
                                        <input
                                            type="text"
                                            placeholder="Options (comma)"
                                            value={(field.options || []).join(', ')}
                                            onChange={(e) => updateField(index, {
                                                options: e.target.value.split(',').map((opt) => opt.trim()).filter(Boolean)
                                            })}
                                            disabled={field.field_type !== 'select'}
                                        />
                                        <label className="field-checkbox">
                                            <input
                                                type="checkbox"
                                                checked={!!field.required}
                                                onChange={(e) => updateField(index, { required: e.target.checked })}
                                            />
                                            Required
                                        </label>
                                        <button type="button" className="btn-secondary" onClick={() => removeField(index)}>Remove</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card className="event-template-section">
                        <div className="section-header">
                            <h3>Task Lists</h3>
                            <button type="button" className="btn-secondary" onClick={addTaskList}>Add List</button>
                        </div>
                        {listGroups.length === 0 ? (
                            <p className="text-muted">No task lists yet. Add a list for this event type.</p>
                        ) : (
                            <div className="event-template-lists">
                                {listGroups.map((group) => (
                                    <div key={group.listKey} className="event-template-list">
                                        <div className="event-template-list-header">
                                            <input
                                                type="text"
                                                value={group.listTitle || ''}
                                                onChange={(e) => updateListMeta(group.listKey, { list_title: e.target.value })}
                                                placeholder="List title"
                                            />
                                            <input
                                                type="text"
                                                value={group.listKey}
                                                onChange={(e) => renameListKey(group.listKey, slugify(e.target.value))}
                                                placeholder="List key"
                                            />
                                            <select
                                                value={group.listMode}
                                                onChange={(e) => updateListMeta(group.listKey, { list_mode: e.target.value })}
                                            >
                                                <option value="sequential">Sequential</option>
                                                <option value="parallel">Parallel</option>
                                            </select>
                                            <button type="button" className="btn-secondary" onClick={() => addTask(group.listKey)}>
                                                Add Task
                                            </button>
                                        </div>
                                        <div className="event-template-task-list">
                                            {group.items.map((item, index) => (
                                                <div key={item.id || `${group.listKey}-${index}`} className="event-template-task-row">
                                                    <input
                                                        type="text"
                                                        value={item.title || ''}
                                                        onChange={(e) => updateTaskAtIndex(group.listKey, index, { title: e.target.value })}
                                                        placeholder="Task title"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={item.step_key || ''}
                                                        onChange={(e) => updateTaskAtIndex(group.listKey, index, { step_key: slugify(e.target.value) })}
                                                        placeholder="Step key"
                                                    />
                                                    <input
                                                        type="number"
                                                        value={item.due_offset_days ?? ''}
                                                        onChange={(e) => updateTaskAtIndex(group.listKey, index, { due_offset_days: e.target.value })}
                                                        placeholder="Due offset"
                                                    />
                                                    <label className="field-checkbox">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!item.active}
                                                            onChange={(e) => updateTaskAtIndex(group.listKey, index, { active: e.target.checked ? 1 : 0 })}
                                                        />
                                                        Active
                                                    </label>
                                                    <button type="button" className="btn-secondary" onClick={() => removeTask(group.listKey, index)}>
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default EventTemplates;
