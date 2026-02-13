import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { API_URL } from '../../services/apiConfig';
import { MAP_AREAS } from '../../data/areas';
import { getTaskProgressMeta } from '../../utils/taskProgress';

const slugify = (value = '') => value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const TICKET_TERMINAL_STATUSES = new Set(['done', 'wont_do']);

export const useBuildingsData = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();

    const [activeTab, setActiveTab] = useState('tickets');
    const [activeArea, setActiveArea] = useState(null);
    const [hoveredArea, setHoveredArea] = useState(null);
    const [buildings, setBuildings] = useState([]);
    const [buildingsError, setBuildingsError] = useState('');

    const [tickets, setTickets] = useState([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [ticketsError, setTicketsError] = useState('');
    const [showTicketModal, setShowTicketModal] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [pendingTicketScroll, setPendingTicketScroll] = useState(false);
    const [archiveExpanded, setArchiveExpanded] = useState(false);
    const [ticketStatusExpandedKey, setTicketStatusExpandedKey] = useState(null);
    const ticketsViewRef = useRef(null);
    const [roomsExpanded, setRoomsExpanded] = useState(false);
    const roomsListRef = useRef(null);
    const [roomsHeight, setRoomsHeight] = useState(0);
    const [newTicket, setNewTicket] = useState({
        title: '',
        description: '',
        status: 'new',
        areaIds: []
    });
    const [newNote, setNewNote] = useState('');
    const [newTaskText, setNewTaskText] = useState('');

    // Needs Data (backed by task engine)
    const [needs, setNeeds] = useState([]);
    const [needsLoading, setNeedsLoading] = useState(true);
    const [needsError, setNeedsError] = useState('');
    const [newNeed, setNewNeed] = useState('');

    // Vendors Data
    const [vendors, setVendors] = useState([]);
    const [vendorsLoading, setVendorsLoading] = useState(true);
    const [vendorsError, setVendorsError] = useState('');

    const formatSqft = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const numeric = Number(value);
        if (Number.isNaN(numeric) || numeric <= 0) return '';
        return `${new Intl.NumberFormat('en-US').format(numeric)} sq ft`;
    };

    const loadNeeds = async () => {
        setNeedsLoading(true);
        setNeedsError('');
        try {
            const params = new URLSearchParams({
                origin_type: 'operations',
                origin_id: 'long-term-needs'
            });
            const response = await fetch(`${API_URL}/tasks?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load needs');
            const data = await response.json();
            setNeeds(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load long term needs:', error);
            setNeeds([]);
            setNeedsError('Unable to load long term needs.');
        } finally {
            setNeedsLoading(false);
        }
    };

    useEffect(() => {
        loadNeeds();
    }, []);

    const addNeed = async () => {
        const trimmed = newNeed.trim();
        if (!trimmed) return;
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: trimmed,
                    source_type: 'operations',
                    source_id: 'long-term-needs',
                    list_title: 'Long Term Needs'
                })
            });
            if (!response.ok) throw new Error('Failed to create need');
            setNewNeed('');
            await loadNeeds();
        } catch (error) {
            console.error('Failed to add long term need:', error);
            setNeedsError('Unable to add long term need.');
        }
    };

    const toggleNeed = async (task) => {
        if (!task) return;
        try {
            const progressMeta = getTaskProgressMeta(task);
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    progressMeta?.nextStep
                        ? { text: task.text, progress_key: progressMeta.nextStep.key }
                        : { text: task.text, completed: !task.completed }
                )
            });
            if (!response.ok) throw new Error('Failed to update task');
            await loadNeeds();
        } catch (error) {
            console.error('Failed to update long term need:', error);
            setNeedsError('Unable to update long term need.');
        }
    };

    useEffect(() => {
        const loadBuildings = async () => {
            setBuildingsError('');
            try {
                const response = await fetch(`${API_URL}/buildings`);
                if (!response.ok) throw new Error('Failed to load buildings');
                const data = await response.json();
                setBuildings(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load buildings:', error);
                setBuildingsError('Unable to load building details.');
            }
        };
        loadBuildings();
    }, []);

    useEffect(() => {
        const queryTab = searchParams.get('tab');
        if (queryTab && ['tickets', 'map', 'vendors', 'needs'].includes(queryTab)) {
            setActiveTab(queryTab);
            return;
        }
        const storedTab = sessionStorage.getItem('bgActiveTab');
        if (storedTab && ['tickets', 'map', 'vendors', 'needs'].includes(storedTab)) {
            setActiveTab(storedTab);
        }
    }, [searchParams]);

    useEffect(() => {
        sessionStorage.setItem('bgActiveTab', activeTab);
    }, [activeTab]);

    useEffect(() => {
        let canceled = false;
        const loadVendors = async () => {
            setVendorsError('');
            setVendorsLoading(true);
            try {
                const response = await fetch(`${API_URL}/vendors`);
                if (!response.ok) throw new Error('Failed to load vendors');
                const data = await response.json();
                if (!canceled) {
                    setVendors(Array.isArray(data) ? data : []);
                }
            } catch (error) {
                console.error('Failed to load preferred vendors:', error);
                if (!canceled) {
                    setVendorsError('Unable to load preferred vendors.');
                }
            } finally {
                if (!canceled) {
                    setVendorsLoading(false);
                }
            }
        };
        loadVendors();
        return () => {
            canceled = true;
        };
    }, []);

    const openTicketModal = (defaultAreaId = null) => {
        const areaIds = defaultAreaId ? [defaultAreaId] : [];
        setNewTicket({ title: '', description: '', status: 'new', areaIds });
        setShowTicketModal(true);
    };

    const toggleTicketArea = (areaId) => {
        setNewTicket((prev) => {
            const exists = prev.areaIds.includes(areaId);
            return {
                ...prev,
                areaIds: exists ? prev.areaIds.filter((id) => id !== areaId) : [...prev.areaIds, areaId]
            };
        });
    };

    const createTicket = async (event) => {
        event.preventDefault();
        if (!newTicket.title.trim()) return;
        try {
            const response = await fetch(`${API_URL}/tickets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTicket.title,
                    description: newTicket.description,
                    status: newTicket.status,
                    area_ids: newTicket.areaIds
                })
            });
            if (!response.ok) throw new Error('Failed to create ticket');
            const created = await response.json();
            setTickets((prev) => [created, ...prev]);
            setSelectedTicketId(created.id);
            setShowTicketModal(false);
        } catch (error) {
            console.error('Failed to create ticket:', error);
            setTicketsError('Unable to create ticket. Please try again.');
        }
    };

    const updateTicket = async (ticketId, updates) => {
        try {
            const response = await fetch(`${API_URL}/tickets/${ticketId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!response.ok) throw new Error('Failed to update ticket');
            const updated = await response.json();
            setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? updated : ticket)));
        } catch (error) {
            console.error('Failed to update ticket:', error);
            setTicketsError('Unable to update ticket. Please try again.');
        }
    };

    const addTicketNote = async (ticket) => {
        const trimmed = newNote.trim();
        if (!trimmed) return;
        const noteEntry = {
            id: `note-${Date.now()}`,
            text: trimmed,
            created_at: new Date().toISOString()
        };
        await updateTicket(ticket.id, { notes: [...(ticket.notes || []), noteEntry] });
        setNewNote('');
    };

    const addTicketTask = async (ticketId) => {
        const trimmed = newTaskText.trim();
        if (!trimmed) return;
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: trimmed, ticket_id: ticketId })
            });
            if (!response.ok) throw new Error('Failed to add task');
            const created = await response.json();
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === ticketId
                    ? { ...ticket, tasks: [created, ...(ticket.tasks || [])] }
                    : ticket
            )));
            setNewTaskText('');
        } catch (error) {
            console.error('Failed to add task:', error);
            setTicketsError('Unable to add task. Please try again.');
        }
    };

    const toggleTicketTask = async (task) => {
        try {
            const progressMeta = getTaskProgressMeta(task);
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    progressMeta?.nextStep
                        ? { text: task.text, progress_key: progressMeta.nextStep.key }
                        : { text: task.text, completed: !task.completed }
                )
            });
            if (!response.ok) throw new Error('Failed to update task');
            const updated = await response.json();
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === task.ticket_id
                    ? { ...ticket, tasks: (ticket.tasks || []).map((item) => (item.id === task.id ? updated : item)) }
                    : ticket
            )));
        } catch (error) {
            console.error('Failed to update task:', error);
            setTicketsError('Unable to update task. Please try again.');
        }
    };

    const deleteTicketTask = async (task) => {
        try {
            const response = await fetch(`${API_URL}/tasks/${task.id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete task');
            setTickets((prev) => prev.map((ticket) => (
                ticket.id === task.ticket_id
                    ? { ...ticket, tasks: (ticket.tasks || []).filter((item) => item.id !== task.id) }
                    : ticket
            )));
        } catch (error) {
            console.error('Failed to delete task:', error);
            setTicketsError('Unable to delete task. Please try again.');
        }
    };

    const buildingsById = useMemo(() => (
        new Map(buildings.map((building) => [building.id, building]))
    ), [buildings]);

    const buildingsByMapId = useMemo(() => {
        const map = new Map();
        buildings.forEach((building) => {
            const mapId = building.map_id || slugify(building.name || '');
            if (mapId) map.set(mapId, building);
        });
        return map;
    }, [buildings]);

    const mapAreas = useMemo(() => {
        return MAP_AREAS.map((area) => {
            if (area.type !== 'building') return area;
            const building = buildingsByMapId.get(area.id) || buildingsById.get(area.id);
            if (!building) return area;
            return {
                ...area,
                name: building.name || area.name,
                category: building.category || area.category,
                description: building.notes || area.description
            };
        });
    }, [buildingsByMapId, buildingsById]);

    useEffect(() => {
        const locationParam = searchParams.get('location');
        if (!locationParam || mapAreas.length === 0) return;
        const target = mapAreas.find((area) => area.id === locationParam)
            || mapAreas.find((area) => slugify(area.name || '') === locationParam);
        if (!target) return;
        setActiveTab('map');
        setActiveArea(target);
    }, [mapAreas, searchParams]);

    useEffect(() => {
        if (activeTab !== 'map' || !activeArea?.id) return;
        let attempts = 0;
        let cancelled = false;
        const tryScroll = () => {
            if (cancelled) return;
            const node = document.querySelector(`.map-list-item[data-area-id="${activeArea.id}"]`);
            if (node) {
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            attempts += 1;
            if (attempts < 10) {
                setTimeout(tryScroll, 80);
            }
        };
        tryScroll();
        return () => {
            cancelled = true;
        };
    }, [activeArea?.id, activeTab]);

    const activeDetails = useMemo(() => {
        const current = hoveredArea || activeArea || null;
        if (!current) return null;
        const match = mapAreas.find((area) => area.id === current.id);
        return match || current;
    }, [hoveredArea, activeArea, mapAreas]);

    const activeBuilding = activeDetails?.type === 'building'
        ? (buildingsByMapId.get(activeDetails.id) || buildingsById.get(activeDetails.id))
        : null;

    useLayoutEffect(() => {
        if (!roomsListRef.current) {
            setRoomsHeight(0);
            return;
        }
        const measured = roomsListRef.current.scrollHeight;
        setRoomsHeight(roomsExpanded ? measured : 0);
    }, [roomsExpanded, activeBuilding?.rooms?.length]);

    useEffect(() => {
        setRoomsExpanded(false);
    }, [activeDetails?.id]);

    const clearSelection = () => {
        setHoveredArea(null);
        setActiveArea(null);
    };

    const shouldIgnoreDeselect = (target) => {
        if (!target) return false;
        if (target.closest('.campus-map-image')) return true;
        if (target.closest('.map-area')) return true;
        if (target.closest('.campus-map-details')) return true;
        if (target.closest('button, input, select, textarea, a, label')) return true;
        return false;
    };

    const orderedAreas = useMemo(() => {
        const priority = ['Worship', 'All Purpose'];
        const buildingBuckets = new Map(priority.map((value) => [value, []]));
        const rest = [];

        mapAreas.forEach((area) => {
            if (area.category && buildingBuckets.has(area.category)) {
                buildingBuckets.get(area.category).push(area);
                return;
            }
            rest.push(area);
        });

        return [
            ...priority.flatMap((key) => buildingBuckets.get(key)),
            ...rest
        ];
    }, [mapAreas]);

    const areaById = useMemo(() => {
        return mapAreas.reduce((acc, area) => {
            acc[area.id] = area;
            return acc;
        }, {});
    }, [mapAreas]);

    const activeAreaTickets = useMemo(() => {
        if (!activeDetails?.id) return [];
        return tickets.filter((ticket) => (
            (ticket.areas || []).includes(activeDetails.id) && !TICKET_TERMINAL_STATUSES.has(ticket.status)
        ));
    }, [activeDetails, tickets]);

    const focusTicket = (ticketId) => {
        setSelectedTicketId(ticketId);
        setActiveTab('tickets');
        setPendingTicketScroll(true);
    };

    useEffect(() => {
        const loadTickets = async () => {
            setTicketsLoading(true);
            setTicketsError('');
            try {
                const response = await fetch(`${API_URL}/tickets`);
                if (!response.ok) throw new Error('Failed to load tickets');
                const data = await response.json();
                setTickets(Array.isArray(data) ? data : []);
                if (!selectedTicketId && Array.isArray(data) && data.length > 0) {
                    const firstActive = data.find((ticket) => !TICKET_TERMINAL_STATUSES.has(ticket.status)) || data[0];
                    setSelectedTicketId(firstActive.id);
                }
            } catch (error) {
                console.error('Failed to load tickets:', error);
                setTicketsError('Unable to load tickets. Please refresh and try again.');
            } finally {
                setTicketsLoading(false);
            }
        };

        loadTickets();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const tasksScrollRef = useRef(null);

    useEffect(() => {
        const ticketParam = searchParams.get('ticket');
        if (!ticketParam || tickets.length === 0) return;
        const match = tickets.find((ticket) => `${ticket.id}` === ticketParam);
        if (!match) return;
        setSelectedTicketId(match.id);
        setActiveTab('tickets');
        setPendingTicketScroll(true);
    }, [searchParams, tickets]);

    useEffect(() => {
        if (location.hash !== '#ticket-tasks') return;
        if (!selectedTicketId || activeTab !== 'tickets') return;
        if (tasksScrollRef.current === selectedTicketId) return;
        const node = document.getElementById('ticket-tasks');
        if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' });
            tasksScrollRef.current = selectedTicketId;
        }
    }, [activeTab, location.hash, selectedTicketId]);

    useEffect(() => {
        if (!pendingTicketScroll || activeTab !== 'tickets') return;
        const node = ticketsViewRef.current;
        if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setPendingTicketScroll(false);
    }, [pendingTicketScroll, activeTab, selectedTicketId]);

    const selectedTicket = useMemo(() => {
        return tickets.find((ticket) => ticket.id === selectedTicketId) || null;
    }, [tickets, selectedTicketId]);

    return {
        location,
        activeTab,
        activeArea,
        hoveredArea,
        buildings,
        buildingsError,
        tickets,
        ticketsLoading,
        ticketsError,
        showTicketModal,
        selectedTicketId,
        pendingTicketScroll,
        archiveExpanded,
        ticketStatusExpandedKey,
        ticketsViewRef,
        roomsExpanded,
        roomsListRef,
        roomsHeight,
        newTicket,
        newNote,
        newTaskText,
        needs,
        needsLoading,
        needsError,
        newNeed,
        vendors,
        vendorsLoading,
        vendorsError,
        mapAreas,
        orderedAreas,
        areaById,
        activeDetails,
        activeBuilding,
        activeAreaTickets,
        selectedTicket,
        formatSqft,
        setActiveTab,
        setActiveArea,
        setHoveredArea,
        setShowTicketModal,
        setSelectedTicketId,
        setArchiveExpanded,
        setTicketStatusExpandedKey,
        setRoomsExpanded,
        setNewTicket,
        setNewNote,
        setNewTaskText,
        setNewNeed,
        openTicketModal,
        toggleTicketArea,
        createTicket,
        updateTicket,
        addTicketNote,
        addTicketTask,
        toggleTicketTask,
        deleteTicketTask,
        addNeed,
        toggleNeed,
        focusTicket,
        clearSelection,
        shouldIgnoreDeselect
    };
};
