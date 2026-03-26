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

const normalizeText = (value = '') => String(value || '').toLowerCase().trim();

const fetchJsonWithFallback = async (paths = []) => {
    let lastError = null;
    for (const path of paths) {
        try {
            const response = await fetch(path);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(String(payload?.error || `HTTP ${response.status}`));
            return payload;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Failed to fetch');
};

const uniqueValues = (values = []) => Array.from(new Set(
    values
        .flat()
        .map((value) => String(value || '').trim())
        .filter(Boolean)
));

const normalizeArchitecturalLayerLabel = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    const key = slugify(text);
    const map = {
        site: 'Site',
        siteplan: 'Site',
        floorplan: 'Floor Plan',
        floorplans: 'Floor Plan',
        basement: 'Basement',
        foundation: 'Foundation',
        elevations: 'Elevations',
        elevation: 'Elevations',
        sections: 'Sections',
        section: 'Sections',
        details: 'Details',
        detail: 'Details',
        schedules: 'Schedules',
        schedule: 'Schedules',
        architectural: 'Architectural',
        architecture: 'Architectural',
        structural: 'Structural',
        plumbing: 'Plumbing',
        electrical: 'Electrical',
        mechanical: 'Mechanical',
        hvac: 'Mechanical',
        fire: 'Life Safety',
        lifesafety: 'Life Safety',
        lighting: 'Electrical',
        power: 'Electrical',
        lowvoltage: 'Low Voltage',
        telecom: 'Low Voltage',
        communications: 'Low Voltage'
    };
    return map[key] || text.replace(/\b\w/g, (char) => char.toUpperCase());
};

const inferArchitecturalLayer = (record = {}) => {
    const explicit = normalizeArchitecturalLayerLabel(
        record.layerLabel || record.layer || record.discipline || record.category || record.sheetType
    );
    if (explicit) return explicit;

    const haystack = [
        record.title,
        record.name,
        record.fileName,
        record.sheetTitle,
        record.summary
    ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

    const matches = [
        ['Site', ['site plan', 'plot plan', 'survey', 'civil', 'grading', 'drainage', 'utility plan', 'roof plan']],
        ['Floor Plan', ['floor plan', 'basement plan', 'reflected ceiling', 'rcp', 'plan']],
        ['Electrical', ['electrical', 'lighting', 'power', 'panel', 'wiring', 'telecom', 'low voltage']],
        ['Plumbing', ['plumbing', 'pipe', 'water', 'sewer', 'sanitary', 'drain']],
        ['Mechanical', ['mechanical', 'hvac', 'duct', 'air conditioning', 'ventilation', 'equipment']],
        ['Structural', ['structural', 'foundation', 'framing', 'beam', 'joist', 'truss']],
        ['Sections', ['section']],
        ['Elevations', ['elevation']],
        ['Details', ['detail', 'enlarged', 'schedule']],
        ['Life Safety', ['fire', 'sprinkler', 'alarm', 'life safety']]
    ];

    for (const [label, tokens] of matches) {
        if (tokens.some((token) => haystack.includes(token))) return label;
    }

    return 'General';
};

const normalizeArchitecturalRecord = (record = {}) => {
    const areaIds = uniqueValues([
        record.areaId,
        record.area_id,
        record.areaIds,
        record.area_ids,
        record.locationId,
        record.location_id,
        record.mapId,
        record.map_id
    ]);
    const areaNames = uniqueValues([
        record.areaName,
        record.areaNames,
        record.location,
        record.locationName
    ]);
    const utilitySystems = uniqueValues([
        ...(Array.isArray(record.utilitySystems)
            ? record.utilitySystems.map((entry) => (
                typeof entry === 'string'
                    ? entry
                    : String(entry?.label || entry?.name || entry?.system || entry?.key || '').trim()
            ))
            : [record.utilitySystems]),
        ...(Array.isArray(record.systems)
            ? record.systems.map((entry) => (
                typeof entry === 'string'
                    ? entry
                    : String(entry?.label || entry?.name || entry?.system || entry?.key || '').trim()
            ))
            : [record.systems]),
        record.utilitySystem,
        record.system,
        record.utilityCategory
    ]);
    const buildingIds = uniqueValues([
        record.buildingId,
        record.building_id,
        record.buildingIds,
        record.building_ids
    ]);
    const fileName = String(record.fileName || record.name || '').trim();
    const title = String(record.title || record.sheetTitle || fileName || 'Untitled record').trim();
    const layer = normalizeArchitecturalLayerLabel(record.layer || record.layerLabel || record.discipline) || inferArchitecturalLayer(record);
    const recordKind = slugify(record.kind || record.type || layer);
    const utilityKey = slugify(record.utilityCategory || record.utility || layer);
    const keywords = uniqueValues([
        record.keywords,
        record.tags,
        record.subjects,
        record.descriptors
    ]);

    return {
        id: String(record.id || record.recordId || fileName || title).trim(),
        title,
        fileName,
        filePath: String(record.filePath || record.path || '').trim(),
        relativePath: String(record.relativePath || '').trim(),
        absolutePath: String(record.absolutePath || '').trim(),
        downloadUrl: String(record.downloadUrl || record.url || record.fileUrl || '').trim(),
        openPath: String(record.openPath || '').trim(),
        summary: String(record.summary || record.description || '').trim(),
        notes: String(record.notes || '').trim(),
        layer,
        layerKey: String(record.layerKey || slugify(layer)).trim(),
        kind: recordKind || 'architectural-record',
        utilityKey,
        utilityLabel: normalizeArchitecturalLayerLabel(record.utilityCategory || record.utility || utilitySystems[0] || ''),
        utilitySystems,
        buildingId: String(record.buildingId || record.building_id || '').trim(),
        buildingIds,
        areaId: String(record.areaId || record.area_id || record.mapId || record.map_id || '').trim(),
        areaIds,
        areaNames,
        buildingName: String(record.buildingName || record.building || '').trim(),
        areaName: String(record.areaName || record.location || '').trim(),
        year: Number.parseInt(record.year || record.sheetYear || record.documentYear, 10) || null,
        pageCount: Number.parseInt(record.pageCount || record.pages || record.sheetCount, 10) || null,
        sourceLabel: String(record.sourceLabel || record.source || '').trim(),
        sourceType: String(record.sourceType || '').trim(),
        exists: record.exists !== false,
        utilityCategory: /electrical|plumbing|mechanical|hvac|life safety|low voltage/i.test(`${layer} ${record.utilityCategory || record.utility || ''}`) ? 'Utility' : '',
        keywords,
        layerLabel: layer,
        recommendationScore: Number.isFinite(Number(record.recommendationScore)) ? Number(record.recommendationScore) : null,
        recommendationReasons: uniqueValues(record.recommendationReasons || [])
    };
};

const normalizeArchitecturalPayload = (payload = {}) => {
    const recordEntries = [
        ...(Array.isArray(payload.records) ? payload.records : []),
        ...(Array.isArray(payload.documents) ? payload.documents : []),
        ...(Array.isArray(payload.items) ? payload.items : []),
        ...(Array.isArray(payload.files) ? payload.files : [])
    ];
    const records = recordEntries.map(normalizeArchitecturalRecord);
    const layerSource = Array.isArray(payload.layers) && payload.layers.length > 0
        ? payload.layers
        : uniqueValues(records.map((record) => record.layerLabel));
    const layers = layerSource.map((layer) => {
        const rawLabel = typeof layer === 'string'
            ? layer
            : String(layer?.label || layer?.name || layer?.layer || layer?.title || '').trim();
        const label = normalizeArchitecturalLayerLabel(rawLabel);
        const normalizedKey = slugify(String(layer?.key || rawLabel || label || ''));
        const count = typeof layer === 'object' && Number.isFinite(Number(layer?.count))
            ? Number(layer.count)
            : records.filter((record) => record.layerKey === normalizedKey).length;
        return {
            id: String(layer?.id || normalizedKey || slugify(rawLabel)).trim(),
            label,
            key: normalizedKey || slugify(rawLabel),
            count
        };
    }).filter((layer) => layer.label);

    const systemSource = Array.isArray(payload.systems) && payload.systems.length > 0
        ? payload.systems
        : uniqueValues(records.flatMap((record) => record.utilitySystems));
    const systems = systemSource.map((system) => {
        const rawLabel = typeof system === 'string'
            ? system
            : String(system?.label || system?.name || system?.system || system?.key || '').trim();
        const label = normalizeArchitecturalLayerLabel(rawLabel);
        const normalizedKey = slugify(String(system?.key || rawLabel || label || ''));
        const count = typeof system === 'object' && Number.isFinite(Number(system?.count))
            ? Number(system.count)
            : records.filter((record) => (
                record.utilitySystems.some((entry) => normalizeArchitecturalLayerLabel(entry) === label || slugify(entry) === normalizedKey)
                || normalizeArchitecturalLayerLabel(record.utilityLabel) === label
            )).length;
        return {
            id: String(system?.id || normalizedKey || slugify(rawLabel)).trim(),
            label,
            key: normalizedKey || slugify(rawLabel),
            count
        };
    }).filter((system) => system.label);

    const areaSource = Array.isArray(payload.areas) && payload.areas.length > 0
        ? payload.areas
        : uniqueValues(records.flatMap((record) => (record.areaNames.length ? record.areaNames : [record.areaName || record.areaId])));
    const areas = areaSource.map((area) => {
        const rawLabel = typeof area === 'string'
            ? area
            : String(area?.label || area?.name || area?.areaName || area?.id || '').trim();
        const label = rawLabel || 'Unassigned';
        const normalizedKey = slugify(String(area?.key || area?.id || rawLabel || ''));
        const count = typeof area === 'object' && Number.isFinite(Number(area?.count))
            ? Number(area.count)
            : records.filter((record) => (
                record.areaIds.includes(String(area?.id || '').trim())
                || record.areaNames.some((name) => normalizeText(name) === normalizeText(label))
                || normalizeText(record.areaName) === normalizeText(label)
            )).length;
        return {
            id: String(area?.id || normalizedKey || slugify(rawLabel)).trim(),
            label,
            key: normalizedKey || slugify(rawLabel),
            count
        };
    }).filter((area) => area.label);

    const summary = payload.summary || payload.stats || {
        recordCount: records.length,
        layerCount: layers.length,
        systemCount: systems.length,
        areaCount: areas.length,
        buildingCount: uniqueValues(records.map((record) => record.buildingId || record.buildingName)).length,
        utilityCount: records.filter((record) => record.utilityCategory).length
    };

    return {
        ...payload,
        records,
        layers,
        systems,
        areas,
        summary,
        stats: summary,
        buildings: Array.isArray(payload.buildings) ? payload.buildings : [],
        utilities: Array.isArray(payload.utilities) ? payload.utilities : []
    };
};

const architecturalRecordMatchesArea = (record = {}, area = {}) => {
    const areaId = String(area?.id || '').trim();
    const areaName = String(area?.name || '').trim().toLowerCase();
    const buildingId = String(area?.buildingId || '').trim();
    const mapId = String(area?.mapId || area?.id || '').trim();
    const recordAreaIds = uniqueValues([record.areaId, record.areaIds, record.buildingId, record.buildingIds]);
    const recordAreaNames = uniqueValues([record.areaName, record.areaNames, record.buildingName]);
    const recordNames = [record.title, record.fileName, record.summary, record.notes, ...recordAreaNames]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
    if (recordAreaIds.includes(areaId) || recordAreaIds.includes(mapId) || recordAreaIds.includes(buildingId)) return true;
    if (recordAreaNames.some((name) => normalizeText(name) === normalizeText(areaName))) return true;
    if (areaName && recordNames.includes(areaName)) return true;
    if (areaId && recordNames.includes(areaId.toLowerCase())) return true;
    return false;
};

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
    const [ticketRecommendations, setTicketRecommendations] = useState([]);
    const [ticketRecommendationsLoading, setTicketRecommendationsLoading] = useState(false);
    const [ticketRecommendationsError, setTicketRecommendationsError] = useState('');
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

    const [architecturalOverview, setArchitecturalOverview] = useState({
        records: [],
        layers: [],
        systems: [],
        areas: [],
        summary: {
            recordCount: 0,
            layerCount: 0,
            systemCount: 0,
            areaCount: 0,
            buildingCount: 0,
            utilityCount: 0
        },
        stats: {
            recordCount: 0,
            layerCount: 0,
            systemCount: 0,
            areaCount: 0,
            buildingCount: 0,
            utilityCount: 0
        },
        buildings: [],
        utilities: []
    });
    const [architecturalOverviewLoading, setArchitecturalOverviewLoading] = useState(true);
    const [architecturalOverviewError, setArchitecturalOverviewError] = useState('');
    const [architecturalAreaRecords, setArchitecturalAreaRecords] = useState({});
    const [architecturalAreaLoading, setArchitecturalAreaLoading] = useState(false);

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
        if (queryTab && ['tickets', 'map', 'vendors', 'records', 'needs'].includes(queryTab)) {
            setActiveTab(queryTab);
            return;
        }
        const storedTab = sessionStorage.getItem('bgActiveTab');
        if (storedTab && ['tickets', 'map', 'vendors', 'records', 'needs'].includes(storedTab)) {
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

    useEffect(() => {
        let canceled = false;
        const loadArchitecturalOverview = async () => {
            setArchitecturalOverviewLoading(true);
            setArchitecturalOverviewError('');
            try {
                const payload = await fetchJsonWithFallback([
                    `${API_URL}/buildings/records/overview`,
                    '/api/buildings/records/overview'
                ]);
                if (!canceled) {
                    setArchitecturalOverview(normalizeArchitecturalPayload(payload));
                }
            } catch (error) {
                console.error('Failed to load architectural records:', error);
                if (!canceled) {
                    setArchitecturalOverview({
                        records: [],
                        layers: [],
                        systems: [],
                        areas: [],
                        summary: {
                            recordCount: 0,
                            layerCount: 0,
                            systemCount: 0,
                            areaCount: 0,
                            buildingCount: 0,
                            utilityCount: 0
                        },
                        stats: {
                            recordCount: 0,
                            layerCount: 0,
                            systemCount: 0,
                            areaCount: 0,
                            buildingCount: 0,
                            utilityCount: 0
                        },
                        buildings: [],
                        utilities: []
                    });
                    setArchitecturalOverviewError('Unable to load architectural records.');
                }
            } finally {
                if (!canceled) {
                    setArchitecturalOverviewLoading(false);
                }
            }
        };

        loadArchitecturalOverview();
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

    const baseMapAreas = useMemo(() => {
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

    const architecturalAreaCounts = useMemo(() => {
        const counts = {};
        const records = architecturalOverview.records || [];
        baseMapAreas.forEach((area) => {
            counts[area.id] = records.filter((record) => architecturalRecordMatchesArea(record, area)).length;
        });
        return counts;
    }, [architecturalOverview.records, baseMapAreas]);

    const mapAreas = useMemo(() => (
        baseMapAreas.map((area) => ({
            ...area,
            architecturalRecordCount: architecturalAreaCounts[area.id] || 0
        }))
    ), [architecturalAreaCounts, baseMapAreas]);

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

    const activeArchitecturalRecords = useMemo(() => {
        const areaId = activeDetails?.id;
        if (!areaId) return [];
        const cached = architecturalAreaRecords[areaId];
        if (cached?.records) return cached.records;
        const baseArea = baseMapAreas.find((area) => area.id === areaId) || activeDetails;
        if (!baseArea) return [];
        return (architecturalOverview.records || []).filter((record) => architecturalRecordMatchesArea(record, baseArea));
    }, [activeDetails, architecturalAreaRecords, architecturalOverview.records, baseMapAreas]);

    const activeArchitecturalLayers = useMemo(() => uniqueValues(
        activeArchitecturalRecords.map((record) => record.layerLabel || record.layer)
    ), [activeArchitecturalRecords]);

    const activeArchitecturalUtilities = useMemo(() => (
        activeArchitecturalRecords.filter((record) => record.utilityCategory || /electrical|plumbing|mechanical|hvac|life safety|low voltage/i.test(`${record.layerLabel || ''} ${record.summary || ''} ${record.title || ''}`))
    ), [activeArchitecturalRecords]);

    const activeArchitecturalSystems = useMemo(() => uniqueValues(
        activeArchitecturalRecords.flatMap((record) => record.utilitySystems || [])
    ), [activeArchitecturalRecords]);

    const activeArchitecturalSummary = useMemo(() => {
        const records = activeArchitecturalRecords;
        const layers = uniqueValues(records.map((record) => record.layerLabel || record.layer));
        return {
            recordCount: records.length,
            layerCount: layers.length,
            utilityCount: activeArchitecturalUtilities.length,
            systemCount: activeArchitecturalSystems.length
        };
    }, [activeArchitecturalRecords, activeArchitecturalUtilities, activeArchitecturalSystems]);

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

    useEffect(() => {
        const areaId = activeArea?.id;
        if (!areaId) {
            setArchitecturalAreaLoading(false);
            return;
        }
        if (architecturalAreaRecords[areaId]) return;

        let canceled = false;
        const loadArchitecturalArea = async () => {
            setArchitecturalAreaLoading(true);
            try {
                const payload = await fetchJsonWithFallback([
                    `${API_URL}/buildings/records/by-area/${encodeURIComponent(areaId)}`,
                    `/api/buildings/records/by-area/${encodeURIComponent(areaId)}`
                ]);
                if (!canceled) {
                    setArchitecturalAreaRecords((prev) => ({
                        ...prev,
                        [areaId]: normalizeArchitecturalPayload(payload)
                    }));
                }
            } catch (error) {
                console.error('Failed to load architectural area records:', error);
                if (!canceled) {
                    setArchitecturalAreaRecords((prev) => ({
                        ...prev,
                        [areaId]: {
                            records: [],
                            layers: [],
                            systems: [],
                            areas: [],
                            summary: {
                                recordCount: 0,
                                layerCount: 0,
                                systemCount: 0,
                                areaCount: 0,
                                buildingCount: 0,
                                utilityCount: 0
                            },
                            stats: {
                                recordCount: 0,
                                layerCount: 0,
                                systemCount: 0,
                                areaCount: 0,
                                buildingCount: 0,
                                utilityCount: 0
                            },
                            buildings: [],
                            utilities: []
                        }
                    }));
                }
            } finally {
                if (!canceled) {
                    setArchitecturalAreaLoading(false);
                }
            }
        };

        loadArchitecturalArea();
        return () => {
            canceled = true;
        };
    }, [activeArea?.id, architecturalAreaRecords]);

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
            (ticket.areas || []).includes(activeDetails.id) && ticket.status !== 'closed'
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
                    const firstActive = data.find((ticket) => ticket.status !== 'closed') || data[0];
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

    useEffect(() => {
        if (!selectedTicketId) {
            setTicketRecommendations([]);
            setTicketRecommendationsLoading(false);
            setTicketRecommendationsError('');
            return;
        }
        let canceled = false;
        const loadTicketRecommendations = async () => {
            setTicketRecommendationsLoading(true);
            setTicketRecommendationsError('');
            try {
                const payload = await fetchJsonWithFallback([
                    `${API_URL}/tickets/${encodeURIComponent(selectedTicketId)}/recommendations`,
                    `/api/tickets/${encodeURIComponent(selectedTicketId)}/recommendations`
                ]);
                if (!payload?.ok) throw new Error(payload?.error || 'Failed to load recommendations');
                if (!canceled) {
                    setTicketRecommendations(
                        (Array.isArray(payload.recommendations) ? payload.recommendations : []).map(normalizeArchitecturalRecord)
                    );
                }
            } catch (error) {
                console.error('Failed to load ticket recommendations:', error);
                if (!canceled) {
                    setTicketRecommendations([]);
                    setTicketRecommendationsError('Unable to load suggested architectural sheets.');
                }
            } finally {
                if (!canceled) {
                    setTicketRecommendationsLoading(false);
                }
            }
        };
        loadTicketRecommendations();
        return () => {
            canceled = true;
        };
    }, [selectedTicketId]);

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
        ticketRecommendations,
        ticketRecommendationsLoading,
        ticketRecommendationsError,
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
        architecturalOverview,
        architecturalOverviewLoading,
        architecturalOverviewError,
        architecturalAreaRecords,
        architecturalAreaLoading,
        activeArchitecturalRecords,
        activeArchitecturalLayers,
        activeArchitecturalUtilities,
        activeArchitecturalSystems,
        activeArchitecturalSummary,
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
