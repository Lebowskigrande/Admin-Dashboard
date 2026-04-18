import { useEffect, useRef, useState } from 'react';
import {
    FaClone,
    FaGripVertical,
    FaLayerGroup,
    FaPlus,
    FaSave,
    FaSeedling,
    FaTrash
} from 'react-icons/fa';
import Card from '../components/Card';
import { getOriginRoute } from '../config/appRoutes';
import { API_URL } from '../services/apiConfig';
import { getSectionPresentation } from './todo/sectionCatalog';
import { getSectionIconComponent } from './todo/todoVisuals';
import {
    formatOriginLabel,
    getOriginColorClass,
    getWorkPackageSubtitle,
    getWorkPackageSummary,
    getWorkPackageTitle
} from './todo/todoHelpers';
import { buildEventEditorDraft, renderPanelContent } from './todo/todoDetailPanelContent';
import './EventTemplates.css';
import './Todo.css';

const FIELD_TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'url', label: 'URL' },
    { value: 'select', label: 'Select' },
    { value: 'checkbox', label: 'Checkbox' }
];

const LIST_MODE_OPTIONS = [
    { value: 'sequential', label: 'Sequential' },
    { value: 'parallel', label: 'Parallel' },
    { value: 'progressive', label: 'Progressive' }
];

const ORIGIN_TYPE_OPTIONS = [
    { value: 'operations', label: 'Operations' },
    { value: 'sunday', label: 'Sunday' },
    { value: 'vestry', label: 'Vestry' },
    { value: 'event', label: 'Event Type' }
];

const OPERATIONS_SCOPE_OPTIONS = [
    { value: 'weekly', label: 'Weekly Operations' },
    { value: 'timesheets', label: 'Timesheets' },
    { value: 'monthly', label: 'Monthly Operations' },
    { value: 'yearly', label: 'Yearly Operations' }
];

const DATAPANE_BEHAVIOR_HELP = {
    mail: 'Mailbox processing and package-intake status.',
    orders: 'Orders queue, deliveries, and follow-up.',
    deposits: 'Deposit history and bank-run context.',
    donations: 'Receivables and contribution routing.',
    bills: 'Payables and AP file history.',
    birthdays: 'Upcoming birthday card list.',
    timesheets: 'Payroll period and timesheet files.',
    bulletin: 'Event documents with bulletin focus.',
    bulletin8: 'Sunday Rite I bulletin preview.',
    bulletin10: 'Sunday Rite II bulletin preview.',
    insert: 'Document preview for inserts and handouts.',
    people: 'People, contacts, and assignment context.',
    clergy: 'Clergy and role coverage context.',
    music: 'Music and musician coverage context.',
    setup: 'Logistics and readiness context.',
    documents: 'General document preview.',
    contracts: 'Contract document view.',
    communications: 'Communications and messaging context.',
    followup: 'Post-event or post-meeting closeout context.'
};

const TILE_LIBRARY = [
    { key: 'mail', label: 'Mail', description: 'Mailbox processing and delivery intake.', listKey: 'mail', listTitle: 'Mail', listMode: 'parallel', stepTitle: 'Process office mail', dueOffsetDays: '', priorityBase: 56, origins: ['operations'] },
    { key: 'orders', label: 'Orders', description: 'Purchasing queue and delivery follow-up.', listKey: 'orders', listTitle: 'Orders', listMode: 'parallel', stepTitle: 'Review orders queue', dueOffsetDays: '', priorityBase: 55, origins: ['operations'] },
    { key: 'deposits', label: 'Deposits', description: 'Bank runs and deposit packet handling.', listKey: 'deposits', listTitle: 'Deposits', listMode: 'parallel', stepTitle: 'Complete deposit run', dueOffsetDays: '', priorityBase: 70, origins: ['operations'] },
    { key: 'donations', label: 'Receivables', description: 'Contribution routing and AR review.', listKey: 'donations', listTitle: 'Receivables', listMode: 'parallel', stepTitle: 'Process receivables', dueOffsetDays: '', priorityBase: 68, origins: ['operations'] },
    { key: 'bills', label: 'Payables', description: 'Invoices, AP routing, and payment prep.', listKey: 'bills', listTitle: 'Payables', listMode: 'parallel', stepTitle: 'Process payables', dueOffsetDays: '', priorityBase: 68, origins: ['operations'] },
    { key: 'birthdays', label: 'Birthdays', description: 'Upcoming card list and follow-through.', listKey: 'birthdays', listTitle: 'Birthday Cards', listMode: 'parallel', stepTitle: 'Prepare birthday cards', dueOffsetDays: '', priorityBase: 42, origins: ['operations'] },
    { key: 'timesheets', label: 'Payroll', description: 'Timesheet and payroll package work.', listKey: 'timesheets', listTitle: 'Payroll', listMode: 'parallel', stepTitle: 'Process timesheets', dueOffsetDays: '', priorityBase: 72, origins: ['operations'] },
    { key: 'bulletin10', label: 'Rite II Bulletin', description: 'Sunday bulletin workflow for 10am.', listKey: 'bulletin10', listTitle: 'Rite II Bulletin', listMode: 'sequential', stepTitle: 'Prepare Rite II bulletin', dueOffsetDays: -5, priorityBase: 72, origins: ['sunday'] },
    { key: 'bulletin8', label: 'Rite I Bulletin', description: 'Sunday bulletin workflow for 8am.', listKey: 'bulletin8', listTitle: 'Rite I Bulletin', listMode: 'sequential', stepTitle: 'Prepare Rite I bulletin', dueOffsetDays: -5, priorityBase: 70, origins: ['sunday'] },
    { key: 'bulletin', label: 'Bulletin', description: 'Docs, copy, and liturgy prep.', listKey: 'bulletin', listTitle: 'Bulletin', listMode: 'sequential', stepTitle: 'Prepare bulletin', dueOffsetDays: -7, priorityBase: 70, origins: ['event'] },
    { key: 'insert', label: 'Insert', description: 'Special inserts and handouts.', listKey: 'insert', listTitle: 'Insert', listMode: 'sequential', stepTitle: 'Prepare insert', dueOffsetDays: -5, priorityBase: 64, origins: ['sunday', 'event'] },
    { key: 'people', label: 'People', description: 'Contacts, assignments, and guest lists.', listKey: 'people', listTitle: 'People', listMode: 'sequential', stepTitle: 'Confirm people details', dueOffsetDays: -7, priorityBase: 60, origins: ['sunday', 'vestry'] },
    { key: 'clergy', label: 'Clergy', description: 'Presider, preacher, and role coverage.', listKey: 'clergy', listTitle: 'Clergy', listMode: 'sequential', stepTitle: 'Confirm clergy coverage', dueOffsetDays: -10, priorityBase: 72, origins: ['sunday', 'event'] },
    { key: 'music', label: 'Music', description: 'Selections, musicians, and rehearsal prep.', listKey: 'music', listTitle: 'Music', listMode: 'sequential', stepTitle: 'Confirm music plan', dueOffsetDays: -10, priorityBase: 72, origins: ['sunday', 'event'] },
    { key: 'setup', label: 'Setup', description: 'Space, supplies, and day-of readiness.', listKey: 'setup', listTitle: 'Setup', listMode: 'parallel', stepTitle: 'Confirm setup needs', dueOffsetDays: -2, priorityBase: 58, origins: ['operations', 'vestry'] },
    { key: 'documents', label: 'Documents', description: 'Packets, certificates, and shared docs.', listKey: 'documents', listTitle: 'Documents', listMode: 'sequential', stepTitle: 'Prepare documents', dueOffsetDays: -5, priorityBase: 62, origins: ['vestry', 'event'] },
    { key: 'contracts', label: 'Contracts', description: 'Vendor forms, agreements, and approvals.', listKey: 'contracts', listTitle: 'Contracts', listMode: 'sequential', stepTitle: 'Review contract details', dueOffsetDays: -14, priorityBase: 74, origins: ['event'] },
    { key: 'communications', label: 'Comms', description: 'Emails, notices, and outreach steps.', listKey: 'communications', listTitle: 'Communications', listMode: 'parallel', stepTitle: 'Send communications', dueOffsetDays: -6, priorityBase: 66, origins: ['operations', 'vestry', 'event'] },
    { key: 'followup', label: 'Follow-up', description: 'After-action tasks and closeout.', listKey: 'followup', listTitle: 'Follow-up', listMode: 'parallel', stepTitle: 'Close the loop', dueOffsetDays: 1, priorityBase: 52, origins: ['vestry', 'event'] },
    { key: 'custom', label: 'Custom', description: 'Blank section with a custom datapane key.', listKey: 'custom_section', listTitle: 'Custom Section', listMode: 'sequential', stepTitle: 'Custom task', dueOffsetDays: '', priorityBase: 50, origins: ['operations', 'sunday', 'vestry', 'event'] }
];

