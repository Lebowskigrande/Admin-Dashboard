import { parseISO } from 'date-fns';
import { ROLE_KEYS } from './roles';
import { createPerson, createPlaceholderPerson, matchPersonByName, normalizeName } from './person';
import { PEOPLE } from '../data/people';

const normalizeAssignments = (rawAssignments, role) => {
    if (!rawAssignments) {
        return { role, status: 'unassigned', people: [] };
    }

    const names = typeof rawAssignments === 'string'
        ? rawAssignments.split(',').map(name => normalizeName(name)).filter(Boolean)
        : [];

    const people = names.map(name => {
        if (name.toLowerCase().includes('volunteer needed')) {
            return createPlaceholderPerson('Volunteer Needed', { roles: [role], tags: ['open'] });
        }

        const matched = matchPersonByName(PEOPLE, name);
        if (matched) return matched;

        return createPerson({ name, roles: [role], tags: ['guest'] });
    });

    const status = people.length === 0
        ? 'unassigned'
        : people.some(person => person.tags.includes('open'))
            ? 'needs_support'
            : 'assigned';

    return { role, status, people };
};

const normalizeService = (service, dayDate) => {
    const roster = {};
    ROLE_KEYS.forEach((roleKey) => {
        const valueFromRolesObject = service?.roles?.[roleKey];
        const valueFromLegacyKey = service?.[roleKey];
        roster[roleKey] = normalizeAssignments(valueFromRolesObject || valueFromLegacyKey, roleKey);
    });

    const readableAssignments = Object.fromEntries(
        Object.entries(roster).map(([key, assignment]) => [
            key,
            assignment.people.map(person => person.displayName).join(', ')
        ])
    );

    return {
        id: service?.id || `${dayDate.toISOString()}-${service?.time || 'service'}`,
        name: service?.name || 'Sunday Service',
        time: service?.time || '10:00',
        rite: service?.rite || service?.format || '',
        theme: service?.theme || service?.title || '',
        roster,
        assignments: readableAssignments,
        location: service?.location || '',
        notes: service?.notes || ''
    };
};

export const createSundayFromApiDay = (day) => {
    const dayDate = parseISO(day.date);

    return {
        date: dayDate,
        name: day.feast || day.name || 'Sunday',
        color: day.color || 'green',
        readings: day.readings || '',
        bulletinStatus: day.bulletin_status || 'draft',
        services: Array.isArray(day.services)
            ? day.services.map(service => normalizeService(service, dayDate))
            : [],
        source: 'liturgical-api'
    };
};
