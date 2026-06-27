import { coerceJsonArray } from './db-utils.js';

export const normalizeName = (name = '') => name.trim().replace(/\s+/g, ' ');

export const slugifyName = (name) => normalizeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const normalizePersonName = (value) => {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const ROLE_TOKEN_MAP = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    officiant: 'officiant',
    lector8: 'lector8',
    '8am lector': 'lector8',
    '8 am lector': 'lector8',
    '8am lectors': 'lector8',
    '8 am lectors': 'lector8',
    lector: 'lector',
    lem: 'lem',
    'lay eucharistic minister': 'lem',
    acolyte: 'acolyte',
    thurifer: 'thurifer',
    usher: 'usher',
    'altar guild': 'altarGuild',
    altarguild: 'altarGuild',
    choirmaster: 'choirmaster',
    organist: 'organist',
    sound: 'sound',
    'sound engineer': 'sound',
    soundengineer: 'sound',
    'coffee hour': 'coffeeHour',
    coffeehour: 'coffeeHour',
    'building supervisor': 'buildingSupervisor',
    buildingsupervisor: 'buildingSupervisor',
    childcare: 'childcare'
};

export const normalizeRoleToken = (token) => {
    const raw = String(token || '').trim();
    if (!raw) return '';
    const lowered = raw.toLowerCase();
    const compact = lowered.replace(/[^a-z0-9]+/g, '');
    return ROLE_TOKEN_MAP[lowered] || ROLE_TOKEN_MAP[compact] || raw;
};

export const normalizePersonRoles = (value) => {
    const roles = coerceJsonArray(value)
        .map((role) => normalizeRoleToken(role))
        .filter(Boolean);
    return Array.from(new Set(roles));
};

export const normalizeTags = (value) => {
    const tags = coerceJsonArray(value)
        .map((tag) => normalizeName(tag))
        .filter(Boolean);
    return Array.from(new Set(tags));
};
