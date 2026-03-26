import { access, readdir, stat } from 'fs/promises';
import { basename, extname, join, relative, resolve } from 'path';

export const ARCHITECTURAL_RECORDS_ROOT = resolve(
    process.cwd(),
    "St. Edmund's Architectural Records - 2013 pdfs"
);

const CACHE_TTL_MS = 60_000;
const MAX_SCAN_DEPTH = 6;

const AREA_METADATA = {
    sanctuary: { id: 'sanctuary', name: 'Church', type: 'building', category: 'Worship', onMap: true },
    chapel: { id: 'chapel', name: 'Chapel', type: 'building', category: 'Worship', onMap: true },
    office: { id: 'office', name: 'Office/School', type: 'building', category: 'All Purpose', onMap: true },
    'parish-hall': { id: 'parish-hall', name: 'Fellows Hall', type: 'building', category: 'All Purpose', onMap: true },
    close: { id: 'close', name: 'Close', type: 'grounds', category: 'Grounds', onMap: true },
    playground: { id: 'playground', name: 'Playground', type: 'grounds', category: 'Grounds', onMap: true },
    rectory: { id: 'rectory', name: 'Rectory', type: 'building', category: 'Residential', onMap: false }
};

const LAYER_LABELS = {
    site: 'Site Plans',
    floor: 'Floor Plans',
    utilities: 'Utilities',
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    mechanical: 'Mechanical / HVAC',
    structural: 'Structural',
    elevations: 'Elevations',
    sections: 'Sections',
    details: 'Details',
    interiors: 'Interiors',
    demolition: 'Demolition',
    reflected_ceiling: 'Reflected Ceiling',
    reference: 'Reference / Notes',
    approvals: 'Approvals / Correspondence',
    misc: 'Miscellaneous'
};

const SYSTEM_LABELS = {
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    hvac: 'HVAC',
    structural: 'Structural',
    site: 'Site / Civil',
    accessibility: 'Accessibility',
    life_safety: 'Life Safety'
};

let cache = {
    expiresAt: 0,
    rootMtimeMs: 0,
    payload: null
};

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const slugify = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'the',
    'to', 'with', 'near', 'need', 'needs', 'issue', 'problem', 'broken', 'fix', 'repair', 'replace',
    'not', 'out', 'possible', 'maybe', 'church'
]);

const TICKET_SIGNAL_GROUPS = [
    {
        key: 'plumbing',
        patterns: ['leak', 'leaking', 'water', 'flood', 'flooding', 'drain', 'drainage', 'toilet', 'restroom', 'sink', 'sewer', 'plumbing', 'pipe'],
        systems: ['plumbing'],
        layers: ['plumbing'],
        labels: ['Plumbing']
    },
    {
        key: 'electrical',
        patterns: ['electrical', 'power', 'outlet', 'breaker', 'panel', 'light', 'lighting', 'switch', 'dimmer', 'sound', 'speaker', 'low voltage'],
        systems: ['electrical', 'life_safety'],
        layers: ['electrical'],
        labels: ['Electrical']
    },
    {
        key: 'hvac',
        patterns: ['hvac', 'air conditioning', 'cooling', 'heating', 'heater', 'thermostat', 'vent', 'duct', 'mechanical'],
        systems: ['hvac'],
        layers: ['mechanical'],
        labels: ['HVAC']
    },
    {
        key: 'structural',
        patterns: ['crack', 'wall', 'beam', 'foundation', 'framing', 'structural', 'seismic', 'settling', 'roof'],
        systems: ['structural'],
        layers: ['structural', 'sections', 'elevations'],
        labels: ['Structural']
    },
    {
        key: 'site',
        patterns: ['gate', 'parking', 'walk', 'walkway', 'path', 'exterior', 'site', 'grading', 'playground', 'landscape', 'irrigation', 'curb'],
        systems: ['site'],
        layers: ['site'],
        labels: ['Site']
    },
    {
        key: 'life_safety',
        patterns: ['alarm', 'fire', 'egress', 'exit', 'safety', 'accessibility', 'ada', 'ramp'],
        systems: ['life_safety', 'accessibility'],
        layers: ['electrical', 'details'],
        labels: ['Life Safety']
    }
];