const TILE_MAP = Object.fromEntries(TILE_LIBRARY.map((tile) => [tile.key, tile]));

const slugify = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const createDraftId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parseNumberInput = (value, fallback = '') => {
    if (value === '' || value == null) return fallback;
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
};

const getTileForKey = (tileKey) => TILE_MAP[tileKey] || TILE_MAP.custom;

const getNormalizedOriginId = (originType, eventTypeId, scopedOriginId) => {
    if (originType === 'operations') return scopedOriginId || 'weekly';
    if (originType === 'event') return eventTypeId || '';
    return null;
};

const getVisibleTiles = (originType) => TILE_LIBRARY.filter((tile) => (
    Array.isArray(tile.origins) && tile.origins.includes(originType)
));

const getCloneOptions = (originType, eventTypes) => {
    if (originType === 'event') {
        return eventTypes.map((type) => ({
            value: String(type.id),
            label: `${type.name}${type.category_name ? ` (${type.category_name})` : ''}`
        }));
    }
    if (originType === 'operations') {
        return OPERATIONS_SCOPE_OPTIONS;
    }
    return [];
};

const getNextSundayDateKey = () => {
    const today = new Date();
    const delta = (7 - today.getDay()) % 7 || 7;
    const sunday = new Date(today);
    sunday.setDate(today.getDate() + delta);
    return sunday.toISOString().slice(0, 10);
};

const guessTileKey = (listKey, listTitle, taskTitle) => {
    const normalizedKey = slugify(listKey);
    if (normalizedKey && TILE_MAP[normalizedKey]) return normalizedKey;
    const raw = `${listKey || ''} ${listTitle || ''} ${taskTitle || ''}`.toLowerCase();
    return TILE_LIBRARY.find((tile) => tile.key !== 'custom' && raw.includes(tile.key.replace('_', ' ')))?.key || 'custom';
};

const ensureUniqueValue = (candidate, fallback, usedValues) => {
    let base = slugify(candidate || fallback) || slugify(fallback) || 'value';
    let next = base;
    let counter = 2;
    while (usedValues.has(next)) {
        next = `${base}_${counter}`;
        counter += 1;
    }
    usedValues.add(next);
    return next;
};

const cloneFieldsForEditor = (items = []) => (
    items.map((field, index) => ({
        id: field.id || '',
        field_key: field.field_key || '',
        label: field.label || '',
        field_type: field.field_type || 'text',
        options: Array.isArray(field.options) ? field.options : [],
        placeholder: field.placeholder || '',
        help_text: field.help_text || '',
        sort_order: Number.isFinite(field.sort_order) ? field.sort_order : index,
        required: !!field.required
    }))
);

const buildStepFromTile = (tileKey, currentSteps = [], overrides = {}) => {
    const tile = getTileForKey(tileKey);
    const usedStepKeys = new Set(currentSteps.map((step) => slugify(step.stepKey)));
    const baseTitle = overrides.title || tile.stepTitle;
    return {
        id: overrides.id || '',
        draftId: overrides.draftId || createDraftId('step'),
        libraryKey: tile.key,
        title: baseTitle,
        stepKey: ensureUniqueValue(overrides.stepKey || baseTitle, 'task', usedStepKeys),
        dueOffsetDays: overrides.dueOffsetDays ?? tile.dueOffsetDays,
        behaviorNotes: overrides.behaviorNotes || '',
        priorityBase: overrides.priorityBase ?? tile.priorityBase,
        active: overrides.active ?? true,
        sortOrder: overrides.sortOrder ?? currentSteps.length
    };
};

const buildLaneFromTile = (tileKey, existingLanes = [], overrides = {}) => {
    const tile = getTileForKey(tileKey);
    const usedLaneKeys = new Set(existingLanes.map((lane) => slugify(lane.listKey)));
    const listTitle = overrides.listTitle || tile.listTitle;
    return {
        laneId: overrides.laneId || createDraftId('lane'),
        libraryKey: tile.key,
        listKey: ensureUniqueValue(overrides.listKey || listTitle || tile.listKey, tile.listKey || 'section', usedLaneKeys),
        listTitle,
        listMode: overrides.listMode || tile.listMode,
        steps: overrides.steps || [buildStepFromTile(tile.key, [], overrides.firstStep || {})]
    };
};

const buildLanesFromTemplates = (templates = []) => {
    const grouped = new Map();
    [...templates]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.title || '').localeCompare(String(b.title || '')))
        .forEach((item) => {
            const laneKey = slugify(item.list_key) || `section_${grouped.size + 1}`;
            const tileKey = guessTileKey(item.list_key, item.list_title, item.title);
            if (!grouped.has(laneKey)) {
                grouped.set(laneKey, {
                    laneId: createDraftId('lane'),
                    libraryKey: tileKey,
                    listKey: item.list_key || laneKey,
                    listTitle: item.list_title || item.list_key || 'Section',
                    listMode: item.list_mode || 'sequential',
                    steps: [],
                    anchorSort: Number.isFinite(item.sort_order) ? item.sort_order : grouped.size * 100
                });
            }
            const lane = grouped.get(laneKey);
            lane.steps.push({
                id: item.id || '',
                draftId: createDraftId('step'),
                libraryKey: tileKey,
                title: item.title || 'Task',
                stepKey: item.step_key || slugify(item.title) || `step_${lane.steps.length + 1}`,
                dueOffsetDays: item.due_offset_days ?? '',
                behaviorNotes: item.behavior_notes || '',
                priorityBase: item.priority_base ?? 50,
                active: item.active !== 0,
                sortOrder: Number.isFinite(item.sort_order) ? item.sort_order : lane.steps.length
            });
        });

    return [...grouped.values()]
        .sort((a, b) => a.anchorSort - b.anchorSort)
        .map((lane) => ({
            laneId: lane.laneId,
            libraryKey: lane.libraryKey,
            listKey: lane.listKey,
            listTitle: lane.listTitle,
            listMode: lane.listMode,
            steps: lane.steps.sort((a, b) => a.sortOrder - b.sortOrder).map((step, index) => ({ ...step, sortOrder: index }))
        }));
};

const cloneLanesForEditor = (lanes = []) => (
    lanes.map((lane) => ({
        laneId: createDraftId('lane'),
        libraryKey: lane.libraryKey || guessTileKey(lane.listKey, lane.listTitle, lane.steps?.[0]?.title),
        listKey: lane.listKey || '',
        listTitle: lane.listTitle || '',
        listMode: lane.listMode || 'sequential',
        steps: (lane.steps || []).map((step, index) => buildStepFromTile(
            step.libraryKey || lane.libraryKey || 'custom',
            lane.steps.slice(0, index),
            {
                id: '',
                title: step.title,
                stepKey: step.stepKey,
                dueOffsetDays: step.dueOffsetDays,
                behaviorNotes: step.behaviorNotes,
                priorityBase: step.priorityBase,
                active: step.active
            }
        ))
    }))
);

const buildTemplatesForSave = (lanes, originType, originId) => {
    const usedLaneKeys = new Set();
    return lanes.flatMap((lane, laneIndex) => {
        const nextLaneKey = ensureUniqueValue(lane.listKey || lane.listTitle, `section_${laneIndex + 1}`, usedLaneKeys);
        const nextLaneTitle = String(lane.listTitle || lane.listKey || `Section ${laneIndex + 1}`).trim();
        const usedStepKeys = new Set();
        return lane.steps.map((step, stepIndex) => ({
            id: step.id || '',
            origin_type: originType,
            origin_id: originId,
            list_key: nextLaneKey,
            list_title: nextLaneTitle,
            list_mode: lane.listMode || 'sequential',
            step_key: ensureUniqueValue(step.stepKey || step.title, `step_${stepIndex + 1}`, usedStepKeys),
            title: String(step.title || `Task ${stepIndex + 1}`).trim(),
            sort_order: laneIndex * 100 + stepIndex * 10,
            due_offset_days: step.dueOffsetDays === '' || step.dueOffsetDays == null ? null : Number(step.dueOffsetDays),
            behavior_notes: String(step.behaviorNotes || '').trim() || null,
            priority_base: Number.isFinite(Number(step.priorityBase)) ? Number(step.priorityBase) : 50,
            active: step.active ? 1 : 0
        }));
    });
};

