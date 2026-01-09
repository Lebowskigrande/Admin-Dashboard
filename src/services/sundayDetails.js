const STORAGE_PREFIX = 'sunday-details:';

const defaultDetails = {
    bulletinStatus: 'draft',
    bulletinNotes: '',
    staffHours: [],
    notes: '',
    livestreamEmailStatus: 'Not Started',
    roleOverrides: {}
};

const serializeDateKey = (date) => {
    if (!date) return '';
    if (typeof date === 'string') return date;
    return date.toISOString().slice(0, 10);
};

export const getSundayDetails = (date) => {
    const key = `${STORAGE_PREFIX}${serializeDateKey(date)}`;
    if (!key) return { ...defaultDetails };
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaultDetails };
    try {
        const parsed = JSON.parse(raw);
        return { ...defaultDetails, ...parsed };
    } catch {
        return { ...defaultDetails };
    }
};

export const saveSundayDetails = (date, details) => {
    const key = `${STORAGE_PREFIX}${serializeDateKey(date)}`;
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(details));
};

export const mergeRoleOverride = (details, serviceTime, roleKey, value) => {
    const existing = details.roleOverrides || {};
    const serviceOverrides = existing[serviceTime] || {};
    return {
        ...details,
        roleOverrides: {
            ...existing,
            [serviceTime]: {
                ...serviceOverrides,
                [roleKey]: value
            }
        }
    };
};
