import express from 'express';
import { join } from 'path';
import { sqlite as db } from '../db.js';
import { tableExists, ensureUniqueId, parseJsonField } from '../helpers/db-utils.js';
import { normalizeName, slugifyName } from '../helpers/people-utils.js';
import { upsertEntityLink, deleteEntityLinks } from '../helpers/entity-utils.js';
import { resolveContractFile } from '../helpers/file-utils.js';
import {
    getArchitecturalAreaMetadata,
    getArchitecturalRecordsForArea,
    getArchitecturalRecordsOverview,
    recommendArchitecturalRecordsForTicket
} from '../helpers/architectural-records.js';
import { listTaskInstances, deleteTaskInstance } from '../services/taskEngine.js';
import {
    TICKET_STATUS_OPTIONS,
    normalizeTicketCategory,
    normalizeTicketPriority,
    normalizeTicketRecord,
    normalizeTicketStatus
} from '../../shared/tickets.js';

const router = express.Router();
const DROPBOX_ROOT = process.env.DB_BACKUP_DIR ? join(process.env.DB_BACKUP_DIR, '..') : 'C:\\Users\\Secretary\\Dropbox\\MacMini';

const TICKET_STATUSES = TICKET_STATUS_OPTIONS.map((option) => option.value);

const buildBuildingMapId = (name = '') => {
    const normalized = slugifyName(name);
    const aliases = {
        'church': 'sanctuary',
        'sanctuary': 'sanctuary',
        'chapel': 'chapel',
        'fellows-hall': 'parish-hall',
        'parish-hall': 'parish-hall',
        'office-school': 'office',
        'office': 'office',
        'north-parking': 'parking-north',
        'south-parking': 'parking-south',
        'north-lot': 'parking-north',
        'south-lot': 'parking-south',
        'playground': 'playground',
        'close': 'close'
    };
    return aliases[normalized] || normalized;
};

const normalizeBuildingName = (value = '') => {
    const name = String(value || '').trim();
    if (!name) return '';
    if (name.toLowerCase() === 'parish hall') return 'Fellows Hall';
    return name;
};

const buildFileUrls = (filePath = '') => ({
    downloadUrl: filePath ? `/api/files/download?path=${encodeURIComponent(filePath)}` : '',
    openPath: filePath
});

const loadBuildingsIndex = () => {
    if (!tableExists('buildings')) return new Map();
    const rows = db.prepare('SELECT id, name, category, size_sqft, parking_spaces, notes FROM buildings').all();
    const index = new Map();
    rows.forEach((row) => {
        const building = {
            id: row.id,
            map_id: buildBuildingMapId(row.name || ''),
            name: normalizeBuildingName(row.name || ''),
            category: row.category || '',
            size_sqft: row.size_sqft || 0,
            parking_spaces: row.parking_spaces || 0,
            notes: row.notes || ''
        };
        index.set(building.id, building);
        index.set(building.map_id, building);
    });
    return index;
};

// --- Buildings Routes ---

router.get('/buildings', (req, res) => {
    if (!tableExists('buildings')) {
        return res.json([]);
    }
    const hasRooms = tableExists('rooms');
    const rows = db.prepare('SELECT * FROM buildings ORDER BY name').all();
    const buildings = rows.map(row => {
        const roomRows = hasRooms
            ? db.prepare(`
                SELECT id, name, floor, capacity, rental_rate, notes
                FROM rooms
                WHERE building_id = ?
                ORDER BY name
            `).all(row.id)
            : [];
        const rooms = roomRows.map((room) => ({
            id: room.id,
            name: room.name,
            floor: room.floor,
            capacity: room.capacity,
            rental_rate: room.rental_rate,
            notes: room.notes || ''
        }));
        const rentalRate = row.rental_rate_day ?? row.rental_rate_hour;
        return {
            id: row.id,
            map_id: buildBuildingMapId(row.name || ''),
            name: normalizeBuildingName(row.name),
            category: row.category,
            capacity: row.capacity,
            size_sqft: row.size_sqft,
            rental_rate_hour: row.rental_rate_hour,
            rental_rate_day: row.rental_rate_day,
            rental_rate: rentalRate || 0,
            parking_spaces: row.parking_spaces,
            event_types: parseJsonField(row.event_types),
            notes: row.notes || '',
            rooms
        };
    });
    res.json(buildings);
});

