import express from 'express';
import { join } from 'path';
import { sqlite as db } from '../db.js';
import { tableExists, ensureUniqueId, parseJsonField } from '../helpers/db-utils.js';
import { normalizeName, slugifyName } from '../helpers/people-utils.js';
import { upsertEntityLink, deleteEntityLinks } from '../helpers/entity-utils.js';
import { resolveContractFile } from '../helpers/file-utils.js';
import { listTaskInstances, deleteTaskInstance } from '../services/taskEngine.js';

const router = express.Router();
const DROPBOX_ROOT = process.env.DB_BACKUP_DIR ? join(process.env.DB_BACKUP_DIR, '..') : 'C:\\Users\\Secretary\\Dropbox\\MacMini';

const TICKET_STATUSES = ['new', 'open', 'in_progress', 'blocked', 'done', 'wont_do'];

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

    return {
        id: ticketRow.id,
        title: ticketRow.title,
        description: ticketRow.description || '',
        status: ticketRow.status,
        notes: parseJsonField(ticketRow.notes),
        areas,
        tasks,
        created_at: ticketRow.created_at,
        updated_at: ticketRow.updated_at
    };
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

router.post('/tickets', (req, res) => {
    const {
        title,
        description = '',
        status = 'new',
        notes = [],
        area_ids = []
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!TICKET_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const now = new Date().toISOString();
    const baseId = slugifyName(normalizedTitle) || `ticket-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'tickets');

    db.prepare(`
        INSERT INTO tickets (id, title, description, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedTitle,
        description,
        status,
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
        notes,
        area_ids
    } = req.body || {};

    const normalizedTitle = normalizeName(title);
    if (!normalizedTitle) {
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!TICKET_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const updatedNotes = Array.isArray(notes) ? notes : parseJsonField(existing.notes);

    db.prepare(`
        UPDATE tickets SET
            title = ?,
            description = ?,
            status = ?,
            notes = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        normalizedTitle,
        description,
        status,
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
