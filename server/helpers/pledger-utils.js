import { resolve } from 'path';
import xlsx from 'xlsx';

const PLEDGER_FILE = '2026 pledgers.xlsx';

const pledgerCache = {
    loaded: false,
    rows: [],
    byEnvelope: new Map()
};

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const normalizeEnvelopeNumber = (value) => compactWhitespace(value)
    .replace(/\s+/g, '')
    .toUpperCase();

export const extractEnvelopeFromTags = (tagsValue) => {
    let tags = [];
    if (Array.isArray(tagsValue)) {
        tags = tagsValue;
    } else {
        const raw = String(tagsValue || '').trim();
        if (!raw) return '';
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                tags = parsed;
            } else {
                tags = [raw];
            }
        } catch {
            tags = raw.split(',');
        }
    }

    for (const tag of tags) {
        const value = String(tag || '').trim();
        if (!value) continue;
        const match = value.match(/env-\s*([A-Za-z0-9-]+)/i);
        if (match?.[1]) return normalizeEnvelopeNumber(match[1]);
    }
    return '';
};

const loadPledgerRows = () => {
    if (pledgerCache.loaded) return pledgerCache.rows;
    pledgerCache.loaded = true;
    pledgerCache.rows = [];
    pledgerCache.byEnvelope = new Map();
    try {
        const filePath = resolve(process.cwd(), PLEDGER_FILE);
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        rows.forEach((row) => {
            const envelope = normalizeEnvelopeNumber(row?.[0] || '');
            const family = compactWhitespace(row?.[1] || '');
            if (!envelope) return;
            const item = {
                envelope,
                family
            };
            pledgerCache.rows.push(item);
            pledgerCache.byEnvelope.set(envelope, item);
        });
    } catch {
        pledgerCache.rows = [];
        pledgerCache.byEnvelope = new Map();
    }
    return pledgerCache.rows;
};

export const getPledgerByEnvelope = (envelopeNumber) => {
    loadPledgerRows();
    const normalized = normalizeEnvelopeNumber(envelopeNumber);
    if (!normalized) return null;
    return pledgerCache.byEnvelope.get(normalized) || null;
};

export const isPledgerEnvelope = (envelopeNumber) => Boolean(getPledgerByEnvelope(envelopeNumber));

export const isGenericContributionDesignation = (value) => {
    const normalized = compactWhitespace(value).toLowerCase();
    if (!normalized) return true;
    if (normalized === '2026 pledge') return false;
    if (/^\d{4}\s+pledge(?:\s+payment)?$/i.test(normalized)) return false;
    if (normalized === 'npo') return true;
    if (normalized === 'no designation') return true;
    if (normalized === 'unknown designation') return true;
    if (normalized === 'unknown') return true;
    if (normalized === 'other') return true;
    if (normalized === 'other designation') return true;
    if (normalized === 'none') return true;
    if (normalized === 'null') return true;
    if (normalized === 'n/a' || normalized === 'na') return true;
    if (normalized === 'unspecified' || normalized === 'not specified') return true;
    return false;
};

export const resolveContributionDesignation = ({ designation = '', envelopeNumber = '' } = {}) => {
    const current = compactWhitespace(designation);
    const pledger = isPledgerEnvelope(envelopeNumber);
    const defaultDesignation = pledger ? '2026 pledge' : 'NPO';
    if (!isGenericContributionDesignation(current)) {
        return {
            designation: current,
            wasDefaulted: false,
            pledger,
            defaultDesignation
        };
    }
    return {
        designation: defaultDesignation,
        wasDefaulted: true,
        pledger,
        defaultDesignation
    };
};

export const syncPledgerFlagsInPeople = (sqlite) => {
    const hasPeople = sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'
    `).get();
    if (!hasPeople) return { updated: 0 };
    loadPledgerRows();
    const rows = sqlite.prepare(`
        SELECT id, display_name, tags, envelope_number, is_pledger
        FROM people
    `).all();
    const update = sqlite.prepare(`
        UPDATE people
        SET envelope_number = ?, is_pledger = ?, tags = ?
        WHERE id = ?
    `);
    let updated = 0;
    rows.forEach((row) => {
        const envelopeFromColumn = normalizeEnvelopeNumber(row.envelope_number || '');
        const envelopeFromTags = extractEnvelopeFromTags(row.tags);
        const envelopeNumber = envelopeFromColumn || envelopeFromTags;
        const isPledger = isPledgerEnvelope(envelopeNumber) ? '1' : '0';
        let parsedTags = [];
        try {
            const parsed = JSON.parse(String(row.tags || '[]'));
            parsedTags = Array.isArray(parsed) ? parsed : [];
        } catch {
            parsedTags = String(row.tags || '')
                .split(',')
                .map((token) => token.trim())
                .filter(Boolean);
        }
        const cleanTags = parsedTags.filter((tag) => !/^env-\s*[A-Za-z0-9-]+$/i.test(String(tag || '').trim()));
        const nextTagsJson = JSON.stringify(cleanTags);
        if (
            String(row.envelope_number || '') !== envelopeNumber
            || String(row.is_pledger || '0') !== isPledger
            || String(row.tags || '') !== nextTagsJson
        ) {
            update.run(envelopeNumber, isPledger, nextTagsJson, row.id);
            updated += 1;
        }
    });
    return { updated };
};
