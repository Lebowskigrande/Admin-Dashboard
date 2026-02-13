import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths
} from 'date-fns';
import { FaChevronLeft, FaChevronRight, FaEye, FaExternalLinkAlt, FaFolderOpen, FaPaperclip, FaUpload, FaEdit, FaSave, FaTimes, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import DataPill from '../components/DataPill';
import { useEvents } from '../context/EventsContext';
import { getSundaysInRange } from '../services/liturgicalService';
import { API_URL } from '../services/apiConfig';
import { getTaskProgressMeta } from '../utils/taskProgress';
import './Calendar.css';



const Calendar = () => {
    const { events, loading, refreshEvents } = useEvents();
    const navigate = useNavigate();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [sundayServices, setSundayServices] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [eventDetails, setEventDetails] = useState(null);
    const [buildings, setBuildings] = useState([]);
    const [eventTasks, setEventTasks] = useState([]);
    const [eventNotes, setEventNotes] = useState('');
    const [templateFields, setTemplateFields] = useState([]);
    const [templateData, setTemplateData] = useState({});
    const [eventDocs, setEventDocs] = useState([]);
    const [docPreview, setDocPreview] = useState({ open: false, url: '', name: '' });
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [taskInput, setTaskInput] = useState('');
    const [taskDueAt, setTaskDueAt] = useState('');
    const [taskState, setTaskState] = useState('open');
    const [taskOwnerId, setTaskOwnerId] = useState('');
    const [taskEditingId, setTaskEditingId] = useState('');
    const [people, setPeople] = useState([]);
    const [contractFile, setContractFile] = useState(null);
    const [otherFile, setOtherFile] = useState(null);
    const TASK_STATE_OPTIONS = [
        { value: 'open', label: 'Open' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'done', label: 'Done' }
    ];

    const toDateInputValue = (value) => {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString().slice(0, 10);
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return String(value).slice(0, 10);
        }
        return parsed.toISOString().slice(0, 10);
    };

    useEffect(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        let active = true;
        const loadSundayServices = async () => {
            const data = await getSundaysInRange(startDate, endDate);
            if (active) setSundayServices(data);
        };

        loadSundayServices();
        return () => {
            active = false;
        };
    }, [currentDate]);

    const closeModal = () => {
        setShowModal(false);
        setSelectedEvent(null);
        setEventDetails(null);
        setEventTasks([]);
        setEventNotes('');
        setTemplateFields([]);
        setTemplateData({});
        setEventDocs([]);
        setDocPreview({ open: false, url: '', name: '' });
        setTaskInput('');
        setTaskDueAt('');
        setTaskState('open');
        setTaskOwnerId('');
        setTaskEditingId('');
        setContractFile(null);
        setOtherFile(null);
        setLoadingDetails(false);
    };

    const loadEventDetails = async (eventItem) => {
        if (!eventItem?.occurrence_id) return;
        setLoadingDetails(true);
        try {
            const occurrenceId = eventItem.occurrence_id;
            const [detailResponse, taskResponse, docResponse] = await Promise.all([
                fetch(`${API_URL}/event-occurrences/${occurrenceId}`),
                fetch(`${API_URL}/tasks?origin_type=event&origin_id=${encodeURIComponent(occurrenceId)}`),
                fetch(`${API_URL}/event-occurrences/${occurrenceId}/documents?preview=1`)
            ]);

            if (detailResponse.ok) {
                const detailPayload = await detailResponse.json();
                setEventDetails(detailPayload);
                setEventNotes(detailPayload?.notes?.internal || '');
                setTemplateData(detailPayload?.notes?.template || {});
                const eventTypeId = detailPayload?.event?.event_type_id;
                if (eventTypeId) {
                    const templateResponse = await fetch(`${API_URL}/event-template-fields?event_type_id=${eventTypeId}`);
                    if (templateResponse.ok) {
                        const templatePayload = await templateResponse.json();
                        setTemplateFields(Array.isArray(templatePayload) ? templatePayload : []);
                    } else {
                        setTemplateFields([]);
                    }
                } else {
                    setTemplateFields([]);
                }
            } else {
                setEventDetails(null);
            }

            if (taskResponse.ok) {
                const taskPayload = await taskResponse.json();
                setEventTasks(Array.isArray(taskPayload) ? taskPayload : []);
            } else {
                setEventTasks([]);
            }

            if (docResponse.ok) {
                const docPayload = await docResponse.json();
                setEventDocs(Array.isArray(docPayload) ? docPayload : []);
            } else {
                setEventDocs([]);
            }
        } catch (error) {
            console.error('Failed to load event details:', error);
        } finally {
            setLoadingDetails(false);
        }
    };

    const handleEventClick = (eventItem) => {
        if (!eventItem?.occurrence_id) return;
        setSelectedEvent(eventItem);
        setShowModal(true);
        loadEventDetails(eventItem);
    };

    const handleSaveNotes = async () => {
        if (!selectedEvent?.occurrence_id) return;
        try {
            await fetch(`${API_URL}/event-occurrences/${selectedEvent.occurrence_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    internal_notes: eventNotes || '',
                    template_data: templateData || {}
                })
            });
        } catch (error) {
            console.error('Failed to save notes:', error);
        }
    };

    const handleTemplateChange = (key, value) => {
        setTemplateData((prev) => ({
            ...(prev || {}),
            [key]: value
        }));
    };

    useEffect(() => {
        let active = true;
        const loadBuildings = async () => {
            try {
                const response = await fetch(`${API_URL}/buildings`);
                if (!response.ok) throw new Error('Failed to load buildings');
                const data = await response.json();
                if (active) setBuildings(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load buildings:', error);
                if (active) setBuildings([]);
            }
        };
        loadBuildings();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!showModal) return;
        let active = true;
        const loadPeople = async () => {
            try {
                const response = await fetch(`${API_URL}/people`);
                if (!response.ok) throw new Error('Failed to load people');
                const payload = await response.json();
                if (active) {
                    setPeople(Array.isArray(payload) ? payload : []);
                }
            } catch (error) {
                console.error('Failed to load people:', error);
                if (active) setPeople([]);
            }
        };
        loadPeople();
        return () => {
            active = false;
        };
    }, [showModal]);

    const normalizeLocationName = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (raw.toLowerCase() === 'parish hall' || raw.toLowerCase() === 'parish-hall' || raw.toLowerCase() === 'fellows hall' || raw.toLowerCase() === 'fellows-hall') {
            return 'Fellows Hall';
        }
        const tokens = raw.replace(/[_-]+/g, ' ').split(' ').filter(Boolean);
        return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');
    };

    const locationId = useMemo(() => (
        eventDetails?.occurrence?.building_id || selectedEvent?.location || ''
    ), [eventDetails?.occurrence?.building_id, selectedEvent?.location]);

    const locationName = useMemo(() => {
        const buildingId = locationId;
        if (!buildingId) return '';
        const match = buildings.find((building) => building.id === buildingId);
        const name = match?.name || buildingId;
        return normalizeLocationName(name);
    }, [buildings, locationId]);

    const defaultTaskDueAt = useMemo(() => (
        toDateInputValue(eventDetails?.occurrence?.date || selectedEvent?.date)
    ), [eventDetails?.occurrence?.date, selectedEvent?.date]);

    useEffect(() => {
        if (taskEditingId) return;
        setTaskDueAt(defaultTaskDueAt);
    }, [defaultTaskDueAt, taskEditingId]);

    const resetTaskDraft = () => {
        setTaskEditingId('');
        setTaskInput('');
        setTaskDueAt(defaultTaskDueAt);
        setTaskState('open');
        setTaskOwnerId('');
    };

    const refreshDocuments = async () => {
        if (!selectedEvent?.occurrence_id) return;
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${selectedEvent.occurrence_id}/documents?preview=1`);
            if (!response.ok) throw new Error('Failed to load documents');
            const payload = await response.json();
            setEventDocs(Array.isArray(payload) ? payload : []);
        } catch (error) {
            console.error('Failed to load documents:', error);
        }
    };

    const handleUploadDocument = async (file, docType = 'attachment') => {
        if (!file || !selectedEvent?.occurrence_id) return;
        const form = new FormData();
        form.append('file', file);
        form.append('doc_type', docType);
        if (docType === 'contract') {
            form.append('label', 'Contract');
        }
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${selectedEvent.occurrence_id}/documents`, {
                method: 'POST',
                body: form
            });
            if (!response.ok) {
                throw new Error('Upload failed');
            }
            await refreshDocuments();
        } catch (error) {
            console.error('Failed to upload document:', error);
        }
    };

    const handleUploadContract = async () => {
        if (!contractFile) return;
        await handleUploadDocument(contractFile, 'contract');
        setContractFile(null);
    };

    const handleUploadOther = async () => {
        if (!otherFile) return;
        await handleUploadDocument(otherFile, 'attachment');
        setOtherFile(null);
    };

    const handlePreviewDocument = (doc) => {
        if (!doc?.preview) return;
        setDocPreview({ open: true, url: doc.preview, name: doc.file_name || 'Document' });
    };

    const handleOpenDocument = (doc) => {
        if (!doc?.file_path) return;
        const url = `${API_URL}/files/download?path=${encodeURIComponent(doc.file_path)}`;
        window.open(url, '_blank', 'noopener');
    };

    const handleOpenLocation = async (doc) => {
        if (!doc?.file_path) return;
        try {
            await fetch(`${API_URL}/files/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: doc.file_path })
            });
        } catch (error) {
            console.error('Failed to open file location:', error);
        }
    };



    const handleTaskToggle = async (task) => {
        if (!task?.id) return;
        try {
            const progressMeta = getTaskProgressMeta(task);
            await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    progressMeta?.nextStep
                        ? { progress_key: progressMeta.nextStep.key }
                        : { completed: !task.completed }
                )
            });
            if (selectedEvent) {
                await loadEventDetails(selectedEvent);
            }
        } catch (error) {
            console.error('Failed to update task:', error);
        }
    };

    const handleEditTask = (task) => {
        if (!task?.id) return;
        setTaskEditingId(task.id);
        setTaskInput(task.text || '');
        setTaskDueAt(toDateInputValue(task.due_at || defaultTaskDueAt));
        setTaskState(task.state || (task.completed ? 'done' : 'open'));
        setTaskOwnerId(task.owner_person_id || '');
    };

    const handleDeleteTask = async (taskId) => {
        if (!taskId) return;
        try {
            await fetch(`${API_URL}/tasks/${taskId}`, { method: 'DELETE' });
            if (taskEditingId === taskId) {
                resetTaskDraft();
            }
            if (selectedEvent) {
                await loadEventDetails(selectedEvent);
            }
        } catch (error) {
            console.error('Failed to delete task:', error);
        }
    };

    const handleAddTask = async () => {
        if (!taskInput.trim() || !selectedEvent?.occurrence_id) return;
        try {
            const payload = {
                text: taskInput.trim(),
                source_type: 'event',
                source_id: selectedEvent.occurrence_id,
                due_at: taskDueAt ? `${taskDueAt}T00:00:00` : null,
                state: taskState || 'open',
                owner_person_id: taskOwnerId || null
            };
            if (taskEditingId) {
                await fetch(`${API_URL}/tasks/${taskEditingId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                await fetch(`${API_URL}/tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            resetTaskDraft();
            if (selectedEvent) {
                await loadEventDetails(selectedEvent);
            }
        } catch (error) {
            console.error('Failed to add task:', error);
        }
    };

    const header = () => {
        return (
            <header className="calendar-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Calendar</h1>
                    <p className="page-header-subtitle">{format(currentDate, 'MMMM yyyy')}</p>
                </div>
                <div className="calendar-actions page-header-actions">
                    <button className="btn-icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
                        <FaChevronLeft />
                    </button>
                    <button className="btn-icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
                        <FaChevronRight />
                    </button>
                    <button className="btn-secondary" onClick={() => refreshEvents(true)} disabled={loading}>
                        {loading ? 'Syncing...' : 'Sync Google'}
                    </button>
                </div>
            </header>
        );
    };

    const daysOfWeek = () => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return (
            <div className="days-row">
                {days.map((day) => (
                    <div className="day-name" key={day}>{day}</div>
                ))}
            </div>
        );
    };

    const getContrastColor = (hexcolor) => {
        if (!hexcolor) return '#3B82F6';
        if (hexcolor.toLowerCase() === '#ffffff' || hexcolor.toLowerCase() === 'white') return '#1f2937';
        if (hexcolor.toLowerCase() === '#ffd700' || hexcolor.toLowerCase() === 'gold') return '#b45309';

        // Simple heuristic: if it's very light, use dark text
        const hex = hexcolor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 180 ? '#1f2937' : hexcolor;
    };

    const getLiturgicalColor = (colorName) => {
        const colorMap = {
            green: '#dcfce7',
            white: '#f3f4f6',
            purple: '#f3e8ff',
            red: '#fee2e2'
        };

        const normalized = (colorName || '').toLowerCase();
        return colorMap[normalized] || '#15803d';
    };

    const getRosterSummary = (roster) => {
        if (!roster) return '';

        const roleLabels = [
            { key: 'lector', label: 'Lector' },
            { key: 'lem', label: 'LEM' },
            { key: 'acolyte', label: 'Acolyte' },
            { key: 'usher', label: 'Usher' },
            { key: 'sound', label: 'Sound' }
        ];

        const entries = roleLabels
            .map(({ key, label }) => {
                const assignment = roster[key];
                if (!assignment?.people?.length) return null;
                const names = assignment.people.map(person => person.displayName).join(', ');
                return `${label}: ${names}`;
            })
            .filter(Boolean);

        return entries.join(' | ');
    };

    const sundayServiceEvents = useMemo(() => {
        if (!sundayServices.length) return [];

        return sundayServices.flatMap((day) => (
            (day.services || []).map((service) => ({
                id: `sunday-${day.date.toISOString()}-${service.time}`,
                title: service.rite ? `${service.rite} Service` : (service.name || 'Sunday Service'),
                date: day.date,
                time: service.time,
                color: getLiturgicalColor(day.color),
                type_name: day.name,
                source: 'sunday',
                roster: service.roster,
                rite: service.rite,
                dayName: day.name
            }))
        ));
    }, [sundayServices]);

    const filteredEvents = useMemo(() => (
        events.filter(event => !(event.source === 'liturgical' && event.date?.getDay?.() === 0))
    ), [events]);

    const mergedEvents = useMemo(() => (
        [...filteredEvents, ...sundayServiceEvents]
    ), [filteredEvents, sundayServiceEvents]);

    const taskGroups = useMemo(() => {
        const grouped = eventTasks.reduce((acc, task) => {
            const key = task.list_title || task.list_key || 'Tasks';
            if (!acc[key]) acc[key] = [];
            acc[key].push(task);
            return acc;
        }, {});
        return Object.entries(grouped).map(([title, items]) => ({
            title,
            items: items.sort((a, b) => {
                const orderA = a.step_order ?? Number.POSITIVE_INFINITY;
                const orderB = b.step_order ?? Number.POSITIVE_INFINITY;
                if (orderA !== orderB) return orderA - orderB;
                return String(a.text || '').localeCompare(String(b.text || ''));
            })
        }));
    }, [eventTasks]);

    const cells = () => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        const dateFormat = "d";
        const dayList = eachDayOfInterval({ start: startDate, end: endDate });

        return (
            <div className="calendar-grid">
                {dayList.map((dayItem) => {
                    return (
                        <div
                            className={`calendar-cell ${!isSameMonth(dayItem, monthStart) ? "disabled" : ""} ${isSameDay(dayItem, new Date()) ? "today" : ""}`}
                            key={dayItem.toString()}
                        >
                            <div className="cell-header">
                                <span className="day-number">{format(dayItem, dateFormat)}</span>
                            </div>
                            <div className="cell-events">
                                {mergedEvents && mergedEvents.filter(e => isSameDay(e.date, dayItem)).map(event => {
                                    const contrastColor = getContrastColor(event.color);
                                    const isLight = contrastColor !== event.color;
                                    const rosterSummary = event.source === 'sunday' ? getRosterSummary(event.roster) : '';
                                    const tooltip = event.source === 'sunday'
                                        ? `${event.dayName || event.title}${event.rite ? ` (${event.rite})` : ''}${rosterSummary ? `\n${rosterSummary}` : ''}`
                                        : (event.type_name ? `${event.type_name} - ${event.title}` : event.title);

                                    return (
                                        <div
                                            key={event.id}
                                            className={`event-chip ${event.occurrence_id ? 'event-chip--clickable' : 'event-chip--static'}`}
                                            style={{
                                                backgroundColor: isLight ? '#f3f4f6' : `${event.color}25`,
                                                color: contrastColor,
                                                borderLeft: `3px solid ${event.color}`
                                            }}
                                            title={tooltip}
                                            onClick={(clickEvent) => {
                                                clickEvent.stopPropagation();
                                                handleEventClick(event);
                                            }}
                                        >
                                            <div className="event-chip-content">
                                                {event.time && <span className="event-chip-time">{event.time}</span>}
                                                <span className="event-chip-title">{event.title}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="page-calendar">
            {header()}
            <Card className="calendar-card">
                {daysOfWeek()}
                {cells()}
            </Card>

            <Modal
                isOpen={showModal}
                onClose={closeModal}
                title={eventDetails?.event?.title || selectedEvent?.title || 'Event Details'}
            >
                {loadingDetails ? (
                    <div className="event-detail-loading">Loading event details...</div>
                ) : (
                    <div className="event-detail-modal">
                        <div className="event-detail-section">
                            <div className="event-detail-grid">
                                <div>
                                    <span className="event-detail-label">Date</span>
                                    <span className="event-detail-value">
                                        {selectedEvent?.date ? format(selectedEvent.date, 'MMMM d, yyyy') : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="event-detail-label">Time</span>
                                    <span className="event-detail-value">{selectedEvent?.time || 'All day'}</span>
                                </div>
                                <div>
                                    <span className="event-detail-label">Type</span>
                                    <span className="event-detail-value">
                                        {eventDetails?.event?.type_name || selectedEvent?.type_name || selectedEvent?.category_name || 'Event'}
                                    </span>
                                </div>
                                <div>
                                    <span className="event-detail-label">Location</span>
                                    <span className="event-detail-value">
                                        {locationName ? (
                                            <DataPill
                                                type="building"
                                                value={locationName}
                                                label={locationName}
                                                showType={false}
                                                tooltip={`Location: ${locationName}`}
                                                onClick={() => {
                                                    if (!locationId) return;
                                                    navigate(`/buildings?tab=map&location=${encodeURIComponent(locationId)}`);
                                                }}
                                            />
                                        ) : 'TBD'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {templateFields.length > 0 && (
                            <div className="event-detail-section">
                                <div className="event-detail-label">Event Details</div>
                                <div className="event-detail-template-grid">
                                    {templateFields.map((field) => {
                                        const value = templateData?.[field.field_key];
                                        const fieldType = field.field_type || 'text';
                                        const key = field.field_key;
                                        if (fieldType === 'textarea') {
                                            return (
                                                <label key={key} className="event-detail-template-field">
                                                    <span>{field.label}</span>
                                                    <textarea
                                                        value={value || ''}
                                                        placeholder={field.placeholder || ''}
                                                        onChange={(e) => handleTemplateChange(key, e.target.value)}
                                                        rows="3"
                                                    />
                                                </label>
                                            );
                                        }
                                        if (fieldType === 'select') {
                                            const options = Array.isArray(field.options) ? field.options : [];
                                            return (
                                                <label key={key} className="event-detail-template-field">
                                                    <span>{field.label}</span>
                                                    <select
                                                        value={value || ''}
                                                        onChange={(e) => handleTemplateChange(key, e.target.value)}
                                                    >
                                                        <option value="">Select...</option>
                                                        {options.map((option) => (
                                                            <option key={option} value={option}>{option}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                            );
                                        }
                                        if (fieldType === 'checkbox') {
                                            return (
                                                <label key={key} className="event-detail-template-field event-detail-template-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!value}
                                                        onChange={(e) => handleTemplateChange(key, e.target.checked)}
                                                    />
                                                    <span>{field.label}</span>
                                                </label>
                                            );
                                        }
                                        return (
                                            <label key={key} className="event-detail-template-field">
                                                <span>{field.label}</span>
                                                <input
                                                    type={fieldType}
                                                    value={value || ''}
                                                    placeholder={field.placeholder || ''}
                                                    onChange={(e) => handleTemplateChange(key, e.target.value)}
                                                />
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="event-detail-section">
                            <div className="event-detail-label">Internal Notes</div>
                            <textarea
                                className="event-detail-notes"
                                value={eventNotes}
                                onChange={(e) => setEventNotes(e.target.value)}
                                placeholder="Add internal notes for this occurrence..."
                                rows="3"
                            />
                            <div className="event-detail-actions">
                                <button className="btn-secondary" type="button" onClick={handleSaveNotes}>
                                    Save Changes
                                </button>
                            </div>
                        </div>

                        <div className="event-detail-section">
                            <div className="event-detail-header-row">
                                <span className="event-detail-label">Documents</span>
                            </div>
                            <div className="event-documents">
                                <div className="event-document-slot">
                                    <div className="event-document-slot-header">
                                        <div className="event-document-slot-title">
                                            <span>Contract</span>
                                            <span className="event-document-slot-subtitle">Keep the signed contract here.</span>
                                        </div>
                                        <div className="event-document-upload">
                                            <label className="btn-secondary event-document-upload-button">
                                                <FaPaperclip />
                                                Choose
                                                <input
                                                    type="file"
                                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                                    onChange={(e) => setContractFile(e.target.files?.[0] || null)}
                                                />
                                            </label>
                                            <button type="button" className="btn-primary event-document-upload-button" onClick={handleUploadContract} disabled={!contractFile}>
                                                <FaUpload />
                                                Upload
                                            </button>
                                        </div>
                                    </div>
                                    {contractFile && (
                                        <div className="event-document-selected">Selected: {contractFile.name}</div>
                                    )}
                                    {eventDocs.filter((doc) => doc.doc_type === 'contract').length === 0 ? (
                                        <div className="event-detail-empty">No contract uploaded.</div>
                                    ) : (
                                        eventDocs
                                            .filter((doc) => doc.doc_type === 'contract')
                                            .map((doc) => (
                                                <div key={doc.id} className="event-document-row">
                                                    <div className="event-document-meta">
                                                        <span className="event-document-name">{doc.file_name}</span>
                                                        {doc.label && <span className="event-document-tag">{doc.label}</span>}
                                                    </div>
                                                    <div className="event-document-actions">
                                                        <button type="button" className="btn-icon small" onClick={() => handlePreviewDocument(doc)} disabled={!doc.preview} title="Preview">
                                                            <FaEye />
                                                        </button>
                                                        <button type="button" className="btn-icon small" onClick={() => handleOpenDocument(doc)} title="Open">
                                                            <FaExternalLinkAlt />
                                                        </button>
                                                        <button type="button" className="btn-icon small" onClick={() => handleOpenLocation(doc)} title="Open File Location">
                                                            <FaFolderOpen />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>

                                <div className="event-document-slot">
                                    <div className="event-document-slot-header">
                                        <div className="event-document-slot-title">
                                            <span>Other Documents</span>
                                            <span className="event-document-slot-subtitle">Add permits, schedules, or notes.</span>
                                        </div>
                                        <div className="event-document-upload">
                                            <label className="btn-secondary event-document-upload-button">
                                                <FaPaperclip />
                                                Choose
                                                <input
                                                    type="file"
                                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                                    onChange={(e) => setOtherFile(e.target.files?.[0] || null)}
                                                />
                                            </label>
                                            <button type="button" className="btn-primary event-document-upload-button" onClick={handleUploadOther} disabled={!otherFile}>
                                                <FaUpload />
                                                Upload
                                            </button>
                                        </div>
                                    </div>
                                    {otherFile && (
                                        <div className="event-document-selected">Selected: {otherFile.name}</div>
                                    )}
                                    {eventDocs.filter((doc) => doc.doc_type !== 'contract').length === 0 ? (
                                        <div className="event-detail-empty">No documents uploaded.</div>
                                    ) : (
                                        eventDocs
                                            .filter((doc) => doc.doc_type !== 'contract')
                                            .map((doc) => (
                                                <div key={doc.id} className="event-document-row">
                                                    <div className="event-document-meta">
                                                        <span className="event-document-name">{doc.file_name}</span>
                                                        {doc.label && <span className="event-document-tag">{doc.label}</span>}
                                                    </div>
                                                    <div className="event-document-actions">
                                                        <button type="button" className="btn-icon small" onClick={() => handlePreviewDocument(doc)} disabled={!doc.preview} title="Preview">
                                                            <FaEye />
                                                        </button>
                                                        <button type="button" className="btn-icon small" onClick={() => handleOpenDocument(doc)} title="Open">
                                                            <FaExternalLinkAlt />
                                                        </button>
                                                        <button type="button" className="btn-icon small" onClick={() => handleOpenLocation(doc)} title="Open File Location">
                                                            <FaFolderOpen />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="event-detail-section">
                            <div className="event-detail-header-row">
                                <span className="event-detail-label">Tasks & Checklists</span>
                            </div>
                            {taskGroups.length === 0 ? (
                                <div className="event-detail-empty">No tasks for this occurrence yet.</div>
                            ) : (
                                taskGroups.map((group) => (
                                    <div key={group.title} className="event-detail-task-group">
                                        <div className="event-detail-task-title">{group.title}</div>
                                        <div className="event-detail-task-list">
                                            {group.items.map((task) => (
                                                <div key={task.id} className={`event-detail-task ${task.completed ? 'completed' : ''}`}>
                                                    <label className="event-detail-task-main">
                                                        <input
                                                            type="checkbox"
                                                            checked={task.completed}
                                                            onChange={() => handleTaskToggle(task)}
                                                        />
                                                        <span>{task.text}</span>
                                                    </label>
                                                    <div className="event-detail-task-meta">
                                                        <span>{task.state ? task.state.replace('_', ' ') : 'open'}</span>
                                                        <span>{task.due_at ? `Due ${format(new Date(task.due_at), 'MMM d')}` : 'No due date'}</span>
                                                        <span>{task.owner_name || 'Unassigned'}</span>
                                                    </div>
                                                    <div className="event-detail-task-row-actions">
                                                        <button type="button" className="btn-icon small" title="Edit task" onClick={() => handleEditTask(task)}>
                                                            <FaEdit />
                                                        </button>
                                                        <button type="button" className="btn-icon small" title="Delete task" onClick={() => handleDeleteTask(task.id)}>
                                                            <FaTrash />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                            <div className="event-detail-task-add">
                                <input
                                    type="text"
                                    placeholder={taskEditingId ? 'Update task...' : 'Add task...'}
                                    value={taskInput}
                                    onChange={(e) => setTaskInput(e.target.value)}
                                />
                                <input
                                    type="date"
                                    value={taskDueAt}
                                    onChange={(e) => setTaskDueAt(e.target.value)}
                                />
                                <select value={taskState} onChange={(e) => setTaskState(e.target.value)}>
                                    {TASK_STATE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <select value={taskOwnerId} onChange={(e) => setTaskOwnerId(e.target.value)}>
                                    <option value="">Unassigned</option>
                                    {people.map((person) => (
                                        <option key={person.id} value={person.id}>{person.displayName}</option>
                                    ))}
                                </select>
                                <button className="btn-primary" type="button" onClick={handleAddTask}>
                                    {taskEditingId ? <><FaSave /> Save</> : 'Add Task'}
                                </button>
                                {taskEditingId && (
                                    <button className="btn-secondary" type="button" onClick={resetTaskDraft}>
                                        <FaTimes /> Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
            <Modal
                isOpen={docPreview.open}
                onClose={() => setDocPreview({ open: false, url: '', name: '' })}
                title={docPreview.name || 'Document Preview'}
                className="modal-large"
            >
                <div className="event-document-preview">
                    {docPreview.url ? (
                        <img src={docPreview.url} alt={docPreview.name || 'Document preview'} />
                    ) : (
                        <span className="text-muted">No preview available.</span>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default Calendar;


