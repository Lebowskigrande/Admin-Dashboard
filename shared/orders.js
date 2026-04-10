const ORDER_ITEM_STATUSES = [
    { value: 'needed', label: 'Needed' },
    { value: 'sourcing', label: 'Sourcing' },
    { value: 'ordered', label: 'Ordered' },
    { value: 'partially_received', label: 'Partially Received' },
    { value: 'received', label: 'Received' },
    { value: 'return_pending', label: 'Return Pending' },
    { value: 'returned', label: 'Returned' },
    { value: 'cancelled', label: 'Cancelled' }
];

const PURCHASE_ORDER_STATUSES = [
    { value: 'draft', label: 'Draft' },
    { value: 'placed', label: 'Placed' },
    { value: 'partially_received', label: 'Partially Received' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'return_open', label: 'Return Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'cancelled', label: 'Cancelled' }
];

const ORDER_PRIORITIES = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
];

const ORDER_CATEGORIES = [
    { value: 'office', label: 'Office' },
    { value: 'facilities', label: 'Facilities' },
    { value: 'liturgy', label: 'Liturgy' },
    { value: 'hospitality', label: 'Hospitality' },
    { value: 'tech', label: 'Tech' },
    { value: 'events', label: 'Events' },
    { value: 'finance', label: 'Finance' },
    { value: 'other', label: 'Other' }
];

const ORDER_ITEM_STATUS_SET = new Set(ORDER_ITEM_STATUSES.map((option) => option.value));
const PURCHASE_ORDER_STATUS_SET = new Set(PURCHASE_ORDER_STATUSES.map((option) => option.value));
const ORDER_PRIORITY_SET = new Set(ORDER_PRIORITIES.map((option) => option.value));
const ORDER_CATEGORY_SET = new Set(ORDER_CATEGORIES.map((option) => option.value));
const EMAIL_ORDER_STATUS_SET = new Set(['ordered', 'shipped', 'out_for_delivery', 'delivered']);

const MATCH_STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'your', 'order', 'package', 'shipment',
    'delivery', 'item', 'items', 'new', 'product', 'page', 'amazon', 'com', 'www'
]);

const normalizeKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const parseCurrency = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/[^0-9.-]+/g, ''));
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 100) / 100;
};

const parseWholeNumber = (value, fallback = 0) => {
    const numeric = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeText = (value = '') => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenizeMatchText = (value = '') => normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !MATCH_STOP_WORDS.has(token));

const extractUrlMatchText = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const url = new URL(text);
        return `${url.hostname} ${url.pathname}`.replace(/[/.?=&_-]+/g, ' ');
    } catch {
        return text;
    }
};

const byLatest = (a, b) => String(b.latestAt || b.updated_at || b.created_at || '').localeCompare(String(a.latestAt || a.updated_at || a.created_at || ''));
const byNeededDate = (a, b) => String(a.needed_by || '9999-12-31').localeCompare(String(b.needed_by || '9999-12-31'))
    || String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));

const scoreOrderMatch = (item, emailOrder) => {
    const itemTitle = normalizeText(item?.title || '');
    const packageTitle = normalizeText(emailOrder?.packageName || '');
    if (!itemTitle || !packageTitle) return 0;

    if (itemTitle.length >= 8 && (packageTitle.includes(itemTitle) || itemTitle.includes(packageTitle))) {
        return 0.98;
    }

    const itemTokens = new Set([
        ...tokenizeMatchText(item?.title || ''),
        ...tokenizeMatchText(extractUrlMatchText(item?.order_url || ''))
    ]);
    const packageTokens = new Set(tokenizeMatchText(emailOrder?.packageName || ''));
    if (!itemTokens.size || !packageTokens.size) return 0;

    const overlap = [...itemTokens].filter((token) => packageTokens.has(token));
    if (!overlap.length) return 0;

    const coverage = overlap.length / Math.min(itemTokens.size, packageTokens.size);
    if (overlap.length >= 2 && coverage >= 0.6) {
        return Math.min(0.95, 0.7 + (coverage / 4));
    }
    if (overlap.length === 1 && itemTokens.size === 1) {
        const [token] = overlap;
        if (token.length >= 6) return 0.72;
    }
    return 0;
};

const buildItemEntry = (item, tracking = null) => ({
    id: `manual:${item.id}`,
    source: 'manual',
    item,
    tracking
});

const buildEmailEntry = (tracking) => ({
    id: `email:${tracking.id}`,
    source: 'email',
    item: null,
    tracking
});

