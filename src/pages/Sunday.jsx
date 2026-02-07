import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, format, isSameDay, parseISO } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { ROLE_DEFINITIONS } from '../models/roles';
import { clearLiturgicalCache, getFollowingSunday, getLiturgicalDay, getNextSunday, getPreviousSunday, getServicesByDate } from '../services/liturgicalService';
import { getSundayDetails, saveSundayDetails } from '../services/sundayDetails';
import { useEvents } from '../context/EventsContext';
import { FaFolderOpen, FaYoutube, FaUpload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import './Sunday.css';
import './People.css';

const serializeDate = (date) => date.toISOString().slice(0, 10);
const toDateKey = (date) => (date ? date.toISOString().slice(0, 10) : '');

const bulletinOptions = ['Not Started', 'draft', 'review', 'ready', 'printed'];
const insertOptions = ['Not Started', 'draft', 'review', 'ready', 'printed', 'stuffed'];

const resolveBulletinStatusFromDoc = (doc) => {
    if (!doc?.exists) return 'Not Started';
    const raw = String(doc.status || '').toLowerCase().trim();
    if (!raw) return 'draft';
    if (raw === 'not_started') return 'Not Started';
    if (raw === 'final') return 'ready';
    return raw;
};

const normalizeStatusLabel = (value) => {
    const raw = String(value || '').toLowerCase().trim();
    if (!raw || raw === 'not_started') return 'Not Started';
    if (raw === 'final') return 'ready';
    return raw;
};

const getStatusPillClass = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'not started' || normalized === 'not_started') return 'pill-neutral';
    if (normalized === 'review') return 'status-reviewed';
    if (normalized === 'draft') return 'status-in_process';
    if (normalized === 'ready' || normalized === 'printed') return 'status-closed';
    return 'pill-neutral';
};

const apiRoleKeys = new Set([
    'celebrant',
    'preacher',
    'lector',
    'organist',
    'lem',
    'acolyte',
    'usher',
    'sound',
    'coffeeHour',
    'childcare'
]);

const roleToApiField = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    lector: 'lector',
    organist: 'organist',
    lem: 'lem',
    acolyte: 'acolyte',
    usher: 'usher',
    sound: 'sound',
    coffeeHour: 'coffeeHour',
    childcare: 'childcare'
};

