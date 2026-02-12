import express from 'express';
import { sqlite as db } from '../db.js';
import {
    tableExists,
    coerceJsonObject,
    parseJsonField,
    ensureUniqueId
} from '../helpers/db-utils.js';
import {
    normalizeName,
    slugifyName,
    normalizePersonRoles,
    normalizeTags
} from '../helpers/people-utils.js';

const router = express.Router();

router.get('/', (req, res) => {
    if (!tableExists('people')) {
        return res.json([]);
    }
    const rows = db.prepare('SELECT * FROM people ORDER BY display_name').all();
    const people = rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email || '',
        phonePrimary: row.phone_primary || '',
        phoneAlternate: row.phone_alternate || '',
        addressLine1: row.address_line1 || '',
        addressLine2: row.address_line2 || '',
        city: row.city || '',
        state: row.state || '',
        postalCode: row.postal_code || '',
        category: row.category || '',
        roles: normalizePersonRoles(row.roles),
        tags: parseJsonField(row.tags),
        teams: coerceJsonObject(row.teams)
    }));
    return res.json(people);
});

router.post('/', (req, res) => {
    const {
        displayName,
        email = '',
        phonePrimary = '',
        phoneAlternate = '',
        addressLine1 = '',
        addressLine2 = '',
        city = '',
        state = '',
        postalCode = '',
        category = 'parishioner',
        roles = [],
        tags = [],
        teams = {}
    } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const baseId = slugifyName(normalizedName) || `person-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'people');
    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = normalizeTags(tags);

    db.prepare(`
        INSERT INTO people (
            id, display_name, email, phone_primary, phone_alternate,
            address_line1, address_line2, city, state, postal_code,
            category, roles, tags, teams
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams))
    );

    return res.status(201).json({
        id,
        displayName: normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        roles: normalizedRoles,
        tags: normalizedTags,
        teams: coerceJsonObject(teams)
    });
});

router.put('/:id', (req, res) => {
    const { id } = req.params;
    const {
        displayName,
        email = '',
        phonePrimary = '',
        phoneAlternate = '',
        addressLine1 = '',
        addressLine2 = '',
        city = '',
        state = '',
        postalCode = '',
        category = 'parishioner',
        roles = [],
        tags = [],
        teams = {}
    } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const existing = db.prepare('SELECT id FROM people WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Person not found' });
    }

    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = normalizeTags(tags);

    db.prepare(`
        UPDATE people SET
            display_name = ?,
            email = ?,
            phone_primary = ?,
            phone_alternate = ?,
            address_line1 = ?,
            address_line2 = ?,
            city = ?,
            state = ?,
            postal_code = ?,
            category = ?,
            roles = ?,
            tags = ?,
            teams = ?
        WHERE id = ?
    `).run(
        normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        JSON.stringify(normalizedRoles),
        JSON.stringify(normalizedTags),
        JSON.stringify(coerceJsonObject(teams)),
        id
    );

    return res.json({
        id,
        displayName: normalizedName,
        email,
        phonePrimary,
        phoneAlternate,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        category,
        roles: normalizedRoles,
        tags: normalizedTags,
        teams: coerceJsonObject(teams)
    });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM people WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'Person not found' });
    }
    return res.json({ success: true });
});

export default router;