const cleanDocumentTitle = (fileName = '') => {
    const raw = basename(fileName, extname(fileName));
    return raw
        .replace(/^\d+[A-Z]?\)\s*/i, '')
        .replace(/^\d+[A-Z]?-/, '')
        .replace(/^\(?\d+\s+of\s+\d+\)?-?/i, '')
        .replace(/^[A-Z]+-?\d+(?:\.\d+)?-?/i, '')
        .replace(/\s+/g, ' ')
        .replace(/^-+/, '')
        .trim() || raw;
};

const detectYear = (value = '') => {
    const matches = String(value || '').match(/\b(19\d{2}|20\d{2})\b/g);
    if (!matches?.length) return null;
    return Number.parseInt(matches[matches.length - 1], 10);
};

const inferAreaIds = ({ topLevel = '', subfolders = [], title = '', relativePath = '' } = {}) => {
    const joined = normalizeText([topLevel, ...subfolders, title, relativePath].join(' '));
    const projectText = normalizeText([subfolders[0] || '', title].join(' '));

    if (/^001\b/.test(topLevel) || joined.includes('main church')) {
        return ['sanctuary'];
    }
    if (/^002\b/.test(topLevel) || joined.includes('chapel')) {
        return ['chapel'];
    }
    if (/^003\b/.test(topLevel) || joined.includes('classroom building') || joined.includes('parish hall')) {
        if (
            projectText.includes('fellows')
            || projectText.includes('fellows hall')
            || projectText.includes('parish addition')
            || projectText.includes('addition south of clsrm')
            || projectText.includes('utilities for fellows hall')
        ) {
            return ['parish-hall'];
        }
        return ['office'];
    }
    if (/^004\b/.test(topLevel) || joined.includes('miscellaneous structures')) {
        if (joined.includes('rectory')) return ['rectory'];
        if (joined.includes('playground')) return ['playground'];
        if (joined.includes('front wall')) return ['close'];
    }
    return [];
};