export const normalizeOrderItemStatus = (value) => {
    const normalized = normalizeKey(value);
    if (normalized === 'partial' || normalized === 'partially_delivered') return 'partially_received';
    if (normalized === 'delivered') return 'received';
    if (normalized === 'return_requested') return 'return_pending';
    return ORDER_ITEM_STATUS_SET.has(normalized) ? normalized : 'needed';
};

export const normalizePurchaseOrderStatus = (value) => {
    const normalized = normalizeKey(value);
    if (normalized === 'ordered') return 'placed';
    if (normalized === 'partially_delivered') return 'partially_received';
    if (normalized === 'received') return 'delivered';
    if (normalized === 'returned') return 'return_open';
    return PURCHASE_ORDER_STATUS_SET.has(normalized) ? normalized : 'draft';
};

export const normalizeOrderPriority = (value) => {
    const normalized = normalizeKey(value);
    if (normalized === 'medium') return 'normal';
    return ORDER_PRIORITY_SET.has(normalized) ? normalized : 'normal';
};

export const normalizeOrderCategory = (value) => {
    const normalized = normalizeKey(value);
    return ORDER_CATEGORY_SET.has(normalized) ? normalized : 'other';
};

export const normalizeEmailOrderRecord = (record = {}) => ({
    id: String(record.id || '').trim(),
    packageName: String(record.packageName || '').trim() || 'Package',
    carrier: String(record.carrier || '').trim(),
    trackingNumber: String(record.trackingNumber || '').trim(),
    trackingNumberDisplay: String(record.trackingNumberDisplay || '').trim(),
    orderNumber: String(record.orderNumber || '').trim(),
    latestStatus: EMAIL_ORDER_STATUS_SET.has(normalizeKey(record.latestStatus).replace(/_/g, '_'))
        ? normalizeKey(record.latestStatus)
        : 'ordered',
    latestStatusLabel: String(record.latestStatusLabel || '').trim(),
    latestAt: String(record.latestAt || '').trim(),
    updates: Array.isArray(record.updates) ? record.updates : [],
    progress: Array.isArray(record.progress) ? record.progress : []
});

export const normalizeOrderItemRecord = (record = {}) => ({
    id: String(record.id || '').trim(),
    title: String(record.title || '').trim(),
    description: String(record.description || '').trim(),
    vendor_name: String(record.vendor_name || '').trim(),
    category: normalizeOrderCategory(record.category),
    priority: normalizeOrderPriority(record.priority),
    quantity: Math.max(1, parseWholeNumber(record.quantity, 1)),
    unit: String(record.unit || '').trim(),
    estimated_cost: parseCurrency(record.estimated_cost),
    requested_by: String(record.requested_by || '').trim(),
    needed_by: String(record.needed_by || '').trim(),
    status: normalizeOrderItemStatus(record.status),
    purchase_order_id: String(record.purchase_order_id || '').trim(),
    order_url: String(record.order_url || '').trim(),
    notes: String(record.notes || '').trim(),
    received_quantity: Math.max(0, parseWholeNumber(record.received_quantity, 0)),
    returned_quantity: Math.max(0, parseWholeNumber(record.returned_quantity, 0)),
    return_reason: String(record.return_reason || '').trim(),
    return_requested_at: String(record.return_requested_at || '').trim(),
    returned_at: String(record.returned_at || '').trim(),
    refund_received_at: String(record.refund_received_at || '').trim(),
    created_at: String(record.created_at || '').trim(),
    updated_at: String(record.updated_at || '').trim()
});

export const normalizePurchaseOrderRecord = (record = {}) => ({
    id: String(record.id || '').trim(),
    vendor_name: String(record.vendor_name || '').trim(),
    order_number: String(record.order_number || '').trim(),
    status: normalizePurchaseOrderStatus(record.status),
    placed_at: String(record.placed_at || '').trim(),
    expected_delivery_at: String(record.expected_delivery_at || '').trim(),
    delivered_at: String(record.delivered_at || '').trim(),
    tracking_number: String(record.tracking_number || '').trim(),
    shipping_cost: parseCurrency(record.shipping_cost),
    subtotal_amount: parseCurrency(record.subtotal_amount),
    tax_amount: parseCurrency(record.tax_amount),
    total_amount: parseCurrency(record.total_amount),
    return_deadline: String(record.return_deadline || '').trim(),
    order_url: String(record.order_url || '').trim(),
    notes: String(record.notes || '').trim(),
    created_at: String(record.created_at || '').trim(),
    updated_at: String(record.updated_at || '').trim()
});

