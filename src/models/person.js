import { ROLE_KEYS } from './roles';

export const normalizeName = (name) => name?.trim().replace(/\s+/g, ' ') || '';

export const slugifyName = (name) => normalizeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

const fallbackId = () => `person-${Math.random().toString(36).slice(2, 9)}`;

export const createPerson = ({ name, roles = [], tags = [] }) => {
    const normalizedName = normalizeName(name);
    return {
        id: slugifyName(normalizedName) || fallbackId(),
        displayName: normalizedName,
        roles: roles.filter(role => ROLE_KEYS.includes(role)),
        tags
    };
};

export const createPlaceholderPerson = (label, { roles = [], tags = [] } = {}) => ({
    id: `placeholder-${slugifyName(label)}`,
    displayName: label,
    roles: roles.filter(role => ROLE_KEYS.includes(role)),
    tags
});

export const matchPersonByName = (people, rawName) => {
    const normalized = normalizeName(rawName).toLowerCase();
    return people.find(person => normalizeName(person.displayName).toLowerCase() === normalized);
};