const classifyRecord = ({ absolutePath = '', relativePath = '' } = {}) => {
    const parts = relativePath.split(/[\\/]+/).filter(Boolean);
    const fileName = parts.at(-1) || basename(absolutePath);
    const title = cleanDocumentTitle(fileName);
    const topLevel = parts[0] || '';
    const seriesFolder = parts[1] || topLevel;
    const subfolders = parts.slice(1, -1);
    const haystack = normalizeText(`${relativePath} ${title}`);
    const systems = [];
    let layerKey = 'misc';

    if (/transmittal|letter|correspondence|city approvals?|approval/i.test(haystack)) {
        layerKey = /approval|approvals?/i.test(haystack) ? 'approvals' : 'reference';
    } else if (/title page|general notes|schedule|notes\b/i.test(haystack)) {
        layerKey = 'reference';
    } else if (/demolition|demo\b/i.test(haystack)) {
        layerKey = 'demolition';
    } else if (/reflected ceiling|rcp\b/i.test(haystack)) {
        layerKey = 'reflected_ceiling';
    } else if (/plumbing|sewer|waste|sanitary|storm drain|water service/i.test(haystack)) {
        layerKey = 'plumbing';
        systems.push('plumbing', 'site');
    } else if (/electrical|lighting|power|panel|switchgear|fire alarm/i.test(haystack)) {
        layerKey = 'electrical';
        systems.push('electrical');
        if (/fire alarm|alarm/i.test(haystack)) systems.push('life_safety');
    } else if (/mechanical|hvac|heating|air conditioning|duct|ventilation/i.test(haystack)) {
        layerKey = 'mechanical';
        systems.push('hvac');
    } else if (/structural|seismic|foundation|framing|beam|joist|\bs-\d/i.test(haystack)) {
        layerKey = 'structural';
        systems.push('structural');
    } else if (/site plan|plot plan|landscape|walk|wall\b|grading/i.test(haystack)) {
        layerKey = 'site';
        systems.push('site');
    } else if (/floor plan|basement|lower level|upper level|roof plan|plan\b/i.test(haystack)) {
        layerKey = 'floor';
    } else if (/elevations?|interior elevations?/i.test(haystack)) {
        layerKey = /interior/i.test(haystack) ? 'interiors' : 'elevations';
    } else if (/sections?/i.test(haystack)) {
        layerKey = 'sections';
    } else if (/details?|stairs|ramps|jambs|windows|doors|toilet|sacristy/i.test(haystack)) {
        layerKey = 'details';
    }

    if (/utilities?/i.test(haystack) && !['plumbing', 'electrical', 'mechanical'].includes(layerKey)) {
        layerKey = 'utilities';
    }
    if (/ada|accessib/i.test(haystack)) {
        systems.push('accessibility');
    }
    if (/seismic|fire|egress|alarm/i.test(haystack)) {
        systems.push('life_safety');
    }

    const areaIds = inferAreaIds({ topLevel, subfolders, title, relativePath });
    const year = detectYear(relativePath);

    return {
        id: slugify(relativePath),
        title,
        fileName,
        absolutePath,
        relativePath,
        topLevel,
        seriesFolder,
        year,
        layerKey,
        layerLabel: LAYER_LABELS[layerKey] || LAYER_LABELS.misc,
        utilitySystems: unique(systems).map((key) => ({
            key,
            label: SYSTEM_LABELS[key] || key
        })),
        areaIds,
        areaNames: areaIds.map((areaId) => AREA_METADATA[areaId]?.name || areaId)
    };
};

const listPdfFilesRecursive = async (rootPath, depth = 0, collector = []) => {
    if (depth > MAX_SCAN_DEPTH) return collector;
    const entries = await readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const nextPath = join(rootPath, entry.name);
        if (entry.isDirectory()) {
            await listPdfFilesRecursive(nextPath, depth + 1, collector);
            continue;
        }
        if (entry.isFile() && extname(entry.name).toLowerCase() === '.pdf') {
            collector.push(nextPath);
        }
    }
    return collector;
};