router.get('/buildings/:id/events', (req, res) => {
    const buildingId = String(req.params?.id || '').trim();
    if (!buildingId) {
        return res.status(400).json({ error: 'building id is required' });
    }
    if (!tableExists('event_occurrences') || !tableExists('events')) {
        return res.json([]);
    }
    const rows = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.end_time,
            e.id AS event_id,
            e.title,
            e.description,
            t.name AS type_name,
            t.slug AS type_slug
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON t.id = e.event_type_id
        WHERE o.building_id = ?
          AND o.date >= date('now')
        ORDER BY o.date ASC, COALESCE(o.start_time, '') ASC
        LIMIT 24
    `).all(buildingId);
    return res.json(rows);
});

router.get('/buildings/records/overview', async (_req, res) => {
    try {
        const overview = await getArchitecturalRecordsOverview();
        const buildingsIndex = loadBuildingsIndex();
        const areaMetadata = getArchitecturalAreaMetadata();
        return res.json({
            ok: true,
            rootPath: overview.rootPath,
            generatedAt: overview.generatedAt,
            summary: overview.summary,
            layers: overview.layers,
            systems: overview.systems,
            areas: overview.areas.map((area) => ({
                ...area,
                building: buildingsIndex.get(area.id) || buildingsIndex.get(area.map_id) || areaMetadata[area.id] || null
            })),
            records: overview.records.map((record) => ({
                ...record,
                ...buildFileUrls(record.absolutePath)
            }))
        });
    } catch (error) {
        console.error('Architectural records overview error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load architectural records overview' });
    }
});

router.get('/buildings/records/by-area/:areaId', async (req, res) => {
    try {
        const areaId = String(req.params?.areaId || '').trim();
        if (!areaId) {
            return res.status(400).json({ ok: false, error: 'areaId is required' });
        }
        const payload = await getArchitecturalRecordsForArea({
            areaId,
            layer: req.query?.layer,
            system: req.query?.system,
            query: req.query?.q
        });
        const buildingsIndex = loadBuildingsIndex();
        const areaMetadata = getArchitecturalAreaMetadata();
        const area = payload.areas.find((entry) => entry.id === areaId) || areaMetadata[areaId] || null;
        return res.json({
            ok: true,
            area: area
                ? {
                    ...area,
                    building: buildingsIndex.get(areaId) || buildingsIndex.get(area?.map_id) || areaMetadata[areaId] || null
                }
                : null,
            layers: payload.layers,
            systems: payload.systems,
            records: payload.records.map((record) => ({
                ...record,
                ...buildFileUrls(record.absolutePath)
            }))
        });
    } catch (error) {
        console.error('Architectural records by-area error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load architectural records for area' });
    }
});

router.post('/buildings', (req, res) => {
    const {
        name,
        category = 'All Purpose',
        capacity = 0,
        size_sqft = 0,
        rental_rate_hour = 0,
        rental_rate_day = 0,
        parking_spaces = 0,
        event_types = [],
        notes = ''
    } = req.body || {};

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const baseId = slugifyName(normalizedName) || `building-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'buildings');

    db.prepare(`
        INSERT INTO buildings (
            id, name, category, capacity, size_sqft, rental_rate_hour, rental_rate_day, parking_spaces, event_types, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        JSON.stringify(Array.isArray(event_types) ? event_types : []),
        notes
    );

    res.status(201).json({
        id,
        map_id: buildBuildingMapId(normalizedName),
        name: normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        event_types: Array.isArray(event_types) ? event_types : [],
        notes
    });
});

router.put('/buildings/:id', (req, res) => {
    const { id } = req.params;
    const {
        name,
        category = 'All Purpose',
        capacity = 0,
        size_sqft = 0,
        rental_rate_hour = 0,
        rental_rate_day = 0,
        parking_spaces = 0,
        event_types = [],
        notes = ''
    } = req.body || {};

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const existing = db.prepare('SELECT id FROM buildings WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Building not found' });
    }

    db.prepare(`
        UPDATE buildings SET
            name = ?,
            category = ?,
            capacity = ?,
            size_sqft = ?,
            rental_rate_hour = ?,
            rental_rate_day = ?,
            parking_spaces = ?,
            event_types = ?,
            notes = ?
        WHERE id = ?
    `).run(
        normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        JSON.stringify(Array.isArray(event_types) ? event_types : []),
        notes,
        id
    );

    res.json({
        id,
        map_id: buildBuildingMapId(normalizedName),
        name: normalizedName,
        category,
        capacity,
        size_sqft,
        rental_rate_hour,
        rental_rate_day,
        parking_spaces,
        event_types: Array.isArray(event_types) ? event_types : [],
        notes
    });
});

router.delete('/buildings/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Building not found' });
    }
    res.json({ success: true });
});

// --- Vendors Routes ---

router.get('/vendors', async (req, res) => {
    if (!tableExists('preferred_vendors')) {
        return res.json([]);
    }
    const rows = db.prepare(`
        SELECT id, service, vendor, contact, phone, email, notes, contract
        FROM preferred_vendors
        ORDER BY service, vendor
    `).all();
    const contractsDir = join(DROPBOX_ROOT, 'Contracts');
    const vendors = await Promise.all(rows.map(async (row) => {
        const contract = await resolveContractFile(contractsDir, row.vendor, row.contract);
        return {
            ...row,
            contract_path: contract.path,
            contract_exists: contract.exists
        };
    }));
    res.json(vendors);
});

// --- Tickets Routes ---

const getTicketAreaIds = (ticketId) => {
    if (!tableExists('entity_links')) {
        return db.prepare('SELECT area_id FROM ticket_areas WHERE ticket_id = ?').all(ticketId).map((r) => r.area_id);
    }
    const linkRows = db.prepare(`
        SELECT to_id FROM entity_links
        WHERE from_type = 'ticket' AND from_id = ? AND role = 'location'
    `).all(ticketId);
    if (linkRows.length) {
        return linkRows.map((row) => row.to_id);
    }
    return db.prepare('SELECT area_id FROM ticket_areas WHERE ticket_id = ?').all(ticketId).map((r) => r.area_id);
};

const setTicketAreas = (ticketId, areaIds = []) => {
    deleteEntityLinks({ fromType: 'ticket', fromId: ticketId, role: 'location' });
    db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(ticketId);
    const insertArea = db.prepare('INSERT OR IGNORE INTO ticket_areas (ticket_id, area_id) VALUES (?, ?)');
    areaIds.forEach((areaId) => {
        if (!areaId) return;
        upsertEntityLink({
            fromType: 'ticket',
            fromId: ticketId,
            toType: 'area',
            toId: areaId,
            role: 'location'
        });
        insertArea.run(ticketId, areaId);
    });
};

const buildTicketResponse = (ticketRow) => {
    const areas = getTicketAreaIds(ticketRow.id);
    const tasks = listTaskInstances(
        `WHERE src.origin_type = 'ticket' AND src.origin_id = ? ORDER BY t.created_at DESC`,
        [ticketRow.id]
    ).map((task) => ({
        id: task.id,
        ticket_id: task.ticket_id,
        text: task.text,
        completed: task.completed,
        created_at: task.created_at,
        completed_at: task.completed_at || null,
        priority_effective: task.priority_effective,
        priority_tier: task.priority_tier
    }));

    return normalizeTicketRecord({
        id: ticketRow.id,
        title: ticketRow.title,
        description: ticketRow.description || '',
        status: ticketRow.status,
        priority: ticketRow.priority,
        category: ticketRow.category,
        requested_by: ticketRow.requested_by || '',
        assigned_to: ticketRow.assigned_to || '',
        vendor_id: ticketRow.vendor_id || '',
        target_date: ticketRow.target_date || '',
        notes: parseJsonField(ticketRow.notes),
        areas,
        tasks,
        created_at: ticketRow.created_at,
        updated_at: ticketRow.updated_at
    });
};

router.get('/tickets', (req, res) => {
    if (!tableExists('tickets')) {
        return res.json([]);
    }
    const rows = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
    const tickets = rows.map(buildTicketResponse);
    res.json(tickets);
});

router.get('/tickets/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('tickets')) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!row) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(buildTicketResponse(row));
});

router.get('/tickets/:id/recommendations', async (req, res) => {
    try {
        const { id } = req.params;
        if (!tableExists('tickets')) {
            return res.status(404).json({ ok: false, error: 'Ticket not found' });
        }
        const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
        if (!row) {
            return res.status(404).json({ ok: false, error: 'Ticket not found' });
        }
        const ticket = buildTicketResponse(row);
        const recommendations = await recommendArchitecturalRecordsForTicket({
            ticket,
            limit: Number.parseInt(req.query?.limit, 10) || 6
        });
        return res.json({
            ok: true,
            ticket: {
                id: ticket.id,
                title: ticket.title,
                description: ticket.description,
                areas: ticket.areas
            },
            recommendations: recommendations.map((record) => ({
                ...record,
                ...buildFileUrls(record.absolutePath)
            }))
        });
    } catch (error) {
        console.error('Ticket recommendations error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load ticket recommendations' });
    }
});

router.post('/tickets', (req, res) => {
    const {
        title,
        description = '',
        status = 'new',
        priority = 'normal',
        category = 'general',
        requested_by = '',
        assigned_to = '',
        vendor_id = '',
        target_date = '',
        notes = [],
        area_ids = []
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    const normalizedStatus = normalizeTicketStatus(status, '');
    if (!normalizedStatus || !TICKET_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    const normalizedPriority = normalizeTicketPriority(priority);
    const normalizedCategory = normalizeTicketCategory(category);
    const normalizedRequestedBy = String(requested_by || '').trim();
    const normalizedAssignedTo = String(assigned_to || '').trim();
    const normalizedVendorId = String(vendor_id || '').trim();
    const normalizedTargetDate = String(target_date || '').trim();

    const now = new Date().toISOString();
    const baseId = slugifyName(normalizedTitle) || `ticket-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'tickets');

    db.prepare(`
        INSERT INTO tickets (
            id, title, description, status, priority, category,
            requested_by, assigned_to, vendor_id, target_date,
            notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedTitle,
        description,
        normalizedStatus,
        normalizedPriority,
        normalizedCategory,
        normalizedRequestedBy,
        normalizedAssignedTo,
        normalizedVendorId,
        normalizedTargetDate,
        JSON.stringify(Array.isArray(notes) ? notes : []),
        now,
        now
    );

    if (Array.isArray(area_ids)) {
        setTicketAreas(id, area_ids);
    }

    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.status(201).json(buildTicketResponse(row));
});

router.put('/tickets/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Ticket not found' });
    }

    const {
        title = existing.title,
        description = existing.description || '',
        status = existing.status,
        priority = existing.priority || 'normal',
        category = existing.category || 'general',
        requested_by = existing.requested_by || '',
        assigned_to = existing.assigned_to || '',
        vendor_id = existing.vendor_id || '',
        target_date = existing.target_date || '',
        notes,
        area_ids
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    const normalizedStatus = normalizeTicketStatus(status, '');
    if (!normalizedStatus || !TICKET_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    const normalizedPriority = normalizeTicketPriority(priority);
    const normalizedCategory = normalizeTicketCategory(category);
    const normalizedRequestedBy = String(requested_by || '').trim();
    const normalizedAssignedTo = String(assigned_to || '').trim();
    const normalizedVendorId = String(vendor_id || '').trim();
    const normalizedTargetDate = String(target_date || '').trim();

    const updatedNotes = Array.isArray(notes) ? notes : parseJsonField(existing.notes);

    db.prepare(`
        UPDATE tickets SET
            title = ?,
            description = ?,
            status = ?,
            priority = ?,
            category = ?,
            requested_by = ?,
            assigned_to = ?,
            vendor_id = ?,
            target_date = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        normalizedTitle,
        description,
        normalizedStatus,
        normalizedPriority,
        normalizedCategory,
        normalizedRequestedBy,
        normalizedAssignedTo,
        normalizedVendorId,
        normalizedTargetDate,
        JSON.stringify(updatedNotes),
        new Date().toISOString(),
        id
    );

    if (Array.isArray(area_ids)) {
        setTicketAreas(id, area_ids);
    }

    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.json(buildTicketResponse(row));
});

router.delete('/tickets/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM ticket_areas WHERE ticket_id = ?').run(id);
    deleteEntityLinks({ fromType: 'ticket', fromId: id, role: 'location' });
    const ticketTasks = listTaskInstances(
        `WHERE src.origin_type = 'ticket' AND src.origin_id = ?`,
        [id]
    );
    ticketTasks.forEach((task) => {
        deleteTaskInstance(task.id);
    });
    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json({ success: true });
});

export default router;
