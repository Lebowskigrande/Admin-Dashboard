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

export const normalizeEnvelopeNumber = (value = '') => String(value || '')
    .trim()
    .replace(/\s+/g, '');

export const normalizeMemberStatus = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'unknown';
    const normalized = raw.replace(/[\s_-]+/g, '_');
    const allowed = new Set(['member', 'associate', 'visitor', 'inactive', 'unknown']);
    return allowed.has(normalized) ? normalized : 'unknown';
};

export const extractEnvelopeNumberFromTags = (tags = []) => {
    const normalizedTags = normalizeTags(tags);
    const match = normalizedTags.find((tag) => /^env-[a-z0-9-]+$/i.test(tag));
    if (!match) return '';
    return normalizeEnvelopeNumber(match.replace(/^env-/i, ''));
};

export const syncEnvelopeTag = ({ tags = [], envelopeNumber = '' }) => {
    const normalizedEnvelope = normalizeEnvelopeNumber(envelopeNumber);
    const baseTags = normalizeTags(tags).filter((tag) => !/^env-[a-z0-9-]+$/i.test(tag));
    if (!normalizedEnvelope) return baseTags;
    return [...baseTags, `env-${normalizedEnvelope}`];
};
