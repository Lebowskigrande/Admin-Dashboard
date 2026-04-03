const SECTION_CATALOG = {
    bulletin: { iconKey: 'documents', shortLabel: 'Bulletin' },
    insert: { iconKey: 'documents', shortLabel: 'Insert' },
    music: { iconKey: 'music', shortLabel: 'Music' },
    clergy: { iconKey: 'people', shortLabel: 'Clergy' },
    roles: { iconKey: 'people', shortLabel: 'Roles' },
    roster: { iconKey: 'people', shortLabel: 'Roster' },
    contacts: { iconKey: 'people', shortLabel: 'People' },
    people: { iconKey: 'people', shortLabel: 'People' },
    documents: { iconKey: 'documents', shortLabel: 'Docs' },
    packet: { iconKey: 'documents', shortLabel: 'Packet' },
    certificates: { iconKey: 'documents', shortLabel: 'Certificates' },
    contracts: { iconKey: 'documents', shortLabel: 'Contracts' },
    print: { iconKey: 'documents', shortLabel: 'Print' },
    setup: { iconKey: 'setup', shortLabel: 'Setup' },
    ready: { iconKey: 'setup', shortLabel: 'Setup' },
    logistics: { iconKey: 'setup', shortLabel: 'Setup' },
    hospitality: { iconKey: 'hospitality', shortLabel: 'Hospitality' },
    communications: { iconKey: 'communications', shortLabel: 'Comms' },
    comms: { iconKey: 'communications', shortLabel: 'Comms' },
    email: { iconKey: 'communications', shortLabel: 'Comms' },
    outreach: { iconKey: 'communications', shortLabel: 'Comms' },
    followup: { iconKey: 'followup', shortLabel: 'Follow-up' },
    postvestry: { iconKey: 'followup', shortLabel: 'Follow-up' },
    finance: { iconKey: 'finance', shortLabel: 'Finance' },
    bills: { iconKey: 'finance', shortLabel: 'Bills' },
    deposits: { iconKey: 'finance', shortLabel: 'Deposits' },
    payroll: { iconKey: 'finance', shortLabel: 'Payroll' },
    records: { iconKey: 'documents', shortLabel: 'Records' }
};

const GENERIC_SECTION_TITLES = new Set([
    'weekly ops',
    'weekly operations',
    'operations',
    'tasks',
    'task',
    'weekly'
]);

const normalizeListKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const normalizeDisplayText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const toCompactPhrase = (value, maxWords = 2) => {
    const words = normalizeDisplayText(value)
        .split(' ')
        .filter(Boolean);
    if (!words.length) return 'Section';
    return words.slice(0, maxWords).join(' ');
};

const isGenericSectionTitle = (value) => GENERIC_SECTION_TITLES.has(normalizeDisplayText(value).toLowerCase());

const getOperationsSectionTitle = (listTitle, taskText) => {
    const normalizedTitle = normalizeDisplayText(listTitle);
    if (!isGenericSectionTitle(normalizedTitle)) return normalizedTitle || normalizeDisplayText(taskText) || 'Operations';
    return normalizeDisplayText(taskText) || normalizedTitle || 'Operations';
};

const getOperationsShortLabel = (title, taskText) => {
    const raw = `${title} ${taskText || ''}`.toLowerCase();
    if (/(bill|invoice|expense|ap |accounts payable)/.test(raw)) return 'Bills';
    if (/(deposit|check|bank)/.test(raw)) return 'Deposits';
    if (/(timesheet|payroll|staff hours)/.test(raw)) return 'Payroll';
    if (/(email|newsletter|communication|announcement)/.test(raw)) return 'Comms';
    if (/(record|archive|scan|filing|file)/.test(raw)) return 'Records';
    if (/(budget|finance|payment|reconcile)/.test(raw)) return 'Finance';
    return toCompactPhrase(title, 3);
};

const getFallbackSectionConfig = (raw = '') => {
    if (/(bulletin|packet|certificate|contract|document|print|file|doc)/.test(raw)) {
        return { iconKey: 'documents', shortLabel: /(packet)/.test(raw) ? 'Packet' : /(certificate)/.test(raw) ? 'Certificates' : 'Docs' };
    }
    if (/(roster|contact|people|guest|clergy|vestry|minister|leader|attendee)/.test(raw)) {
        return { iconKey: 'people', shortLabel: /(roster)/.test(raw) ? 'Roster' : 'People' };
    }
    if (/(music|musician|organ|choir|hymn|anthem)/.test(raw)) {
        return { iconKey: 'music', shortLabel: 'Music' };
    }
    if (/(setup|ready|logistics|building|facility|room|site|campus|sacristy)/.test(raw)) {
        return { iconKey: 'setup', shortLabel: 'Setup' };
    }
    if (/(email|communication|invite|announcement|newsletter|outreach)/.test(raw)) {
        return { iconKey: 'communications', shortLabel: 'Comms' };
    }
    if (/(follow|post |minutes|recap|close|archive|thank)/.test(raw)) {
        return { iconKey: 'followup', shortLabel: 'Follow-up' };
    }
    if (/(hospitality|food|kitchen|refreshment|supply)/.test(raw)) {
        return { iconKey: 'hospitality', shortLabel: 'Hospitality' };
    }
    if (/(budget|finance|deposit|payment|invoice|expense)/.test(raw)) {
        return { iconKey: 'finance', shortLabel: 'Finance' };
    }
    return { iconKey: 'general', shortLabel: 'Section' };
};

export const getSectionPresentation = ({
    originType,
    listKey,
    listTitle,
    taskText
}) => {
    const normalizedOriginType = String(originType || '').toLowerCase();
    const normalizedListKey = normalizeListKey(listKey);
    const explicit = SECTION_CATALOG[normalizedListKey];

    if (normalizedOriginType === 'operations') {
        const title = getOperationsSectionTitle(listTitle, taskText);
        if (explicit) {
            return {
                title,
                shortLabel: explicit.shortLabel,
                iconKey: explicit.iconKey
            };
        }
        const fallback = getFallbackSectionConfig(`${title} ${taskText || ''}`.toLowerCase());
        return {
            title,
            shortLabel: getOperationsShortLabel(title, taskText),
            iconKey: fallback.iconKey
        };
    }

    const title = normalizeDisplayText(listTitle) || normalizeDisplayText(taskText) || 'Section';
    if (explicit) {
        return {
            title,
            shortLabel: explicit.shortLabel,
            iconKey: explicit.iconKey
        };
    }

    const fallback = getFallbackSectionConfig(`${normalizedListKey} ${title} ${taskText || ''}`.toLowerCase());
    return {
        title,
        shortLabel: fallback.shortLabel || title,
        iconKey: fallback.iconKey
    };
};
