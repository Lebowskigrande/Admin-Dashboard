import { basename } from 'path';
import { sqlite } from '../db.js';

const normalizeWindowsPath = (rawPath) => String(rawPath || '').replace(/\//g, '\\').trim();

const toObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const canonicalizeRoutingFiles = (files) => {
    if (!Array.isArray(files)) return [];
    return files
        .map((entry) => {
            if (typeof entry === 'string') {
                const rawPath = normalizeWindowsPath(entry);
                if (!rawPath) return null;
                return {
                    name: basename(rawPath),
                    path: rawPath
                };
            }
            const base = toObject(entry);
            const rawPath = normalizeWindowsPath(base.path || base.filePath || base.file_path || '');
            const name = String(base.name || base.fileName || base.filename || '').trim();
            const canonicalName = rawPath ? basename(rawPath) : name;
            if (!canonicalName && !rawPath) return null;
            return {
                ...base,
                name: canonicalName || name,
                path: rawPath
            };
        })
        .filter(Boolean);
};

const appendRoutingHistory = (routing, { action = '', details = null } = {}) => {
    const currentRouting = toObject(routing);
    const currentHistory = Array.isArray(currentRouting.history) ? currentRouting.history : [];
    const normalized = currentHistory
        .map((row) => toObject(row))
        .filter((row) => Number.isFinite(Number(row.seq)))
        .sort((a, b) => Number(a.seq) - Number(b.seq));
    const lastSeq = normalized.length ? Number(normalized[normalized.length - 1].seq) : 0;
    const nextEntry = {
        seq: lastSeq + 1,
        at: new Date().toISOString(),
        action: String(action || '').trim() || 'update',
        details: toObject(details)
    };
    return [...normalized, nextEntry];
};

const persistRoutingLogUpdateTxn = sqlite.transaction(({
    jobId = '',
    codeValue = undefined,
    output = {}
} = {}) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) throw new Error('Routing log update requires jobId');
    const outputJson = JSON.stringify(output || {});
    if (codeValue === undefined) {
        sqlite.prepare('UPDATE sharefile_jobs SET output_json = ? WHERE id = ?')
            .run(outputJson, normalizedJobId);
        sqlite.prepare('UPDATE sharefile_job_events SET output_json = ? WHERE job_id = ?')
            .run(outputJson, normalizedJobId);
        return;
    }
    const nextCodeValue = String(codeValue || '').trim();
    sqlite.prepare('UPDATE sharefile_jobs SET code_value = ?, output_json = ? WHERE id = ?')
        .run(nextCodeValue, outputJson, normalizedJobId);
    sqlite.prepare('UPDATE sharefile_job_events SET code_value = ?, output_json = ? WHERE job_id = ?')
        .run(nextCodeValue, outputJson, normalizedJobId);
});

export const persistRoutingLogUpdate = ({
    jobId = '',
    codeValue = undefined,
    output = {},
    historyAction = '',
    historyDetails = null
} = {}) => {
    const normalizedOutput = toObject(output);
    const nextOutput = {
        ...normalizedOutput,
        files: canonicalizeRoutingFiles(normalizedOutput.files),
        routing: {
            ...toObject(normalizedOutput.routing),
            history: appendRoutingHistory(normalizedOutput.routing, {
                action: historyAction,
                details: historyDetails
            })
        }
    };
    persistRoutingLogUpdateTxn({
        jobId,
        codeValue,
        output: nextOutput
    });
    return nextOutput;
};
