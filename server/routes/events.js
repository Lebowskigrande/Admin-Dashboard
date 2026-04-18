import express from 'express';
import { randomUUID } from 'crypto';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { rename, copyFile, rm } from 'fs/promises';
import multer from 'multer';
import { sqlite as db } from '../db.js';
import {
    tableExists,
    tableHasColumn,
    parseJsonField,
    parseNotes
} from '../helpers/db-utils.js';
import {
    allowsCustomWorshipRoles,
    buildWorshipRoleDefinitions,
    getDefaultRosterAssignments,
    isRegularSundayServiceType,
    isWorshipServiceTypeSlug,
    normalizeRosterForType,
    normalizeWorshipTypeSlug,
    sanitizeCustomRoles,
    sanitizeGuestMusicians
} from '../helpers/worship-service-utils.js';
import { buildDocumentPreview } from '../services/bulletinService.js';
import {
    ensureEventDocDir,
    ensureUniquePath
} from '../helpers/file-utils.js';
import { seedEventTasksForOccurrence } from '../services/taskEngine.js';
import {
    buildWorshipPlanning,
    createManualEvent,
    getSharedSundayScheduleContext
} from '../services/eventPlanningService.js';
import {
    extractEventTags,
    findEventTypeFromTags,
    getLocationContext,
    resolveLocation,
    updateOccurrenceLinks
} from '../eventEngine.js';
import {
    buildPackageSignatureMap,
    getEventPackageDefinitions,
    normalizePackageTaskDefinitions,
    normalizeRecurringCompletionMap
} from '../helpers/eventPackageUtils.js';
import {
    isSundayDate,
    replaceAllAssignmentsForOccurrence,
    syncLinkedSundayAliasOccurrences
} from '../helpers/sunday-utils.js';

const router = express.Router();
const eventDocUpload = multer({ dest: join(tmpdir(), 'event-doc-uploads') });

const parseMetadata = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const getEventTypeRows = () => (
    tableExists('event_types')
        ? db.prepare(`
            SELECT
                t.id,
                t.name,
                t.slug,
                c.name AS category_name
            FROM event_types t
            LEFT JOIN event_categories c ON c.id = t.category_id
            ORDER BY t.name ASC
        `).all()
        : []
);

const getEventTypeById = (eventTypeId) => {
    if (!Number.isFinite(Number(eventTypeId)) || !tableExists('event_types')) return null;
    return db.prepare(`
        SELECT
            t.id,
            t.name,
            t.slug,
            c.name AS category_name
        FROM event_types t
        LEFT JOIN event_categories c ON c.id = t.category_id
        WHERE t.id = ?
        LIMIT 1
    `).get(Number(eventTypeId)) || null;
};

const getBuildingLookupRows = () => (
    tableExists('buildings')
        ? db.prepare('SELECT id, name FROM buildings ORDER BY name ASC').all()
        : []
);

const buildEventContact = (metadata = {}, template = {}) => ({
    person: String(
        metadata.contact_person
        || metadata.contactName
        || template.contact_person
        || template.family_contact
        || ''
    ).trim(),
    email: String(metadata.contact_email || metadata.contactEmail || '').trim(),
    phone: String(metadata.contact_phone || metadata.contactPhone || '').trim(),
    address: String(metadata.contact_address || metadata.contactAddress || '').trim()
});

