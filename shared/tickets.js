const STATUS_OPTIONS = [
    { value: 'new', label: 'New', lane: 'intake' },
    { value: 'open', label: 'Open', lane: 'active' },
    { value: 'in_progress', label: 'In Progress', lane: 'active' },
    { value: 'blocked', label: 'Blocked', lane: 'risk' },
    { value: 'done', label: 'Done', lane: 'closed' },
    { value: 'wont_do', label: "Won't Do", lane: 'closed' }
];

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low', rank: 1 },
    { value: 'normal', label: 'Normal', rank: 2 },
    { value: 'high', label: 'High', rank: 3 },
    { value: 'critical', label: 'Critical', rank: 4 }
];

const CATEGORY_OPTIONS = [
    { value: 'general', label: 'General' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'plumbing', label: 'Plumbing' },
    { value: 'hvac', label: 'HVAC' },
    { value: 'grounds', label: 'Grounds' },
    { value: 'interior', label: 'Interior' },
    { value: 'safety', label: 'Safety' },
    { value: 'access', label: 'Access / Entry' },
    { value: 'cleaning', label: 'Cleaning' }
];

export const TICKET_STATUS_OPTIONS = Object.freeze(STATUS_OPTIONS);
export const TICKET_PRIORITY_OPTIONS = Object.freeze(PRIORITY_OPTIONS);
export const TICKET_CATEGORY_OPTIONS = Object.freeze(CATEGORY_OPTIONS);
export const TICKET_CLOSED_STATUSES = Object.freeze(['done', 'wont_do']);
export const TICKET_FOCUS_OPTIONS = Object.freeze([
    { value: 'active', label: 'All Active' },
    { value: 'triage', label: 'Needs Triage' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'urgent', label: 'Urgent' },
    { value: 'due_soon', label: 'Due Soon' },
    { value: 'no_vendor', label: 'No Vendor' }
]);

const LEGACY_STATUS_MAP = Object.freeze({
    reviewed: 'open',
    in_process: 'in_progress',
    closed: 'done'
});

const STATUS_SET = new Set(STATUS_OPTIONS.map((option) => option.value));
const PRIORITY_SET = new Set(PRIORITY_OPTIONS.map((option) => option.value));
const CATEGORY_SET = new Set(CATEGORY_OPTIONS.map((option) => option.value));
const CLOSED_STATUS_SET = new Set(TICKET_CLOSED_STATUSES);

const normalizeKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const toStartOfDay = (date) => {
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const parseTicketDate = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTicketDate = (value) => {
    const parsed = parseTicketDate(value);
    if (!parsed) return '';
    return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const normalizeTicketStatus = (value, fallback = 'new') => {
    const normalized = normalizeKey(value);
    if (!normalized) return fallback;
    const mapped = LEGACY_STATUS_MAP[normalized] || normalized;
    return STATUS_SET.has(mapped) ? mapped : fallback;
};

export const normalizeTicketPriority = (value, fallback = 'normal') => {
    const normalized = normalizeKey(value);
    if (!normalized) return fallback;
    if (normalized === 'urgent') return 'high';
    if (normalized === 'routine') return 'low';
    return PRIORITY_SET.has(normalized) ? normalized : fallback;
};

export const normalizeTicketCategory = (value, fallback = 'general') => {
    const normalized = normalizeKey(value);
    if (!normalized) return fallback;
    if (normalized === 'security') return 'safety';
    if (normalized === 'janitorial') return 'cleaning';
    return CATEGORY_SET.has(normalized) ? normalized : fallback;
};

export const getTicketStatusMeta = (value) => {
    const normalized = normalizeTicketStatus(value);
    return STATUS_OPTIONS.find((option) => option.value === normalized) || STATUS_OPTIONS[0];
};

export const getTicketPriorityMeta = (value) => {
    const normalized = normalizeTicketPriority(value);
    return PRIORITY_OPTIONS.find((option) => option.value === normalized) || PRIORITY_OPTIONS[1];
};

export const getTicketCategoryMeta = (value) => {
    const normalized = normalizeTicketCategory(value);
    return CATEGORY_OPTIONS.find((option) => option.value === normalized) || CATEGORY_OPTIONS[0];
};

export const getTicketStatusLabel = (value) => getTicketStatusMeta(value).label;
export const getTicketPriorityLabel = (value) => getTicketPriorityMeta(value).label;
export const getTicketCategoryLabel = (value) => getTicketCategoryMeta(value).label;

export const isTicketClosedStatus = (value) => {
    const normalized = LEGACY_STATUS_MAP[normalizeKey(value)] || normalizeKey(value);
    return CLOSED_STATUS_SET.has(normalized);
};

export const getTicketDueMeta = (ticket = {}, { today = new Date() } = {}) => {
    if (isTicketClosedStatus(ticket?.status)) {
        return { key: 'closed', label: 'Closed', rank: 5, overdue: false };
    }

    const targetDate = parseTicketDate(ticket?.target_date);
    if (!targetDate) {
        return { key: 'none', label: 'No target date', rank: 4, overdue: false };
    }

    const todayStart = toStartOfDay(today);
    const targetStart = toStartOfDay(targetDate);
    if (!todayStart || !targetStart) {
        return { key: 'none', label: 'No target date', rank: 4, overdue: false };
    }

    const deltaDays = Math.round((targetStart.getTime() - todayStart.getTime()) / 86400000);
    if (deltaDays < 0) {
        return { key: 'overdue', label: `Overdue since ${formatTicketDate(ticket?.target_date)}`, rank: 0, overdue: true };
    }
    if (deltaDays === 0) {
        return { key: 'today', label: 'Due today', rank: 1, overdue: false };
    }
    if (deltaDays <= 7) {
        return { key: 'soon', label: `Due ${formatTicketDate(ticket?.target_date)}`, rank: 2, overdue: false };
    }
    return { key: 'future', label: `Target ${formatTicketDate(ticket?.target_date)}`, rank: 3, overdue: false };
};

export const matchesTicketFocus = (ticket = {}, focus = 'active', options = {}) => {
    const normalizedFocus = normalizeKey(focus) || 'active';
    const status = normalizeTicketStatus(ticket?.status);
    const priority = normalizeTicketPriority(ticket?.priority);
    const due = getTicketDueMeta(ticket, options);
    const vendorId = String(ticket?.vendor_id || '').trim();

    if (normalizedFocus === 'active') return !isTicketClosedStatus(status);
    if (normalizedFocus === 'triage') return ['new', 'open'].includes(status);
    if (normalizedFocus === 'blocked') return status === 'blocked';
    if (normalizedFocus === 'urgent') return !isTicketClosedStatus(status) && ['high', 'critical'].includes(priority);
    if (normalizedFocus === 'due_soon') return !isTicketClosedStatus(status) && ['overdue', 'today', 'soon'].includes(due.key);
    if (normalizedFocus === 'no_vendor') return !isTicketClosedStatus(status) && !vendorId;
    return true;
};

export const normalizeTicketRecord = (ticket = {}) => ({
    ...ticket,
    status: normalizeTicketStatus(ticket?.status),
    priority: normalizeTicketPriority(ticket?.priority),
    category: normalizeTicketCategory(ticket?.category),
    areas: Array.isArray(ticket?.areas)
        ? ticket.areas.map((areaId) => String(areaId || '').trim()).filter(Boolean)
        : [],
    notes: Array.isArray(ticket?.notes) ? ticket.notes : [],
    tasks: Array.isArray(ticket?.tasks) ? ticket.tasks : [],
    requested_by: String(ticket?.requested_by || ticket?.requestedBy || '').trim(),
    assigned_to: String(ticket?.assigned_to || ticket?.assignedTo || '').trim(),
    vendor_id: String(ticket?.vendor_id || ticket?.vendorId || '').trim(),
    target_date: String(ticket?.target_date || ticket?.targetDate || '').trim()
});

export const summarizeTickets = (tickets = [], options = {}) => {
    const normalizedTickets = tickets.map(normalizeTicketRecord);
    return normalizedTickets.reduce((summary, ticket) => {
        summary.total += 1;

        if (isTicketClosedStatus(ticket.status)) {
            summary.closed += 1;
            return summary;
        }

        summary.active += 1;
        if (ticket.status === 'new' || ticket.status === 'open') summary.triage += 1;
        if (ticket.status === 'blocked') summary.blocked += 1;

        const priority = normalizeTicketPriority(ticket.priority);
        if (priority === 'critical') summary.critical += 1;
        if (priority === 'high' || priority === 'critical') summary.urgent += 1;
        if (!String(ticket.vendor_id || '').trim()) summary.no_vendor += 1;

        const due = getTicketDueMeta(ticket, options);
        if (due.key === 'overdue') summary.overdue += 1;
        if (due.key === 'today' || due.key === 'soon' || due.key === 'overdue') summary.due_soon += 1;

        return summary;
    }, {
        total: 0,
        active: 0,
        closed: 0,
        triage: 0,
        blocked: 0,
        urgent: 0,
        critical: 0,
        overdue: 0,
        due_soon: 0,
        no_vendor: 0
    });
};

export const sortTicketsForQueue = (tickets = [], options = {}) => tickets
    .map(normalizeTicketRecord)
    .slice()
    .sort((a, b) => {
        const aClosed = isTicketClosedStatus(a.status);
        const bClosed = isTicketClosedStatus(b.status);
        if (aClosed !== bClosed) return Number(aClosed) - Number(bClosed);

        const aDue = getTicketDueMeta(a, options);
        const bDue = getTicketDueMeta(b, options);
        if (aDue.rank !== bDue.rank) return aDue.rank - bDue.rank;

        const aPriority = getTicketPriorityMeta(a.priority).rank;
        const bPriority = getTicketPriorityMeta(b.priority).rank;
        if (aPriority !== bPriority) return bPriority - aPriority;

        const aUpdated = new Date(a.updated_at || a.created_at || 0).getTime();
        const bUpdated = new Date(b.updated_at || b.created_at || 0).getTime();
        return (Number.isNaN(bUpdated) ? 0 : bUpdated) - (Number.isNaN(aUpdated) ? 0 : aUpdated);
    });
