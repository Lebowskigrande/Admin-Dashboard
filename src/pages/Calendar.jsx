import { useState, useEffect, useMemo, useRef } from 'react';
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
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { useEvents } from '../context/EventsContext';
import { API_URL } from '../services/apiConfig';
import { getTaskProgressMeta } from '../utils/taskProgress';
import { ROLE_DEFINITIONS } from '../models/roles';
import CalendarEventDetails from './calendar/CalendarEventDetails';
import './Calendar.css';

const REGULAR_SUNDAY_SERVICE_SLUGS = new Set(['weekly-service', 'rite-i-service', 'rite-ii-service']);

const WORSHIP_ROLE_CATALOG = [
    { key: 'clergy', label: 'Clergy' },
    { key: 'celebrant', label: 'Celebrant' },
    { key: 'preacher', label: 'Preacher' },
    { key: 'officiant', label: 'Officiant' },
    { key: 'lector', label: 'Lector' },
    { key: 'lem', label: 'LEM' },
    { key: 'acolyte', label: 'Acolyte' },
    { key: 'thurifer', label: 'Thurifer' },
    { key: 'usher', label: 'Usher' },
    { key: 'altarGuild', label: 'Altar Guild' },
    { key: 'organist', label: 'Organist' },
    { key: 'choirmaster', label: 'Choirmaster' },
    { key: 'sound', label: 'Sound' },
    { key: 'coffeeHour', label: 'Coffee Hour' },
    { key: 'childcare', label: 'Childcare' }
];

const ROLE_CONFIG_BY_KEY = new Map(
    [...ROLE_DEFINITIONS, ...WORSHIP_ROLE_CATALOG]
        .map((role) => [role.key, role])
);

const createEmptyPlanningDraft = () => ({
    buildingId: '',
    guestMusicians: [],
    customRoles: [],
    roster: {}
});