const normalizeBoolean = (value) => {
    if (value === true || value === 1) return true;
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const getTemplateFieldRowsByTypeIds = (eventTypeIds = []) => {
    if (!tableExists('event_template_fields')) return new Map();
    const uniqueIds = Array.from(new Set(
        eventTypeIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
    ));
    if (!uniqueIds.length) return new Map();
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = db.prepare(`
        SELECT event_type_id, field_key, label, field_type, required
        FROM event_template_fields
        WHERE event_type_id IN (${placeholders})
        ORDER BY sort_order ASC, label ASC
    `).all(...uniqueIds);
    return rows.reduce((acc, row) => {
        const key = Number(row.event_type_id);
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(row);
        return acc;
    }, new Map());
};

const isFieldValueMissing = (field, value) => {
    const fieldType = String(field?.field_type || 'text').trim().toLowerCase();
    if (fieldType === 'checkbox') return !normalizeBoolean(value);
    if (value == null) return true;
    if (typeof value === 'number') return !Number.isFinite(value);
    if (typeof value === 'boolean') return value !== true;
    return !String(value).trim();
};

const buildEventDataFlags = ({
    eventTypeId,
    typeSlug,
    template,
    templateFieldMap,
    buildingId
}) => {
    const normalizedTemplate = template && typeof template === 'object' ? template : {};
    const templateFields = templateFieldMap.get(Number(eventTypeId)) || [];
    const setupRequired = normalizeBoolean(normalizedTemplate.setup_required);
    const setupDescription = String(normalizedTemplate.setup_description || '').trim();
    const rentalActive = typeSlug === 'private-rental' || normalizeBoolean(normalizedTemplate.rental);
    const missingLabels = [];

    templateFields.forEach((field) => {
        const fieldKey = String(field?.field_key || '').trim();
        if (!fieldKey || !field.required) return;
        if (fieldKey === 'setup_description') return;
        if (fieldKey === 'rental_rate' && !rentalActive) return;
        if (isFieldValueMissing(field, normalizedTemplate[fieldKey])) {
            missingLabels.push(String(field.label || fieldKey).trim());
        }
    });

    if (setupRequired && !setupDescription) {
        missingLabels.push('Setup plan');
    }
    if (setupRequired && !String(buildingId || '').trim()) {
        missingLabels.push('Location');
    }

    const uniqueMissingLabels = Array.from(new Set(missingLabels));
    const flags = [];
    if (uniqueMissingLabels.length > 0) {
        flags.push({
            key: 'details-missing',
            tone: 'warning',
            label: `${uniqueMissingLabels.length} detail${uniqueMissingLabels.length === 1 ? '' : 's'} missing`,
            detail: uniqueMissingLabels.join(', ')
        });
    }
    if (setupRequired) {
        flags.push({
            key: 'setup-needed',
            tone: setupDescription ? 'info' : 'warning',
            label: setupDescription ? 'Setup needed' : 'Setup details needed',
            detail: setupDescription || 'Describe the setup plan before the event.'
        });
    }

    return {
        flags,
        missingFieldCount: uniqueMissingLabels.length
    };
};

const listFutureOccurrencesForEvent = (eventId, fromDate) => {
    if (!eventId || !fromDate || !tableExists('event_occurrences')) return [];
    return db.prepare(`
        SELECT id, date, start_time
        FROM event_occurrences
        WHERE event_id = ?
          AND date >= ?
        ORDER BY date ASC, COALESCE(start_time, '') ASC
    `).all(eventId, fromDate);
};

const updateFuturePackageTaskStates = ({ eventId, fromDate, listKey, state, completedAt = null }) => {
    if (!eventId || !fromDate || !listKey || !tableExists('task_instances') || !tableExists('task_origins')) return 0;
    const rows = db.prepare(`
        SELECT ti.id
        FROM task_instances ti
        JOIN task_origins src
          ON src.scope = 'instance'
         AND src.task_instance_id = ti.id
        JOIN event_occurrences o
          ON o.id = src.origin_id
        WHERE src.origin_type = 'event'
          AND o.event_id = ?
          AND o.date >= ?
          AND COALESCE(ti.list_key, '') = ?
    `).all(eventId, fromDate, listKey);
    const nextState = state === 'done' ? 'done' : 'open';
    const appliedCompletedAt = nextState === 'done' ? (completedAt || new Date().toISOString()) : null;
    const hasUpdatedAt = tableHasColumn('task_instances', 'updated_at');
    const stmt = hasUpdatedAt
        ? db.prepare(`
            UPDATE task_instances
            SET state = ?,
                completed_at = ?,
                archived_at = NULL,
                updated_at = ?
            WHERE id = ?
        `)
        : db.prepare(`
            UPDATE task_instances
            SET state = ?,
                completed_at = ?,
                archived_at = NULL
            WHERE id = ?
        `);
    const now = new Date().toISOString();
    rows.forEach((row) => {
        if (hasUpdatedAt) {
            stmt.run(nextState, appliedCompletedAt, now, row.id);
        } else {
            stmt.run(nextState, appliedCompletedAt, row.id);
        }
    });
    return rows.length;
};

const buildEventPackagePayload = ({ eventTypeId, metadata, eventId, occurrenceDate }) => {
    const packageDefinition = getEventPackageDefinitions({ eventTypeId, metadata });
    const recurringCompletion = normalizeRecurringCompletionMap(metadata?.recurring_package_completion);
    const signatureMap = buildPackageSignatureMap(packageDefinition.tasks);
    return {
        source: packageDefinition.source,
        tasks: packageDefinition.tasks.map((task) => ({
            ...task,
            signature: signatureMap[task.list_key] || ''
        })),
        recurringCompletion,
        futureOccurrenceCount: listFutureOccurrencesForEvent(eventId, occurrenceDate).length
    };
};

// --- Events Engine Core Endpoints ---

router.get('/event-categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM event_categories').all();
    res.json(categories);
});