const formatOffsetLabel = (value) => {
    if (value === '' || value == null || !Number.isFinite(Number(value))) return 'No due offset';
    const next = Number(value);
    if (next === 0) return 'Event day';
    if (next < 0) return `${Math.abs(next)} day${Math.abs(next) === 1 ? '' : 's'} before`;
    return `${next} day${next === 1 ? '' : 's'} after`;
};

const readJson = async (response, fallbackMessage) => {
    if (!response.ok) {
        try {
            const payload = await response.json();
            throw new Error(payload?.error || fallbackMessage);
        } catch (error) {
            throw new Error(error.message || fallbackMessage);
        }
    }
    return response.json();
};

const EventTemplates = () => {
    const [eventTypes, setEventTypes] = useState([]);
    const [templateOriginType, setTemplateOriginType] = useState('operations');
    const [templateOriginId, setTemplateOriginId] = useState('weekly');
    const [selectedTypeId, setSelectedTypeId] = useState('');
    const [fields, setFields] = useState([]);
    const [lanes, setLanes] = useState([]);
    const [cloneSourceId, setCloneSourceId] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [selectedLaneId, setSelectedLaneId] = useState('');
    const [selectedStepId, setSelectedStepId] = useState('');
    const [previewEventOccurrenceId, setPreviewEventOccurrenceId] = useState('');
    const [livePanelData, setLivePanelData] = useState(null);
    const [livePanelLoading, setLivePanelLoading] = useState(false);
    const [livePanelError, setLivePanelError] = useState('');
    const [liveEventDetails, setLiveEventDetails] = useState(null);
    const [liveEventDraft, setLiveEventDraft] = useState(null);
    const [liveEventSaveError, setLiveEventSaveError] = useState('');
    const initialTemplateIds = useRef(new Set());
    const normalizedOriginId = getNormalizedOriginId(templateOriginType, selectedTypeId, templateOriginId);
    const isEventScope = templateOriginType === 'event';
    const visibleTiles = getVisibleTiles(templateOriginType);
    const cloneOptions = getCloneOptions(templateOriginType, eventTypes);

    useEffect(() => {
        const loadTypes = async () => {
            try {
                const response = await fetch(`${API_URL}/event-types`);
                const payload = await readJson(response, 'Failed to load event types');
                const nextTypes = Array.isArray(payload) ? payload : [];
                setEventTypes(nextTypes);
                if (nextTypes.length) {
                    setSelectedTypeId((current) => current || String(nextTypes[0].id));
                }
            } catch (error) {
                console.error('Failed to load event types:', error);
                setEventTypes([]);
                setErrorMessage(error.message || 'Unable to load event types.');
            }
        };
        loadTypes();
    }, []);

    useEffect(() => {
        if (isEventScope && !normalizedOriginId) return;
        const loadTemplate = async () => {
            setLoading(true);
            setErrorMessage('');
            try {
                const templateUrl = new URL(`${API_URL}/recurring-templates`);
                templateUrl.searchParams.set('origin_type', templateOriginType);
                if (normalizedOriginId) {
                    templateUrl.searchParams.set('origin_id', normalizedOriginId);
                }
                const templateResponsePromise = fetch(templateUrl.toString());
                const fieldPayloadPromise = isEventScope
                    ? fetch(`${API_URL}/event-template-fields?event_type_id=${normalizedOriginId}`).then((response) => readJson(response, 'Failed to load template fields'))
                    : Promise.resolve([]);
                const [fieldPayload, templateResponse] = await Promise.all([
                    fieldPayloadPromise,
                    templateResponsePromise
                ]);
                const templatePayload = await readJson(templateResponse, 'Failed to load recurring templates');
                const nextFields = cloneFieldsForEditor(Array.isArray(fieldPayload) ? fieldPayload : []);
                const nextLanes = buildLanesFromTemplates(Array.isArray(templatePayload) ? templatePayload : []);
                setFields(nextFields);
                setLanes(nextLanes);
                initialTemplateIds.current = new Set((Array.isArray(templatePayload) ? templatePayload : []).map((item) => item.id));
                if (nextLanes[0]?.steps[0]) {
                    setSelectedLaneId(nextLanes[0].laneId);
                    setSelectedStepId(nextLanes[0].steps[0].draftId);
                } else {
                    setSelectedLaneId('');
                    setSelectedStepId('');
                }
            } catch (error) {
                console.error('Failed to load template:', error);
                setFields([]);
                setLanes([]);
                setErrorMessage(error.message || 'Unable to load template.');
            } finally {
                setLoading(false);
            }
        };
        loadTemplate();
    }, [isEventScope, normalizedOriginId, templateOriginType]);

    useEffect(() => {
        if (!isEventScope || !selectedTypeId) {
            setPreviewEventOccurrenceId('');
            return;
        }
        let cancelled = false;
        const loadPreviewOccurrence = async () => {
            try {
                const response = await fetch(`${API_URL}/events`);
                const payload = await readJson(response, 'Failed to load events');
                const todayKey = new Date().toISOString().slice(0, 10);
                const candidates = (Array.isArray(payload) ? payload : [])
                    .filter((event) => String(event?.event_type_id || '') === String(selectedTypeId) && event?.occurrence_id)
                    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
                const next = candidates.find((event) => String(event?.date || '') >= todayKey) || candidates[0] || null;
                if (!cancelled) {
                    setPreviewEventOccurrenceId(next?.occurrence_id || '');
                }
            } catch (error) {
                console.error('Failed to load event preview occurrence:', error);
                if (!cancelled) {
                    setPreviewEventOccurrenceId('');
                }
            }
        };
        loadPreviewOccurrence();
        return () => {
            cancelled = true;
        };
    }, [isEventScope, selectedTypeId]);

    const selectedLane = lanes.find((lane) => lane.laneId === selectedLaneId) || null;
    const selectedStep = selectedLane?.steps.find((step) => step.draftId === selectedStepId) || null;
    const previewRows = lanes.flatMap((lane, laneIndex) => lane.steps.map((step, stepIndex) => ({
        key: `${lane.laneId}-${step.draftId}`,
        laneIndex,
        stepIndex,
        laneTitle: lane.listTitle || lane.listKey || 'Section',
        laneMode: lane.listMode,
        title: step.title || 'Untitled task',
        dueOffsetLabel: formatOffsetLabel(step.dueOffsetDays),
        active: !!step.active,
        priorityBase: step.priorityBase ?? 50
    })));
    const currentEventType = eventTypes.find((type) => String(type.id) === String(selectedTypeId)) || null;
    const currentOperationsScope = OPERATIONS_SCOPE_OPTIONS.find((option) => option.value === templateOriginId) || null;
    const scopeLabel = templateOriginType === 'event'
        ? (currentEventType?.name || 'Event Type')
        : templateOriginType === 'operations'
            ? (currentOperationsScope?.label || 'Weekly Operations')
            : (ORIGIN_TYPE_OPTIONS.find((option) => option.value === templateOriginType)?.label || 'Package');
    const scopeSubtitle = templateOriginType === 'event'
        ? (currentEventType?.category_name || 'Event package')
        : templateOriginType === 'operations'
            ? 'Recurring operations package'
            : `${scopeLabel} package`;
    const previewOriginId = templateOriginType === 'operations'
        ? (templateOriginId === 'weekly'
            ? `weekly-${new Date().toISOString().slice(0, 10)}`
            : templateOriginId === 'timesheets'
                ? 'timesheets-2026-04-a'
                : templateOriginId === 'monthly'
                    ? 'monthly-2026-04'
                    : templateOriginId === 'yearly'
                        ? 'yearly-2026'
                        : (templateOriginId || 'weekly'))
        : templateOriginType === 'event'
            ? 'preview-event'
            : `${templateOriginType}-preview`;
    const previewOrigin = {
        key: `preview:${templateOriginType}:${normalizedOriginId || 'default'}`,
        origin_type: templateOriginType,
        origin_id: previewOriginId,
        sample: {
            origin_type: templateOriginType,
            origin_id: previewOriginId,
            list_title: scopeLabel,
            text: scopeLabel,
            event_title: currentEventType?.name || scopeLabel,
            event_type_name: currentEventType?.name || scopeLabel,
            event_date: new Date().toISOString().slice(0, 10)
        },
        lists: lanes.map((lane) => ({
            key: lane.listKey,
            title: lane.listTitle,
            mode: lane.listMode,
            tasks: lane.steps.map((step) => ({
                id: step.draftId,
                text: step.title,
                title: step.title,
                list_key: lane.listKey,
                list_title: lane.listTitle,
                list_mode: lane.listMode,
                due_at: '',
                priority_effective: step.priorityBase ?? 50,
                state: step.active ? 'open' : 'done',
                completed: !step.active,
                origin_type: templateOriginType,
                origin_id: previewOriginId,
                event_title: currentEventType?.name || scopeLabel,
                event_type_name: currentEventType?.name || scopeLabel,
                event_date: new Date().toISOString().slice(0, 10)
            })),
            nextTask: null
        }))
    };
    previewOrigin.lists.forEach((list) => {
        list.nextTask = list.tasks.find((task) => !task.completed) || list.tasks[0] || null;
    });
    const workPackagePreview = getWorkPackageSummary(previewOrigin);
    const previewOriginLabel = formatOriginLabel(previewOrigin.sample);
    const previewTitle = getWorkPackageTitle(previewOrigin);
    const previewSubtitle = getWorkPackageSubtitle(previewOrigin);
    const taskPreviewRows = lanes.flatMap((lane) => lane.steps.map((step) => {
        const presentation = getSectionPresentation({
            originType: templateOriginType,
            listKey: lane.listKey,
            listTitle: lane.listTitle,
            taskText: step.title
        });
        return {
            key: `${lane.laneId}-${step.draftId}`,
            sectionTitle: lane.listTitle || lane.listKey || 'Section',
            sectionKey: lane.listKey || '',
            shortLabel: presentation.shortLabel,
            iconKey: presentation.iconKey,
            title: step.title || 'Untitled task',
            dueOffsetLabel: formatOffsetLabel(step.dueOffsetDays),
            priorityBase: step.priorityBase ?? 50,
            active: !!step.active,
            behaviorHelp: DATAPANE_BEHAVIOR_HELP[lane.listKey] || 'Custom or not-yet-mapped datapane behavior.',
            behaviorNotes: step.behaviorNotes || '',
            laneId: lane.laneId,
            stepId: step.draftId
        };
    }));
    const selectedPreviewTask = taskPreviewRows.find((row) => row.stepId === selectedStepId)
        || taskPreviewRows[0]
        || null;
    const selectedPreviewSectionKey = selectedLane?.listKey || taskPreviewRows[0]?.sectionKey || '';
    const livePreviewOriginId = templateOriginType === 'operations'
        ? (normalizedOriginId || 'weekly')
        : templateOriginType === 'sunday'
            ? getNextSundayDateKey()
            : templateOriginType === 'event'
                ? previewEventOccurrenceId
                : '';
    const liveOriginRoute = getOriginRoute({
        originType: templateOriginType,
        originId: livePreviewOriginId
    });

    const selectLane = (laneId) => {
        setSelectedLaneId(laneId);
        setSelectedStepId('');
    };

    const selectStep = (laneId, stepId) => {
        setSelectedLaneId(laneId);
        setSelectedStepId(stepId);
    };

    const updateField = (index, patch) => {
        setFields((prev) => prev.map((field, fieldIndex) => (
            fieldIndex === index ? { ...field, ...patch } : field
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
        setFields((prev) => prev.filter((_, fieldIndex) => fieldIndex !== index));
    };

    const insertLane = (tileKey, index = lanes.length) => {
        const tile = getTileForKey(tileKey);
        if (tile.key !== 'custom') {
            const existingLane = lanes.find((lane) => slugify(lane.listKey) === slugify(tile.listKey));
            if (existingLane) {
                insertStep(existingLane.laneId, tileKey);
                return existingLane;
            }
        }
        const nextLane = buildLaneFromTile(tileKey, lanes);
        setLanes((prev) => {
            const next = [...prev];
            next.splice(index, 0, nextLane);
            return next;
        });
        setSelectedLaneId(nextLane.laneId);
        setSelectedStepId(nextLane.steps[0]?.draftId || '');
        return nextLane;
    };

    const insertStep = (laneId, tileKey, insertIndex = null) => {
        let createdStepId = '';
        setLanes((prev) => prev.map((lane) => {
            if (lane.laneId !== laneId) return lane;
            const nextStep = buildStepFromTile(tileKey, lane.steps);
            createdStepId = nextStep.draftId;
            const nextSteps = [...lane.steps];
            if (insertIndex == null || insertIndex < 0 || insertIndex > nextSteps.length) {
                nextSteps.push(nextStep);
            } else {
                nextSteps.splice(insertIndex, 0, nextStep);
            }
            return { ...lane, steps: nextSteps };
        }));
        setSelectedLaneId(laneId);
        setSelectedStepId(createdStepId);
    };

    const updateLane = (laneId, patch) => {
        setLanes((prev) => prev.map((lane) => (
            lane.laneId === laneId ? { ...lane, ...patch } : lane
        )));
    };

    const applyLaneBehavior = (laneId, tileKey) => {
        const lane = lanes.find((entry) => entry.laneId === laneId);
        if (!lane) return;
        const nextTile = getTileForKey(tileKey);
        const duplicateLane = nextTile.key === 'custom'
            ? null
            : lanes.find((entry) => entry.laneId !== laneId && slugify(entry.listKey) === slugify(nextTile.listKey));
        if (duplicateLane) {
            setErrorMessage(`${nextTile.label} already exists in this package. Add another task to that section instead of creating a duplicate datapane key.`);
            return;
        }
        setErrorMessage('');
        updateLane(laneId, {
            libraryKey: nextTile.key,
            listKey: nextTile.key === 'custom' ? lane.listKey : nextTile.listKey,
            listTitle: nextTile.key === 'custom' ? lane.listTitle : nextTile.listTitle,
            listMode: nextTile.key === 'custom' ? lane.listMode : nextTile.listMode
        });
    };

    const updateStep = (laneId, stepId, patch) => {
        setLanes((prev) => prev.map((lane) => {
            if (lane.laneId !== laneId) return lane;
            return {
                ...lane,
                steps: lane.steps.map((step) => (
                    step.draftId === stepId ? { ...step, ...patch } : step
                ))
            };
        }));
    };

    const removeLane = (laneId) => {
        setLanes((prev) => {
            const next = prev.filter((lane) => lane.laneId !== laneId);
            if (selectedLaneId === laneId) {
                setSelectedLaneId(next[0]?.laneId || '');
                setSelectedStepId(next[0]?.steps[0]?.draftId || '');
            }
            return next;
        });
    };

    const removeStep = (laneId, stepId) => {
        setLanes((prev) => {
            const next = prev.flatMap((lane) => {
                if (lane.laneId !== laneId) return [lane];
                const remainingSteps = lane.steps.filter((step) => step.draftId !== stepId);
                if (!remainingSteps.length) return [];
                return [{ ...lane, steps: remainingSteps }];
            });
            if (selectedStepId === stepId) {
                const nextLane = next.find((lane) => lane.laneId === laneId) || next[0];
                setSelectedLaneId(nextLane?.laneId || '');
                setSelectedStepId(nextLane?.steps[0]?.draftId || '');
            }
            return next;
        });
    };

    const splitStepToOwnSection = (laneId, stepId) => {
        setLanes((prev) => {
            const sourceLane = prev.find((lane) => lane.laneId === laneId);
            const step = sourceLane?.steps.find((entry) => entry.draftId === stepId);
            if (!sourceLane || !step || sourceLane.steps.length <= 1) return prev;
            const detachedLane = buildLaneFromTile(step.libraryKey || sourceLane.libraryKey || 'custom', prev, {
                listTitle: step.title || sourceLane.listTitle,
                firstStep: {
                    ...step,
                    id: step.id || '',
                    draftId: createDraftId('step')
                }
            });
            const sourceIndex = prev.findIndex((lane) => lane.laneId === laneId);
            const withoutStep = prev.map((lane) => (
                lane.laneId === laneId
                    ? { ...lane, steps: lane.steps.filter((entry) => entry.draftId !== stepId) }
                    : lane
            ));
            const next = [...withoutStep];
            next.splice(sourceIndex + 1, 0, detachedLane);
            setSelectedLaneId(detachedLane.laneId);
            setSelectedStepId(detachedLane.steps[0]?.draftId || '');
            return next;
        });
    };

    useEffect(() => {
        if (!selectedPreviewSectionKey) {
            setLivePanelData(null);
            setLivePanelError('');
            setLivePanelLoading(false);
            setLiveEventDetails(null);
            setLiveEventDraft(null);
            setLiveEventSaveError('');
            return;
        }
        if (templateOriginType === 'vestry') {
            setLivePanelData({ kind: 'empty', title: 'Task Data' });
            setLivePanelError('');
            setLivePanelLoading(false);
            setLiveEventDetails(null);
            setLiveEventDraft(null);
            setLiveEventSaveError('');
            return;
        }
        if ((templateOriginType === 'sunday' || templateOriginType === 'event') && !livePreviewOriginId) {
            setLivePanelData({ kind: 'empty', title: 'Task Data' });
            setLivePanelError(templateOriginType === 'event'
                ? 'No existing occurrence is available yet for a live event datapane preview.'
                : 'No Sunday preview date is available.');
            setLivePanelLoading(false);
            setLiveEventDetails(null);
            setLiveEventDraft(null);
            setLiveEventSaveError('');
            return;
        }

        let cancelled = false;
        const loadLivePreview = async () => {
            setLivePanelLoading(true);
            setLivePanelError('');
            try {
                const params = new URLSearchParams({
                    origin_type: templateOriginType,
                    origin_id: livePreviewOriginId || '',
                    section_key: selectedPreviewSectionKey
                });
                const response = await fetch(`${API_URL}/tasks/panel-data?${params.toString()}`);
                const payload = await readJson(response, 'Failed to load live datapane preview');
                if (cancelled) return;
                setLivePanelData(payload);
                if (templateOriginType === 'event' && livePreviewOriginId) {
                    const detailsResponse = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(livePreviewOriginId)}`);
                    const detailsPayload = await readJson(detailsResponse, 'Failed to load event preview details');
                    if (cancelled) return;
                    setLiveEventDetails(detailsPayload);
                    setLiveEventDraft(buildEventEditorDraft(detailsPayload));
                    setLiveEventSaveError('');
                } else {
                    setLiveEventDetails(null);
                    setLiveEventDraft(null);
                    setLiveEventSaveError('');
                }
            } catch (error) {
                console.error('Failed to load live datapane preview:', error);
                if (!cancelled) {
                    setLivePanelData({ kind: 'empty', title: 'Task Data' });
                    setLivePanelError(error.message || 'Unable to load live datapane preview.');
                    setLiveEventDetails(null);
                    setLiveEventDraft(null);
                    setLiveEventSaveError('');
                }
            } finally {
                if (!cancelled) {
                    setLivePanelLoading(false);
                }
            }
        };
        loadLivePreview();
        return () => {
            cancelled = true;
        };
    }, [livePreviewOriginId, selectedPreviewSectionKey, templateOriginType]);

    const handleLiveEventDraftChange = (patch) => {
        setLiveEventDraft((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    const handleLivePreviewSave = () => {
        setLiveEventSaveError('Preview mode only. Save event changes from Calendar or the To Do datapane.');
    };

    const handleLivePackageStatus = () => {
        setLiveEventSaveError('Preview mode only. Future-package controls are disabled in the builder preview.');
    };

    const moveLane = (sourceLaneId, targetLaneId = null) => {
        if (!sourceLaneId) return;
        setLanes((prev) => {
            const sourceIndex = prev.findIndex((lane) => lane.laneId === sourceLaneId);
            if (sourceIndex < 0) return prev;
            const next = [...prev];
            const [movedLane] = next.splice(sourceIndex, 1);
            if (!targetLaneId) {
                next.push(movedLane);
                return next;
            }
            const targetIndex = next.findIndex((lane) => lane.laneId === targetLaneId);
            if (targetIndex < 0) {
                next.push(movedLane);
                return next;
            }
            next.splice(targetIndex, 0, movedLane);
            return next;
        });
    };

    const moveStep = (sourceLaneId, stepId, targetLaneId, targetStepId = null) => {
        if (!sourceLaneId || !stepId || !targetLaneId) return;
        setLanes((prev) => {
            const next = prev.map((lane) => ({ ...lane, steps: [...lane.steps] }));
            const sourceLane = next.find((lane) => lane.laneId === sourceLaneId);
            const targetLane = next.find((lane) => lane.laneId === targetLaneId);
            if (!sourceLane || !targetLane) return prev;
            const sourceIndex = sourceLane.steps.findIndex((step) => step.draftId === stepId);
            if (sourceIndex < 0) return prev;
            const [movedStep] = sourceLane.steps.splice(sourceIndex, 1);
            if (!movedStep) return prev;
            if (sourceLane.steps.length === 0) {
                const laneIndex = next.findIndex((lane) => lane.laneId === sourceLaneId);
                if (laneIndex >= 0) {
                    next.splice(laneIndex, 1);
                }
            }
            const finalTargetLane = next.find((lane) => lane.laneId === targetLaneId);
            if (!finalTargetLane) return next;
            if (!targetStepId) {
                finalTargetLane.steps.push(movedStep);
            } else {
                const targetIndex = finalTargetLane.steps.findIndex((step) => step.draftId === targetStepId);
                if (targetIndex < 0) {
                    finalTargetLane.steps.push(movedStep);
                } else {
                    finalTargetLane.steps.splice(targetIndex, 0, movedStep);
                }
            }
            return next;
        });
        setSelectedLaneId(targetLaneId);
        setSelectedStepId(stepId);
    };

    const handleDragStart = (event, payload) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    };

    const readDragPayload = (event) => {
        try {
            const raw = event.dataTransfer.getData('text/plain');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const handleBoardDrop = (event) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (!payload) return;
        if (payload.type === 'palette') {
            insertLane(payload.tileKey);
        }
        if (payload.type === 'lane') {
            moveLane(payload.laneId, null);
        }
    };

    const handleLaneDrop = (event, laneId) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (!payload) return;
        if (payload.type === 'lane' && payload.laneId !== laneId) {
            moveLane(payload.laneId, laneId);
        }
    };

    const handleLaneBodyDrop = (event, laneId) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (!payload) return;
        if (payload.type === 'palette') {
            insertStep(laneId, payload.tileKey);
            return;
        }
        if (payload.type === 'step') {
            moveStep(payload.laneId, payload.stepId, laneId, null);
        }
    };

    const handleStepDrop = (event, laneId, stepId) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (!payload) return;
        if (payload.type === 'palette') {
            const lane = lanes.find((entry) => entry.laneId === laneId);
            const stepIndex = lane?.steps.findIndex((entry) => entry.draftId === stepId) ?? -1;
            insertStep(laneId, payload.tileKey, stepIndex >= 0 ? stepIndex : null);
            return;
        }
        if (payload.type === 'step') {
            if (payload.stepId === stepId) return;
            moveStep(payload.laneId, payload.stepId, laneId, stepId);
        }
    };

    const handleClone = async () => {
        if (!cloneSourceId) return;
        if (templateOriginType === 'event' && cloneSourceId === normalizedOriginId) return;
        if (templateOriginType === 'operations' && cloneSourceId === normalizedOriginId) return;
        setErrorMessage('');
        setStatusMessage('');
        try {
            const templateUrl = new URL(`${API_URL}/recurring-templates`);
            templateUrl.searchParams.set('origin_type', templateOriginType);
            if (cloneSourceId) {
                templateUrl.searchParams.set('origin_id', cloneSourceId);
            }
            const templateResponsePromise = fetch(templateUrl.toString());
            const fieldPayloadPromise = templateOriginType === 'event'
                ? fetch(`${API_URL}/event-template-fields?event_type_id=${cloneSourceId}`).then((response) => readJson(response, 'Failed to load fields to clone'))
                : Promise.resolve([]);
            const [fieldPayload, templateResponse] = await Promise.all([
                fieldPayloadPromise,
                templateResponsePromise
            ]);
            const templatePayload = await readJson(templateResponse, 'Failed to load task package to clone');
            const nextFields = cloneFieldsForEditor(Array.isArray(fieldPayload) ? fieldPayload : []).map((field, index) => ({
                ...field,
                id: '',
                sort_order: index
            }));
            const nextLanes = cloneLanesForEditor(buildLanesFromTemplates(Array.isArray(templatePayload) ? templatePayload : []));
            setFields(nextFields);
            setLanes(nextLanes);
            initialTemplateIds.current = new Set();
            if (nextLanes[0]?.steps[0]) {
                setSelectedLaneId(nextLanes[0].laneId);
                setSelectedStepId(nextLanes[0].steps[0].draftId);
            }
            setStatusMessage('Template cloned. Review the package before saving.');
        } catch (error) {
            console.error('Failed to clone template:', error);
            setErrorMessage(error.message || 'Unable to clone this template.');
        }
    };

    const persistTemplate = async ({ successMessage = 'Template saved.' } = {}) => {
        if (isEventScope && !normalizedOriginId) return false;
        setSaving(true);
        setErrorMessage('');
        setStatusMessage('');
        try {
            const templateRows = buildTemplatesForSave(lanes, templateOriginType, normalizedOriginId || null);
            const fieldPayload = fields.map((field, index) => ({
                field_key: field.field_key || slugify(field.label),
                label: field.label,
                field_type: field.field_type,
                options: Array.isArray(field.options) ? field.options : [],
                placeholder: field.placeholder || '',
                help_text: field.help_text || '',
                sort_order: index,
                required: !!field.required
            }));

            if (isEventScope) {
                const saveFieldsResponse = await fetch(`${API_URL}/event-template-fields/${normalizedOriginId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: fieldPayload })
                });
                await readJson(saveFieldsResponse, 'Failed to save event fields');
            }

            const currentIds = new Set(templateRows.filter((item) => item.id).map((item) => item.id));
            const removedIds = [...initialTemplateIds.current].filter((id) => !currentIds.has(id));

            for (const item of templateRows) {
                const payload = {
                    origin_type: templateOriginType,
                    origin_id: normalizedOriginId || null,
                    list_key: item.list_key,
                    list_title: item.list_title,
                    list_mode: item.list_mode,
                    step_key: item.step_key,
                    title: item.title,
                    sort_order: item.sort_order,
                    due_offset_days: item.due_offset_days,
                    behavior_notes: item.behavior_notes,
                    priority_base: item.priority_base,
                    active: item.active
                };
                if (item.id) {
                    const response = await fetch(`${API_URL}/recurring-templates/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    await readJson(response, 'Failed to update a recurring template');
                } else {
                    const response = await fetch(`${API_URL}/recurring-templates`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    await readJson(response, 'Failed to create a recurring template');
                }
            }

            for (const id of removedIds) {
                const response = await fetch(`${API_URL}/recurring-templates/${id}`, { method: 'DELETE' });
                await readJson(response, 'Failed to delete a recurring template');
            }

            const refreshUrl = new URL(`${API_URL}/recurring-templates`);
            refreshUrl.searchParams.set('origin_type', templateOriginType);
            if (normalizedOriginId) {
                refreshUrl.searchParams.set('origin_id', normalizedOriginId);
            }
            const refreshResponse = await fetch(refreshUrl.toString());
            const refreshedTemplates = await readJson(refreshResponse, 'Failed to refresh template rows');
            const nextLanes = buildLanesFromTemplates(Array.isArray(refreshedTemplates) ? refreshedTemplates : []);
            setLanes(nextLanes);
            initialTemplateIds.current = new Set((Array.isArray(refreshedTemplates) ? refreshedTemplates : []).map((item) => item.id));
            if (nextLanes[0]?.steps[0]) {
                setSelectedLaneId(nextLanes[0].laneId);
                setSelectedStepId(nextLanes[0].steps[0].draftId);
            } else {
                setSelectedLaneId('');
                setSelectedStepId('');
            }
            setStatusMessage(successMessage);
            return true;
        } catch (error) {
            console.error('Failed to save template:', error);
            setErrorMessage(error.message || 'Unable to save this template.');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        await persistTemplate({ successMessage: 'Template saved.' });
    };

    const handleSeedFuture = async () => {
        if (isEventScope && !normalizedOriginId) return;
        const saved = await persistTemplate({ successMessage: 'Template saved. Seeding tasks...' });
        if (!saved) return;
        setSeeding(true);
        setErrorMessage('');
        try {
            const seedUrl = new URL(`${API_URL}/recurring-templates/seed`);
            seedUrl.searchParams.set('origin_type', templateOriginType);
            if (normalizedOriginId) {
                seedUrl.searchParams.set('origin_id', normalizedOriginId);
            }
            const response = await fetch(seedUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            await readJson(response, 'Failed to seed tasks from this package');
            setStatusMessage('Saved and seeded tasks for this package.');
        } catch (error) {
            console.error('Failed to seed future tasks:', error);
            setErrorMessage(error.message || 'Unable to seed tasks for this package.');
        } finally {
            setSeeding(false);
        }
    };

    return (
        <div className="page-event-templates">
            <header className="page-header-bar">
                <div className="page-header-title">
                    <h1>Task Packages</h1>
                    <p className="page-header-subtitle">Create and edit recurring packages for operations, Sunday, vestry, and event workflows in one builder.</p>
                </div>
                <div className="page-header-actions">
                    <button className="btn-secondary" type="button" onClick={handleSeedFuture} disabled={saving || seeding || (isEventScope && !normalizedOriginId)}>
                        <FaSeedling /> {seeding ? 'Seeding...' : 'Save + Seed Tasks'}
                    </button>
                    <button className="btn-primary" type="button" onClick={handleSave} disabled={saving || (isEventScope && !normalizedOriginId)}>
                        <FaSave /> {saving ? 'Saving...' : 'Save Package'}
                    </button>
                </div>
            </header>

            {errorMessage ? <div className="template-banner error">{errorMessage}</div> : null}
            {!errorMessage && statusMessage ? <div className="template-banner success">{statusMessage}</div> : null}

            <div className="event-template-layout">
                <Card className="event-template-sidebar">
                    <div className="template-sidebar-block">
                        <h3>Package Scope</h3>
                        <label className="template-control-label" htmlFor="package-origin-type">Origin type</label>
                        <select
                            id="package-origin-type"
                            value={templateOriginType}
                            onChange={(event) => {
                                const nextType = event.target.value;
                                setTemplateOriginType(nextType);
                                setCloneSourceId('');
                                if (nextType === 'operations') {
                                    setTemplateOriginId('weekly');
                                } else if (nextType === 'event') {
                                    setTemplateOriginId(null);
                                    if (!selectedTypeId && eventTypes[0]?.id) {
                                        setSelectedTypeId(String(eventTypes[0].id));
                                    }
                                } else {
                                    setTemplateOriginId(null);
                                }
                            }}
                        >
                            {ORIGIN_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>

                        {templateOriginType === 'operations' ? (
                            <>
                                <label className="template-control-label" htmlFor="operations-scope-select">Cadence</label>
                                <select id="operations-scope-select" value={templateOriginId || 'weekly'} onChange={(event) => setTemplateOriginId(event.target.value)}>
                                    {OPERATIONS_SCOPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </>
                        ) : null}

                        {templateOriginType === 'event' ? (
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
                        ) : (
                            <div className="template-scope-summary">
                                <strong>{scopeLabel}</strong>
                                <small>{scopeSubtitle}</small>
                            </div>
                        )}
                    </div>

                    <div className="template-sidebar-block">
                        <h3>Clone</h3>
                        <label className="template-control-label" htmlFor="clone-source-select">Clone from</label>
                        <select id="clone-source-select" value={cloneSourceId} onChange={(event) => setCloneSourceId(event.target.value)}>
                            <option value="">Select source</option>
                            {cloneOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button type="button" className="btn-secondary" onClick={handleClone} disabled={!cloneSourceId}>
                            <FaClone /> Clone Package
                        </button>
                    </div>

                    <div className="template-sidebar-block">
                        <div className="template-sidebar-headline">
                            <h3>Task Tiles</h3>
                            <button type="button" className="btn-secondary btn-compactish" onClick={() => insertLane('custom')}>
                                <FaPlus /> Empty Section
                            </button>
                        </div>
                        <p className="text-muted">Drag a tile into the board to create a section, or drop it into an existing section to add a task. The section behavior drives the datapane.</p>
                        <div className="template-tile-library">
                            {visibleTiles.map((tile) => {
                                const presentation = getSectionPresentation({
                                    originType: templateOriginType,
                                    listKey: tile.listKey,
                                    listTitle: tile.listTitle,
                                    taskText: tile.stepTitle
                                });
                                const Icon = getSectionIconComponent(presentation.iconKey);
                                return (
                                    <button
                                        key={tile.key}
                                        type="button"
                                        className="template-tile"
                                        draggable
                                        onDragStart={(event) => handleDragStart(event, { type: 'palette', tileKey: tile.key })}
                                        onClick={() => insertLane(tile.key)}
                                    >
                                        <span className="template-tile-icon"><Icon /></span>
                                        <span className="template-tile-copy">
                                            <strong>{tile.label}</strong>
                                            <small>{tile.description}</small>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </Card>

                <div className="event-template-main">
                    <Card className="event-template-board-card">
                        <div className="builder-toolbar">
                            <div>
                                <h3>Package Builder</h3>
                                <p className="text-muted">Build sections visually. Section order, task order, offsets, and priority all save back into the current recurring template rows.</p>
                            </div>
                            <div className="builder-toolbar-meta">
                                <span>{lanes.length} section{lanes.length === 1 ? '' : 's'}</span>
                                <span>{previewRows.length} task{previewRows.length === 1 ? '' : 's'}</span>
                            </div>
                        </div>

                        <div className={`event-template-board ${loading ? 'is-loading' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleBoardDrop}>
                            {loading ? <div className="template-empty-state">Loading template...</div> : null}
                            {!loading && lanes.length === 0 ? (
                                <div className="template-empty-state">
                                    <strong>No package yet.</strong>
                                    <span>Drag a tile here to create the first section.</span>
                                </div>
                            ) : null}

                            {!loading && lanes.map((lane) => {
                                const presentation = getSectionPresentation({
                                    originType: templateOriginType,
                                    listKey: lane.listKey,
                                    listTitle: lane.listTitle,
                                    taskText: lane.steps[0]?.title || ''
                                });
                                const Icon = getSectionIconComponent(presentation.iconKey);
                                return (
                                    <section
                                        key={lane.laneId}
                                        className={`template-lane ${selectedLaneId === lane.laneId && !selectedStepId ? 'is-selected' : ''}`}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => handleLaneDrop(event, lane.laneId)}
                                    >
                                        <header className="template-lane-header" draggable onDragStart={(event) => handleDragStart(event, { type: 'lane', laneId: lane.laneId })} onClick={() => selectLane(lane.laneId)}>
                                            <div className="template-lane-title">
                                                <span className="template-lane-handle"><FaGripVertical /></span>
                                                <span className="template-lane-icon"><Icon /></span>
                                                <div>
                                                    <strong>{lane.listTitle || lane.listKey}</strong>
                                                    <small>{lane.listMode}</small>
                                                </div>
                                            </div>
                                            <div className="template-lane-actions">
                                                <button
                                                    type="button"
                                                    className="btn-secondary btn-compactish"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        insertStep(lane.laneId, lane.libraryKey || 'custom');
                                                    }}
                                                >
                                                    <FaPlus /> Task
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-secondary btn-compactish"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        removeLane(lane.laneId);
                                                    }}
                                                >
                                                    <FaTrash />
                                                </button>
                                            </div>
                                        </header>

                                        <div className="template-lane-body" onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleLaneBodyDrop(event, lane.laneId)}>
                                            {lane.steps.map((step) => (
                                                <button
                                                    key={step.draftId}
                                                    type="button"
                                                    className={`template-step ${selectedStepId === step.draftId ? 'is-selected' : ''} ${step.active ? '' : 'is-inactive'}`}
                                                    draggable
                                                    onDragStart={(event) => handleDragStart(event, { type: 'step', laneId: lane.laneId, stepId: step.draftId })}
                                                    onDragOver={(event) => event.preventDefault()}
                                                    onDrop={(event) => handleStepDrop(event, lane.laneId, step.draftId)}
                                                    onClick={() => selectStep(lane.laneId, step.draftId)}
                                                >
                                                    <span className="template-step-meta">
                                                        <span className="template-step-grip"><FaGripVertical /></span>
                                                        <span className="template-step-copy">
                                                            <strong>{step.title || 'Untitled task'}</strong>
                                                            <small>{formatOffsetLabel(step.dueOffsetDays)} | P{step.priorityBase ?? 50}</small>
                                                        </span>
                                                    </span>
                                                    <span className={`template-step-state ${step.active ? 'is-active' : 'is-muted'}`}>
                                                        {step.active ? 'Active' : 'Off'}
                                                    </span>
                                                </button>
                                            ))}
                                            <div className="template-lane-dropzone">Drop a tile here to add a task</div>
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    </Card>

                    <div className="event-template-secondary-grid">
                        <Card className="event-template-inspector">
                            <h3>Inspector</h3>
                            {!selectedLane && !selectedStep ? (
                                <p className="text-muted">Select a section or task to edit its attributes.</p>
                            ) : null}

                            {selectedLane && !selectedStep ? (
                                <div className="inspector-form">
                                    <label>
                                        <span>Datapane behavior</span>
                                        <select value={selectedLane.libraryKey || 'custom'} onChange={(event) => applyLaneBehavior(selectedLane.laneId, event.target.value)}>
                                            {visibleTiles.map((tile) => (
                                                <option key={tile.key} value={tile.key}>{tile.label}</option>
                                            ))}
                                        </select>
                                        <small>This section key determines what the detail datapane shows when the task package is opened.</small>
                                    </label>
                                    <label>
                                        <span>Section title</span>
                                        <input type="text" value={selectedLane.listTitle} onChange={(event) => updateLane(selectedLane.laneId, { listTitle: event.target.value })} />
                                    </label>
                                    <label>
                                        <span>Section key</span>
                                        <input type="text" value={selectedLane.listKey} onChange={(event) => updateLane(selectedLane.laneId, { listKey: slugify(event.target.value) })} />
                                        <small>Use a custom key only when you want nonstandard behavior.</small>
                                    </label>
                                    <label>
                                        <span>Flow mode</span>
                                        <select value={selectedLane.listMode} onChange={(event) => updateLane(selectedLane.laneId, { listMode: event.target.value })}>
                                            {LIST_MODE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <div className="inspector-inline-actions">
                                        <button type="button" className="btn-secondary" onClick={() => insertStep(selectedLane.laneId, selectedLane.libraryKey || 'custom')}>
                                            <FaPlus /> Add Task
                                        </button>
                                        <button type="button" className="btn-secondary" onClick={() => removeLane(selectedLane.laneId)}>
                                            <FaTrash /> Delete Section
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {selectedLane && selectedStep ? (
                                <div className="inspector-form">
                                    <label>
                                        <span>Section behavior</span>
                                        <input type="text" value={selectedLane.listKey} disabled />
                                        <small>If this task needs a different datapane, split it into its own section.</small>
                                    </label>
                                    <label>
                                        <span>Task title</span>
                                        <input type="text" value={selectedStep.title} onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, { title: event.target.value })} />
                                    </label>
                                    <label>
                                        <span>Step key</span>
                                        <input type="text" value={selectedStep.stepKey} onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, { stepKey: slugify(event.target.value) })} />
                                    </label>
                                    <label>
                                        <span>Due offset</span>
                                        <input
                                            type="number"
                                            value={selectedStep.dueOffsetDays}
                                            onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, {
                                                dueOffsetDays: event.target.value === '' ? '' : parseNumberInput(event.target.value, '')
                                            })}
                                        />
                                        <small>{formatOffsetLabel(selectedStep.dueOffsetDays)}</small>
                                    </label>
                                    <label>
                                        <span>Priority base</span>
                                        <input
                                            type="number"
                                            value={selectedStep.priorityBase}
                                            onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, { priorityBase: parseNumberInput(event.target.value, 50) })}
                                        />
                                    </label>
                                    <label>
                                        <span>Datapane notes</span>
                                        <textarea
                                            rows="4"
                                            value={selectedStep.behaviorNotes || ''}
                                            onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, { behaviorNotes: event.target.value })}
                                            placeholder="Describe, in plain language, what this datapane should show or let you do."
                                        />
                                        <small>These notes are saved with the template so I can use them to implement deeper datapane behavior changes later.</small>
                                    </label>
                                    <label className="inspector-toggle">
                                        <input type="checkbox" checked={!!selectedStep.active} onChange={(event) => updateStep(selectedLane.laneId, selectedStep.draftId, { active: event.target.checked })} />
                                        <span>Active</span>
                                    </label>
                                    <div className="inspector-inline-actions">
                                        {selectedLane.steps.length > 1 ? (
                                            <button type="button" className="btn-secondary" onClick={() => splitStepToOwnSection(selectedLane.laneId, selectedStep.draftId)}>
                                                <FaClone /> Split To Section
                                            </button>
                                        ) : null}
                                        <button type="button" className="btn-secondary" onClick={() => setSelectedStepId('')}>
                                            <FaLayerGroup /> Edit Section
                                        </button>
                                        <button type="button" className="btn-secondary" onClick={() => removeStep(selectedLane.laneId, selectedStep.draftId)}>
                                            <FaTrash /> Delete Task
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </Card>

                        <Card className="event-template-preview">
                            <h3>Preview</h3>
                            {!previewRows.length ? (
                                <p className="text-muted">Your generated package preview will appear here.</p>
                            ) : (
                                <div className="template-preview-stack">
                                    <article className={`package-card template-preview-package ${getOriginColorClass(previewOrigin.sample?.origin_type)}`}>
                                        <div className="package-card-accent" aria-hidden="true" />
                                        <div className="package-card-head">
                                            <div className="package-card-kicker">
                                                <span className="package-origin-label">{previewOriginLabel}</span>
                                                <span className="package-bucket-pill">Preview</span>
                                            </div>
                                            <div className="package-card-title">{previewTitle}</div>
                                            <div className="package-card-subtitle">{previewSubtitle}</div>
                                        </div>
                                        <div className="package-section-strip">
                                            {workPackagePreview.sections.map((section) => {
                                                const Icon = getSectionIconComponent(section.iconKey);
                                                return (
                                                    <div key={section.key} className={`section-node attention-${section.attention}`}>
                                                        <div className="section-node-button">
                                                            <span className={`section-node-icon state-${section.status}`}>
                                                                <Icon />
                                                                {section.dueIndicator ? <span className={`section-due-chip is-${section.dueIndicator}`}>{section.dueIndicator === 'overdue' ? '!' : ''}</span> : null}
                                                            </span>
                                                            <span className="section-node-label">{section.shortLabel}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </article>

                                    <div className="template-preview-task-list">
                                        {taskPreviewRows.map((row) => {
                                            const Icon = getSectionIconComponent(row.iconKey);
                                            const isSelected = row.stepId === selectedStepId;
                                            return (
                                                <button
                                                    key={row.key}
                                                    type="button"
                                                    className={`template-task-preview-card ${row.active ? '' : 'is-inactive'} ${isSelected ? 'is-selected' : ''}`}
                                                    onClick={() => selectStep(row.laneId, row.stepId)}
                                                >
                                                    <div className="template-task-preview-head">
                                                        <div className="template-task-preview-title">
                                                            <span className="template-task-preview-icon"><Icon /></span>
                                                            <div>
                                                                <strong>{row.title}</strong>
                                                                <small>{row.sectionTitle} | {row.sectionKey}</small>
                                                            </div>
                                                        </div>
                                                        <div className="template-preview-meta">
                                                            <span>{row.dueOffsetLabel}</span>
                                                            <span>P{row.priorityBase ?? 50}</span>
                                                        </div>
                                                    </div>
                                                    <div className="template-task-preview-body">
                                                        <div className="template-task-preview-line">
                                                            <span className="template-preview-label">Datapane</span>
                                                            <span>{row.behaviorHelp}</span>
                                                        </div>
                                                        <div className="template-task-preview-line">
                                                            <span className="template-preview-label">Notes</span>
                                                            <span>{row.behaviorNotes || 'No task-specific datapane notes yet.'}</span>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="event-template-live-panel-block">
                                        <div className="event-template-live-panel-head">
                                            <div>
                                                <h4>Live Datapane</h4>
                                                <p className="text-muted">
                                                    {selectedPreviewTask
                                                        ? `${selectedPreviewTask.title} | ${selectedPreviewTask.sectionTitle}`
                                                        : 'Select a task to load its datapane.'}
                                                </p>
                                            </div>
                                            <div className="event-template-live-panel-meta">
                                                <span>{selectedPreviewSectionKey || 'No section selected'}</span>
                                                <span>Read-only preview</span>
                                            </div>
                                        </div>
                                        {livePanelError ? <div className="template-banner error compact">{livePanelError}</div> : null}
                                        {livePanelLoading ? (
                                            <div className="task-panel-empty">Loading live datapane preview...</div>
                                        ) : (
                                            <div className="event-template-live-panel-frame">
                                                <div className="event-template-live-panel-readonly">Preview only</div>
                                                <div className="event-template-live-panel-surface">
                                                    {renderPanelContent({
                                                        panelData: livePanelData,
                                                        selectedSectionKey: selectedPreviewSectionKey,
                                                        originRoute: liveOriginRoute,
                                                        eventEditorProps: {
                                                            details: liveEventDetails,
                                                            draft: liveEventDraft,
                                                            saving: false,
                                                            saveError: liveEventSaveError,
                                                            onDraftChange: handleLiveEventDraftChange,
                                                            onSave: handleLivePreviewSave,
                                                            onPackageStatus: handleLivePackageStatus
                                                        },
                                                        ordersPanelProps: {
                                                            onRefresh: () => {},
                                                            onActivity: () => {}
                                                        }
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>

                    {isEventScope ? (
                        <Card className="event-template-fields-card">
                            <div className="builder-toolbar">
                                <div>
                                    <h3>Event Variables</h3>
                                    <p className="text-muted">Keep this lean. Missing event data should surface as calendar flags. Only create task sections here for work that genuinely belongs in the to-do system.</p>
                                </div>
                                <button type="button" className="btn-secondary" onClick={addField}>
                                    <FaPlus /> Add Field
                                </button>
                            </div>
                            {!fields.length ? <p className="text-muted">No event-specific fields yet.</p> : null}
                            <div className="event-template-fields-grid">
                                {fields.map((field, index) => (
                                    <div key={`${field.field_key || 'field'}-${index}`} className="event-template-field-card">
                                        <div className="event-template-field-head">
                                            <strong>{field.label || 'Untitled field'}</strong>
                                            <button type="button" className="btn-secondary btn-compactish" onClick={() => removeField(index)}>
                                                <FaTrash />
                                            </button>
                                        </div>
                                        <div className="event-template-field-form">
                                            <label>
                                                <span>Label</span>
                                                <input
                                                    type="text"
                                                    value={field.label}
                                                    onChange={(event) => updateField(index, {
                                                        label: event.target.value,
                                                        field_key: field.field_key || slugify(event.target.value)
                                                    })}
                                                />
                                            </label>
                                            <label>
                                                <span>Key</span>
                                                <input type="text" value={field.field_key} onChange={(event) => updateField(index, { field_key: slugify(event.target.value) })} />
                                            </label>
                                            <label>
                                                <span>Type</span>
                                                <select value={field.field_type} onChange={(event) => updateField(index, { field_type: event.target.value })}>
                                                    {FIELD_TYPES.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label>
                                                <span>Placeholder</span>
                                                <input type="text" value={field.placeholder} onChange={(event) => updateField(index, { placeholder: event.target.value })} />
                                            </label>
                                            <label className="event-template-field-span">
                                                <span>Options</span>
                                                <input
                                                    type="text"
                                                    value={(field.options || []).join(', ')}
                                                    disabled={field.field_type !== 'select'}
                                                    onChange={(event) => updateField(index, {
                                                        options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean)
                                                    })}
                                                />
                                            </label>
                                            <label className="event-template-field-span">
                                                <span>Help text</span>
                                                <input type="text" value={field.help_text} onChange={(event) => updateField(index, { help_text: event.target.value })} />
                                            </label>
                                            <label className="inspector-toggle">
                                                <input type="checkbox" checked={!!field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />
                                                <span>Required</span>
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ) : (
                        <Card className="event-template-fields-card">
                            <h3>Template Notes</h3>
                            <p className="text-muted">Event variables only apply to event-type packages. This scope saves recurring task packages only.</p>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventTemplates;