const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist'];
const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];
const MULTI_ASSIGNMENT_ROLES = new Set(['lector', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare']);
const isEightAmService = (time = '') => /^0?8:/.test(time.trim());
const getServiceRoleKeys = (service) => (isEightAmService(service?.time || '') ? EIGHT_AM_ROLE_KEYS : TEN_AM_ROLE_KEYS);
const formatServiceTime = (time) => {
    const trimmed = (time || '').trim();
    if (trimmed.startsWith('08')) return '8:00 AM';
    if (trimmed.startsWith('10')) return '10 AM';
    return trimmed || 'Service';
};

const defaultLocationForTime = (time) => (isEightAmService(time) ? 'chapel' : 'sanctuary');

const roleLabel = (key) => ROLE_DEFINITIONS.find((role) => role.key === key)?.label || key;

const HGK_DEFAULT_ITEMS = [
    'Bread',
    'Peanut Butter',
    'Jelly',
    'Chips (box)',
    'Granola Bars (box)',
    'Oranges',
    'Rice Krispie Treats (box)',
    'Water',
    'Lunch Bags',
    'Sandwich Bags',
    'Gloves',
    'Napkins'
];

const HGK_STATUS_OPTIONS = ['needed', 'ordered', 'received'];

const HGK_STATUS_LABELS = {
    needed: 'Needed',
    ordered: 'Ordered',
    received: 'Received'
};

const buildHgkSupplyList = (rawItems = [], knownNames = []) => {
    const legacyNameMap = {
        'chips': 'Chips (box)',
        'granola bars': 'Granola Bars (box)',
        'rice krispie treats': 'Rice Krispie Treats (box)'
    };
    const normalizedRawItems = Array.isArray(rawItems)
        ? rawItems.reduce((acc, item) => {
            const originalName = String(item?.item_name || '').trim();
            if (!originalName) return acc;
            const mappedName = legacyNameMap[originalName.toLowerCase()] || originalName;
            const key = mappedName.toLowerCase();
            const existing = acc.get(key);
            if (!existing) {
                acc.set(key, { ...item, item_name: mappedName });
            } else {
                const next = {
                    ...existing,
                    item_name: mappedName,
                    quantity: existing.quantity || item?.quantity || '',
                    notes: existing.notes || item?.notes || '',
                    status: existing.status || item?.status
                };
                acc.set(key, next);
            }
            return acc;
        }, new Map())
        : new Map();
    const normalizedItems = Array.from(normalizedRawItems.values());
    const normalizedNames = Array.isArray(knownNames)
        ? knownNames.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
    const fallbackNames = normalizedNames.length > 0 ? normalizedNames : HGK_DEFAULT_ITEMS.slice();
    const extraNames = normalizedItems.length > 0
        ? normalizedItems
            .map((item) => String(item?.item_name || '').trim())
            .filter((name) => name && !fallbackNames.some((existing) => existing.toLowerCase() === name.toLowerCase()))
        : [];
    const mergedNames = [...fallbackNames, ...extraNames];
    const itemMap = new Map();
    normalizedItems.forEach((item) => {
        const key = String(item?.item_name || '').trim().toLowerCase();
        if (!key) return;
        itemMap.set(key, item);
    });

    return mergedNames.map((name) => {
        const key = name.toLowerCase();
        const existing = itemMap.get(key) || {};
        const statusValue = HGK_STATUS_OPTIONS.includes(existing.status)
            ? existing.status
            : HGK_STATUS_OPTIONS[0];
        return {
            id: existing.id || null,
            item_name: name,
            quantity: existing.quantity || '',
            notes: existing.notes || '',
            status: statusValue
        };
    });
};

const Sunday = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { events } = useEvents();
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [details, setDetails] = useState(getSundayDetails(null));
    const [roleDrafts, setRoleDrafts] = useState({});
    const [locationDrafts, setLocationDrafts] = useState({});
    const [people, setPeople] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [openMenu, setOpenMenu] = useState(null);
    const [openTooltipKey, setOpenTooltipKey] = useState(null);
    const [menuDirection, setMenuDirection] = useState('up');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [livestreamUrl, setLivestreamUrl] = useState('');
    const [livestreamError, setLivestreamError] = useState('');
    const [docsLoading, setDocsLoading] = useState(false);
    const [docRefreshLoading, setDocRefreshLoading] = useState({
        bulletin10: false,
        bulletin8: false,
        insert: false
    });
    const [uploadingBulletin, setUploadingBulletin] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [bulletinDoc, setBulletinDoc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [bulletin8Doc, setBulletin8Doc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [insertDoc, setInsertDoc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [statusDrafts, setStatusDrafts] = useState({});
    const [statusExpandedKey, setStatusExpandedKey] = useState(null);
    const [bulletinPrintCopies, setBulletinPrintCopies] = useState({ bulletin10: 1, bulletin8: 1, insert: 1 });
    const [selectedEventId, setSelectedEventId] = useState(null);
    const [hgkItemNames, setHgkItemNames] = useState([]);
    const [hgkRawSupplies, setHgkRawSupplies] = useState([]);
    const [hgkSupplyRequest, setHgkSupplyRequest] = useState(null);
    const [hgkSupplyMonth, setHgkSupplyMonth] = useState('');
    const [hgkSupplies, setHgkSupplies] = useState([]);
    const [hgkSupplyLoading, setHgkSupplyLoading] = useState(false);
    const [hgkSupplySaving, setHgkSupplySaving] = useState(false);
    const [hgkSupplyError, setHgkSupplyError] = useState('');
    const [hgkInstacartBusy, setHgkInstacartBusy] = useState(false);
    const [hgkNotes, setHgkNotes] = useState('');
    const [hgkEmailInput, setHgkEmailInput] = useState('');
    const [hgkEmailBusy, setHgkEmailBusy] = useState(false);
    const [hgkSearchBusy, setHgkSearchBusy] = useState(false);
    const [sundayTemplates, setSundayTemplates] = useState([]);
    const [sundayTasks, setSundayTasks] = useState([]);

    const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
    const peopleByName = useMemo(() => {
        const map = new Map();
        people.forEach((person) => {
            if (person?.displayName) map.set(person.displayName.toLowerCase(), person);
        });
        return map;
    }, [people]);

    const loadSunday = useCallback(async (date) => {
        if (!date) return;
        setLoading(true);
        setError('');
        try {
            const [litInfo, svcData] = await Promise.all([
                getLiturgicalDay(date),
                getServicesByDate(date)
            ]);
            const stored = getSundayDetails(date);
            const drafts = {};
            const locationMap = {};
            svcData.forEach((service) => {
                const roleValues = {};
                const serviceRoleKeys = getServiceRoleKeys(service);
                serviceRoleKeys.forEach((roleKey) => {
                    const rosterPeople = service.roster?.[roleKey]?.people || [];
                    const resolvedIds = rosterPeople
                        .map((person) => {
                            if (!person) return '';
                            if (peopleById.has(person.id)) return person.id;
                            const byName = peopleByName.get((person.displayName || '').toLowerCase());
                            return byName?.id || '';
                        })
                        .filter(Boolean);
                    const eligibleIds = resolvedIds.filter((id) => {
                        const person = peopleById.get(id);
                        return person && (person.roles || []).includes(roleKey);
                    });

                    roleValues[roleKey] = MULTI_ASSIGNMENT_ROLES.has(roleKey)
                        ? eligibleIds
                        : (eligibleIds[0] || '');
                });
                drafts[service.time] = roleValues;
                locationMap[service.time] = service.location || defaultLocationForTime(service.time);
            });

            setCurrentDate(date);
            setLiturgicalInfo(litInfo);
            setServices(svcData);
            setDetails(stored);
            setRoleDrafts(drafts);
            setLocationDrafts(locationMap);
        } catch (err) {
            console.error(err);
            setError('Unable to load Sunday details.');
        } finally {
            setLoading(false);
        }
    }, [peopleById, peopleByName]);

    const loadSundayTasks = useCallback(async (date) => {
        if (!date) return;
        try {
            const dateStr = serializeDate(date);
            const params = new URLSearchParams({
                origin_type: 'sunday',
                origin_id: dateStr
            });
            const response = await fetch(`${API_URL}/tasks?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to load Sunday tasks');
            const data = await response.json();
            setSundayTasks(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error(err);
            setSundayTasks([]);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const loadTemplates = async () => {
            try {
                const response = await fetch(`${API_URL}/recurring-templates?origin_type=sunday`);
                if (!response.ok) throw new Error('Failed to load templates');
                const data = await response.json();
                if (active) setSundayTemplates(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error(err);
                if (active) setSundayTemplates([]);
            }
        };
        loadTemplates();
        return () => {
            active = false;
        };
    }, []);

    const milestoneLists = useMemo(() => {
        if (!sundayTemplates.length) return [];
        const grouped = new Map();
        sundayTemplates.forEach((template) => {
            if (template.list_key === 'special-events') return;
            const key = template.list_key || template.id;
            if (!key) return;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    title: template.list_title || key,
                    steps: []
                });
            }
            grouped.get(key).steps.push(template);
        });
        return Array.from(grouped.values()).map((list) => ({
            ...list,
            steps: list.steps
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((step) => ({
                    key: step.step_key,
                    title: step.title,
                    dueOffset: step.due_offset_days
                }))
        }));
    }, [sundayTemplates]);

    const milestoneListsWithDates = useMemo(() => {
        if (!currentDate) return milestoneLists;
        return milestoneLists.map((list) => ({
            ...list,
            steps: list.steps.map((step) => ({
                ...step,
                dueDate: typeof step.dueOffset === 'number'
                    ? addDays(currentDate, step.dueOffset)
                    : null
            }))
        }));
    }, [milestoneLists, currentDate]);

    const ensureBulletinDocTasks = useCallback(async () => {
        if (!currentDate) return;
        const bulletinList = milestoneListsWithDates.find((list) => list.key === 'bulletins');
        if (!bulletinList) return;
        const existingKeys = new Set(sundayTasks.map((task) => String(task?.list_key || '').toLowerCase()));
        const targets = [
            { key: 'bulletins-10am', label: 'Bulletins (10am)' },
            { key: 'bulletins-8am', label: 'Bulletins (8am)' }
        ];
        const missing = targets.filter((target) => !existingKeys.has(target.key));
        if (!missing.length) return;

        const steps = bulletinList.steps.map((step, index) => ({
            key: step.key,
            title: step.title,
            sort_order: index + 1,
            due_offset_days: step.dueOffset ?? null
        }));
        const maxOffset = steps.reduce((max, step) => (
            Number.isFinite(Number(step.due_offset_days))
                ? Math.max(max, Number(step.due_offset_days))
                : max
        ), 0);
        const dueAt = addDays(currentDate, maxOffset || 0).toISOString().slice(0, 10);
        const dateStr = serializeDate(currentDate);

        await Promise.all(missing.map((target) => (
            fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: target.label,
                    source_type: 'sunday',
                    source_id: dateStr,
                    source_event: target.key,
                    task_type: 'sunday',
                    due_at: dueAt,
                    list_key: target.key,
                    list_title: target.label,
                    list_mode: 'progressive',
                    progress_steps: steps
                })
            })
        )));

        await loadSundayTasks(currentDate);
    }, [currentDate, milestoneListsWithDates, sundayTasks, loadSundayTasks]);

    const sundayTaskMap = useMemo(() => {
        const map = new Map();
        sundayTasks.forEach((task) => {
            const key = String(task?.list_key || '').trim();
            if (!key) return;
            if (!map.has(key)) {
                map.set(key, task);
                return;
            }
            const existing = map.get(key);
            const existingProg = String(existing?.list_mode || '').toLowerCase() === 'progressive';
            const nextProg = String(task?.list_mode || '').toLowerCase() === 'progressive';
            if (!existingProg && nextProg) {
                map.set(key, task);
            }
        });
        return map;
    }, [sundayTasks]);

    const resolveMilestoneListKey = useCallback((listKey, statusKey) => {
        const rawStatus = String(statusKey || '').toLowerCase();
        if (rawStatus === 'bulletins-10am' || rawStatus === 'bulletins-8am') {
            return rawStatus;
        }
        if (rawStatus.startsWith('bulletins')) return 'bulletins';
        return listKey || statusKey || '';
    }, []);

    const getMilestoneTask = useCallback((list, statusKey) => {
        const key = resolveMilestoneListKey(list?.key, statusKey);
        if (!key) return null;
        return sundayTaskMap.get(key) || null;
    }, [resolveMilestoneListKey, sundayTaskMap]);

    const updateMilestoneTask = useCallback(async (taskId, stepKey) => {
        if (!taskId) return;
        try {
            const response = await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress_key: stepKey || '' })
            });
            if (!response.ok) throw new Error('Failed to update task progress');
            const updated = await response.json();
            setSundayTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
        } catch (err) {
            console.error(err);
        }
    }, []);

    const setMilestoneStatus = (listKey, stepKey, statusKey = listKey) => {
        const task = getMilestoneTask({ key: listKey }, statusKey);
        if (!task) return;
        updateMilestoneTask(task.id, stepKey);
    };

    const clearMilestoneStatus = (listKey, statusKey = listKey) => {
        const task = getMilestoneTask({ key: listKey }, statusKey);
        if (!task) return;
        updateMilestoneTask(task.id, '');
    };

    const statusToStepKey = (status) => {
        const normalized = String(status || '').toLowerCase().trim();
        if (!normalized || normalized === 'not started' || normalized === 'not_started') return '';
        if (normalized === 'draft') return 'draft';
        if (normalized === 'review') return 'review';
        if (normalized === 'ready' || normalized === 'final' || normalized === 'finalize') return 'finalize';
        if (normalized === 'printed' || normalized === 'print') return 'print';
        if (normalized === 'stuffed' || normalized === 'stuff') return 'stuff';
        return '';
    };

    const syncMilestoneFromStatus = useCallback((listKey, statusKey, statusValue) => {
        const stepKey = statusToStepKey(statusValue);
        const task = getMilestoneTask({ key: listKey }, statusKey);
        if (!task) return;
        updateMilestoneTask(task.id, stepKey);
    }, [getMilestoneTask, updateMilestoneTask]);

    const updateDateParam = useCallback((date) => {
        navigate(`/sunday?date=${serializeDate(date)}`);
    }, [navigate]);

    useEffect(() => {
        let active = true;
        const loadPeople = async () => {
            try {
                const response = await fetch(`${API_URL}/people`);
                if (!response.ok) throw new Error('Failed to load people');
                const data = await response.json();
                if (active) {
                    setPeople(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                console.error(err);
                if (active) setPeople([]);
            }
        };
        loadPeople();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const loadBuildings = async () => {
            try {
                const response = await fetch(`${API_URL}/buildings`);
                if (!response.ok) throw new Error('Failed to load buildings');
                const data = await response.json();
                if (active) {
                    setBuildings(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                console.error(err);
                if (active) setBuildings([]);
            }
        };
        loadBuildings();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const loadHgkItems = async () => {
            try {
                const response = await fetch(`${API_URL}/hgk/items`);
                if (!response.ok) throw new Error('Failed to load HGK supply items');
                const data = await response.json();
                if (!active) return;
                const items = Array.isArray(data) && data.length > 0 ? data : HGK_DEFAULT_ITEMS;
                setHgkItemNames(items);
            } catch (err) {
                console.error(err);
                if (active) setHgkItemNames(HGK_DEFAULT_ITEMS);
            }
        };
        loadHgkItems();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!openMenu) return;
        const timer = setTimeout(() => {
            const key = `${openMenu.serviceTime}-${openMenu.roleKey}`;
            const menu = document.querySelector(`[data-menu-key="${key}"]`);
            if (!menu) return;
            const rect = menu.getBoundingClientRect();
            const menuHeight = rect.height;
            const trigger = menu.parentElement?.getBoundingClientRect();
            if (!trigger) return;
            const spaceBelow = window.innerHeight - trigger.bottom;
            const spaceAbove = trigger.top;
            if (spaceAbove >= menuHeight) {
                setMenuDirection('up');
            } else if (spaceBelow >= menuHeight) {
                setMenuDirection('down');
            } else {
                setMenuDirection('up');
            }
        }, 0);
        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-menu') || target.closest('.role-menu-trigger')) return;
            setOpenMenu(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [openMenu]);

    useEffect(() => {
        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-tooltip') || target.closest('.person-chip-wrapper')) return;
            setOpenTooltipKey(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, []);

    useEffect(() => {
        const paramDate = searchParams.get('date');
        if (paramDate) {
            loadSunday(parseISO(paramDate));
            return;
        }
        getNextSunday().then((nextDate) => {
            if (nextDate) {
                updateDateParam(nextDate);
            }
        });
    }, [loadSunday, searchParams, updateDateParam]);

    useEffect(() => {
        if (!currentDate || people.length === 0) return;
        loadSunday(currentDate);
    }, [currentDate, loadSunday, people.length]);

    useEffect(() => {
        if (!currentDate) return;
        loadSundayTasks(currentDate);
    }, [currentDate, loadSundayTasks]);

    useEffect(() => {
        if (!currentDate || sundayTasks.length === 0 || milestoneListsWithDates.length === 0) return;
        ensureBulletinDocTasks();
    }, [currentDate, sundayTasks.length, milestoneListsWithDates, ensureBulletinDocTasks]);

    useEffect(() => {
        if (!currentDate) return;
        const loadLivestream = async () => {
            try {
                const dateStr = serializeDate(currentDate);
                const response = await fetch(`${API_URL}/sunday/livestream?date=${dateStr}`);
                if (!response.ok) throw new Error('Failed to load livestream');
                const data = await response.json();
                setLivestreamUrl(data?.url || '');
                setLivestreamError('');
            } catch (err) {
                console.error(err);
                setLivestreamUrl('');
                setLivestreamError('Unable to load livestream link.');
            }
        };
        loadLivestream();
    }, [currentDate]);


    const loadDocs = useCallback(async () => {
        if (!currentDate) return;
        setDocsLoading(true);
        try {
            const dateStr = serializeDate(currentDate);
            const name = liturgicalInfo?.name || liturgicalInfo?.feast || '';
            const cachedDetails = getSundayDetails(currentDate);
            setBulletinDoc((prev) => ({
                ...prev,
                preview: cachedDetails.bulletinPreview10 || prev.preview || ''
            }));
            setBulletin8Doc((prev) => ({
                ...prev,
                preview: cachedDetails.bulletinPreview8 || prev.preview || ''
            }));
            setInsertDoc((prev) => ({
                ...prev,
                preview: cachedDetails.insertPreview || prev.preview || ''
            }));

            const response = await fetch(`${API_URL}/sunday/documents?date=${dateStr}&name=${encodeURIComponent(name)}&preview=0`);
            if (!response.ok) throw new Error('Failed to load document status');
            const data = await response.json();
            const bulletin10Exists = !!data?.bulletin10?.exists;
            const bulletin8Exists = !!data?.bulletin8?.exists;
            const insertExists = !!data?.insert?.exists;
            setBulletinDoc((prev) => ({
                ...(data?.bulletin10 || {}),
                preview: bulletin10Exists
                    ? (cachedDetails.bulletinPreview10 || prev.preview || '')
                    : ''
            }));
            setBulletin8Doc((prev) => ({
                ...(data?.bulletin8 || {}),
                preview: bulletin8Exists
                    ? (cachedDetails.bulletinPreview8 || prev.preview || '')
                    : ''
            }));
            setInsertDoc((prev) => ({
                ...(data?.insert || {}),
                preview: insertExists
                    ? (cachedDetails.insertPreview || prev.preview || '')
                    : ''
            }));

            setDetails((prev) => {
                const next = {
                    ...prev,
                    bulletinPreview10: bulletin10Exists ? (cachedDetails.bulletinPreview10 || prev.bulletinPreview10 || '') : '',
                    bulletinPreview8: bulletin8Exists ? (cachedDetails.bulletinPreview8 || prev.bulletinPreview8 || '') : '',
                    insertPreview: insertExists ? (cachedDetails.insertPreview || prev.insertPreview || '') : ''
                };
                if (currentDate) {
                    saveSundayDetails(currentDate, next);
                }
                return next;
            });
            setStatusDrafts((prev) => ({
                ...prev,
                bulletin10: null,
                bulletin8: null
            }));

            const needsPreview = (bulletin10Exists && !(cachedDetails.bulletinPreview10 || ''))
                || (bulletin8Exists && !(cachedDetails.bulletinPreview8 || ''))
                || (insertExists && !(cachedDetails.insertPreview || ''));
            if (needsPreview) {
                fetch(`${API_URL}/sunday/documents?date=${dateStr}&name=${encodeURIComponent(name)}&preview=1`)
                    .then((previewResponse) => (previewResponse.ok ? previewResponse.json() : null))
                    .then((previewData) => {
                        if (!previewData) return;
                        const nextBulletin10Preview = previewData?.bulletin10?.exists
                            ? (previewData?.bulletin10?.preview || '')
                            : '';
                        const nextBulletin8Preview = previewData?.bulletin8?.exists
                            ? (previewData?.bulletin8?.preview || '')
                            : '';
                        const nextInsertPreview = previewData?.insert?.exists
                            ? (previewData?.insert?.preview || '')
                            : '';
                        setBulletinDoc((prev) => ({ ...prev, preview: nextBulletin10Preview }));
                        setBulletin8Doc((prev) => ({ ...prev, preview: nextBulletin8Preview }));
                        setInsertDoc((prev) => ({ ...prev, preview: nextInsertPreview }));
                        setDetails((prev) => {
                            const next = {
                                ...prev,
                                bulletinPreview10: nextBulletin10Preview || prev.bulletinPreview10 || '',
                                bulletinPreview8: nextBulletin8Preview || prev.bulletinPreview8 || '',
                                insertPreview: nextInsertPreview || prev.insertPreview || ''
                            };
                            if (currentDate) {
                                saveSundayDetails(currentDate, next);
                            }
                            return next;
                        });
                    })
                    .catch(() => {});
            }
        } catch (err) {
            console.error(err);
            // Keep last known state on error to avoid flicker.
        } finally {
            setDocsLoading(false);
        }
    }, [currentDate, liturgicalInfo?.feast, liturgicalInfo?.name, syncMilestoneFromStatus]);

    const refreshDocPreviews = useCallback(async (docKey) => {
        if (!currentDate) return;
        if (docKey) {
            setDocRefreshLoading((prev) => ({ ...prev, [docKey]: true }));
        } else {
            setDocsLoading(true);
        }
        try {
            const dateStr = serializeDate(currentDate);
            const name = liturgicalInfo?.name || liturgicalInfo?.feast || '';
            const docParam = docKey ? `&doc=${encodeURIComponent(docKey)}` : '';
            const previewResponse = await fetch(`${API_URL}/sunday/documents?date=${dateStr}&name=${encodeURIComponent(name)}&preview=1&forcePreview=1${docParam}`);
            if (!previewResponse.ok) throw new Error('Failed to refresh document previews');
            const previewData = await previewResponse.json();
            if (previewData?.bulletin10) {
                const nextBulletin10Preview = previewData?.bulletin10?.exists
                    ? (previewData?.bulletin10?.preview || '')
                    : '';
                setBulletinDoc((prev) => ({ ...prev, preview: nextBulletin10Preview }));
                setDetails((prev) => {
                    const next = {
                        ...prev,
                        bulletinPreview10: nextBulletin10Preview || prev.bulletinPreview10 || ''
                    };
                    if (currentDate) {
                        saveSundayDetails(currentDate, next);
                    }
                    return next;
                });
            }
            if (previewData?.bulletin8) {
                const nextBulletin8Preview = previewData?.bulletin8?.exists
                    ? (previewData?.bulletin8?.preview || '')
                    : '';
                setBulletin8Doc((prev) => ({ ...prev, preview: nextBulletin8Preview }));
                setDetails((prev) => {
                    const next = {
                        ...prev,
                        bulletinPreview8: nextBulletin8Preview || prev.bulletinPreview8 || ''
                    };
                    if (currentDate) {
                        saveSundayDetails(currentDate, next);
                    }
                    return next;
                });
            }
            if (previewData?.insert) {
                const nextInsertPreview = previewData?.insert?.exists
                    ? (previewData?.insert?.preview || '')
                    : '';
                setInsertDoc((prev) => ({ ...prev, preview: nextInsertPreview }));
                setDetails((prev) => {
                    const next = {
                        ...prev,
                        insertPreview: nextInsertPreview || prev.insertPreview || ''
                    };
                    if (currentDate) {
                        saveSundayDetails(currentDate, next);
                    }
                    return next;
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (docKey) {
                setDocRefreshLoading((prev) => ({ ...prev, [docKey]: false }));
            } else {
                setDocsLoading(false);
            }
        }
    }, [currentDate, liturgicalInfo?.feast, liturgicalInfo?.name]);

    const getPreviewLoading = (key) => docsLoading || docRefreshLoading[key];

    useEffect(() => {
        loadDocs();
    }, [loadDocs]);

    useEffect(() => {
        if (!currentDate) return undefined;
        const interval = window.setInterval(loadDocs, 30000);
        const handleFocus = () => loadDocs();
        window.addEventListener('focus', handleFocus);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [currentDate, loadDocs]);

    const handleNavigate = async (direction) => {
        if (!currentDate) return;
        const newDate = direction === 'prev'
            ? await getPreviousSunday(currentDate)
            : await getFollowingSunday(currentDate);
        updateDateParam(newDate);
    };

    const updateDetailField = (field, value) => {
        setDetails((prev) => ({ ...prev, [field]: value }));
        if (field === 'bulletinStatus10') {
            syncMilestoneFromStatus('bulletins', 'bulletins-10am', value);
        }
        if (field === 'bulletinStatus8') {
            syncMilestoneFromStatus('bulletins', 'bulletins-8am', value);
        }
        if (field === 'bulletinInsertStatus') {
            syncMilestoneFromStatus('insert', 'insert', value);
        }
    };

    const stepKeyToStatus = (stepKey) => {
        const normalized = String(stepKey || '').toLowerCase().trim();
        if (!normalized) return 'Not Started';
        if (normalized === 'draft') return 'draft';
        if (normalized === 'review') return 'review';
        if (normalized === 'finalize' || normalized === 'final') return 'ready';
        if (normalized === 'print' || normalized === 'printed') return 'printed';
        if (normalized === 'stuff' || normalized === 'stuffed') return 'stuffed';
        return normalized;
    };

    const getTaskStatusLabel = (listKey, statusKey, fallback) => {
        const task = getMilestoneTask({ key: listKey }, statusKey);
        if (!task) return fallback;
        return stepKeyToStatus(task.progress_key);
    };

    const updateRoleDraft = (serviceTime, roleKey, value) => {
        setRoleDrafts((prev) => {
            const nextValue = typeof value === 'function'
                ? value(prev[serviceTime]?.[roleKey])
                : value;
            return {
                ...prev,
                [serviceTime]: {
                    ...(prev[serviceTime] || {}),
                    [roleKey]: nextValue
                }
            };
        });
    };

    const updateLocationDraft = (serviceTime, value) => {
        setLocationDrafts((prev) => ({
            ...prev,
            [serviceTime]: value
        }));
    };

    const toggleRoleMenu = (serviceTime, roleKey) => {
        setOpenMenu((prev) => {
            if (prev?.serviceTime === serviceTime && prev?.roleKey === roleKey) {
                return null;
            }
            return { serviceTime, roleKey };
        });
    };

    const getTeamMap = (roleKey, eligiblePeople) => {
        const teamMap = new Map();
        eligiblePeople.forEach((person) => {
            const teamList = person.teams?.[roleKey] || [];
            teamList.forEach((teamNumber) => {
                if (!teamMap.has(teamNumber)) teamMap.set(teamNumber, []);
                teamMap.get(teamNumber).push(person.id);
            });
        });
        return teamMap;
    };

    const toggleTeamSelection = (serviceTime, roleKey, teamMemberIds) => {
        updateRoleDraft(serviceTime, roleKey, (prevValue) => {
            const current = new Set(Array.isArray(prevValue) ? prevValue : (prevValue ? [prevValue] : []));
            const allSelected = teamMemberIds.every((id) => current.has(id));
            if (allSelected) {
                teamMemberIds.forEach((id) => current.delete(id));
            } else {
                teamMemberIds.forEach((id) => current.add(id));
            }
            return Array.from(current);
        });
    };

    const togglePersonSelection = (serviceTime, roleKey, personId, isMulti) => {
        if (isMulti) {
            updateRoleDraft(serviceTime, roleKey, (prevValue) => {
                const current = new Set(Array.isArray(prevValue) ? prevValue : (prevValue ? [prevValue] : []));
                if (current.has(personId)) {
                    current.delete(personId);
                } else {
                    current.add(personId);
                }
                return Array.from(current);
            });
            return;
        }
        updateRoleDraft(serviceTime, roleKey, personId);
        setOpenMenu(null);
    };

    const saveSunday = async () => {
        if (!currentDate) return;
        setSaving(true);
        setError('');
        try {
            const dateStr = serializeDate(currentDate);
            const requests = services.map((service) => {
                const payload = {
                    date: dateStr,
                    service_time: service.time || '10:00',
                    location: locationDrafts?.[service.time] || service.location || defaultLocationForTime(service.time)
                };
                const serviceRoleKeys = getServiceRoleKeys(service);
                serviceRoleKeys.forEach((roleKey) => {
                    if (!apiRoleKeys.has(roleKey)) return;
                    const draftValue = roleDrafts?.[service.time]?.[roleKey];
                    const selectedIds = Array.isArray(draftValue)
                        ? draftValue
                        : (draftValue ? [draftValue] : []);
                    payload[roleToApiField[roleKey]] = selectedIds.join(', ');
                });
                return fetch(`${API_URL}/schedule-roles`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            });

            const results = await Promise.all(requests);
            if (results.some((res) => !res.ok)) {
                throw new Error('Failed to save schedule updates');
            }
            saveSundayDetails(currentDate, details);
            clearLiturgicalCache();
        } catch (err) {
            console.error(err);
            setError('Unable to save Sunday updates.');
        } finally {
            setSaving(false);
        }
    };

    const openFileLocation = async (path) => {
        if (!path) return;
        try {
            await fetch(`${API_URL}/files/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const printFile = async (path, options = {}) => {
        if (!path) return;
        try {
            const response = await fetch(`${API_URL}/files/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, ...options })
            });
            if (!response.ok) throw new Error('Print failed');
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    };

    const handleUploadBulletin = async () => {
        if (!bulletinDoc?.path || uploadingBulletin) return;
        setUploadingBulletin(true);
        setUploadError('');
        try {
            const response = await fetch(`${API_URL}/bulletins/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: bulletinDoc.path })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Upload failed');
            }
            const data = await response.json();
            updateDetailField('bulletinUploaded', true);
            updateDetailField('bulletinUploadUrl', data?.url || '');
            updateDetailField('bulletinImageUrl', data?.imageUrl || '');
        } catch (err) {
            console.error(err);
            setUploadError('Upload failed.');
        } finally {
            setUploadingBulletin(false);
        }
    };

    const renderTooltipCard = (person) => {
        if (!person) return null;
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const phoneTag = tags.find((tag) => /^phone[:\-]/i.test(tag)) || tags.find((tag) => /^tel[:\-]/i.test(tag));
        const rawPhone = phoneTag ? phoneTag.replace(/^phone[:\-]\s*/i, '').replace(/^tel[:\-]\s*/i, '').trim() : '';
        const barePhoneTag = tags.find((tag) => !tag.startsWith('ext-') && /\d{3}[^0-9]?\d{3}[^0-9]?\d{4}/.test(tag || ''));
        const phoneLabel = rawPhone || barePhoneTag || (extensionTag ? `Ext ${extensionTag.replace(/^ext-/, '')}` : '');
        const titleTags = tags.filter((tag) => tag && tag !== extensionTag);
        const metaChips = [...titleTags, ...(extensionTag ? [extensionTag] : [])];

        return (
            <Card className="person-card tooltip-person-card">
                <div className="person-card__header">
                    <div className="person-main">
                        <div className="person-name">{person.displayName}</div>
                        {person.email && (
                            <a className="person-email" href={`mailto:${person.email}`}>
                                {person.email}
                            </a>
                        )}
                        {phoneLabel && (
                            <div className="person-phone">{phoneLabel}</div>
                        )}
                        {metaChips.length > 0 && (
                            <div className="meta-chip-row">
                                {metaChips.map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                        {tags.length > metaChips.length && (
                            <div className="tag-row">
                                {tags.filter((tag) => !metaChips.includes(tag)).map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="roles">
                    <span className="roles-label">Eligible roles</span>
                    <div className="role-chip-row">
                        {(person.roles || []).map((roleKey) => (
                            <span key={roleKey} className="role-chip">{roleLabel(roleKey)}</span>
                        ))}
                    </div>
                </div>
            </Card>
        );
    };

    const bulletin10Fallback = bulletinDoc?.exists
        ? normalizeStatusLabel(bulletinDoc.status || details.bulletinStatus10 || 'draft')
        : 'Not Started';
    const bulletin8Fallback = bulletin8Doc?.exists
        ? normalizeStatusLabel(bulletin8Doc.status || details.bulletinStatus8 || 'draft')
        : 'Not Started';
    const insertFallback = insertDoc.exists
        ? normalizeStatusLabel(insertDoc.status || details.bulletinInsertStatus || 'Not Started')
        : 'Not Started';
    const bulletin10Status = getTaskStatusLabel('bulletins', 'bulletins-10am', bulletin10Fallback);
    const bulletin8Status = getTaskStatusLabel('bulletins', 'bulletins-8am', bulletin8Fallback);
    const insertStatus = getTaskStatusLabel('insert', 'insert', insertFallback);
    const bulletin10Display = bulletinDoc?.exists ? bulletin10Status : 'Not Started';
    const bulletin8Display = bulletin8Doc?.exists ? bulletin8Status : 'Not Started';
    const insertDisplay = insertDoc.exists ? insertStatus : 'Not Started';
    const getBulletinDefaultCopies = (status, readyCopies) => (
        String(status || '').toLowerCase() === 'ready' ? readyCopies : 1
    );
    const getInsertDefaultCopies = (status, milestoneList, milestoneStep) => {
        const normalized = String(status || '').toLowerCase();
        if (normalized === 'print' || normalized === 'printed') return 110;
        const stepKey = String(milestoneStep || '').toLowerCase();
        if (stepKey === 'print' || stepKey === 'printed') return 110;
        if (milestoneList?.steps?.length) {
            const step = milestoneList.steps.find((item) => item.key === milestoneStep);
            const title = String(step?.title || '').toLowerCase();
            if (title.includes('print')) return 110;
        }
        return 1;
    };

    const isReadyStatus = (status) => String(status || '').toLowerCase() === 'ready';

    useEffect(() => {
        const insertMilestoneList = milestoneListsWithDates.find((list) => list.key === 'insert');
        const insertMilestoneKey = insertMilestoneList?.key || 'insert';
        const insertMilestoneTask = insertMilestoneList ? getMilestoneTask(insertMilestoneList, insertMilestoneKey) : null;
        const insertMilestoneStep = insertMilestoneTask?.progress_key || '';
        setBulletinPrintCopies({
            bulletin10: getBulletinDefaultCopies(bulletin10Display, 90),
            bulletin8: getBulletinDefaultCopies(bulletin8Display, 20),
            insert: getInsertDefaultCopies(insertDisplay, insertMilestoneList, insertMilestoneStep)
        });
    }, [bulletin10Display, bulletin8Display, insertDisplay, milestoneListsWithDates, getMilestoneTask]);

    const toggleEmailChecklistItem = (field) => {
        updateDetailField(field, !details[field]);
    };

    const isEmailChecklistComplete = !!livestreamUrl
        && details.bulletinUploaded
        && details.emailCreated
        && details.emailScheduled
        && details.emailSent;
    const sundayEvents = useMemo(() => {
        if (!currentDate) return [];
        return events
            .filter((event) => {
                if (!event?.date) return false;
                if (!isSameDay(event.date, currentDate)) return false;
                if (event.source === 'liturgical') return false;
                if (event.type_slug === 'weekly-service') return false;
                if (event.id === 'sunday-service') return false;
                return true;
            })
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }, [currentDate, events]);

    useEffect(() => {
        if (!sundayEvents.length) {
            setSelectedEventId(null);
            return;
        }
        if (!selectedEventId || !sundayEvents.some((event) => event.id === selectedEventId)) {
            setSelectedEventId(sundayEvents[0].id);
        }
    }, [selectedEventId, sundayEvents]);

    const selectedEvent = useMemo(() => (
        sundayEvents.find((event) => event.id === selectedEventId) || null
    ), [sundayEvents, selectedEventId]);

    const isHgkEvent = useMemo(() => {
        if (!selectedEvent) return false;
        const metadata = selectedEvent.metadata || {};
        const identifier = String(metadata.identifier || '').toLowerCase();
        const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
        const hasHgkTag = tags.some((tag) => String(tag || '').toLowerCase() === '#hgk');
        const title = (selectedEvent.title || '').toLowerCase();
        return (
            selectedEvent.id === 'hgk-volunteer' ||
            identifier === '#hgk' ||
            hasHgkTag ||
            (selectedEvent.type_slug === 'volunteer' && title.includes('holy ghost kitchen'))
        );
    }, [selectedEvent]);

    useEffect(() => {
        if (!selectedEvent || !isHgkEvent) {
            setHgkRawSupplies([]);
            setHgkSupplyRequest(null);
            setHgkSupplyMonth('');
            setHgkNotes('');
            setHgkEmailInput('');
            setHgkSupplyError('');
            setHgkSupplyLoading(false);
            setHgkSupplies([]);
            return;
        }
        const monthKey = format(selectedEvent.date || new Date(), 'yyyy-MM');
        let active = true;
        setHgkSupplies([]);
        setHgkSupplyLoading(true);
        setHgkSupplyError('');
        setHgkEmailInput('');

        const fetchSupplies = async () => {
            try {
                const response = await fetch(`${API_URL}/hgk/supplies?month=${encodeURIComponent(monthKey)}`);
                if (!response.ok) throw new Error('Failed to load HGK supplies');
                const data = await response.json();
                if (!active) return;
                setHgkSupplyRequest(data.request || null);
                setHgkRawSupplies(Array.isArray(data.items) ? data.items : []);
                setHgkSupplyMonth(data.month || monthKey);
                setHgkNotes(data.request?.notes || '');
            } catch (err) {
                console.error(err);
                if (!active) return;
                setHgkRawSupplies([]);
                setHgkSupplyRequest(null);
                setHgkNotes('');
                setHgkSupplyMonth(monthKey);
                setHgkSupplyError('Unable to load HGK supply list.');
            } finally {
                if (active) setHgkSupplyLoading(false);
            }
        };

        fetchSupplies();
        return () => {
            active = false;
        };
    }, [selectedEvent, isHgkEvent]);

    useEffect(() => {
        if (!isHgkEvent) {
            setHgkSupplies([]);
            return;
        }
        setHgkSupplies(buildHgkSupplyList(hgkRawSupplies, hgkItemNames));
    }, [hgkRawSupplies, hgkItemNames, isHgkEvent]);

    const servicePanels = useMemo(() => {
        return services.map((service) => (
            <Card key={service.id} className="sunday-service-card">
                <header className="sunday-service-header">
                    <div>
                        <h3>{formatServiceTime(service.time)} Sunday Service - {service.rite || 'Rite II'}</h3>
                        <div className="service-location">
                            <span>Location</span>
                            <select
                                value={locationDrafts?.[service.time] || service.location || defaultLocationForTime(service.time)}
                                onChange={(event) => updateLocationDraft(service.time, event.target.value)}
                            >
                                {buildings.length === 0 ? (
                                    <option value={defaultLocationForTime(service.time)}>
                                        {defaultLocationForTime(service.time)}
                                    </option>
                                ) : (
                                    buildings.map((building) => (
                                        <option key={building.id} value={building.id}>
                                            {building.name}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                    </div>
                </header>
                <div className="service-roles-grid">
                    {ROLE_DEFINITIONS.filter((role) => getServiceRoleKeys(service).includes(role.key)).map((role) => {
                        const isMulti = MULTI_ASSIGNMENT_ROLES.has(role.key);
                        const selectedValue = roleDrafts?.[service.time]?.[role.key];
                        const selectValue = isMulti
                            ? (Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : []))
                            : (Array.isArray(selectedValue) ? (selectedValue[0] || '') : (selectedValue || ''));
                        const eligiblePeople = people.filter((person) => (person.roles || []).includes(role.key));
                        const teamMap = getTeamMap(role.key, eligiblePeople);
                        const teamEntries = Array.from(teamMap.entries()).sort((a, b) => a[0] - b[0]);
                        const selectedPeople = (Array.isArray(selectValue) ? selectValue : [selectValue])
                            .map((id) => peopleById.get(id))
                            .filter(Boolean);
                        const menuOpen = openMenu?.serviceTime === service.time && openMenu?.roleKey === role.key;

                        return (
                            <div key={`${service.id}-${role.key}`} className="role-edit-row">
                                <div className="role-menu-anchor">
                                    <button
                                        type="button"
                                        className="role-menu-trigger"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            toggleRoleMenu(service.time, role.key);
                                        }}
                                        disabled={eligiblePeople.length === 0}
                                        aria-expanded={menuOpen ? 'true' : 'false'}
                                    >
                                        <span>{role.label}</span>
                                        <span className={`caret-icon ${menuOpen ? 'open' : ''}`}>▸</span>
                                    </button>
                                    {menuOpen && (
                                        <div
                                            className={`person-menu ${menuDirection === 'down' ? 'open-down' : 'open-up'}`}
                                            data-menu-key={`${service.time}-${role.key}`}
                                        >
                                            {isMulti && teamEntries.length > 0 && (
                                                <div className="person-menu-section">
                                                    <div className="person-menu-title">Teams</div>
                                                    {teamEntries.map(([teamNumber, memberIds]) => {
                                                        const teamSelected = memberIds.every((id) => selectValue.includes(id));
                                                        return (
                                                            <button
                                                                key={`${service.id}-${role.key}-team-${teamNumber}`}
                                                                type="button"
                                                                className="person-menu-item"
                                                                onClick={() => toggleTeamSelection(service.time, role.key, memberIds)}
                                                            >
                                                                <span className={`person-chip person-chip-volunteer ${teamSelected ? 'chip-selected' : ''}`}>
                                                                    Team {teamNumber}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                    <div className="person-menu-divider" />
                                                </div>
                                            )}
                                            <div className="person-menu-section">
                                                <div className="person-menu-title">People</div>
                                                {eligiblePeople.map((person) => {
                                                    const isSelected = isMulti
                                                        ? selectValue.includes(person.id)
                                                        : selectValue === person.id;
                                                    const category = person.category || 'volunteer';
                                                    return (
                                                        <button
                                                            key={`${service.id}-${role.key}-${person.id}`}
                                                            type="button"
                                                            className="person-menu-item"
                                                            onClick={() => togglePersonSelection(service.time, role.key, person.id, isMulti)}
                                                        >
                                                            <span className={`person-chip person-chip-${category} ${isSelected ? 'chip-selected' : ''}`}>
                                                                {person.displayName}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {selectedPeople.length > 0 ? (
                                    <div className="role-chip-list">
                                        {selectedPeople.map((person) => (
                                            <span
                                                key={person.id}
                                                className={`person-chip-wrapper ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'tooltip-open' : ''}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    const tooltipKey = `${service.time}-${role.key}-${person.id}`;
                                                    setOpenTooltipKey((prev) => (prev === tooltipKey ? null : tooltipKey));
                                                }}
                                            >
                                                <span className={`person-chip person-chip-${person.category || 'volunteer'}`}>{person.displayName}</span>
                                                <span className={`person-tooltip ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'open' : ''}`}>
                                                    {renderTooltipCard(person)}
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </Card>
        ));
    }, [buildings, locationDrafts, menuDirection, openMenu, openTooltipKey, people, peopleById, roleDrafts, services]);

    const handleHgkItemQuantityChange = (index, value) => {
        setHgkSupplies((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], quantity: value };
            return next;
        });
    };

    const handleHgkItemStatusChange = (index, value) => {
        setHgkSupplies((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], status: value };
            return next;
        });
    };

    const handleHgkItemNotesChange = (index, value) => {
        setHgkSupplies((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], notes: value };
            return next;
        });
    };

    const buildHgkInstacartItems = () => {
        const packSizes = {
            'Napkins': 500,
            'Sandwich Bags': 1100
        };
        const items = [];
        hgkSupplies.forEach((entry) => {
            const name = String(entry.item_name || '').trim();
            const quantityMatch = String(entry.quantity || '').match(/(\d+(?:\.\d+)?)/);
            const requested = quantityMatch ? Number(quantityMatch[1]) : 0;
            if (!name || !Number.isFinite(requested) || requested <= 0) return;
            const packSize = packSizes[name];
            if (packSize) {
                const boxes = Math.max(1, Math.ceil(requested / packSize));
                const boxLabel = boxes === 1 ? 'box' : 'boxes';
                items.push({
                    name,
                    display: `${boxes} ${boxLabel} (${packSize} each)`
                });
            } else {
                items.push({
                    name,
                    display: `${requested}`
                });
            }
        });
        return items;
    };

    const applyParsedHgkItems = (parsed = []) => {
        const parsedMap = new Map(
            parsed.map((entry) => [String(entry.item_name || '').trim().toLowerCase(), entry])
        );
        setHgkSupplies((prev) => prev.map((entry) => {
            const key = String(entry.item_name || '').trim().toLowerCase();
            const match = parsedMap.get(key);
            if (!match || !match.quantity) return entry;
            return { ...entry, quantity: String(match.quantity).trim() };
        }));
    };

    const handleParseHgkEmail = async () => {
        if (!hgkEmailInput.trim()) return;
        const monthKey = hgkSupplyMonth || format(selectedEvent?.date || new Date(), 'yyyy-MM');
        setHgkEmailBusy(true);
        setHgkSupplyError('');
        try {
            const response = await fetch(`${API_URL}/hgk/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: hgkEmailInput,
                    month: monthKey
                })
            });
            if (!response.ok) throw new Error('Failed to parse HGK email');
            const data = await response.json();
            const parsed = Array.isArray(data.items) ? data.items : [];
            if (!parsed.length) {
                setHgkSupplyError('No supply quantities detected in that email.');
                return;
            }
            applyParsedHgkItems(parsed);
        } catch (err) {
            console.error(err);
            setHgkSupplyError('Unable to parse that supply email.');
        } finally {
            setHgkEmailBusy(false);
        }
    };

    const handleSearchHgkEmail = async () => {
        setHgkSearchBusy(true);
        setHgkSupplyError('');
        try {
            const response = await fetch(`${API_URL}/hgk/gmail-search`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to search Gmail');
            const data = await response.json();
            const parsed = Array.isArray(data.items) ? data.items : [];
            if (!parsed.length) {
                setHgkSupplyError('No matching supply request found in Gmail.');
                return;
            }
            applyParsedHgkItems(parsed);
        } catch (err) {
            console.error(err);
            setHgkSupplyError('Unable to search Gmail for the supply request.');
        } finally {
            setHgkSearchBusy(false);
        }
    };

    const handleOpenHgkInstacart = async () => {
        const items = buildHgkInstacartItems();
        if (items.length === 0) {
            setHgkSupplyError('No quantities found to send to Instacart.');
            return;
        }
        setHgkInstacartBusy(true);
        setHgkSupplyError('');
        try {
            const response = await fetch(`${API_URL}/hgk/instacart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `HGK Supplies ${hgkSupplyMonthLabel || ''}`.trim(),
                    items
                })
            });
            if (!response.ok) throw new Error('Failed to open Instacart list');
        } catch (err) {
            console.error(err);
            setHgkSupplyError('Unable to open the Instacart list.');
        } finally {
            setHgkInstacartBusy(false);
        }
    };

    const handleSaveHgkSupplies = async () => {
        if (!hgkSupplyMonth || hgkSupplies.length === 0) return;
        setHgkSupplySaving(true);
        setHgkSupplyError('');
        try {
            const body = {
                month: hgkSupplyMonth,
                notes: hgkNotes,
                items: hgkSupplies.map((entry) => ({
                    item_name: entry.item_name,
                    quantity: String(entry.quantity || '').trim(),
                    notes: String(entry.notes || '').trim(),
                    status: HGK_STATUS_OPTIONS.includes(entry.status) ? entry.status : HGK_STATUS_OPTIONS[0]
                }))
            };
            const response = await fetch(`${API_URL}/hgk/supplies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) throw new Error('Failed to save HGK supplies');
            const data = await response.json();
            setHgkSupplyRequest(data.request || null);
            setHgkRawSupplies(Array.isArray(data.items) ? data.items : []);
            setHgkNotes(data.request?.notes || '');
            setHgkSupplyMonth(data.month || hgkSupplyMonth);
            setHgkEmailInput('');
        } catch (err) {
            console.error(err);
            setHgkSupplyError('Unable to save supply list.');
        } finally {
            setHgkSupplySaving(false);
        }
    };

    const hgkSupplyMonthLabel = (() => {
        if (hgkSupplyMonth) {
            try {
                return format(parseISO(`${hgkSupplyMonth}-01`), 'MMMM yyyy');
            } catch {
                // ignore parse errors
            }
        }
        if (selectedEvent?.date) {
            return format(selectedEvent.date, 'MMMM yyyy');
        }
        return '';
    })();

    const getMilestoneStatus = (list, statusKey) => {
        const todayKey = toDateKey(new Date());
        const steps = list.steps || [];
        const task = getMilestoneTask(list, statusKey);
        const currentKey = task?.progress_key || '';
        const currentIndex = steps.findIndex((step) => step.key === currentKey);
        let missed = 0;
        steps.forEach((step, index) => {
            if (index <= currentIndex) return;
            if (step.dueDate && toDateKey(step.dueDate) < todayKey) missed += 1;
        });
        const warning = missed >= 2 ? 'Late' : missed >= 1 ? 'Behind' : '';
        const progress = steps.length > 0 ? Math.max(0, currentIndex + 1) / steps.length : 0;
        return { currentIndex, warning, progress };
    };

    const isMilestoneComplete = (list, statusKey) => {
        if (!list?.steps?.length) return false;
        const status = getMilestoneStatus(list, statusKey);
        return status.currentIndex >= list.steps.length - 1;
    };

    const milestoneLookup = useMemo(() => {
        const map = new Map();
        milestoneListsWithDates.forEach((list) => map.set(list.key, list));
        const find = (keys = [], titleHints = []) => {
            for (const key of keys) {
                if (map.has(key)) return map.get(key);
            }
            const loweredHints = titleHints.map((hint) => String(hint || '').toLowerCase()).filter(Boolean);
            if (loweredHints.length === 0) return null;
            for (const list of map.values()) {
                const title = String(list.title || '').toLowerCase();
                if (loweredHints.some((hint) => title.includes(hint))) return list;
            }
            return null;
        };
        return { map, find };
    }, [milestoneListsWithDates]);

    const bulletinMilestone = milestoneLookup.find(['bulletins', 'bulletin'], ['bulletin']);
    const insertMilestone = milestoneLookup.find(['insert'], ['insert']);
    const emailMilestone = milestoneLookup.find(['email', 'livestream-email', 'livestream'], ['email']);

    const roleProgress = useMemo(() => {
        if (!services.length) return null;
        const optionalRoles = new Set(['childcare']);
        const isAssigned = (value) => {
            if (Array.isArray(value)) return value.filter(Boolean).length > 0;
            return !!value;
        };
        const roleSteps = ROLE_DEFINITIONS
            .filter((role) => apiRoleKeys.has(role.key))
            .map((role) => {
                const relevantServices = services.filter((service) => getServiceRoleKeys(service).includes(role.key));
                if (relevantServices.length === 0) return null;
                const filled = relevantServices.every((service) => {
                    const draftValue = roleDrafts?.[service.time]?.[role.key];
                    if (draftValue !== undefined) return isAssigned(draftValue);
                    const rosterPeople = service?.roster?.[role.key]?.people || [];
                    return rosterPeople.length > 0;
                });
                return {
                    key: role.key,
                    title: role.label,
                    filled,
                    optional: optionalRoles.has(role.key)
                };
            })
            .filter(Boolean);
        const requiredSteps = roleSteps.filter((step) => !step.optional);
        const completedRequired = requiredSteps.filter((step) => step.filled).length;
        const progress = requiredSteps.length > 0 ? completedRequired / requiredSteps.length : 0;
        return {
            steps: roleSteps,
            completedRequired,
            requiredCount: requiredSteps.length,
            progress
        };
    }, [roleDrafts, services]);

    const renderMilestoneInline = (title, list, statusKey = list?.key) => {
        if (!list) return null;
        const status = getMilestoneStatus(list, statusKey);
        const currentStep = status.currentIndex >= 0 ? list.steps[status.currentIndex] : null;
        const nextStep = status.currentIndex + 1 < list.steps.length ? list.steps[status.currentIndex + 1] : null;
        const prevStep = status.currentIndex > 0 ? list.steps[status.currentIndex - 1] : null;
        const currentLabel = currentStep ? currentStep.title : 'Not Started';
        const nextLabel = nextStep ? `Next: ${nextStep.title}` : 'Complete';
        return (
            <div className="milestone-inline">
                <div className="milestone-item-header">
                    <div>
                        <div className="milestone-title">{title}</div>
                    </div>
                    {status.warning && (
                        <span className={`pill milestone-warning ${status.warning === 'Late' ? 'status-closed' : 'status-reviewed'}`}>
                            {status.warning}
                        </span>
                    )}
                </div>
                <div className="milestone-inline-actions">
                    <div className="milestone-inline-next">{`${currentLabel} | ${nextLabel}`}</div>
                    <div className="milestone-inline-buttons">
                        <button
                            type="button"
                            className="milestone-back-btn"
                            title="Go Back"
                            aria-label="Go Back"
                            disabled={status.currentIndex < 0}
                            onClick={() => {
                                if (status.currentIndex <= 0) {
                                    clearMilestoneStatus(list.key, statusKey);
                                    return;
                                }
                                if (prevStep) setMilestoneStatus(list.key, prevStep.key, statusKey);
                            }}
                        >
                            &lt;
                        </button>
                        <button
                            type="button"
                            className="milestone-complete-btn"
                            title="Mark Complete"
                            aria-label="Mark Complete"
                            disabled={!nextStep}
                            onClick={() => setMilestoneStatus(list.key, nextStep.key, statusKey)}
                        >
                            ✓
                        </button>
                    </div>
                </div>
                <div className="milestone-bar">
                    <div
                        className="milestone-bar-fill"
                        style={{ width: `${Math.round(status.progress * 100)}%` }}
                    />
                </div>
            </div>
        );
    };

    const renderRoleProgress = () => {
        if (!roleProgress) return null;
        return (
            <div className="milestone-inline role-progress">
                <div className="milestone-item-header">
                    <div>
                        <div className="milestone-title">Fill Liturgical Roles</div>
                        <div className="milestone-current">
                            {roleProgress.completedRequired}/{roleProgress.requiredCount} roles filled
                        </div>
                    </div>
                </div>
                <div className="milestone-bar">
                    <div
                        className="milestone-bar-fill"
                        style={{ width: `${Math.round(roleProgress.progress * 100)}%` }}
                    />
                </div>
                <div className="milestone-inline-next">
                    {roleProgress.completedRequired === roleProgress.requiredCount
                        ? 'All required roles filled'
                        : `${roleProgress.requiredCount - roleProgress.completedRequired} required roles remaining`}
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="page-sunday">
                <Card className="loading-card">Loading Sunday details...</Card>
            </div>
        );
    }

    return (
        <div className="page-sunday">
            <header className="sunday-header page-header-bar">
                <div className="sunday-title page-header-title">
                    <h1>Sunday Planner: {currentDate ? format(currentDate, 'MMMM d, yyyy') : ''}</h1>
                    <div className="sunday-subtitle page-header-subtitle">{liturgicalInfo?.name || liturgicalInfo?.feast || 'Sunday'}</div>
                </div>
                <div className="page-header-actions">
                    <div className="sunday-nav">
                        <button className="nav-icon" onClick={() => handleNavigate('prev')} aria-label="Previous Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <button className="nav-icon" onClick={() => handleNavigate('next')} aria-label="Next Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                    <button className="btn-primary" onClick={saveSunday} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Updates'}
                    </button>
                </div>
            </header>

            {error && <div className="alert error">{error}</div>}

            <div className="top-panel-row">
                <Card
                    id="bulletin-10am"
                    className={`sunday-panel bulletin-card ${(statusDrafts.bulletin10 || bulletin10Status) === 'printed' ? 'panel-complete' : ''}`}
                >
                    {renderMilestoneInline('10am Bulletin', bulletinMilestone, 'bulletins-10am')}
                    {isMilestoneComplete(bulletinMilestone, 'bulletins-10am') && (
                        <span className="check-badge panel-check" aria-hidden="true">✓</span>
                    )}
                    
                    <div className="doc-preview">
                        <button
                            type="button"
                            className="doc-preview-refresh"
                            onClick={() => refreshDocPreviews('bulletin10')}
                            disabled={getPreviewLoading('bulletin10')}
                            aria-label="Refresh preview"
                            title="Refresh preview"
                        >
                            <FaSyncAlt />
                        </button>
                        {getPreviewLoading('bulletin10') && <span className="doc-spinner" aria-hidden="true" />}
                        {bulletinDoc?.preview ? (
                            <img src={bulletinDoc.preview} alt="10am bulletin preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No bulletin preview</div>
                        )}
                    </div>
                    <div className="panel-actions panel-actions-bottom">
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={() => openFileLocation(bulletinDoc?.path)}
                            disabled={!bulletinDoc?.exists}
                            aria-label="Open 10am bulletin folder"
                            title="Open File Location"
                        >
                            <FaFolderOpen />
                        </button>
                        <input
                            type="number"
                            min="1"
                            className="print-copies-input"
                            value={bulletinPrintCopies.bulletin10}
                            onChange={(event) => {
                                const next = Math.max(1, Number(event.target.value) || 1);
                                setBulletinPrintCopies((prev) => ({ ...prev, bulletin10: next }));
                            }}
                            aria-label="10am bulletin copies"
                        />
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={async () => {
                                const ok = await printFile(bulletinDoc?.path, {
                                    printer: 'SHARP-BULLETIN',
                                    copies: bulletinPrintCopies.bulletin10
                                });
                                const expectedCopies = getBulletinDefaultCopies(bulletin10Display, 90);
                                if (ok && isReadyStatus(bulletin10Display) && bulletinPrintCopies.bulletin10 === expectedCopies) {
                                    updateDetailField('bulletinStatus10', 'printed');
                                }
                            }}
                            disabled={!bulletinDoc?.exists}
                            aria-label="Print 10am bulletin"
                            title="Print"
                        >
                            <FaPrint />
                        </button>
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={handleUploadBulletin}
                            disabled={!bulletinDoc?.exists || uploadingBulletin}
                            aria-label="Upload 10am bulletin"
                            title="Upload to WordPress"
                        >
                            {uploadingBulletin ? <span className="btn-icon-loading" aria-hidden="true" /> : <FaUpload />}
                        </button>
                    </div>
                    {uploadError && <div className="text-muted">{uploadError}</div>}
                </Card>
                <Card
                    id="bulletin-8am"
                    className={`sunday-panel bulletin-card ${(statusDrafts.bulletin8 || bulletin8Status) === 'printed' ? 'panel-complete' : ''}`}
                >
                    {renderMilestoneInline('8am Bulletin', bulletinMilestone, 'bulletins-8am')}
                    {isMilestoneComplete(bulletinMilestone, 'bulletins-8am') && (
                        <span className="check-badge panel-check" aria-hidden="true">✓</span>
                    )}
                    
                    <div className="doc-preview">
                        <button
                            type="button"
                            className="doc-preview-refresh"
                            onClick={() => refreshDocPreviews('bulletin8')}
                            disabled={getPreviewLoading('bulletin8')}
                            aria-label="Refresh preview"
                            title="Refresh preview"
                        >
                            <FaSyncAlt />
                        </button>
                        {getPreviewLoading('bulletin8') && <span className="doc-spinner" aria-hidden="true" />}
                        {bulletin8Doc?.preview ? (
                            <img src={bulletin8Doc.preview} alt="8am bulletin preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No bulletin preview</div>
                        )}
                    </div>
                    <div className="panel-actions panel-actions-bottom">
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={() => openFileLocation(bulletin8Doc?.path)}
                            disabled={!bulletin8Doc?.exists}
                            aria-label="Open 8am bulletin folder"
                            title="Open File Location"
                        >
                            <FaFolderOpen />
                        </button>
                        <input
                            type="number"
                            min="1"
                            className="print-copies-input"
                            value={bulletinPrintCopies.bulletin8}
                            onChange={(event) => {
                                const next = Math.max(1, Number(event.target.value) || 1);
                                setBulletinPrintCopies((prev) => ({ ...prev, bulletin8: next }));
                            }}
                            aria-label="8am bulletin copies"
                        />
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={async () => {
                                const ok = await printFile(bulletin8Doc?.path, {
                                    printer: 'SHARP-BULLETIN',
                                    copies: bulletinPrintCopies.bulletin8
                                });
                                const expectedCopies = getBulletinDefaultCopies(bulletin8Display, 20);
                                if (ok && isReadyStatus(bulletin8Display) && bulletinPrintCopies.bulletin8 === expectedCopies) {
                                    updateDetailField('bulletinStatus8', 'printed');
                                }
                            }}
                            disabled={!bulletin8Doc?.exists}
                            aria-label="Print 8am bulletin"
                            title="Print"
                        >
                            <FaPrint />
                        </button>
                    </div>
                </Card>
                <Card
                    className={`sunday-panel insert-card ${(statusDrafts.insert || insertStatus) === 'stuffed' ? 'panel-complete' : ''}`}
                >
                    {renderMilestoneInline('Insert', insertMilestone)}
                    {isMilestoneComplete(insertMilestone, insertMilestone?.key || 'insert') && (
                        <span className="check-badge panel-check" aria-hidden="true">✓</span>
                    )}
                    
                    <div className="doc-preview">
                        <button
                            type="button"
                            className="doc-preview-refresh"
                            onClick={() => refreshDocPreviews('insert')}
                            disabled={getPreviewLoading('insert')}
                            aria-label="Refresh preview"
                            title="Refresh preview"
                        >
                            <FaSyncAlt />
                        </button>
                        {getPreviewLoading('insert') && <span className="doc-spinner" aria-hidden="true" />}
                        {insertDoc.preview ? (
                            <img src={insertDoc.preview} alt="Insert preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No insert preview</div>
                        )}
                    </div>
                    <div className="panel-actions panel-actions-bottom">
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={() => openFileLocation(insertDoc.path)}
                            disabled={!insertDoc.exists}
                            aria-label="Open insert folder"
                            title="Open File Location"
                        >
                            <FaFolderOpen />
                        </button>
                        <input
                            type="number"
                            min="1"
                            className="print-copies-input"
                            value={bulletinPrintCopies.insert}
                            onChange={(event) => {
                                const next = Math.max(1, Number(event.target.value) || 1);
                                setBulletinPrintCopies((prev) => ({ ...prev, insert: next }));
                            }}
                            aria-label="Insert copies"
                        />
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={() => printFile(insertDoc.path, { copies: bulletinPrintCopies.insert })}
                            disabled={!insertDoc.exists}
                            aria-label="Print insert"
                            title="Print"
                        >
                            <FaPrint />
                        </button>
                    </div>
                </Card>
                <Card className={`sunday-panel livestream-card ${isEmailChecklistComplete ? 'panel-complete' : ''}`}>
                    {renderMilestoneInline('Livestream Email', emailMilestone)}

                    {isMilestoneComplete(emailMilestone, emailMilestone?.key || 'email') && (
                        <span className="check-badge panel-check" aria-hidden="true">✓</span>
                    )}
                    
                    <div className="email-checklist-wrapper">
                        <div className="email-checklist">
                            <div className={`check-item ${livestreamUrl ? 'done' : ''}`}>
                                <span className={`check-badge check-badge--sm ${livestreamUrl ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {livestreamUrl ? '✓' : ''}
                                </span>
                                <span>Livestream setup</span>
                                {livestreamUrl && (
                                    <a
                                        className="btn-icon btn-icon-ghost youtube-link"
                                        href={livestreamUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Open YouTube livestream"
                                        title="Open YouTube"
                                    >
                                        <FaYoutube />
                                    </a>
                                )}
                            </div>
                            <button
                                type="button"
                                className={`check-item check-action ${details.bulletinUploaded ? 'done' : ''}`}
                                onClick={() => toggleEmailChecklistItem('bulletinUploaded')}
                            >
                                <span className={`check-badge check-badge--sm ${details.bulletinUploaded ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.bulletinUploaded ? '✓' : ''}
                                </span>
                                <span>Bulletin uploaded</span>
                            </button>
                            <button
                                type="button"
                                className={`check-item check-action ${details.emailCreated ? 'done' : ''}`}
                                onClick={() => toggleEmailChecklistItem('emailCreated')}
                            >
                                <span className={`check-badge check-badge--sm ${details.emailCreated ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.emailCreated ? '✓' : ''}
                                </span>
                                <span>Email created</span>
                            </button>
                            <button
                                type="button"
                                className={`check-item check-action ${details.emailScheduled ? 'done' : ''}`}
                                onClick={() => toggleEmailChecklistItem('emailScheduled')}
                            >
                                <span className={`check-badge check-badge--sm ${details.emailScheduled ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.emailScheduled ? '✓' : ''}
                                </span>
                                <span>Email scheduled</span>
                            </button>
                            <button
                                type="button"
                                className={`check-item check-action ${details.emailSent ? 'done' : ''}`}
                                onClick={() => toggleEmailChecklistItem('emailSent')}
                            >
                                <span className={`check-badge check-badge--sm ${details.emailSent ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.emailSent ? '✓' : ''}
                                </span>
                                <span>Email sent</span>
                            </button>
                        </div>
                    </div>
                    {livestreamError && <div className="text-muted">{livestreamError}</div>}
                </Card>
            </div>

            {sundayEvents.length > 0 && (
                <Card className="sunday-panel events-panel">
                    <div className="panel-header">
                        <h3>Additional Sunday Events</h3>
                    </div>
                    <div className="events-panel-body">
                        <div className="events-panel-list">
                            {sundayEvents.map((eventItem) => (
                                <button
                                    key={eventItem.id}
                                    type="button"
                                    className={`event-row ${eventItem.id === selectedEventId ? 'active' : ''}`}
                                    onClick={() => setSelectedEventId(eventItem.id)}
                                >
                                    <div className="event-row-main">
                                        <span className="event-row-title">{eventItem.title}</span>
                                        <span className="event-row-meta">
                                            {eventItem.type_name || eventItem.category_name || 'Event'}
                                        </span>
                                    </div>
                                    <span className="event-row-time">{eventItem.time || 'All day'}</span>
                                </button>
                            ))}
                        </div>
                        <div className="events-panel-detail">
                            {!selectedEvent ? (
                                <div className="empty-text">Select an event to see details.</div>
                            ) : (
                                <div className="event-details">
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Title</span>
                                        <span className="event-detail-value">{selectedEvent.title}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Time</span>
                                        <span className="event-detail-value">{selectedEvent.time || 'All day'}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Location</span>
                                        <span className="event-detail-value">{selectedEvent.location || 'TBD'}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Type</span>
                                        <span className="event-detail-value">{selectedEvent.type_name || selectedEvent.category_name || 'Event'}</span>
                                    </div>
                                    {selectedEvent.description && (
                                        <div className="event-detail-row">
                                            <span className="event-detail-label">Notes</span>
                                            <span className="event-detail-value">{selectedEvent.description}</span>
                                        </div>
                                    )}
                                    {isHgkEvent && (
                                        <div className="hgk-supply-panel">
                                            <div className="hgk-supply-header">
                                                <div>
                                                    <h4>Holy Ghost Kitchen Supplies</h4>
                                                    <span className="hgk-supply-month">{hgkSupplyMonthLabel}</span>
                                                </div>
                                                <span className="hgk-supply-status-label">
                                                    {hgkSupplyRequest ? 'Saved request' : 'Ungenerated list'}
                                                </span>
                                            </div>
                                            <div className="hgk-supply-notes">
                                                <label htmlFor="hgk-supply-notes">Notes</label>
                                                <textarea
                                                    id="hgk-supply-notes"
                                                    className="hgk-supply-textarea"
                                                    value={hgkNotes}
                                                    onChange={(event) => setHgkNotes(event.target.value)}
                                                    placeholder="Add ordering notes or reminders."
                                                />
                                            </div>
                                            <div className="hgk-supply-email">
                                                <label htmlFor="hgk-supply-email">Supply email</label>
                                                <div className="hgk-supply-email-row">
                                                    <textarea
                                                        id="hgk-supply-email"
                                                        className="hgk-supply-textarea"
                                                        value={hgkEmailInput}
                                                        onChange={(event) => setHgkEmailInput(event.target.value)}
                                                        placeholder="Paste the monthly supply email text to populate quantities."
                                                    />
                                                    <div className="hgk-email-actions">
                                                        <button
                                                            type="button"
                                                            className="btn-secondary hgk-email-button"
                                                            onClick={handleSearchHgkEmail}
                                                            disabled={hgkSearchBusy}
                                                        >
                                                            {hgkSearchBusy ? 'Searching...' : 'Search for Supply Request'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn-primary hgk-email-button"
                                                            onClick={handleParseHgkEmail}
                                                            disabled={hgkEmailBusy || !hgkEmailInput.trim()}
                                                        >
                                                            {hgkEmailBusy ? 'Parsing...' : 'Use email'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="hgk-supply-grid">
                                                <div className="hgk-supply-row hgk-supply-row--header">
                                                    <span>Item</span>
                                                    <span>Qty</span>
                                                    <span>Status</span>
                                                    <span>Notes</span>
                                                </div>
                                                {hgkSupplyLoading ? (
                                                    <div className="hgk-supply-loading">Loading supply list...</div>
                                                ) : hgkSupplies.length === 0 ? (
                                                    <div className="hgk-supply-empty">No supply items configured yet.</div>
                                                ) : (
                                                    hgkSupplies.map((item, index) => (
                                                        <div className="hgk-supply-row" key={`${item.item_name}-${index}`}>
                                                            <span className="hgk-supply-name">{item.item_name}</span>
                                                            <input
                                                                type="text"
                                                                className="hgk-supply-input"
                                                                value={item.quantity}
                                                                placeholder="Qty"
                                                                onChange={(event) => handleHgkItemQuantityChange(index, event.target.value)}
                                                            />
                                                            <select
                                                                className="hgk-supply-select"
                                                                value={item.status}
                                                                onChange={(event) => handleHgkItemStatusChange(index, event.target.value)}
                                                            >
                                                                {HGK_STATUS_OPTIONS.map((value) => (
                                                                    <option key={value} value={value}>
                                                                        {HGK_STATUS_LABELS[value] || value}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <input
                                                                type="text"
                                                                className="hgk-supply-input"
                                                                value={item.notes}
                                                                onChange={(event) => handleHgkItemNotesChange(index, event.target.value)}
                                                                placeholder="Notes"
                                                            />
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                            <div className="hgk-supply-actions">
                                                <button
                                                    type="button"
                                                    className="btn-secondary"
                                                    onClick={handleOpenHgkInstacart}
                                                    disabled={hgkInstacartBusy || hgkSupplyLoading}
                                                >
                                                    {hgkInstacartBusy ? 'Opening...' : 'Open Instacart List'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-primary"
                                                    onClick={handleSaveHgkSupplies}
                                                    disabled={hgkSupplySaving || hgkSupplyLoading}
                                                >
                                                    {hgkSupplySaving ? 'Saving...' : 'Save supply list'}
                                                </button>
                                                {hgkSupplyError && <span className="hgk-supply-error">{hgkSupplyError}</span>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            )}

            <section id="volunteers" className="sunday-services">
                <div className="section-header">
                    <h2>Service Roles</h2>
                    <span className="text-muted">Every role for each service is listed below.</span>
                </div>
                {renderRoleProgress()}
                {servicePanels.length > 0 ? servicePanels : (
                    <Card className="empty-card">No service assignments available for this Sunday.</Card>
                )}
            </section>

        </div>
    );
};

export default Sunday;




