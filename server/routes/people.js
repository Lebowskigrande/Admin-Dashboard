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
import { extractEnvelopeFromTags, isPledgerEnvelope, normalizeEnvelopeNumber } from '../helpers/pledger-utils.js';

const router = express.Router();
const stripEnvelopeTags = (tags = []) => (Array.isArray(tags)
    ? tags.filter((tag) => !/^env-\s*[A-Za-z0-9-]+$/i.test(String(tag || '').trim()))
    : []);

router.get('/', (req, res) => {
    if (!tableExists('people')) {
        return res.json([]);
    }
    const rows = db.prepare('SELECT * FROM people ORDER BY display_name').all();
    const people = rows.map((row) => {
        const envelopeFromColumn = normalizeEnvelopeNumber(row.envelope_number || '');
        const envelopeFromTags = extractEnvelopeFromTags(row.tags);
        const cleanTags = stripEnvelopeTags(parseJsonField(row.tags));
        const envelopeNumber = envelopeFromColumn || envelopeFromTags || '';
        const isPledger = String(row.is_pledger || '').trim() === '1' || isPledgerEnvelope(envelopeNumber);
        return {
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
            tags: cleanTags,
            teams: coerceJsonObject(row.teams),
            envelopeNumber,
            isPledger
        };
    });
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
        teams = {},
        envelopeNumber = null,
        isPledger = null
    } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const baseId = slugifyName(normalizedName) || `person-${Date.now()}`;
    const id = ensureUniqueId(baseId, 'people');
    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = stripEnvelopeTags(normalizeTags(tags));
    const providedEnvelope = envelopeNumber == null ? '' : normalizeEnvelopeNumber(envelopeNumber);
    const normalizedEnvelopeNumber = providedEnvelope || extractEnvelopeFromTags(normalizedTags);
    const explicitPledger = isPledger == null
        ? null
        : (isPledger === true || String(isPledger).trim() === '1');
    const normalizedPledger = ((explicitPledger == null ? isPledgerEnvelope(normalizedEnvelopeNumber) : explicitPledger))
        ? '1'
        : '0';

    db.prepare(`
        INSERT INTO people (
            id, display_name, email, phone_primary, phone_alternate,
            address_line1, address_line2, city, state, postal_code,
            category, roles, tags, teams, envelope_number, is_pledger
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(coerceJsonObject(teams)),
        normalizedEnvelopeNumber,
        normalizedPledger
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
        teams: coerceJsonObject(teams),
        envelopeNumber: normalizedEnvelopeNumber,
        isPledger: normalizedPledger === '1'
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
        teams = {},
        envelopeNumber = null,
        isPledger = null
    } = req.body || {};

    const normalizedName = normalizeName(displayName);
    if (!normalizedName) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const existing = db.prepare('SELECT id, envelope_number FROM people WHERE id = ?').get(id);
    if (!existing) {
        return res.status(404).json({ error: 'Person not found' });
    }

    const normalizedRoles = normalizePersonRoles(roles);
    const normalizedTags = stripEnvelopeTags(normalizeTags(tags));
    const providedEnvelope = envelopeNumber == null ? '' : normalizeEnvelopeNumber(envelopeNumber);
    const existingEnvelope = normalizeEnvelopeNumber(existing.envelope_number || '');
    const normalizedEnvelopeNumber = providedEnvelope || extractEnvelopeFromTags(normalizedTags) || existingEnvelope;
    const explicitPledger = isPledger == null
        ? null
        : (isPledger === true || String(isPledger).trim() === '1');
    const normalizedPledger = ((explicitPledger == null ? isPledgerEnvelope(normalizedEnvelopeNumber) : explicitPledger))
        ? '1'
        : '0';

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
            teams = ?,
            envelope_number = ?,
            is_pledger = ?
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
        normalizedEnvelopeNumber,
        normalizedPledger,
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
        teams: coerceJsonObject(teams),
        envelopeNumber: normalizedEnvelopeNumber,
        isPledger: normalizedPledger === '1'
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