export const linkManualOrdersToEmailPackages = ({ items = [], emailPackages = [] } = {}) => {
    const normalizedItems = items.map(normalizeOrderItemRecord);
    const normalizedEmail = emailPackages.map(normalizeEmailOrderRecord);
    const candidates = [];

    normalizedItems.forEach((item) => {
        if (!item.id || !item.title || item.status === 'cancelled') return;
        normalizedEmail.forEach((emailOrder) => {
            const score = scoreOrderMatch(item, emailOrder);
            if (score >= 0.7) {
                candidates.push({
                    itemId: item.id,
                    emailId: emailOrder.id,
                    score,
                    latestAt: emailOrder.latestAt || ''
                });
            }
        });
    });

    candidates.sort((a, b) => b.score - a.score || String(b.latestAt).localeCompare(String(a.latestAt)));
    const itemMatchesById = {};
    const emailMatchesById = {};

    candidates.forEach((candidate) => {
        if (itemMatchesById[candidate.itemId] || emailMatchesById[candidate.emailId]) return;
        itemMatchesById[candidate.itemId] = {
            emailId: candidate.emailId,
            score: candidate.score
        };
        emailMatchesById[candidate.emailId] = {
            itemId: candidate.itemId,
            score: candidate.score
        };
    });

    return {
        items: normalizedItems,
        emailPackages: normalizedEmail,
        itemMatchesById,
        emailMatchesById
    };
};

export const buildOrdersSnapshot = ({ items = [], emailPackages = [] } = {}) => {
    const {
        items: normalizedItems,
        emailPackages: normalizedEmail,
        itemMatchesById,
        emailMatchesById
    } = linkManualOrdersToEmailPackages({ items, emailPackages });

    const emailById = Object.fromEntries(normalizedEmail.map((entry) => [entry.id, entry]));
    const requests = [];
    const orders = [];
    const deliveries = [];
    const returns = [];

    normalizedItems.forEach((item) => {
        if (!item.id || item.status === 'cancelled') return;
        const matched = itemMatchesById[item.id] || null;
        const tracking = matched ? emailById[matched.emailId] || null : null;
        const trackingStatus = tracking?.latestStatus || '';

        if (['return_pending', 'returned'].includes(item.status)) {
            returns.push(buildItemEntry(item, tracking));
            return;
        }
        if (trackingStatus === 'ordered') {
            orders.push(buildItemEntry(item, tracking));
            return;
        }
        if (['shipped', 'out_for_delivery', 'delivered'].includes(trackingStatus)) {
            deliveries.push(buildItemEntry(item, tracking));
            return;
        }
        if (['ordered', 'partially_received'].includes(item.status)) {
            orders.push(buildItemEntry(item));
            return;
        }
        if (item.status === 'received') {
            deliveries.push(buildItemEntry(item));
            return;
        }
        requests.push(buildItemEntry(item));
    });

    normalizedEmail.forEach((tracking) => {
        if (emailMatchesById[tracking.id]) return;
        if (tracking.latestStatus === 'ordered') {
            orders.push(buildEmailEntry(tracking));
            return;
        }
        deliveries.push(buildEmailEntry(tracking));
    });

    return {
        items: normalizedItems.map((item) => {
            const matched = itemMatchesById[item.id] || null;
            return {
                ...item,
                matched_email_order_id: matched?.emailId || '',
                matched_email_score: matched?.score || 0
            };
        }),
        emailPackages: normalizedEmail.map((tracking) => {
            const matched = emailMatchesById[tracking.id] || null;
            return {
                ...tracking,
                matched_item_id: matched?.itemId || '',
                matched_item_score: matched?.score || 0
            };
        }),
        sections: {
            requests: requests.sort((a, b) => byNeededDate(a.item, b.item)),
            orders: orders.sort((a, b) => byLatest(a.tracking || a.item, b.tracking || b.item)),
            deliveries: deliveries.sort((a, b) => byLatest(a.tracking || a.item, b.tracking || b.item)),
            returns: returns.sort((a, b) => byLatest(a.item, b.item))
        },
        summary: {
            requested: requests.length,
            orders: orders.length,
            deliveries: deliveries.length,
            returns: returns.length
        }
    };
};

export const ORDER_ITEM_STATUS_OPTIONS = ORDER_ITEM_STATUSES;
export const PURCHASE_ORDER_STATUS_OPTIONS = PURCHASE_ORDER_STATUSES;
export const ORDER_PRIORITY_OPTIONS = ORDER_PRIORITIES;
export const ORDER_CATEGORY_OPTIONS = ORDER_CATEGORIES;
