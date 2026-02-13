import { ROLE_OPTIONS } from '../../utils/constants';

export const CATEGORY_LABELS = {
    clergy: 'Clergy',
    staff: 'Staff',
    parishioner: 'Parishioner'
};

export const MEMBER_STATUS_LABELS = {
    member: 'Member',
    associate: 'Associate',
    visitor: 'Visitor',
    inactive: 'Inactive',
    unknown: 'Unknown'
};

const getLastName = (name = '') => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (raw.includes(',')) {
        const [last] = raw.split(',');
        return last.trim();
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[tokens.length - 1] : '';
};

const getFirstName = (name = '') => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (raw.includes(',')) {
        const [, rest] = raw.split(',');
        return (rest || '').trim();
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[0] : '';
};

export const sortPeople = (list) => {
    return [...list].sort((a, b) => {
        const lastA = getLastName(a.displayName).toLowerCase();
        const lastB = getLastName(b.displayName).toLowerCase();
        if (lastA !== lastB) return lastA.localeCompare(lastB);
        const firstA = getFirstName(a.displayName).toLowerCase();
        const firstB = getFirstName(b.displayName).toLowerCase();
        if (firstA !== firstB) return firstA.localeCompare(firstB);
        return (a.displayName || '').localeCompare(b.displayName || '');
    });
};

export const parseCommaList = (value) => {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

export const parseTeamList = (value) => {
    return parseCommaList(value)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
};

export const formatTeams = (teams) => {
    if (!Array.isArray(teams) || teams.length === 0) return '';
    return teams.join(', ');
};

export const roleLabel = (roleKey) => {
    return ROLE_OPTIONS.find((role) => role.value === roleKey)?.label || roleKey;
};

export const buildTeamRoleKeys = (roles, teams) => {
    const roleSet = new Set(roles || []);
    Object.keys(teams || {}).forEach((roleKey) => roleSet.add(roleKey));
    return Array.from(roleSet);
};

export const defaultPersonForm = () => ({
    displayName: '',
    email: '',
    phonePrimary: '',
    phoneAlternate: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    category: 'parishioner',
    envelopeNumber: '',
    memberStatus: 'unknown',
    roles: [],
    tagsText: '',
    teams: {}
});