const buildAreaOverview = (records = []) => {
    const areas = new Map();
    Object.values(AREA_METADATA).forEach((area) => {
        areas.set(area.id, {
            ...area,
            documentCount: 0,
            years: [],
            layers: [],
            systems: [],
            sampleRecords: []
        });
    });

    records.forEach((record) => {
        record.areaIds.forEach((areaId) => {
            const area = areas.get(areaId);
            if (!area) return;
            area.documentCount += 1;
            if (record.year) area.years.push(record.year);
            area.layers.push(record.layerKey);
            area.systems.push(...record.utilitySystems.map((system) => system.key));
            if (area.sampleRecords.length < 4) {
                area.sampleRecords.push({
                    id: record.id,
                    title: record.title,
                    year: record.year,
                    layerLabel: record.layerLabel,
                    relativePath: record.relativePath
                });
            }
        });
    });

    return Array.from(areas.values())
        .filter((area) => area.documentCount > 0)
        .map((area) => ({
            ...area,
            years: unique(area.years.map(String))
                .map((year) => Number.parseInt(year, 10))
                .sort((a, b) => a - b),
            layers: unique(area.layers).map((key) => ({
                key,
                label: LAYER_LABELS[key] || key,
                count: records.filter((record) => record.areaIds.includes(area.id) && record.layerKey === key).length
            })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
            systems: unique(area.systems).map((key) => ({
                key,
                label: SYSTEM_LABELS[key] || key,
                count: records.filter((record) => (
                    record.areaIds.includes(area.id)
                    && record.utilitySystems.some((system) => system.key === key)
                )).length
            })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
};

const buildGlobalCounts = (records = [], keySelector = () => '') => {
    const counts = new Map();
    records.forEach((record) => {
        const values = [].concat(keySelector(record)).filter(Boolean);
        values.forEach((value) => {
            counts.set(value, (counts.get(value) || 0) + 1);
        });
    });
    return counts;
};

const scanArchitecturalRecords = async () => {
    await access(ARCHITECTURAL_RECORDS_ROOT);
    const rootStats = await stat(ARCHITECTURAL_RECORDS_ROOT);
    const now = Date.now();
    if (
        cache.payload
        && cache.expiresAt > now
        && cache.rootMtimeMs === rootStats.mtimeMs
    ) {
        return cache.payload;
    }

    const pdfFiles = await listPdfFilesRecursive(ARCHITECTURAL_RECORDS_ROOT);
    const records = pdfFiles
        .map((absolutePath) => classifyRecord({
            absolutePath,
            relativePath: relative(ARCHITECTURAL_RECORDS_ROOT, absolutePath)
        }))
        .sort((a, b) => {
            if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
            return a.relativePath.localeCompare(b.relativePath);
        });

    const layerCounts = buildGlobalCounts(records, (record) => record.layerKey);
    const systemCounts = buildGlobalCounts(records, (record) => record.utilitySystems.map((system) => system.key));
    const areaCounts = buildGlobalCounts(records, (record) => record.areaIds);
    const areas = buildAreaOverview(records);

    const payload = {
        rootPath: ARCHITECTURAL_RECORDS_ROOT,
        generatedAt: new Date().toISOString(),
        summary: {
            documentCount: records.length,
            areaCount: areas.length,
            utilityDocumentCount: records.filter((record) => (
                ['utilities', 'plumbing', 'electrical', 'mechanical'].includes(record.layerKey)
            )).length
        },
        layers: Array.from(layerCounts.entries())
            .map(([key, count]) => ({ key, label: LAYER_LABELS[key] || key, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        systems: Array.from(systemCounts.entries())
            .map(([key, count]) => ({ key, label: SYSTEM_LABELS[key] || key, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        areas: areas.map((area) => ({
            ...area,
            count: areaCounts.get(area.id) || area.documentCount
        })),
        records
    };

    cache = {
        expiresAt: now + CACHE_TTL_MS,
        rootMtimeMs: rootStats.mtimeMs,
        payload
    };
    return payload;
};

export const getArchitecturalRecordsOverview = async () => scanArchitecturalRecords();

export const getArchitecturalRecordsForArea = async ({
    areaId = '',
    layer = '',
    system = '',
    query = ''
} = {}) => {
    const overview = await scanArchitecturalRecords();
    const targetArea = String(areaId || '').trim();
    const targetLayer = String(layer || '').trim().toLowerCase();
    const targetSystem = String(system || '').trim().toLowerCase();
    const targetQuery = normalizeText(query);

    const records = overview.records.filter((record) => {
        if (targetArea && !record.areaIds.includes(targetArea)) return false;
        if (targetLayer && record.layerKey !== targetLayer) return false;
        if (targetSystem && !record.utilitySystems.some((entry) => entry.key === targetSystem)) return false;
        if (targetQuery) {
            const haystack = normalizeText(`${record.title} ${record.relativePath} ${record.layerLabel} ${record.areaNames.join(' ')}`);
            if (!haystack.includes(targetQuery)) return false;
        }
        return true;
    });

    return {
        ...overview,
        records
    };
};

export const getArchitecturalAreaMetadata = () => AREA_METADATA;

const tokenizeTicketText = (value = '') => unique(
    normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
);

const getRecordSearchText = (record = {}) => normalizeText([
    record.title,
    record.relativePath,
    record.layerLabel,
    ...(record.utilitySystems || []).map((entry) => entry.label || entry.key || entry),
    ...(record.areaNames || [])
].join(' '));

const matchTicketSignals = (ticketText = '') => {
    const signals = [];
    TICKET_SIGNAL_GROUPS.forEach((group) => {
        const matched = group.patterns.filter((pattern) => ticketText.includes(pattern));
        if (!matched.length) return;
        signals.push({
            ...group,
            matched
        });
    });
    return signals;
};

export const recommendArchitecturalRecordsForTicket = async ({
    ticket = {},
    limit = 6
} = {}) => {
    const overview = await scanArchitecturalRecords();
    const areaIds = unique([ticket.areaIds, ticket.areas].flat().filter(Boolean));
    const ticketText = normalizeText(`${ticket.title || ''} ${ticket.description || ''}`);
    const areaTokens = unique(areaIds.flatMap((areaId) => String(areaId || '').split(/[^a-z0-9]+/i)));
    const tokens = tokenizeTicketText(ticketText).filter((token) => !areaTokens.includes(token));
    const signals = matchTicketSignals(ticketText);
    const primarySignalKey = signals
        .slice()
        .sort((a, b) => b.matched.length - a.matched.length)[0]?.key || '';

    const scored = overview.records.map((record) => {
        let score = 0;
        const reasons = [];
        const recordSearchText = getRecordSearchText(record);
        const recordAreaSet = new Set(record.areaIds || []);
        const matchedTokens = tokens.filter((token) => recordSearchText.includes(token));

        const matchedAreas = areaIds.filter((areaId) => recordAreaSet.has(areaId));
        if (matchedAreas.length) {
            score += 40;
            reasons.push(`Matches ${matchedAreas.length === 1 ? 'area' : 'areas'}: ${matchedAreas.join(', ')}`);
        }

        if (matchedTokens.length) {
            score += Math.min(18, matchedTokens.length * 4);
            reasons.push(`Keyword match: ${matchedTokens.slice(0, 3).join(', ')}`);
        }

        let signalScore = 0;
        signals.forEach((signal) => {
            const layerMatch = signal.layers.some((layerKey) => record.layerKey === layerKey);
            const systemMatch = signal.systems.some((systemKey) => (
                (record.utilitySystems || []).some((entry) => (entry.key || entry) === systemKey)
            ));
            const textMatch = signal.patterns.some((pattern) => recordSearchText.includes(pattern));
            const signalWeight = Math.max(8, signal.matched.length * 6);
            if (layerMatch) {
                signalScore += signalWeight + 6;
                if (signal.key === primarySignalKey) signalScore += 10;
                reasons.push(`${signal.labels[0]} layer`);
            } else if (systemMatch) {
                signalScore += signalWeight + 4;
                if (signal.key === primarySignalKey) signalScore += 8;
                reasons.push(`${signal.labels[0]} system`);
            } else if (textMatch) {
                signalScore += signalWeight;
                reasons.push(`${signal.labels[0]} keyword`);
            }
        });
        score += signalScore;

        if (record.layerKey === 'details' && matchedTokens.length) {
            score += 4;
        }
        if (record.layerKey === 'reference' && matchedTokens.length) {
            score += 2;
        }
        if (signals.length > 0 && signalScore === 0) {
            score -= 12;
        }

        return {
            ...record,
            recommendationScore: score,
            recommendationReasons: unique(reasons).slice(0, 4)
        };
    });

    const deduped = [];
    const seen = new Set();
    scored
        .filter((record) => record.recommendationScore > 0)
        .sort((a, b) => (
            b.recommendationScore - a.recommendationScore
            || (b.year || 0) - (a.year || 0)
            || String(a.title || '').localeCompare(String(b.title || ''))
        ))
        .forEach((record) => {
            const signature = [
                normalizeText(record.title),
                record.layerKey,
                record.year || '',
                (record.areaIds || []).join(',')
            ].join('|');
            if (seen.has(signature)) return;
            seen.add(signature);
            deduped.push(record);
        });

    return deduped.slice(0, limit);
};
