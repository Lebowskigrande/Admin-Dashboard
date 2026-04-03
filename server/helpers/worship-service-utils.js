const RITE_I_ROLE_DEFINITIONS = [
    { key: 'celebrant', label: 'Celebrant', allowsMultiple: false },
    { key: 'preacher', label: 'Preacher', allowsMultiple: false },
    { key: 'lector', label: 'Lector', allowsMultiple: false },
    { key: 'organist', label: 'Organist', allowsMultiple: false }
];

const RITE_II_ROLE_DEFINITIONS = [
    { key: 'celebrant', label: 'Celebrant', allowsMultiple: false },
    { key: 'preacher', label: 'Preacher', allowsMultiple: false },
    { key: 'lector', label: 'Lector', allowsMultiple: true },
    { key: 'organist', label: 'Organist', allowsMultiple: false },
    { key: 'lem', label: 'LEM', allowsMultiple: true },
    { key: 'acolyte', label: 'Acolyte', allowsMultiple: true },
    { key: 'usher', label: 'Usher', allowsMultiple: true },
    { key: 'sound', label: 'Sound', allowsMultiple: true },
    { key: 'coffeeHour', label: 'Coffee Hour', allowsMultiple: true },
    { key: 'childcare', label: 'Childcare', allowsMultiple: true }
];

const FLEXIBLE_WORSHIP_ROLE_DEFINITIONS = [
    { key: 'clergy', label: 'Clergy', allowsMultiple: true }
];

const WORSHIP_SERVICE_DEFAULTS = {
    'rite-i-service': {
        displayName: 'Rite I',
        musicians: ({ isSummer }) => (isSummer ? ['Rob Hovencamp, Organist'] : ['Rob Hovencamp, Organist']),
        allowsCustomRoles: false,
        roleDefinitions: RITE_I_ROLE_DEFINITIONS
    },
    'rite-ii-service': {
        displayName: 'Rite II',
        musicians: ({ isSummer }) => (
            isSummer
                ? ['Rob Hovencamp, Organist']
                : ['Rob Hovencamp, Organist', "St. Edmund's Choir"]
        ),
        allowsCustomRoles: false,
        roleDefinitions: RITE_II_ROLE_DEFINITIONS
    },
    'eucharist-service': {
        displayName: 'Midweek Eucharist',
        musicians: () => [],
        allowsCustomRoles: true,
        roleDefinitions: FLEXIBLE_WORSHIP_ROLE_DEFINITIONS
    },
    'special-service': {
        displayName: 'Special Service',
        musicians: () => [],
        allowsCustomRoles: true,
        roleDefinitions: FLEXIBLE_WORSHIP_ROLE_DEFINITIONS
    }
};

export const WORSHIP_SERVICE_TYPE_SLUGS = [
    'rite-i-service',
    'rite-ii-service',
    'eucharist-service',
    'special-service',
    'weekly-service'
];

const toTrimmedArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
};

const slugifyRoleKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cloneRoles = (roles) => roles.map((role) => ({ ...role }));

