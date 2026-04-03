import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import { tableExists } from '../helpers/db-utils.js';
import {
    allowsCustomWorshipRoles,
    buildWorshipRoleDefinitions,
    getDefaultRosterAssignments,
    getDefaultMusicians,
    getWorshipDisplayName,
    isWorshipServiceTypeSlug,
    normalizeWorshipTypeSlug,
    sanitizeCustomRoles,
    sanitizeGuestMusicians
} from '../helpers/worship-service-utils.js';
import { seedEventTasksForOccurrence } from './taskEngine.js';
import { getLinkedSundayScheduleOccurrence } from '../helpers/sunday-utils.js';

const getOccurrenceAssignments = (occurrenceId) => {
    if (!tableExists('assignments')) return [];
    return db.prepare(`
        SELECT
            a.role_key,
            a.person_id,
            p.display_name,
            p.category
        FROM assignments a
        LEFT JOIN people p ON p.id = a.person_id
        WHERE a.occurrence_id = ?
        ORDER BY a.role_key ASC, COALESCE(p.display_name, a.person_id) ASC
    `).all(occurrenceId);
};

const getRiteIInheritedAssignments = ({ dateKey, excludeOccurrenceId }) => {
    if (!dateKey || !tableExists('event_occurrences') || !tableExists('events') || !tableExists('assignments')) return [];
    return db.prepare(`
        SELECT
            a.role_key,
            a.person_id,
            p.display_name,
            p.category
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON t.id = e.event_type_id
        JOIN assignments a ON a.occurrence_id = o.id
        LEFT JOIN people p ON p.id = a.person_id
        WHERE o.date = ?
          AND o.start_time = '10:00'
          AND o.id != ?
          AND a.role_key IN ('celebrant', 'preacher')
          AND (
              e.id = 'sunday-service'
              OR COALESCE(t.slug, '') IN ('weekly-service', 'rite-ii-service')
          )
        ORDER BY a.role_key ASC, COALESCE(p.display_name, a.person_id) ASC
    `).all(dateKey, excludeOccurrenceId || '');
};

export const buildWorshipPlanning = ({ typeSlug, notes, occurrenceId, dateKey }) => {
    if (!isWorshipServiceTypeSlug(typeSlug)) return null;
    const normalizedTypeSlug = normalizeWorshipTypeSlug(typeSlug);
    const template = notes?.template && typeof notes.template === 'object' ? notes.template : {};
    const customRoles = allowsCustomWorshipRoles(normalizedTypeSlug)
        ? sanitizeCustomRoles(template.custom_roles)
        : [];
    const roleDefinitions = buildWorshipRoleDefinitions(normalizedTypeSlug, customRoles);
    const assignments = getOccurrenceAssignments(occurrenceId);
    const assignmentsByRole = assignments.reduce((acc, row) => {
        const roleKey = String(row.role_key || '').trim();
        if (!roleKey) return acc;
        if (!acc[roleKey]) acc[roleKey] = [];
        acc[roleKey].push({
            id: row.person_id,
            display_name: row.display_name || row.person_id,
            category: row.category || ''
        });
        return acc;
    }, {});
    if (normalizedTypeSlug === 'rite-i-service') {
        getRiteIInheritedAssignments({ dateKey, excludeOccurrenceId: occurrenceId }).forEach((row) => {
            const roleKey = String(row.role_key || '').trim();
            if (!roleKey || assignmentsByRole[roleKey]?.length) return;
            assignmentsByRole[roleKey] = [{
                id: row.person_id,
                display_name: row.display_name || row.person_id,
                category: row.category || '',
                is_inherited: true
            }];
        });
    }
    const defaultRoster = getDefaultRosterAssignments(normalizedTypeSlug);
    Object.entries(defaultRoster).forEach(([roleKey, personIds]) => {
        if (assignmentsByRole[roleKey]?.length) return;
        assignmentsByRole[roleKey] = personIds.map((personId) => ({
            id: personId,
            display_name: personId,
            category: 'clergy',
            is_default: true
        }));
    });
    const guestMusicians = sanitizeGuestMusicians(template.guest_musicians);
    return {
        service_type: normalizedTypeSlug,
        service_label: getWorshipDisplayName(normalizedTypeSlug),
        custom_roles_enabled: allowsCustomWorshipRoles(normalizedTypeSlug),
        role_definitions: roleDefinitions.map((role) => ({
            key: role.key,
            label: role.label,
            allows_multiple: !!role.allowsMultiple,
            is_custom: !!role.isCustom,
            assignments: assignmentsByRole[role.key] || []
        })),
        custom_roles: customRoles,
        musicians: {
            regular: getDefaultMusicians(normalizedTypeSlug, dateKey),
            guests: guestMusicians,
            all: [...getDefaultMusicians(normalizedTypeSlug, dateKey), ...guestMusicians]
        }
    };
};

export const getSharedSundayScheduleContext = (row) => {
    const linkedOccurrence = getLinkedSundayScheduleOccurrence({
        eventId: row?.event_id,
        date: row?.date,
        startTime: row?.start_time,
        title: row?.title
    });
    if (!linkedOccurrence || linkedOccurrence.id === row?.occurrence_id) {
        return {
            linked: false,
            assignmentOccurrenceId: row?.occurrence_id,
            buildingId: row?.building_id || null
        };
    }
    return {
        linked: true,
        assignmentOccurrenceId: linkedOccurrence.id,
        buildingId: linkedOccurrence.building_id || row?.building_id || null
    };
};

export const createManualEvent = db.transaction((payload) => {
    const {
        title,
        description,
        date,
        time,
        location,
        parsedTypeId,
        metadata
    } = payload;
    const eventId = `event-${randomUUID()}`;
    const occurrenceId = `occ-${randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
        INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
    `).run(
        eventId,
        title,
        description,
        parsedTypeId,
        metadata ? JSON.stringify(metadata) : null,
        now,
        now
    );

    db.prepare(`
        INSERT INTO event_occurrences (
            id, event_id, date, start_time, end_time, building_id, rite, is_default, notes
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL)
    `).run(
        occurrenceId,
        eventId,
        date,
        time || null,
        null,
        location || null
    );

    seedEventTasksForOccurrence({
        occurrenceId,
        eventTypeId: parsedTypeId,
        dateKey: date
    });

    return { eventId, occurrenceId };
});
