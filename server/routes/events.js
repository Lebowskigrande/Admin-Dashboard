import express from 'express';
import { randomUUID } from 'crypto';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { rename, copyFile, rm } from 'fs/promises';
import multer from 'multer';
import { sqlite as db } from '../db.js';
import {
    tableExists,
    parseJsonField,
    parseNotes
} from '../helpers/db-utils.js';
import { buildDocumentPreview } from '../services/bulletinService.js';
import {
    ensureEventDocDir,
    ensureUniquePath
} from '../helpers/file-utils.js';
import { seedEventTasksForOccurrence } from '../services/taskEngine.js';
import { isSundayDate } from '../helpers/sunday-utils.js';

const router = express.Router();
const eventDocUpload = multer({ dest: join(tmpdir(), 'event-doc-uploads') });

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
                   o.id AS occurrence_id, o.date, o.start_time, o.end_time, o.building_id,
                   t.name as type_name, t.slug as type_slug, c.name as category_name,
                   COALESCE(t.color, c.color) as type_color
            FROM events e
            JOIN event_occurrences o ON o.event_id = e.id
            LEFT JOIN event_types t ON e.event_type_id = t.id
            LEFT JOIN event_categories c ON t.category_id = c.id
            WHERE e.id <> 'sunday-service'
        `).all();

        const scheduledEvents = eventRows.map(e => ({
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
            metadata: e.metadata ? JSON.parse(e.metadata) : {},
            source: e.source || 'manual'
        }));

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
    res.json({
        occurrence: {
            id: row.occurrence_id,
            date: row.date,
            start_time: row.start_time,
            end_time: row.end_time,
            building_id: row.building_id
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
        metadata
    });
});

router.put('/event-occurrences/:id', (req, res) => {
    const { id } = req.params;
    if (!tableExists('event_occurrences')) {
        return res.status(404).json({ error: 'Events not available' });
    }
    const existing = db.prepare('SELECT notes FROM event_occurrences WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Event occurrence not found' });
    }
    const { internal_notes: internalNotes, template_data: templateData } = req.body || {};
    const notes = parseNotes(existing.notes);
    notes.internal = String(internalNotes || '').trim();
    if (templateData && typeof templateData === 'object') {
        notes.template = templateData;
    }
    db.prepare('UPDATE event_occurrences SET notes = ? WHERE id = ?').run(JSON.stringify(notes), id);
    res.json({ success: true, notes });
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

        if (docType === 'contract') {
            const existing = db.prepare(`
                SELECT id, file_path FROM event_documents
                WHERE occurrence_id = ? AND doc_type = 'contract'
            `).all(occurrence.id);
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

        const eventId = `event-${randomUUID()}`;
        const occurrenceId = `occ-${randomUUID()}`;
        const now = new Date().toISOString();
        const parsedTypeId = type_id !== null && type_id !== '' ? Number(type_id) : null;

        db.prepare(`
            INSERT INTO events (id, title, description, event_type_id, source, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
        `).run(
            eventId,
            title,
            description,
            Number.isNaN(parsedTypeId) ? null : parsedTypeId,
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
            eventTypeId: Number.isNaN(parsedTypeId) ? null : parsedTypeId,
            dateKey: date
        });

        res.json({
            id: eventId,
            occurrenceId,
            title,
            description,
            date,
            time: time || '',
            location: location || '',
            type_id: Number.isNaN(parsedTypeId) ? null : parsedTypeId,
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