const normalizeDateKey = (dateKey) => {
    const value = String(dateKey || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
};

const isSummerDate = (dateKey) => {
    const normalized = normalizeDateKey(dateKey);
    if (!normalized) return false;
    const month = Number(normalized.slice(5, 7));
    return month >= 6 && month <= 8;
};

export const normalizeWorshipTypeSlug = (typeSlug, fallback = 'special-service') => {
    const normalized = String(typeSlug || '').trim().toLowerCase();
    if (normalized === 'weekly-service') return 'rite-ii-service';
    if (WORSHIP_SERVICE_TYPE_SLUGS.includes(normalized)) return normalized;
    return fallback;
};

const getWorshipDefaults = (typeSlug) => WORSHIP_SERVICE_DEFAULTS[normalizeWorshipTypeSlug(typeSlug)] || WORSHIP_SERVICE_DEFAULTS['special-service'];

export const getWorshipDisplayName = (typeSlug) => getWorshipDefaults(typeSlug).displayName;

export const getBaseWorshipRoleDefinitions = (typeSlug) => cloneRoles(getWorshipDefaults(typeSlug).roleDefinitions);

export const getDefaultWorshipRoleDefinitions = (typeSlug = 'rite-ii-service') => getBaseWorshipRoleDefinitions(typeSlug);

export const getDefaultWorshipRoleKeys = (typeSlug = 'rite-ii-service') => getBaseWorshipRoleDefinitions(typeSlug).map((role) => role.key);

export const getDefaultMusicians = (typeSlug, dateKey = '') => {
    const defaults = getWorshipDefaults(typeSlug);
    const resolver = typeof defaults.musicians === 'function'
        ? defaults.musicians
        : () => Array.isArray(defaults.musicians) ? defaults.musicians : [];
    return resolver({ dateKey: normalizeDateKey(dateKey), isSummer: isSummerDate(dateKey) }).slice();
};

export const allowsCustomWorshipRoles = (typeSlug) => !!getWorshipDefaults(typeSlug).allowsCustomRoles;

export const isRegularSundayServiceType = (typeSlug) => {
    const normalized = normalizeWorshipTypeSlug(typeSlug);
    return normalized === 'rite-i-service' || normalized === 'rite-ii-service';
};

export const isWorshipServiceTypeSlug = (typeSlug) => {
    const normalized = String(typeSlug || '').trim().toLowerCase();
    return WORSHIP_SERVICE_TYPE_SLUGS.includes(normalized);
};

export const sanitizeGuestMusicians = (value) => {
    const seen = new Set();
    return toTrimmedArray(value).filter((entry) => {
        const key = entry.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const sanitizeCustomRoles = (value) => {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    return source.reduce((acc, entry) => {
        const label = typeof entry === 'string'
            ? entry.trim()
            : String(entry?.label || entry?.name || entry?.key || '').trim();
        if (!label) return acc;
        const key = typeof entry === 'string'
            ? slugifyRoleKey(entry)
            : slugifyRoleKey(entry?.key || label);
        if (!key || seen.has(key)) return acc;
        seen.add(key);
        acc.push({ key, label, allowsMultiple: true });
        return acc;
    }, []);
};

export const buildWorshipRoleDefinitions = (typeSlug, customRoles = []) => {
    const roles = getBaseWorshipRoleDefinitions(typeSlug);
    if (!allowsCustomWorshipRoles(typeSlug)) return roles;
    const seen = new Set(roles.map((role) => role.key));
    sanitizeCustomRoles(customRoles).forEach((role) => {
        if (seen.has(role.key)) return;
        seen.add(role.key);
        roles.push({
            key: role.key,
            label: role.label,
            allowsMultiple: role.allowsMultiple !== false,
            isCustom: true
        });
    });
    return roles;
};

export const normalizeRosterForType = (typeSlug, roster = {}, customRoles = []) => {
    const roleDefinitions = buildWorshipRoleDefinitions(typeSlug, customRoles);
    const multipleByRole = new Map(roleDefinitions.map((role) => [role.key, !!role.allowsMultiple]));
    return Object.entries(roster || {}).reduce((acc, [roleKey, personIds]) => {
        const key = String(roleKey || '').trim();
        if (!key) return acc;
        const values = Array.isArray(personIds) ? personIds : (personIds ? [personIds] : []);
        const normalized = Array.from(new Set(values.map((personId) => String(personId || '').trim()).filter(Boolean)));
        acc[key] = multipleByRole.get(key) ? normalized : normalized.slice(0, 1);
        return acc;
    }, {});
};

export const getDefaultRosterAssignments = () => ({});

export const getEligibleRoleKeysForType = (typeSlug, customRoles = []) => (
    buildWorshipRoleDefinitions(typeSlug, customRoles).map((role) => role.key)
);