const Calendar = () => {
    const { events, loading, refreshEvents } = useEvents();
    const navigate = useNavigate();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [showModal, setShowModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [eventDetails, setEventDetails] = useState(null);
    const [people, setPeople] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [eventTasks, setEventTasks] = useState([]);
    const [eventNotes, setEventNotes] = useState('');
    const [templateFields, setTemplateFields] = useState([]);
    const [templateData, setTemplateData] = useState({});
    const [eventDocs, setEventDocs] = useState([]);
    const [docPreview, setDocPreview] = useState({ open: false, url: '', name: '' });
    const [loadingDetails, setLoadingDetails] = useState(false);
    const detailRequestRef = useRef({ requestId: 0, controller: null });
    const [taskInput, setTaskInput] = useState('');
    const [linkedBulletinDoc, setLinkedBulletinDoc] = useState(null);
    const [documentBusy, setDocumentBusy] = useState({
        bulletin: false,
        contract: false,
        attachment: false
    });
    const [applyToSeries, setApplyToSeries] = useState(true);
    const [detailSaving, setDetailSaving] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [planningDraft, setPlanningDraft] = useState(createEmptyPlanningDraft);
    const [guestMusicianInput, setGuestMusicianInput] = useState('');
    const [planningRoleKey, setPlanningRoleKey] = useState('');
    const [planningSaving, setPlanningSaving] = useState(false);
    const [planningError, setPlanningError] = useState('');
    const [openRosterMenu, setOpenRosterMenu] = useState(null);
    const [rosterMenuDirection, setRosterMenuDirection] = useState('up');

    const cancelDetailRequest = () => {
        const activeRequest = detailRequestRef.current;
        if (activeRequest.controller) {
            activeRequest.controller.abort();
        }
        detailRequestRef.current = {
            requestId: activeRequest.requestId + 1,
            controller: null
        };
    };

    const closeModal = () => {
        cancelDetailRequest();
        setShowModal(false);
        setSelectedEvent(null);
        setEventDetails(null);
        setEventTasks([]);
        setEventNotes('');
        setTemplateFields([]);
        setTemplateData({});
        setEventDocs([]);
        setLinkedBulletinDoc(null);
        setDocPreview({ open: false, url: '', name: '' });
        setTaskInput('');
        setDocumentBusy({ bulletin: false, contract: false, attachment: false });
        setApplyToSeries(true);
        setDetailSaving(false);
        setDetailError('');
        setPlanningDraft(createEmptyPlanningDraft());
        setGuestMusicianInput('');
        setPlanningRoleKey('');
        setPlanningSaving(false);
        setPlanningError('');
        setOpenRosterMenu(null);
        setRosterMenuDirection('up');
        setLoadingDetails(false);
    };

    useEffect(() => () => {
        cancelDetailRequest();
    }, []);

    const loadEventDetails = async (eventItem) => {
        if (!eventItem?.occurrence_id) return;

        const occurrenceId = eventItem.occurrence_id;
        const eventDate = eventItem.date instanceof Date
            ? format(eventItem.date, 'yyyy-MM-dd')
            : String(eventItem.date || '').slice(0, 10);
        const startTime = String(eventItem.time || '').trim();
        const regularSundayService = REGULAR_SUNDAY_SERVICE_SLUGS.has(String(eventItem.type_slug || '').trim());
        const sundayBulletinDocKey = /^0?8:/.test(startTime) ? 'bulletin8' : 'bulletin10';
        const nextRequestId = detailRequestRef.current.requestId + 1;
        detailRequestRef.current.controller?.abort();
        const controller = new AbortController();
        detailRequestRef.current = { requestId: nextRequestId, controller };

        setLoadingDetails(true);
        try {
            const [detailResponse, taskResponse, docResponse, sundayDocResponse] = await Promise.all([
                fetch(`${API_URL}/event-occurrences/${occurrenceId}`, { signal: controller.signal }),
                fetch(`${API_URL}/tasks?origin_type=event&origin_id=${encodeURIComponent(occurrenceId)}&include_future=1`, { signal: controller.signal }),
                fetch(`${API_URL}/event-occurrences/${occurrenceId}/documents?preview=1`, { signal: controller.signal }),
                regularSundayService && eventDate
                    ? fetch(`${API_URL}/sunday/documents?date=${encodeURIComponent(eventDate)}&doc=${encodeURIComponent(sundayBulletinDocKey)}&preview=1`, { signal: controller.signal })
                    : Promise.resolve(null)
            ]);

            if (detailRequestRef.current.requestId !== nextRequestId) return;

            if (detailResponse.ok) {
                const detailPayload = await detailResponse.json();
                if (detailRequestRef.current.requestId !== nextRequestId) return;
                setEventDetails(detailPayload);
                setEventNotes(detailPayload?.notes?.internal || '');
                setTemplateData(detailPayload?.notes?.template || {});
                setPlanningDraft({
                    buildingId: detailPayload?.occurrence?.building_id || '',
                    guestMusicians: Array.isArray(detailPayload?.planning?.musicians?.guests)
                        ? detailPayload.planning.musicians.guests
                        : [],
                    customRoles: Array.isArray(detailPayload?.planning?.custom_roles)
                        ? detailPayload.planning.custom_roles
                        : [],
                    roster: Object.fromEntries(
                        (Array.isArray(detailPayload?.planning?.role_definitions) ? detailPayload.planning.role_definitions : [])
                            .map((role) => [role.key, Array.isArray(role.assignments) ? role.assignments.map((person) => person.id) : []])
                    )
                });
                setGuestMusicianInput('');
                setPlanningRoleKey('');
                setPlanningError('');
                setOpenRosterMenu(null);
                setRosterMenuDirection('up');
                const eventTypeId = detailPayload?.event?.event_type_id;
                if (eventTypeId) {
                    const templateResponse = await fetch(`${API_URL}/event-template-fields?event_type_id=${eventTypeId}`, {
                        signal: controller.signal
                    });
                    if (detailRequestRef.current.requestId !== nextRequestId) return;
                    if (templateResponse.ok) {
                        const templatePayload = await templateResponse.json();
                        if (detailRequestRef.current.requestId !== nextRequestId) return;
                        setTemplateFields(Array.isArray(templatePayload) ? templatePayload : []);
                    } else {
                        setTemplateFields([]);
                    }
                } else {
                    setTemplateFields([]);
                }
            } else {
                setEventDetails(null);
                setTemplateFields([]);
            }

            if (taskResponse.ok) {
                const taskPayload = await taskResponse.json();
                if (detailRequestRef.current.requestId !== nextRequestId) return;
                setEventTasks(Array.isArray(taskPayload) ? taskPayload : []);
            } else {
                setEventTasks([]);
            }

            if (docResponse.ok) {
                const docPayload = await docResponse.json();
                if (detailRequestRef.current.requestId !== nextRequestId) return;
                setEventDocs(Array.isArray(docPayload) ? docPayload : []);
            } else {
                setEventDocs([]);
            }

            if (regularSundayService && sundayDocResponse?.ok) {
                const sundayDocPayload = await sundayDocResponse.json();
                if (detailRequestRef.current.requestId !== nextRequestId) return;
                const rawDoc = sundayDocPayload?.[sundayBulletinDocKey] || null;
                if (rawDoc?.exists) {
                    setLinkedBulletinDoc({
                        id: `linked-${occurrenceId}-${sundayBulletinDocKey}`,
                        occurrence_id: occurrenceId,
                        event_id: eventItem.event_id || eventItem.id || 'sunday-service',
                        doc_type: 'bulletin',
                        label: 'Folder',
                        file_name: rawDoc.name || 'Bulletin',
                        file_path: rawDoc.path || '',
                        preview: rawDoc.preview || '',
                        created_at: '',
                        isLinkedSundayDoc: true
                    });
                } else {
                    setLinkedBulletinDoc(null);
                }
            } else {
                setLinkedBulletinDoc(null);
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Failed to load event details:', error);
            if (detailRequestRef.current.requestId !== nextRequestId) return;
            setEventDetails(null);
            setEventTasks([]);
            setEventDocs([]);
            setLinkedBulletinDoc(null);
            setTemplateFields([]);
            setPlanningDraft(createEmptyPlanningDraft());
            setOpenRosterMenu(null);
            setRosterMenuDirection('up');
        } finally {
            if (detailRequestRef.current.requestId === nextRequestId) {
                setLoadingDetails(false);
                detailRequestRef.current = { requestId: nextRequestId, controller: null };
            }
        }
    };

    const handleEventClick = (eventItem) => {
        if (!eventItem?.occurrence_id) return;
        setApplyToSeries(true);
        setDetailError('');
        setSelectedEvent(eventItem);
        setShowModal(true);
        loadEventDetails(eventItem);
    };

    const handleSaveDetails = async () => {
        if (!selectedEvent?.occurrence_id) return;
        setDetailSaving(true);
        setDetailError('');
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${selectedEvent.occurrence_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    internal_notes: eventNotes || '',
                    apply_to_series: applyToSeries,
                    template_data: {
                        ...(templateData || {}),
                        ...(isWorshipPlanning ? {
                            guest_musicians: planningDraft.guestMusicians,
                            custom_roles: planningDraft.customRoles
                        } : {})
                    }
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Failed to save event details');
            }
            if (selectedEvent) {
                await loadEventDetails(selectedEvent);
            }
            await refreshEvents();
        } catch (error) {
            console.error('Failed to save event details:', error);
            setDetailError(error.message || 'Unable to save event details right now.');
        } finally {
            setDetailSaving(false);
        }
    };

    const handleTemplateChange = (key, value) => {
        setDetailError('');
        setTemplateData((prev) => {
            const next = {
                ...(prev || {}),
                [key]: value
            };
            if (key === 'rental' && !value) {
                delete next.rental_rate;
            }
            if (key === 'setup_required' && !value) {
                delete next.setup_description;
            }
            return next;
        });
    };

    useEffect(() => {
        let active = true;
        const loadLookupData = async () => {
            try {
                const [buildingResponse, peopleResponse] = await Promise.all([
                    fetch(`${API_URL}/buildings`),
                    fetch(`${API_URL}/people`)
                ]);
                if (!buildingResponse.ok) throw new Error('Failed to load buildings');
                if (!peopleResponse.ok) throw new Error('Failed to load people');
                const [buildingData, peopleData] = await Promise.all([
                    buildingResponse.json(),
                    peopleResponse.json()
                ]);
                if (!active) return;
                setBuildings(Array.isArray(buildingData) ? buildingData : []);
                setPeople(Array.isArray(peopleData) ? peopleData : []);
            } catch (error) {
                console.error('Failed to load event planning lookup data:', error);
                if (!active) return;
                setBuildings([]);
                setPeople([]);
            }
        };
        loadLookupData();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!openRosterMenu) return undefined;

        const timer = setTimeout(() => {
            const menu = document.querySelector(`[data-roster-menu-key="${openRosterMenu}"]`);
            if (!menu) return;
            const rect = menu.getBoundingClientRect();
            const menuHeight = rect.height;
            const trigger = menu.parentElement?.getBoundingClientRect();
            if (!trigger) return;
            const spaceAbove = trigger.top;
            const spaceBelow = window.innerHeight - trigger.bottom;
            if (spaceAbove >= menuHeight) {
                setRosterMenuDirection('up');
            } else if (spaceBelow >= menuHeight) {
                setRosterMenuDirection('down');
            } else {
                setRosterMenuDirection('up');
            }
        }, 0);

        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-menu') || target.closest('.role-menu-trigger')) return;
            setOpenRosterMenu(null);
        };

        document.addEventListener('mousedown', handleClick);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [openRosterMenu]);

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
        planningDraft.buildingId || eventDetails?.occurrence?.building_id || selectedEvent?.location || ''
    ), [planningDraft.buildingId, eventDetails?.occurrence?.building_id, selectedEvent?.location]);

    const locationName = useMemo(() => {
        const buildingId = locationId;
        if (!buildingId) return '';
        const match = buildings.find((building) => building.id === buildingId);
        const name = match?.name || buildingId;
        return normalizeLocationName(name);
    }, [buildings, locationId]);

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
        setDocumentBusy((prev) => ({ ...prev, [docType]: true }));
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
        } finally {
            setDocumentBusy((prev) => ({ ...prev, [docType]: false }));
        }
    };

    const handlePickBulletin = async (file) => {
        if (!file) return;
        await handleUploadDocument(file, 'bulletin');
    };

    const handlePickContract = async (file) => {
        if (!file) return;
        await handleUploadDocument(file, 'contract');
    };

    const handlePickOtherDocument = async (file) => {
        if (!file) return;
        await handleUploadDocument(file, 'attachment');
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
                credentials: 'include',
                body: JSON.stringify({ path: doc.file_path })
            });
        } catch (error) {
            console.error('Failed to open file location:', error);
        }
    };

    const handleSavePlanning = async () => {
        if (!selectedEvent?.occurrence_id) return;
        setPlanningSaving(true);
        setPlanningError('');
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${selectedEvent.occurrence_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    internal_notes: eventNotes || '',
                    apply_to_series: applyToSeries,
                    template_data: templateData || {},
                    building_id: planningDraft.buildingId || '',
                    guest_musicians: planningDraft.guestMusicians,
                    custom_roles: planningDraft.customRoles,
                    roster: planningDraft.roster
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Failed to save worship planning');
            }
            if (selectedEvent) {
                await loadEventDetails(selectedEvent);
                await refreshEvents();
            }
        } catch (error) {
            console.error('Failed to save worship planning:', error);
            setPlanningError('Unable to save the worship planning details right now.');
        } finally {
            setPlanningSaving(false);
        }
    };

    const handleAddGuestMusician = () => {
        const value = String(guestMusicianInput || '').trim();
        if (!value) return;
        setPlanningDraft((prev) => {
            const exists = prev.guestMusicians.some((entry) => entry.toLowerCase() === value.toLowerCase());
            if (exists) return prev;
            return {
                ...prev,
                guestMusicians: [...prev.guestMusicians, value]
            };
        });
        setGuestMusicianInput('');
    };

    const handleRemoveGuestMusician = (entry) => {
        setPlanningDraft((prev) => ({
            ...prev,
            guestMusicians: prev.guestMusicians.filter((item) => item !== entry)
        }));
    };

    const handleAddPlanningRole = (roleKey = planningRoleKey) => {
        const key = String(roleKey || '').trim();
        const roleConfig = ROLE_CONFIG_BY_KEY.get(key);
        const label = roleConfig?.label || '';
        if (!label || !key) return;
        setPlanningDraft((prev) => {
            const exists = prev.customRoles.some((role) => role.key === key);
            if (exists) return prev;
            return {
                ...prev,
                customRoles: [...prev.customRoles, { key, label }],
                roster: {
                    ...prev.roster,
                    [key]: prev.roster[key] || []
                }
            };
        });
        setPlanningRoleKey('');
    };

    const handleRemovePlanningRole = (roleKey) => {
        setPlanningDraft((prev) => {
            const nextRoster = { ...prev.roster };
            delete nextRoster[roleKey];
            return {
                ...prev,
                customRoles: prev.customRoles.filter((role) => role.key !== roleKey),
                roster: nextRoster
            };
        });
    };

    const normalizeRosterIds = (roleKey, values) => {
        const list = Array.isArray(values) ? values : (values ? [values] : []);
        const uniqueIds = Array.from(new Set(list.map((value) => String(value || '').trim()).filter(Boolean)));
        return roleAllowsMultiple(roleKey) ? uniqueIds : uniqueIds.slice(0, 1);
    };

    const handleRosterSelectionChange = (roleKey, values) => {
        const normalized = normalizeRosterIds(roleKey, values);
        setPlanningDraft((prev) => ({
            ...prev,
            roster: {
                ...prev.roster,
                [roleKey]: normalized
            }
        }));
    };

    const toggleRosterMenu = (roleKey) => {
        setOpenRosterMenu((prev) => (prev === roleKey ? null : roleKey));
    };

    const getEligibleRosterPeople = (roleKey) => {
        const eligiblePeople = people.filter((person) => {
            const personRoles = Array.isArray(person.roles) ? person.roles : [];
            if (roleKey === 'clergy') {
                return person.category === 'clergy'
                    || personRoles.includes('clergy')
                    || personRoles.includes('celebrant')
                    || personRoles.includes('preacher')
                    || personRoles.includes('officiant');
            }
            return personRoles.includes(roleKey);
        });
        return eligiblePeople.length > 0 ? eligiblePeople : people;
    };

    const getTeamMap = (roleKey, eligiblePeople) => {
        const teamMap = new Map();
        eligiblePeople.forEach((person) => {
            const teamList = Array.isArray(person.teams?.[roleKey]) ? person.teams[roleKey] : [];
            teamList.forEach((teamNumber) => {
                if (!teamMap.has(teamNumber)) teamMap.set(teamNumber, []);
                teamMap.get(teamNumber).push(person.id);
            });
        });
        return teamMap;
    };

    const toggleRosterPersonSelection = (roleKey, personId) => {
        const currentIds = normalizeRosterIds(roleKey, planningDraft.roster?.[roleKey] || []);
        if (roleAllowsMultiple(roleKey)) {
            const current = new Set(currentIds);
            if (current.has(personId)) {
                current.delete(personId);
            } else {
                current.add(personId);
            }
            handleRosterSelectionChange(roleKey, Array.from(current));
            return;
        }
        handleRosterSelectionChange(roleKey, [personId]);
        setOpenRosterMenu(null);
    };

    const toggleRosterTeamSelection = (roleKey, memberIds) => {
        const currentIds = normalizeRosterIds(roleKey, planningDraft.roster?.[roleKey] || []);
        const current = new Set(currentIds);
        const normalizedMembers = normalizeRosterIds(roleKey, memberIds);
        const allSelected = normalizedMembers.every((personId) => current.has(personId));
        if (allSelected) {
            normalizedMembers.forEach((personId) => current.delete(personId));
        } else {
            normalizedMembers.forEach((personId) => current.add(personId));
        }
        handleRosterSelectionChange(roleKey, Array.from(current));
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

    const handleAddTask = async () => {
        if (!taskInput.trim() || !selectedEvent?.occurrence_id) return;
        try {
            await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: taskInput.trim(),
                    source_type: 'event',
                    source_id: selectedEvent.occurrence_id
                })
            });
            setTaskInput('');
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

    const filteredEvents = useMemo(() => (
        events.filter(event => !(event.source === 'liturgical' && event.date?.getDay?.() === 0))
    ), [events]);

    const taskGroups = useMemo(() => {
        const grouped = eventTasks.reduce((acc, task) => {
            const key = task.list_title || task.list_key || 'Tasks';
            if (!acc[key]) acc[key] = [];
            acc[key].push(task);
            return acc;
        }, {});
        return Object.entries(grouped).map(([title, items]) => ({
            title,
            listKey: items[0]?.list_key || '',
            items: items.sort((a, b) => {
                const orderA = a.step_order ?? Number.POSITIVE_INFINITY;
                const orderB = b.step_order ?? Number.POSITIVE_INFINITY;
                if (orderA !== orderB) return orderA - orderB;
                return String(a.text || '').localeCompare(String(b.text || ''));
            })
        }));
    }, [eventTasks]);

    const isWorshipPlanning = Boolean(eventDetails?.planning);
    const roleDefinitions = useMemo(() => (
        Array.isArray(eventDetails?.planning?.role_definitions) ? eventDetails.planning.role_definitions : []
    ), [eventDetails?.planning?.role_definitions]);
    const roleAllowsMultipleByKey = useMemo(() => (
        new Map(roleDefinitions.map((role) => [role.key, !!role.allows_multiple]))
    ), [roleDefinitions]);
    const roleAllowsMultiple = (roleKey) => roleAllowsMultipleByKey.get(roleKey) === true;
    const getRoleDisplayLabel = (role) => ROLE_CONFIG_BY_KEY.get(role.key)?.label || role.label;
    const orderedRoleDefinitions = useMemo(() => {
        const sortOrder = new Map(WORSHIP_ROLE_CATALOG.map((role, index) => [role.key, index]));
        return [...roleDefinitions].sort((a, b) => {
            const orderA = sortOrder.has(a.key) ? sortOrder.get(a.key) : Number.MAX_SAFE_INTEGER;
            const orderB = sortOrder.has(b.key) ? sortOrder.get(b.key) : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            return String(a.label || a.key || '').localeCompare(String(b.label || b.key || ''));
        });
    }, [roleDefinitions]);
    const availablePlanningRoles = useMemo(() => {
        const activeKeys = new Set(orderedRoleDefinitions.map((role) => role.key));
        return WORSHIP_ROLE_CATALOG.filter((role) => !activeKeys.has(role.key));
    }, [orderedRoleDefinitions]);
    const isRegularSundayService = REGULAR_SUNDAY_SERVICE_SLUGS.has(String(selectedEvent?.type_slug || eventDetails?.event?.type_slug || '').trim());
    const bulletinDocs = useMemo(() => (
        eventDocs.filter((doc) => doc.doc_type === 'bulletin')
    ), [eventDocs]);
    const contractDocs = useMemo(() => (
        eventDocs.filter((doc) => doc.doc_type === 'contract')
    ), [eventDocs]);
    const attachmentDocs = useMemo(() => (
        eventDocs.filter((doc) => !['bulletin', 'contract'].includes(doc.doc_type))
    ), [eventDocs]);
    const openTaskCount = useMemo(() => (
        eventTasks.filter((task) => !task.completed).length
    ), [eventTasks]);
    const assignedRosterCount = useMemo(() => (
        Object.values(planningDraft.roster || {}).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0)
    ), [planningDraft.roster]);
    const serviceLabel = eventDetails?.planning?.service_label || eventDetails?.event?.type_name || selectedEvent?.type_name || selectedEvent?.category_name || 'Event';
    const getEventChipClass = (event) => {
        const classes = [];
        const source = String(event?.source || '').toLowerCase();
        const role = String(event?.calendar_role || event?.metadata?.calendarRole || '').toLowerCase();
        const kind = String(event?.entry_kind || event?.metadata?.entryKind || '').toLowerCase();
        const taskPolicy = String(event?.task_policy || event?.metadata?.taskPolicy || '').toLowerCase();
        if (source === 'google') classes.push('event-google');
        if (role === 'personal' || kind === 'personal' || kind === 'appointment') classes.push('event-personal');
        if (['schedule', 'out_of_office', 'resource_hold'].includes(kind)) classes.push('event-schedule');
        if (['reminder', 'deadline'].includes(kind)) classes.push('event-reminder');
        if (taskPolicy === 'never') classes.push('event-no-auto-task');
        return classes.join(' ');
    };
    const getEventChipMeta = (event) => {
        const group = event?.display_group || event?.metadata?.displayGroup || '';
        const kind = String(event?.entry_kind || event?.metadata?.entryKind || '').replace(/_/g, ' ');
        if (group && kind) return `${group} / ${kind}`;
        return group || kind || '';
    };
    const getEventFlags = (event) => (
        Array.isArray(event?.flags)
            ? event.flags.filter((flag) => String(flag?.label || '').trim()).slice(0, 2)
            : []
    );

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
                                {filteredEvents && filteredEvents.filter(e => isSameDay(e.date, dayItem)).map(event => {
                                    const contrastColor = getContrastColor(event.color);
                                    const isLight = contrastColor !== event.color;
                                    const tooltip = event.type_name ? `${event.type_name} - ${event.title}` : event.title;
                                    const eventFlags = getEventFlags(event);

                                    return (
                                        <div
                                            key={event.id}
                                            className={`event-chip ${getEventChipClass(event)} ${event.occurrence_id ? 'event-chip--clickable' : 'event-chip--static'}`}
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
                                                {(event.time || getEventChipMeta(event)) && (
                                                    <span className="event-chip-time">
                                                        {[event.time, getEventChipMeta(event)].filter(Boolean).join(' / ')}
                                                    </span>
                                                )}
                                                <span className="event-chip-title">{event.title}</span>
                                                {eventFlags.length > 0 && (
                                                    <div className="event-chip-flags">
                                                        {eventFlags.map((flag) => (
                                                            <span key={`${event.id}-${flag.key || flag.label}`} className={`event-chip-flag tone-${flag.tone || 'warning'}`} title={flag.detail || flag.label}>
                                                                {flag.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
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
                className="modal-large event-detail-shell"
            >
                <CalendarEventDetails
                    loadingDetails={loadingDetails}
                    selectedEvent={selectedEvent}
                    eventDetails={eventDetails}
                    serviceLabel={serviceLabel}
                    locationId={locationId}
                    locationName={locationName}
                    openTaskCount={openTaskCount}
                    assignedRosterCount={assignedRosterCount}
                    isWorshipPlanning={isWorshipPlanning}
                    templateFields={templateFields}
                    templateData={templateData}
                    onTemplateChange={handleTemplateChange}
                    planningState={{
                        buildings,
                        people,
                        planningDraft,
                        guestMusicianInput,
                        planningRoleKey,
                        planningSaving,
                        planningError,
                        openRosterMenu,
                        rosterMenuDirection,
                        orderedRoleDefinitions,
                        availablePlanningRoles
                    }}
                    planningActions={{
                        setPlanningDraft,
                        setGuestMusicianInput,
                        setPlanningRoleKey,
                        handleSavePlanning,
                        handleAddGuestMusician,
                        handleRemoveGuestMusician,
                        handleAddPlanningRole,
                        handleRemovePlanningRole,
                        toggleRosterMenu,
                        toggleRosterPersonSelection,
                        toggleRosterTeamSelection
                    }}
                    planningHelpers={{
                        roleAllowsMultiple,
                        normalizeRosterIds,
                        getEligibleRosterPeople,
                        getTeamMap,
                        getRoleDisplayLabel
                    }}
                    seriesState={{ applyToSeries, setApplyToSeries, detailSaving, detailError }}
                    notesState={{ eventNotes }}
                    notesActions={{ setEventNotes, handleSaveDetails }}
                    documentsState={{
                        bulletinDocs,
                        contractDocs,
                        attachmentDocs,
                        linkedBulletinDoc,
                        documentBusy,
                        isRegularSundayService
                    }}
                    documentActions={{
                        handlePickBulletin,
                        handlePickContract,
                        handlePickOtherDocument,
                        handlePreviewDocument,
                        handleOpenDocument,
                        handleOpenLocation
                    }}
                    taskState={{ taskGroups, taskInput }}
                    taskActions={{ setTaskInput, handleAddTask, handleTaskToggle }}
                    onLocationClick={() => navigate(`/buildings?tab=map&location=${encodeURIComponent(locationId)}`)}
                />
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