router.get('/event-types', (req, res) => {
    const types = db.prepare(`
        SELECT t.*, c.name as category_name, c.color as category_color 
        FROM event_types t
        JOIN event_categories c ON t.category_id = c.id
    `).all();
    res.json(types);
});

// Get all events (merged liturgical + manual)
router.get('/events', async (req, res) => {
    try {
        if (!tableExists('events') || !tableExists('event_occurrences')) {
            return res.json([]);
        }
        // 1. Get liturgical events
        const days = tableExists('liturgical_days')
            ? db.prepare('SELECT * FROM liturgical_days ORDER BY date').all()
            : [];
        const liturgicalEvents = days.map(day => {
            // Map liturgical color name to hex if possible or use default
            const colorMap = {
                'Green': '#dcfce7',
                'White': '#f3f4f6',
                'Purple': '#f3e8ff',
                'Red': '#fee2e2'
            };

            return {
                id: `lit-${day.date}`,
                title: day.feast,
                date: day.date,
                time: '10:00 AM',
                type_name: 'Weekly Service',
                type_slug: 'weekly-service',
                category_name: 'Liturgical',
                color: colorMap[day.color] || '#15803d',
                source: 'liturgical',
                readings: day.readings
            };
        });

        // 2. Get scheduled/custom events
        const eventRows = db.prepare(`
            SELECT e.id, e.title, e.description, e.event_type_id, e.source, e.metadata,
                   o.id AS occurrence_id, o.date, o.start_time, o.end_time, o.building_id, o.notes,
                   t.name as type_name, t.slug as type_slug, c.name as category_name,
                   COALESCE(t.color, c.color) as type_color
            FROM events e
            JOIN event_occurrences o ON o.event_id = e.id
            LEFT JOIN event_types t ON e.event_type_id = t.id
            LEFT JOIN event_categories c ON t.category_id = c.id
            WHERE e.id <> 'sunday-service'
        `).all();
        const templateFieldMap = getTemplateFieldRowsByTypeIds(eventRows.map((row) => row.event_type_id));

        const scheduledEvents = eventRows.map(e => {
            const metadata = e.metadata ? parseNotes(e.metadata) : {};
            const notes = parseNotes(e.notes);
            const classification = notes?.classification || {};
            const calendar = notes?.calendar || {};
            const flagPayload = buildEventDataFlags({
                eventTypeId: e.event_type_id,
                typeSlug: e.type_slug,
                template: notes?.template || {},
                templateFieldMap,
                buildingId: e.building_id
            });
            return {
                id: e.occurrence_id,
                occurrence_id: e.occurrence_id,
                event_id: e.id,
                title: e.title,
                description: e.description,
                date: e.date,
                time: e.start_time,
                location: e.building_id,
                type_name: e.type_name,
                type_slug: e.type_slug,
                category_name: e.category_name,
                color: e.type_color,
                metadata,
                entry_kind: metadata.entryKind || classification.entryKind || '',
                task_policy: metadata.taskPolicy || classification.taskPolicy || '',
                calendar_role: metadata.calendarRole || calendar.role || '',
                display_group: metadata.displayGroup || calendar.displayGroup || '',
                import_mode: metadata.importMode || calendar.importMode || '',
                flags: flagPayload.flags,
                missing_field_count: flagPayload.missingFieldCount,
                source: e.source || 'manual'
            };
        });

        // 3. Merge and return
        const filteredScheduled = scheduledEvents.filter(
            (event) => !(event.type_slug === 'weekly-service' && isSundayDate(event.date))
        );
        res.json([...liturgicalEvents, ...filteredScheduled]);
    } catch (error) {
        console.error('Error fetching merged events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

router.get('/event-occurrences/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('events') || !tableExists('event_occurrences')) {
        return res.status(404).json({ error: 'Events not available' });
    }
    const row = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.end_time,
            o.building_id,
            o.notes,
            e.id AS event_id,
            e.title,
            e.description,
            e.event_type_id,
            e.source,
            e.metadata,
            t.name AS type_name,
            t.slug AS type_slug,
            c.name AS category_name,
            COALESCE(t.color, c.color) AS type_color
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON e.event_type_id = t.id
        LEFT JOIN event_categories c ON t.category_id = c.id
        WHERE o.id = ?
        LIMIT 1
    `).get(id);
    if (!row) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const notes = parseNotes(row.notes);
    const metadata = row.metadata ? parseNotes(row.metadata) : {};
    const templateFieldMap = getTemplateFieldRowsByTypeIds([row.event_type_id]);
    const sharedSundayContext = getSharedSundayScheduleContext(row);
    const planning = buildWorshipPlanning({
        typeSlug: row.type_slug,
        notes,
        occurrenceId: sharedSundayContext.assignmentOccurrenceId,
        dateKey: row.date
    });
    const packagePayload = buildEventPackagePayload({
        eventTypeId: row.event_type_id,
        metadata,
        eventId: row.event_id,
        occurrenceDate: row.date
    });
    if (planning && sharedSundayContext.linked) {
        planning.shared_source = 'liturgical-schedule';
    }
    const flagPayload = buildEventDataFlags({
        eventTypeId: row.event_type_id,
        typeSlug: row.type_slug,
        template: notes?.template || {},
        templateFieldMap,
        buildingId: sharedSundayContext.buildingId
    });
    res.json({
        occurrence: {
            id: row.occurrence_id,
            date: row.date,
            start_time: row.start_time,
            end_time: row.end_time,
            building_id: sharedSundayContext.buildingId
        },
        event: {
            id: row.event_id,
            title: row.title,
            description: row.description,
            event_type_id: row.event_type_id,
            source: row.source,
            type_name: row.type_name,
            type_slug: row.type_slug,
            category_name: row.category_name,
            color: row.type_color
        },
        notes,
        metadata,
        flags: flagPayload.flags,
        missing_field_count: flagPayload.missingFieldCount,
        planning,
        contact: buildEventContact(metadata, notes?.template || {}),
        package: packagePayload,
        lookups: {
            eventTypes: getEventTypeRows(),
            buildings: getBuildingLookupRows()
        }
    });
});

router.put('/event-occurrences/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('event_occurrences')) {
        return res.status(404).json({ error: 'Events not available' });
    }
    const existing = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.end_time,
            o.notes,
            o.building_id,
            e.id AS event_id,
            e.title,
            e.description,
            e.metadata,
            e.event_type_id,
            t.slug AS type_slug
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON t.id = e.event_type_id
        WHERE o.id = ?
    `).get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const {
        title,
        description,
        event_type_id: eventTypeId,
        internal_notes: internalNotes,
        template_data: templateData,
        building_id: buildingId,
        contact_person: contactPerson,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        contact_address: contactAddress,
        package_tasks: packageTasks,
        guest_musicians: guestMusicians,
        custom_roles: customRoles,
        roster,
        apply_to_series: applyToSeries = true,
        apply_description_tags: applyDescriptionTags = true
    } = req.body || {};
    const notes = parseNotes(existing.notes);
    const metadata = parseMetadata(existing.metadata);
    notes.internal = internalNotes !== undefined
        ? String(internalNotes || '').trim()
        : String(notes.internal || '').trim();
    if (templateData && typeof templateData === 'object') {
        notes.template = templateData;
    }
    if (!notes.template || typeof notes.template !== 'object') {
        notes.template = {};
    }
    if (!notes.template.default_overrides || typeof notes.template.default_overrides !== 'object') {
        notes.template.default_overrides = {};
    }

    const explicitTitle = title !== undefined ? String(title || '').trim() : String(existing.title || '').trim();
    const explicitDescription = description !== undefined ? String(description || '').trim() : String(existing.description || '').trim();
    const eventTypes = getEventTypeRows();
    const locationContext = getLocationContext();
    const tags = applyDescriptionTags ? extractEventTags(`${explicitTitle}\n${explicitDescription}`) : { hashtags: [], locations: [] };
    const taggedType = applyDescriptionTags ? findEventTypeFromTags(tags.hashtags, eventTypes) : null;
    let resolvedEventTypeId = Number.isFinite(Number(eventTypeId))
        ? Number(eventTypeId)
        : (taggedType?.id || existing.event_type_id || null);
    let resolvedTypeRow = getEventTypeById(resolvedEventTypeId) || taggedType || null;

    let resolvedBuildingId = buildingId !== undefined
        ? (String(buildingId || '').trim() || null)
        : existing.building_id || null;

    if (applyDescriptionTags && (!resolvedBuildingId || buildingId === undefined)) {
        const taggedLocation = resolveLocation({
            locationTags: tags.locations,
            eventLocation: resolvedBuildingId || '',
            locationContext,
            textContent: `${explicitTitle}\n${explicitDescription}`,
            typeSlug: resolvedTypeRow?.slug || existing.type_slug || ''
        });
        if (taggedLocation.buildingId) {
            resolvedBuildingId = taggedLocation.buildingId;
        }
    }

    const resolvedTypeSlug = resolvedTypeRow?.slug || existing.type_slug || '';
    const normalizedTypeSlug = normalizeWorshipTypeSlug(resolvedTypeSlug);
    const customRolesEnabled = allowsCustomWorshipRoles(resolvedTypeSlug);
    if (guestMusicians !== undefined) {
        notes.template.guest_musicians = sanitizeGuestMusicians(guestMusicians);
    }
    if (customRoles !== undefined) {
        notes.template.custom_roles = customRolesEnabled ? sanitizeCustomRoles(customRoles) : [];
    } else if (!customRolesEnabled) {
        notes.template.custom_roles = [];
    }

    if (contactPerson !== undefined) {
        const normalized = String(contactPerson || '').trim();
        metadata.contact_person = normalized;
        metadata.contactName = normalized;
        notes.template.contact_person = normalized;
    }
    if (contactEmail !== undefined) metadata.contact_email = String(contactEmail || '').trim();
    if (contactPhone !== undefined) metadata.contact_phone = String(contactPhone || '').trim();
    if (contactAddress !== undefined) metadata.contact_address = String(contactAddress || '').trim();
    const setupRequired = normalizeBoolean(notes?.template?.setup_required);
    const setupDescription = String(notes?.template?.setup_description || '').trim();
    if (setupRequired && !setupDescription) {
        return res.status(400).json({ error: 'Setup details are required when setup is marked as needed.' });
    }

    const normalizedPackageTasks = packageTasks !== undefined
        ? normalizePackageTaskDefinitions(packageTasks)
        : null;
    const previousRecurringCompletion = normalizeRecurringCompletionMap(metadata.recurring_package_completion);
    const packageEdited = packageTasks !== undefined;
    const typeChanged = Number(resolvedEventTypeId || 0) !== Number(existing.event_type_id || 0);
    if (normalizedPackageTasks) {
        metadata.task_package = {
            override: true,
            tasks: normalizedPackageTasks
        };
    }
    if (packageEdited || typeChanged) {
        delete metadata.recurring_package_completion;
    }

    const sharedSundayContext = getSharedSundayScheduleContext(existing);
    if (!resolvedBuildingId) {
        resolvedBuildingId = sharedSundayContext.buildingId || null;
    }

    let nextRosterMap = null;
    if (roster && typeof roster === 'object' && tableExists('assignments')) {
        const nextRoles = isWorshipServiceTypeSlug(resolvedTypeSlug)
            ? buildWorshipRoleDefinitions(normalizedTypeSlug, notes.template.custom_roles)
            : [];
        const validRoleKeys = new Set(nextRoles.map((role) => role.key));
        const entries = Object.entries(roster).reduce((acc, [roleKey, personIds]) => {
            const key = String(roleKey || '').trim();
            if (!key) return acc;
            if (validRoleKeys.size > 0 && !validRoleKeys.has(key)) return acc;
            const uniqueIds = Array.from(new Set(
                (Array.isArray(personIds) ? personIds : [personIds])
                    .map((personId) => String(personId || '').trim())
                    .filter(Boolean)
            ));
            acc.push({ key, personIds: uniqueIds });
            return acc;
        }, []);

        nextRosterMap = normalizeRosterForType(
            normalizedTypeSlug,
            Object.fromEntries(entries.map((entry) => [entry.key, entry.personIds])),
            notes.template.custom_roles
        );
        const defaultRoster = getDefaultRosterAssignments(normalizedTypeSlug);
        Object.entries(defaultRoster).forEach(([roleKey, personIds]) => {
            if (Array.isArray(nextRosterMap[roleKey]) && nextRosterMap[roleKey].length > 0) return;
            nextRosterMap[roleKey] = personIds.slice();
        });
        if (isRegularSundayServiceType(resolvedTypeSlug) && Object.prototype.hasOwnProperty.call(nextRosterMap, 'organist')) {
            notes.template.default_overrides.organist_removed = nextRosterMap.organist.length === 0;
        }
    }

    const now = new Date().toISOString();
    db.prepare(`
        UPDATE events
        SET title = ?,
            description = ?,
            event_type_id = ?,
            metadata = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        explicitTitle || existing.title,
        explicitDescription || '',
        resolvedEventTypeId,
        JSON.stringify(metadata),
        now,
        existing.event_id
    );

    const targetOccurrenceIds = applyToSeries !== false
        ? listFutureOccurrencesForEvent(existing.event_id, existing.date).map((occurrence) => occurrence.id)
        : [id];
    targetOccurrenceIds.forEach((occurrenceId) => {
        db.prepare('UPDATE event_occurrences SET notes = ?, building_id = ? WHERE id = ?').run(
            JSON.stringify(notes),
            resolvedBuildingId,
            occurrenceId
        );
        updateOccurrenceLinks(occurrenceId, {
            buildingId: resolvedBuildingId,
            roomId: null,
            source: applyDescriptionTags && tags.locations.length ? 'tag' : 'manual',
            tag: tags.locations[0] || null
        });
    });
    if (sharedSundayContext.linked) {
        db.prepare('UPDATE event_occurrences SET notes = ?, building_id = ? WHERE id = ?').run(
            JSON.stringify(notes),
            resolvedBuildingId,
            sharedSundayContext.assignmentOccurrenceId
        );
        updateOccurrenceLinks(sharedSundayContext.assignmentOccurrenceId, {
            buildingId: resolvedBuildingId,
            roomId: null,
            source: applyDescriptionTags && tags.locations.length ? 'tag' : 'manual',
            tag: tags.locations[0] || null
        });
    }

    if (nextRosterMap && tableExists('assignments')) {
        replaceAllAssignmentsForOccurrence(sharedSundayContext.assignmentOccurrenceId, nextRosterMap);
        if (sharedSundayContext.linked) {
            syncLinkedSundayAliasOccurrences({
                date: existing.date,
                startTime: existing.start_time,
                buildingId: resolvedBuildingId,
                roles: nextRosterMap
            });
        }
    }

    if (packageEdited || typeChanged) {
        Object.keys(previousRecurringCompletion).forEach((listKey) => {
            updateFuturePackageTaskStates({
                eventId: existing.event_id,
                fromDate: existing.date,
                listKey,
                state: 'open'
            });
        });
    }

    if (resolvedEventTypeId && (packageEdited || typeChanged)) {
        listFutureOccurrencesForEvent(existing.event_id, existing.date).forEach((occurrence) => {
            seedEventTasksForOccurrence({
                occurrenceId: occurrence.id,
                eventTypeId: resolvedEventTypeId,
                dateKey: occurrence.date
            });
        });
        if (sharedSundayContext.linked && sharedSundayContext.assignmentOccurrenceId !== id) {
            seedEventTasksForOccurrence({
                occurrenceId: sharedSundayContext.assignmentOccurrenceId,
                eventTypeId: resolvedEventTypeId,
                dateKey: existing.date
            });
        }
    }

    const responsePlanning = buildWorshipPlanning({
        typeSlug: resolvedTypeSlug,
        notes,
        occurrenceId: sharedSundayContext.assignmentOccurrenceId,
        dateKey: existing.date
    });
    if (responsePlanning && sharedSundayContext.linked) {
        responsePlanning.shared_source = 'liturgical-schedule';
    }
    const responseTemplateFieldMap = getTemplateFieldRowsByTypeIds([resolvedEventTypeId]);
    const responseFlags = buildEventDataFlags({
        eventTypeId: resolvedEventTypeId,
        typeSlug: resolvedTypeSlug,
        template: notes?.template || {},
        templateFieldMap: responseTemplateFieldMap,
        buildingId: resolvedBuildingId
    });
    res.json({
        success: true,
        notes,
        metadata,
        flags: responseFlags.flags,
        missing_field_count: responseFlags.missingFieldCount,
        planning: responsePlanning,
        event: {
            id: existing.event_id,
            title: explicitTitle || existing.title,
            description: explicitDescription || '',
            event_type_id: resolvedEventTypeId,
            type_slug: resolvedTypeSlug,
            type_name: resolvedTypeRow?.name || '',
            category_name: resolvedTypeRow?.category_name || ''
        },
        occurrence: {
            id,
            date: existing.date,
            start_time: existing.start_time,
            end_time: existing.end_time,
            building_id: resolvedBuildingId
        },
        contact: buildEventContact(metadata, notes?.template || {}),
        package: buildEventPackagePayload({
            eventTypeId: resolvedEventTypeId,
            metadata,
            eventId: existing.event_id,
            occurrenceDate: existing.date
        }),
        lookups: {
            eventTypes,
            buildings: getBuildingLookupRows()
        }
    });
});

router.post('/event-occurrences/:id/package-status', (req, res) => {
    const { id } = req.params;
    const {
        list_key: listKey,
        action = 'complete_future'
    } = req.body || {};
    const normalizedListKey = String(listKey || '').trim().toLowerCase();
    if (!normalizedListKey) {
        return res.status(400).json({ error: 'list_key is required' });
    }
    const existing = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            e.id AS event_id,
            e.event_type_id,
            e.metadata
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        WHERE o.id = ?
        LIMIT 1
    `).get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }

    const metadata = parseMetadata(existing.metadata);
    const packageDefinition = getEventPackageDefinitions({
        eventTypeId: existing.event_type_id,
        metadata
    });
    const signatureMap = buildPackageSignatureMap(packageDefinition.tasks);
    const templateSignature = signatureMap[normalizedListKey] || '';
    if (!templateSignature) {
        return res.status(400).json({ error: 'Package task not found for this event' });
    }

    const completionMap = normalizeRecurringCompletionMap(metadata.recurring_package_completion);
    if (action === 'reset_future') {
        delete completionMap[normalizedListKey];
        updateFuturePackageTaskStates({
            eventId: existing.event_id,
            fromDate: existing.date,
            listKey: normalizedListKey,
            state: 'open'
        });
    } else {
        completionMap[normalizedListKey] = {
            completedAt: new Date().toISOString(),
            fromDate: existing.date,
            templateSignature
        };
        updateFuturePackageTaskStates({
            eventId: existing.event_id,
            fromDate: existing.date,
            listKey: normalizedListKey,
            state: 'done',
            completedAt: completionMap[normalizedListKey].completedAt
        });
    }

    metadata.recurring_package_completion = completionMap;
    db.prepare('UPDATE events SET metadata = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(metadata),
        new Date().toISOString(),
        existing.event_id
    );

    listFutureOccurrencesForEvent(existing.event_id, existing.date).forEach((occurrence) => {
        seedEventTasksForOccurrence({
            occurrenceId: occurrence.id,
            eventTypeId: existing.event_type_id,
            dateKey: occurrence.date
        });
    });

    return res.json({
        success: true,
        recurringCompletion: completionMap
    });
});

