import { join, extname, basename } from 'path';
import { access, mkdir, readdir, stat } from 'fs/promises';
import { homedir } from 'os';

export const DROPBOX_ROOT = process.env.DROPBOX_ROOT
    || join(homedir(), 'Dropbox', 'Parish Administrator');
export const DROPBOX_BULLETINS_DIR = 'Bulletins';
export const DROPBOX_INSERTS_DIR = 'Bulletin Inserts';
export const DROPBOX_EVENT_DOCS_DIR = 'Events';

export const sanitizeFileName = (value) => String(value || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();

export const ensureEventDocDir = async (eventId, occurrenceId) => {
    const safeEvent = sanitizeFileName(eventId || 'event');
    const safeOccurrence = sanitizeFileName(occurrenceId || 'occurrence');
    const targetDir = join(DROPBOX_ROOT, DROPBOX_EVENT_DOCS_DIR, safeEvent, safeOccurrence);
    await mkdir(targetDir, { recursive: true });
    return targetDir;
};

export const ensureUniquePath = async (targetDir, filename) => {
    const base = sanitizeFileName(filename || 'document');
    const ext = extname(base);
    const root = ext ? base.slice(0, -ext.length) : base;
    const attemptPath = async (suffix) => {
        const candidate = suffix ? `${root}-${suffix}${ext}` : `${root}${ext}`;
        const fullPath = join(targetDir, candidate);
        try {
            await access(fullPath);
            return null;
        } catch {
            return fullPath;
        }
    };
    let attempt = await attemptPath('');
    if (attempt) return attempt;
    for (let index = 2; index < 1000; index += 1) {
        attempt = await attemptPath(index);
        if (attempt) return attempt;
    }
    return join(targetDir, `${root}-${Date.now()}${ext}`);
};

export const findInsertFile = async (dateStr) => {
    const year = (dateStr || '').slice(0, 4);
    const folder = join(DROPBOX_ROOT, DROPBOX_INSERTS_DIR, year);
    try {
        await access(folder);
    } catch {
        return null;
    }

    const exactName = `${dateStr} Insert.pub`;
    const exactPath = join(folder, exactName);
    try {
        await access(exactPath);
        return exactPath;
    } catch {
        // fall through
    }

    const entries = await readdir(folder, { withFileTypes: true });
    const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith('.pub'))
        .filter((name) => name.startsWith(`${dateStr}`))
        .filter((name) => /insert/i.test(name));

    if (!candidates.length) return null;

    const scored = await Promise.all(candidates.map(async (name) => {
        let modified = 0;
        try {
            const stats = await stat(join(folder, name));
            modified = stats.mtimeMs || 0;
        } catch {
            modified = 0;
        }
        return { name, modified };
    }));

    scored.sort((a, b) => b.modified - a.modified);
    return scored[0]?.name ? join(folder, scored[0].name) : null;
};

export const getIsoWeekNumber = (dateStr) => {
    const base = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    const date = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return weekNo;
};

export const findBulletinFile = async (dateStr, timeToken = '10am') => {
    const year = (dateStr || '').slice(0, 4);
    const folder = join(DROPBOX_ROOT, DROPBOX_BULLETINS_DIR, year);
    try {
        await access(folder);
    } catch {
        return null;
    }

    const entries = await readdir(folder, { withFileTypes: true });
    const weekNumber = getIsoWeekNumber(dateStr);
    const weekToken = weekNumber ? `W${String(weekNumber).padStart(2, '0')}` : '';
    const weekRegex = weekToken ? new RegExp(`^${weekToken}(\\b|\\s|-)`, 'i') : null;
    const timeRegex = new RegExp(`\\b${timeToken}\\b`, 'i');
    const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.toLowerCase().endsWith('.docx'))
        .filter((name) => timeRegex.test(name))
        .filter((name) => (weekRegex ? weekRegex.test(name) : false));

    if (!candidates.length) return null;

    const scored = await Promise.all(candidates.map(async (name) => {
        const score = (timeRegex.test(name) ? 5 : 0)
            + (/^w\d{2}/i.test(name) ? 2 : 0)
            + (weekRegex && weekRegex.test(name) ? 3 : 0);
        let modified = 0;
        try {
            const stats = await stat(join(folder, name));
            modified = stats.mtimeMs || 0;
        } catch {
            modified = 0;
        }
        return { name, score, modified };
    }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.modified - a.modified;
    });

    return scored[0]?.name ? join(folder, scored[0].name) : null;
};

export const resolveContractFile = async (contractsDir, vendorName, contractField) => {
    const baseRaw = contractField || vendorName || '';
    const baseName = sanitizeFileName(baseRaw);
    if (!baseName) return { path: '', exists: false };
    const ext = extname(baseName);
    const extensions = ext ? [''] : ['.pdf', '.docx', '.doc', '.rtf'];
    const candidates = ext ? [baseName] : extensions.map((suffix) => `${baseName}${suffix}`);
    for (const candidate of candidates) {
        const fullPath = join(contractsDir, candidate);
        try {
            await access(fullPath);
            return { path: fullPath, exists: true };
        } catch {
            // keep searching
        }
    }
    return { path: join(contractsDir, candidates[0]), exists: false };
};