router.get('/event-occurrences/:id/documents', async (req, res) => {
    if (!tableExists('event_documents')) {
        return res.json([]);
    }
    const { id } = req.params;
    const includePreview = String(req.query.preview || '').trim() === '1';
    const rows = db.prepare(`
        SELECT id, occurrence_id, event_id, doc_type, label, file_name, file_path, created_at
        FROM event_documents
        WHERE occurrence_id = ?
        ORDER BY created_at DESC
    `).all(id);
    if (!includePreview) {
        return res.json(rows);
    }
    const withPreview = await Promise.all(rows.map(async (row) => {
        let preview = '';
        try {
            preview = await buildDocumentPreview(row.file_path);
        } catch {
            preview = '';
        }
        return { ...row, preview };
    }));
    res.json(withPreview);
});

router.post('/event-occurrences/:id/documents', eventDocUpload.single('file'), async (req, res) => {
    if (!tableExists('event_documents')) {
        return res.status(400).json({ error: 'Event documents not available' });
    }
    const { id } = req.params;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'file is required' });
    }
    const occurrence = db.prepare('SELECT id, event_id FROM event_occurrences WHERE id = ?').get(id);
    if (!occurrence) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const docType = String(req.body?.doc_type || 'attachment').toLowerCase();
    const label = String(req.body?.label || '').trim();
    try {
        const targetDir = await ensureEventDocDir(occurrence.event_id, occurrence.id);
        const originalName = file.originalname || file.filename || 'document';
        const safeName = originalName.replace(/[<>:"/\\|?*]+/g, '_');
        const targetPath = await ensureUniquePath(targetDir, safeName);
        try {
            await rename(file.path, targetPath);
        } catch {
            await copyFile(file.path, targetPath);
        }

        if (docType === 'contract' || docType === 'bulletin') {
            const existing = db.prepare(`
                SELECT id, file_path FROM event_documents
                WHERE occurrence_id = ? AND doc_type = ?
            `).all(occurrence.id, docType);
            existing.forEach((row) => {
                db.prepare('DELETE FROM event_documents WHERE id = ?').run(row.id);
                if (row.file_path) {
                    rm(row.file_path, { force: true }).catch(() => { });
                }
            });
        }

        const docId = `doc-${randomUUID()}`;
        const createdAt = new Date().toISOString();
        db.prepare(`
            INSERT INTO event_documents (
                id, occurrence_id, event_id, doc_type, label, file_name, file_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            docId,
            occurrence.id,
            occurrence.event_id,
            docType,
            label || null,
            basename(targetPath),
            targetPath,
            createdAt
        );

        res.status(201).json({
            id: docId,
            occurrence_id: occurrence.id,
            event_id: occurrence.event_id,
            doc_type: docType,
            label: label || null,
            file_name: basename(targetPath),
            file_path: targetPath,
            created_at: createdAt
        });
    } catch (error) {
        console.error('Event document upload error:', error);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

router.get('/event-template-fields', (req, res) => {
    if (!tableExists('event_template_fields')) {
        return res.json([]);
    }
    const eventTypeId = Number(req.query.event_type_id);
    if (!Number.isFinite(eventTypeId)) {
        return res.status(400).json({ error: 'event_type_id is required' });
    }
    const rows = db.prepare(`
        SELECT *
        FROM event_template_fields
        WHERE event_type_id = ?
        ORDER BY sort_order ASC, label ASC
    `).all(eventTypeId);
    res.json(rows.map((row) => ({
        id: row.id,
        event_type_id: row.event_type_id,
        field_key: row.field_key,
        label: row.label,
        field_type: row.field_type,
        options: row.options_json ? parseJsonField(row.options_json, []) : [],
        placeholder: row.placeholder || '',
        help_text: row.help_text || '',
        sort_order: row.sort_order || 0,
        required: !!row.required
    })));
});

router.put('/event-template-fields/:eventTypeId', (req, res) => {
    if (!tableExists('event_template_fields')) {
        return res.status(400).json({ error: 'event_template_fields table not initialized' });
    }
    const eventTypeId = Number(req.params.eventTypeId);
    if (!Number.isFinite(eventTypeId)) {
        return res.status(400).json({ error: 'Invalid eventTypeId' });
    }
    const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const now = new Date().toISOString();
    const insert = db.prepare(`
        INSERT INTO event_template_fields (
            id, event_type_id, field_key, label, field_type, options_json,
            placeholder, help_text, sort_order, required, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM event_template_fields WHERE event_type_id = ?').run(eventTypeId);
        fields.forEach((field, index) => {
            const fieldKey = String(field.field_key || '').trim();
            const label = String(field.label || '').trim();
            const fieldType = String(field.field_type || 'text').trim();
            if (!fieldKey || !label) return;
            const options = Array.isArray(field.options) ? field.options : [];
            insert.run(
                `tmplfield-${randomUUID()}`,
                eventTypeId,
                fieldKey,
                label,
                fieldType,
                options.length ? JSON.stringify(options) : null,
                field.placeholder ? String(field.placeholder) : null,
                field.help_text ? String(field.help_text) : null,
                Number.isFinite(Number(field.sort_order)) ? Number(field.sort_order) : index,
                field.required ? 1 : 0,
                now,
                now
            );
        });
    });
    tx();
    res.json({ success: true });
});

router.post('/events', (req, res) => {
    try {
        const {
            title,
            description = '',
            date,
            time = '',
            location = '',
            type_id = null,
            metadata = null
        } = req.body || {};

        if (!title || !date) {
            return res.status(400).json({ error: 'title and date are required' });
        }

        const parsedTypeId = type_id !== null && type_id !== '' ? Number(type_id) : null;
        let normalizedTypeId = Number.isNaN(parsedTypeId) ? null : parsedTypeId;
        let normalizedLocation = location || '';
        const tags = extractEventTags(`${title}\n${description}`);
        if (!normalizedTypeId) {
            const taggedType = findEventTypeFromTags(tags.hashtags, getEventTypeRows());
            if (taggedType?.id) {
                normalizedTypeId = taggedType.id;
            }
        }
        if (!normalizedLocation) {
            const resolvedTypeRow = getEventTypeById(normalizedTypeId);
            const locationInfo = resolveLocation({
                locationTags: tags.locations,
                eventLocation: '',
                locationContext: getLocationContext(),
                textContent: `${title}\n${description}`,
                typeSlug: resolvedTypeRow?.slug || ''
            });
            normalizedLocation = locationInfo.buildingId || '';
        }
        const { eventId, occurrenceId } = createManualEvent({
            title,
            description,
            date,
            time,
            location: normalizedLocation,
            parsedTypeId: normalizedTypeId,
            metadata
        });

        res.json({
            id: eventId,
            occurrenceId,
            title,
            description,
            date,
            time: time || '',
            location: normalizedLocation || '',
            type_id: normalizedTypeId,
            source: 'manual'
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

router.get('/liturgical-days', (req, res) => {
    if (!tableExists('liturgical_days')) {
        return res.json([]);
    }
    const { start, end } = req.query;
    let sql = 'SELECT * FROM liturgical_days';
    const params = [];

    if (start && end) {
        sql += ' WHERE date BETWEEN ? AND ?';
        params.push(start, end);
    } else if (start) {
        sql += ' WHERE date >= ?';
        params.push(start);
    } else if (end) {
        sql += ' WHERE date <= ?';
        params.push(end);
    }

    sql += ' ORDER BY date';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
});

export default router;

