import express from 'express';
import multer from 'multer';
import { join, resolve, dirname, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdir, writeFile, readFile, rm, access, rename, readdir, stat, copyFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { sqlite } from '../db.js';

import {
    saveDepositPdf,
    buildDepositFilePath,
    buildManualChecks,
    normalizeFundsReportEntries,
    parseJsonValue,
    getDefaultPrinterName,
    resolveSumatraPdfPath,
    addChecksGridFromPdf,
    parseCurrencyOverride
} from '../helpers/finance-utils.js';
import { isPledgerEnvelope, resolveContributionDesignation } from '../helpers/pledger-utils.js';
import { syncSharefileLocalMirrors } from '../services/sharefileEmailRouter.js';
import { persistRoutingLogUpdate } from '../services/routingLogStore.js';

import { buildDepositSlipPdf, extractChecksFromImages } from '../depositSlip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFileAsync = promisify(execFile);

const router = express.Router();

const depositBundleUpload = multer({
    dest: join(tmpdir(), 'deposit-bundle-uploads')
});

const upload = multer({
    dest: join(tmpdir(), 'uploads')
});
const apAttachUpload = multer({
    dest: join(tmpdir(), 'ap-attach-uploads')
});

const parseLogDate = (raw) => {
    const value = String(raw || '').trim();
    const fallback = new Date();
    const fallbackKey = fallback.toISOString().slice(0, 10);
    const buildLocalRange = (key) => {
        const [year, month, day] = key.split('-').map(Number);
        const start = new Date(year, month - 1, day, 0, 0, 0, 0);
        const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
        return {
            key,
            startIso: start.toISOString(),
            endIso: end.toISOString()
        };
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return buildLocalRange(fallbackKey);
    }

    const [year, month, day] = value.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(start.getTime())) {
        return buildLocalRange(fallbackKey);
    }
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    return { key: value, startIso: start.toISOString(), endIso: end.toISOString() };
};

const resolveRoutingCodeType = (rawType) => {
    const type = String(rawType || '').trim().toLowerCase();
    if (type === 'ar') return 'envelope';
    return 'budget';
};

const safeParseJson = (raw) => {
    try {
        return JSON.parse(String(raw || '{}'));
    } catch {
        return {};
    }
};

const extractLastJsonObject = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return null;
    const objects = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth += 1;
        } else if (ch === '}') {
            if (depth > 0) {
                depth -= 1;
                if (depth === 0 && start !== -1) {
                    objects.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
        }
    }
    for (let idx = objects.length - 1; idx >= 0; idx -= 1) {
        try {
            return JSON.parse(objects[idx]);
        } catch {
            // Keep trying earlier candidates.
        }
    }
    return null;
};

const deriveExpectedCheckPageCount = (rawChecks) => {
    const rows = parseJsonValue(rawChecks, []);
    if (!Array.isArray(rows)) return null;
    const count = rows.filter((row) => {
        const checkNumber = String(row?.checkNumber || '').trim();
        return /^[A-Za-z0-9-]{2,}$/.test(checkNumber);
    }).length;
    return Number.isInteger(count) && count >= 0 ? count : null;
};

const classifyEnvelopePagesFromChecksPdf = async (checksPdfPath) => {
    const tempDir = join(tmpdir(), `deposit-envelope-classify-${randomUUID()}`);
    const envelopePageIndexes = new Set();
    try {
        await mkdir(tempDir, { recursive: true });
        const outputPrefix = join(tempDir, 'check');
        await execFileAsync('pdftoppm', ['-png', '-r', '200', checksPdfPath, outputPrefix], { windowsHide: true });
        const files = (await readdir(tempDir))
            .filter((name) => /^check-\d+\.png$/i.test(name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!files.length) return envelopePageIndexes;

        const pythonScriptPath = join(process.cwd(), 'server', 'ocr', 'handwriting_ocr.py');
        let pythonCommand = 'python';
        try {
            await execFileAsync('python', ['--version'], { windowsHide: true });
        } catch {
            pythonCommand = 'py';
        }
        const micrOnlyRegions = {
            micr: { xMin: 0.0, xMax: 1.0, yMin: 0.82, yMax: 1.0 }
        };

        const pageSignals = [];
        for (let pageIndex = 0; pageIndex < files.length; pageIndex += 1) {
            const imagePath = join(tempDir, files[pageIndex]);
            let isLikelyCheck = false;
            try {
                const { stdout } = await execFileAsync(pythonCommand, [pythonScriptPath, imagePath], {
                    windowsHide: true,
                    env: {
                        ...process.env,
                        OCR_REGIONS: JSON.stringify(micrOnlyRegions),
                        OCR_ENGINES: JSON.stringify(['tesseract']),
                        OCR_REGION_ORIGIN: 'top-left',
                        OCR_REGION_ANCHOR: 'none',
                        OCR_PREVIEW_ONLY: '0',
                        OCR_DEBUG_IMAGES: '0',
                        OCR_ALIGN: '0',
                        OCR_ROTATE_CW_DEG: '0',
                        MICR_TESS_LANG: 'eng'
                    }
                });
                const payload = extractLastJsonObject(stdout);
                const micrText = String(payload?.regions?.micr?.text || '').trim();
                const micrDigits = micrText.replace(/\D/g, '');
                isLikelyCheck = micrDigits.length >= 9;
            } catch {
                // Leave page unclassified/unchanged if OCR classification fails.
            }
            pageSignals.push({ pageIndex, isLikelyCheck });
        }

        // Expected bundle order is checks first, then envelopes.
        // Rotate only the trailing non-check segment to avoid rotating check pages.
        let lastCheckIndex = -1;
        pageSignals.forEach((signal) => {
            if (signal.isLikelyCheck) lastCheckIndex = Math.max(lastCheckIndex, signal.pageIndex);
        });
        if (lastCheckIndex < 0) {
            return envelopePageIndexes;
        }
        pageSignals.forEach((signal) => {
            if (signal.pageIndex > lastCheckIndex && !signal.isLikelyCheck) {
                envelopePageIndexes.add(signal.pageIndex);
            }
        });
        if (envelopePageIndexes.size === 0) {
            // Fallback for trailing envelope pages when MICR is weak/non-detected:
            // if we have any pages after the last detected check, rotate all of them.
            pageSignals.forEach((signal) => {
                if (signal.pageIndex > lastCheckIndex) {
                    envelopePageIndexes.add(signal.pageIndex);
                }
            });
        }
        return envelopePageIndexes;
    } catch {
        return envelopePageIndexes;
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
};

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeContributionToken = (value, fallback) => {
    const cleaned = compactWhitespace(value)
        .replace(/[<>:"/\\|?*]/g, '')
        .split('')
        .filter((ch) => ch.charCodeAt(0) >= 32)
        .join('')
        .trim();
    return cleaned || fallback;
};

const buildContributionNoteText = ({ envelopeNumber = '', designation = '' } = {}) => {
    const normalizedDesignation = sanitizeContributionToken(designation, 'Unknown designation');
    const envelopeRaw = compactWhitespace(envelopeNumber);
    if (!envelopeRaw) {
        return `Designation: ${normalizedDesignation}`;
    }
    const normalizedEnvelope = sanitizeContributionToken(envelopeRaw, 'Unknown envelope');
    return `Envelope: ${normalizedEnvelope} | Designation: ${normalizedDesignation}`;
};

const parseDesignationFromNoteText = (noteText) => {
    const note = String(noteText || '');
    if (!note) return '';
    const explicit = note.match(/\bDesignation:\s*(.+)$/i);
    if (!explicit?.[1]) return '';
    return compactWhitespace(explicit[1]);
};

const extractDesignationFromOutput = (output) => {
    const routedDesignation = compactWhitespace(output?.routing?.designation || '');
    if (routedDesignation) return routedDesignation;
    const legacyDesignation = compactWhitespace(output?.designation || '');
    if (legacyDesignation) return legacyDesignation;
    return parseDesignationFromNoteText(output?.routing?.noteText || output?.noteText || '');
};

const extractVendorFromOutput = (output) => compactWhitespace(output?.routing?.vendor || output?.vendor || '');
const extractPersonFromOutput = (output) => {
    const personId = compactWhitespace(output?.routing?.personId || output?.personId || '');
    const personName = compactWhitespace(output?.routing?.personName || output?.personName || '');
    const rawConfidence = Number(output?.routing?.personMatchConfidence ?? output?.personMatchConfidence ?? 0);
    const personMatchConfidence = Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, rawConfidence))
        : 0;
    return { personId, personName, personMatchConfidence };
};

const extractDesignationFromPdf = async (pdfPath) => {
    const normalizedPath = normalizeWindowsPath(pdfPath);
    if (!normalizedPath) return '';
    try {
        const bytes = await readFile(normalizedPath);
        const doc = await PDFDocument.load(bytes);
        const page = doc.getPages()?.[0];
        if (page) {
            const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
            if (annots) {
                for (let i = 0; i < annots.size(); i += 1) {
                    const annotRef = annots.get(i);
                    const annot = doc.context.lookup(annotRef);
                    const contents = annot?.get?.(PDFName.of('Contents'));
                    let text = '';
                    if (contents instanceof PDFString) {
                        text = contents.decodeText();
                    } else if (contents != null) {
                        text = String(contents || '');
                    }
                    const parsed = parseDesignationFromNoteText(text);
                    if (parsed) return parsed;
                }
            }
        }

        const fallbackText = bytes.toString('latin1');
        const fallbackMatch = fallbackText.match(/Designation:\s*([^\r\n|<>{}]{1,180})/i);
        return compactWhitespace(fallbackMatch?.[1] || '');
    } catch {
        return '';
    }
};

const resolveDesignationForOutput = async (output) => {
    const fromOutput = extractDesignationFromOutput(output);
    if (fromOutput) return fromOutput;
    const files = normalizeJobFiles(output).filter((file) => String(file.path || '').trim());
    if (!files.length) return '';
    for (const file of files) {
        const designation = await extractDesignationFromPdf(file.path);
        if (designation) return designation;
    }
    return '';
};

const resolveContributionEnvelopeNumber = ({ output, codeValue = '' } = {}) => {
    return compactWhitespace(output?.routing?.envelopeNumber || codeValue || '');
};

const applyContributionDesignationPolicyToOutput = ({ output, codeType = '', codeValue = '' } = {}) => {
    const routeKind = String(output?.routing?.routeKind || '').toUpperCase();
    const isContribution = routeKind === 'CONTRIBUTION' || String(codeType || '').trim() === 'envelope';
    if (!isContribution) return { changed: false, output, designation: '' };
    const envelopeNumber = resolveContributionEnvelopeNumber({ output, codeValue });
    const currentDesignation = extractDesignationFromOutput(output);
    const resolved = resolveContributionDesignation({
        designation: currentDesignation,
        envelopeNumber
    });
    const nextDesignation = compactWhitespace(resolved.designation || currentDesignation || '');
    if (!nextDesignation || nextDesignation === currentDesignation) {
        return {
            changed: false,
            output,
            designation: nextDesignation || currentDesignation || ''
        };
    }
    const noteText = buildContributionNoteText({
        envelopeNumber,
        designation: nextDesignation
    });
    return {
        changed: true,
        designation: nextDesignation,
        output: {
            ...output,
            routing: {
                ...(output?.routing || {}),
                routeKind: 'CONTRIBUTION',
                envelopeNumber,
                designation: nextDesignation,
                noteText,
                designationUpdatedAt: new Date().toISOString()
            }
        }
    };
};

const buildRoutingGroupKey = (row = {}) => {
    const jobId = String(row.job_id || '').trim();
    const messageId = String(row.message_id || '').trim();
    const codeType = String(row.code_type || '').trim();
    const codeValue = String(row.code_value || '').trim();
    const id = String(row.id || '').trim();
    return jobId || `${codeType}|${codeValue}|${messageId || id}`;
};

const buildRoutingLogEntryFromGroup = async ({
    group,
    latest,
    dirCache,
    includeSource = false,
    includeTiming = false
} = {}) => {
    const jobId = String(group?.jobId || '').trim();
    const latestRow = latest || {};
    const jobRow = jobId
        ? sqlite.prepare(`
            SELECT id, code_type, code_value, output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(jobId)
        : null;

    const effectiveCodeType = String(jobRow?.code_type || latestRow.code_type || '').trim();
    const effectiveCodeValue = String(jobRow?.code_value || latestRow.code_value || '').trim();
    let output = safeParseJson(jobRow?.output_json || latestRow.output_json);
    const contributionPolicy = applyContributionDesignationPolicyToOutput({
        output,
        codeType: effectiveCodeType,
        codeValue: effectiveCodeValue
    });
    if (contributionPolicy.changed && jobId) {
        output = contributionPolicy.output;
        await persistContributionOutputBackfill({
            jobId,
            output
        });
    } else if (contributionPolicy.changed) {
        output = contributionPolicy.output;
    }

    const files = await normalizeJobFilesWithCurrentPaths(
        output,
        String(jobRow?.created_at || latestRow.created_at || ''),
        dirCache
    );
    const fileRows = await Promise.all(files.map(async (file) => {
        const normalizedPath = normalizeWindowsPath(file.path || '');
        const exists = normalizedPath ? await pathExists(normalizedPath) : false;
        return {
            ...file,
            path: normalizedPath,
            exists
        };
    }));
    const existingFiles = fileRows.filter((file) => file.exists);
    const missingFiles = Math.max(0, fileRows.length - existingFiles.length);

    const vendor = extractVendorFromOutput(output);
    const person = extractPersonFromOutput(output);
    const isAp = effectiveCodeType === 'budget';
    const envelopeNumber = resolveContributionEnvelopeNumber({ output, codeValue: effectiveCodeValue });
    const latestStatus = String(latestRow.status || 'success').trim().toLowerCase() === 'failure' ? 'failure' : 'success';
    const status = latestStatus === 'success' && missingFiles > 0 && existingFiles.length === 0
        ? 'failure'
        : latestStatus;
    const errorText = status === 'failure' && latestStatus === 'success' && existingFiles.length === 0
        ? 'Routed file is missing from disk.'
        : String(latestRow.error_text || '').trim();

    const entry = {
        id: latestRow.id,
        jobId: jobId || null,
        codeType: effectiveCodeType,
        codeValue: effectiveCodeValue,
        envelopeNumber,
        isPledger: effectiveCodeType === 'envelope' ? isPledgerEnvelope(envelopeNumber) : false,
        designation: await resolveDesignationForOutput(output),
        personId: person.personId,
        personName: person.personName,
        personMatchConfidence: person.personMatchConfidence,
        vendor,
        vendorMissing: isAp && !vendor,
        status,
        errorText,
        createdAt: String(latestRow.created_at || jobRow?.created_at || ''),
        targetDir: String(output?.targetDir || ''),
        files: existingFiles,
        missingFiles,
        attempts: group?.attempts || 0,
        successCount: group?.successCount || 0,
        failureCount: group?.failureCount || 0,
        lastSuccessAt: group?.lastSuccessAt || null,
        lastFailureAt: group?.lastFailureAt || null
    };

    if (includeTiming) {
        entry.startedAt = group?.startedAt || null;
        entry.completedAt = group?.completedAt || null;
    }
    if (includeSource) {
        entry.source = String(latestRow.source || '').trim() || null;
    }

    return entry;
};

const persistContributionOutputBackfill = async ({ jobId = '', output = null } = {}) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId || !output) return;
    const files = normalizeJobFiles(output).filter((file) => String(file.path || '').trim());
    const noteText = String(output?.routing?.noteText || '').trim();
    if (noteText && files.length > 0) {
        for (const file of files) {
            try {
                await replaceRoutingNoteInPdf(normalizeWindowsPath(file.path), noteText);
            } catch (error) {
                console.warn(`Failed to restamp routed PDF during designation backfill: ${file.path}`, error?.message || error);
            }
        }
    }
    persistRoutingLogUpdate({
        jobId: normalizedJobId,
        output,
        historyAction: 'designation-backfill',
        historyDetails: { source: 'contribution-policy' }
    });
};

const sanitizeVendorToken = (value) => sanitizeContributionToken(value, '').replace(/\s+/g, ' ').trim();
const sanitizeFilenameToken = (value) => {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned;
};

let contributionDesignationBackfillPromise = null;
const runContributionDesignationBackfillIfNeeded = async () => {
    if (contributionDesignationBackfillPromise) return contributionDesignationBackfillPromise;
    contributionDesignationBackfillPromise = (async () => {
        try {
            const rows = sqlite.prepare(`
                SELECT id, code_type, code_value, output_json
                FROM sharefile_jobs
                WHERE code_type = 'envelope'
            `).all();
            for (const row of rows) {
                const output = safeParseJson(row.output_json || '{}');
                const contributionPolicy = applyContributionDesignationPolicyToOutput({
                    output,
                    codeType: row.code_type,
                    codeValue: row.code_value
                });
                if (!contributionPolicy.changed) continue;
                await persistContributionOutputBackfill({
                    jobId: row.id,
                    output: contributionPolicy.output
                });
            }
        } catch (error) {
            console.warn('Failed to run contribution designation backfill:', error?.message || error);
        }
    })();
    return contributionDesignationBackfillPromise;
};

const ensureUniqueFilePath = async (targetPath) => {
    const dir = dirname(targetPath);
    const name = basename(targetPath);
    const idx = name.lastIndexOf('.');
    const stem = idx >= 0 ? name.slice(0, idx) : name;
    const ext = idx >= 0 ? name.slice(idx) : '';
    let candidate = targetPath;
    let counter = 2;
    while (true) {
        try {
            await access(candidate);
            candidate = join(dir, `${stem}-${counter}${ext}`);
            counter += 1;
        } catch {
            return candidate;
        }
    }
};

const buildRenamedApFilename = (currentName, { routeKind = 'BILL', vendor = '' } = {}) => {
    const raw = String(currentName || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4}\.\d{2})\s+SEEC\s+([A-Z]+)\s+(.+?)(?:-(\d+))?\.pdf$/i);
    const monthPart = match?.[1] || '';
    const kindPart = String(match?.[2] || routeKind || 'BILL').toUpperCase();
    const suffixPart = match?.[4] ? `-${match[4]}` : '';
    if (!monthPart) return '';
    const vendorToken = sanitizeVendorToken(vendor);
    if (!vendorToken) return '';
    return `${monthPart} SEEC ${kindPart} ${vendorToken}${suffixPart}.pdf`;
};

const pathExists = async (targetPath) => {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const getPdfDirEntries = async (dirPath, dirCache) => {
    if (!dirPath) return [];
    if (dirCache.has(dirPath)) return dirCache.get(dirPath);
    try {
        const names = await readdir(dirPath);
        const pdfNames = names.filter((name) => name.toLowerCase().endsWith('.pdf'));
        const rows = await Promise.all(pdfNames.map(async (name) => {
            const fullPath = join(dirPath, name);
            try {
                const info = await stat(fullPath);
                return {
                    name,
                    path: fullPath,
                    mtimeMs: Number(info?.mtimeMs || 0) || 0
                };
            } catch {
                return null;
            }
        }));
        const filtered = rows.filter(Boolean);
        dirCache.set(dirPath, filtered);
        return filtered;
    } catch {
        dirCache.set(dirPath, []);
        return [];
    }
};

const resolveRenamedFilePath = async ({ targetDir, originalName, createdAt, dirCache }) => {
    if (!targetDir || !originalName) return '';
    const candidates = await getPdfDirEntries(targetDir, dirCache);
    if (!candidates.length) return '';

    const pattern = String(originalName || '').match(/^(\d{4}\.\d{2}\s+SEEC\s+[A-Z]+)\s+(.+?)(-\d+)?\.pdf$/i);
    if (pattern?.[1]) {
        const prefix = String(pattern[1]).toLowerCase();
        const suffix = String(pattern[3] || '').toLowerCase();
        const byPrefix = candidates.filter((item) => String(item.name || '').toLowerCase().startsWith(`${prefix} `));
        const bySuffix = suffix
            ? byPrefix.filter((item) => String(item.name || '').toLowerCase().endsWith(`${suffix}.pdf`))
            : byPrefix;
        if (bySuffix.length === 1) return bySuffix[0].path;
        if (bySuffix.length > 1 && createdAt) {
            const targetTs = new Date(createdAt).getTime();
            bySuffix.sort((a, b) => Math.abs(a.mtimeMs - targetTs) - Math.abs(b.mtimeMs - targetTs));
            return bySuffix[0]?.path || '';
        }
    }

    if (candidates.length === 1) return candidates[0].path;
    if (createdAt) {
        const targetTs = new Date(createdAt).getTime();
        candidates.sort((a, b) => Math.abs(a.mtimeMs - targetTs) - Math.abs(b.mtimeMs - targetTs));
        return candidates[0]?.path || '';
    }
    return '';
};

const normalizeWindowsPath = (rawPath) => String(rawPath || '').replace(/\//g, '\\').trim();

const revealInExplorer = async (targetPath) => {
    const normalized = normalizeWindowsPath(targetPath);
    if (!normalized) {
        throw new Error('Missing file path');
    }
    const parentDir = dirname(normalized);
    let lastError = null;
    try {
        await openExplorerSelect(normalized);
        return { ok: true, warning: '' };
    } catch (error) {
        lastError = error;
    }
    try {
        await openExplorerFolder(parentDir);
        return { ok: true, warning: 'File selection unavailable; opened parent folder instead.' };
    } catch (error) {
        lastError = error;
    }
    throw lastError || new Error('Unable to launch Explorer');
};

const escapePowerShellSingleQuoted = (value) => String(value || '').replace(/'/g, "''");

const openExplorerSelect = async (targetPath) => {
    const normalized = normalizeWindowsPath(targetPath);
    // Prefer direct explorer invocation to avoid PowerShell quoting/escaping edge cases.
    try {
        await execFileAsync('explorer.exe', [`/select,${normalized}`], { windowsHide: true });
        return;
    } catch {
        const safePath = escapePowerShellSingleQuoted(normalized);
        const script = `$p = '${safePath}'; $arg = '/select,"' + $p + '"'; Start-Process -FilePath explorer.exe -ArgumentList $arg`;
        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    }
};

const openExplorerFolder = async (folderPath) => {
    const normalized = normalizeWindowsPath(folderPath);
    try {
        await execFileAsync('explorer.exe', [normalized], { windowsHide: true });
        return;
    } catch {
        const safePath = escapePowerShellSingleQuoted(normalized);
        const script = `$p = '${safePath}'; $arg = '"' + $p + '"'; Start-Process -FilePath explorer.exe -ArgumentList $arg`;
        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    }
};

const pickPdfFilePath = async ({ initialDirectory = '', title = 'Select PDF file' } = {}) => {
    const safeDir = escapePowerShellSingleQuoted(initialDirectory);
    const safeTitle = escapePowerShellSingleQuoted(title);
    const script = `
Add-Type -AssemblyName System.Windows.Forms;
$dialog = New-Object System.Windows.Forms.OpenFileDialog;
$dialog.Filter = 'PDF files (*.pdf)|*.pdf|All files (*.*)|*.*';
$dialog.Multiselect = $false;
$dialog.CheckFileExists = $true;
$dialog.Title = '${safeTitle}';
if ('${safeDir}' -and (Test-Path '${safeDir}')) { $dialog.InitialDirectory = '${safeDir}' };
$result = $dialog.ShowDialog();
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName };
`;
    try {
        const result = await execFileAsync('powershell', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
        const selectedPath = compactWhitespace(result?.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || '';
        return normalizeWindowsPath(selectedPath);
    } catch (error) {
        const stderr = String(error?.stderr || '').trim();
        const stdout = String(error?.stdout || '').trim();
        const message = String(error?.message || '').trim();
        const detail = compactWhitespace(stderr || stdout || message || 'Unknown picker error');
        throw new Error(detail);
    }
};

const moveFileWithFallback = async (fromPath, toPath) => {
    try {
        await rename(fromPath, toPath);
    } catch (error) {
        if (String(error?.code || '').toUpperCase() !== 'EXDEV') {
            throw error;
        }
        await copyFile(fromPath, toPath);
        await rm(fromPath, { force: true });
    }
};

const normalizeJobFiles = (output) => {
    const targetDir = String(output?.targetDir || '').trim();
    const rawFiles = Array.isArray(output?.files) ? output.files : [];
    const files = [];

    rawFiles.forEach((file, index) => {
        if (typeof file === 'string') {
            const path = String(file).trim();
            if (!path) return;
            files.push({
                fileIndex: index,
                name: basename(path),
                path
            });
            return;
        }

        if (!file || typeof file !== 'object') return;

        const name = String(file.name || file.fileName || file.filename || '').trim();
        const explicitPath = String(file.path || file.filePath || file.file_path || '').trim();
        let resolvedPath = explicitPath;

        if (!resolvedPath && name && targetDir) {
            resolvedPath = join(targetDir, name);
        } else if (resolvedPath && !isAbsolute(resolvedPath) && targetDir) {
            resolvedPath = join(targetDir, resolvedPath);
        }

        const displayName = name || (resolvedPath ? basename(resolvedPath) : '');
        if (!displayName) return;

        files.push({
            fileIndex: index,
            name: displayName,
            path: resolvedPath || ''
        });
    });

    return files;
};

const normalizeJobFilesWithCurrentPaths = async (output, createdAt = '', dirCache = new Map()) => {
    const files = normalizeJobFiles(output);
    const targetDir = String(output?.targetDir || '').trim();
    const resolved = [];
    for (const file of files) {
        const currentPath = normalizeWindowsPath(file.path || '');
        if (currentPath && await pathExists(currentPath)) {
            resolved.push({
                ...file,
                name: basename(currentPath),
                path: currentPath
            });
            continue;
        }

        const renamedPath = await resolveRenamedFilePath({
            targetDir,
            originalName: file.name,
            createdAt,
            dirCache
        });
        if (renamedPath) {
            resolved.push({
                ...file,
                name: basename(renamedPath),
                path: normalizeWindowsPath(renamedPath)
            });
            continue;
        }

        resolved.push(file);
    }
    return resolved;
};

const replaceRoutingNoteInPdf = async (pdfPath, noteText) => {
    const existingPdfBytes = await readFile(pdfPath);
    const doc = await PDFDocument.load(existingPdfBytes);
    const pages = doc.getPages();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const margin = 36;
    const noteBandHeight = 18;

    pages.forEach((page) => {
        const { width } = page.getSize();
        page.drawRectangle({
            x: margin - 2,
            y: margin - 2,
            width: Math.max(1, width - (margin * 2) + 4),
            height: noteBandHeight,
            color: rgb(1, 1, 1)
        });
        page.drawText(noteText, {
            x: margin,
            y: margin,
            size: 9,
            font,
            color: rgb(0.2, 0.2, 0.2),
            maxWidth: width - margin * 2
        });
    });

    const firstPage = pages[0] || doc.addPage();
    const annots = firstPage.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
        const filtered = [];
        for (let idx = 0; idx < annots.size(); idx += 1) {
            const annotRef = annots.get(idx);
            const annotDict = doc.context.lookup(annotRef);
            const subtype = annotDict?.get?.(PDFName.of('Subtype'));
            const subtypeValue = String(subtype || '');
            if (subtypeValue === '/Text') continue;
            filtered.push(annotRef);
        }
        firstPage.node.set(PDFName.of('Annots'), doc.context.obj(filtered));
    }

    const annotation = doc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: [margin, margin, margin + 1, margin + 1],
        Contents: PDFString.of(noteText),
        Name: PDFName.of('Comment'),
        Open: false
    });
    const nextAnnots = firstPage.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (nextAnnots) {
        nextAnnots.push(annotation);
    } else {
        firstPage.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
    }

    const updatedBytes = await doc.save();
    await writeFile(pdfPath, updatedBytes);
};

router.get('/routing-log', async (req, res) => {
    try {
        await runContributionDesignationBackfillIfNeeded();
        const codeType = resolveRoutingCodeType(req.query?.type);
        await syncSharefileLocalMirrors({ codeType }).catch(() => ({}));
        const date = parseLogDate(req.query?.date);
        const dirCache = new Map();
        const attemptRows = sqlite.prepare(`
            SELECT id, job_id, message_id, thread_id, code_type, code_value, status, error_text,
                   output_json, written_files_json, source, created_at, started_at, completed_at
            FROM routing_attempts
            WHERE code_type = ?
              AND created_at >= ?
              AND created_at < ?
            ORDER BY created_at DESC
        `).all(codeType, date.startIso, date.endIso);

        if (attemptRows.length > 0) {
            const groupedAttempts = new Map();
            attemptRows.forEach((row) => {
                const jobId = String(row.job_id || '').trim();
                const key = buildRoutingGroupKey(row);
                if (!key) return;
                if (!groupedAttempts.has(key)) {
                    groupedAttempts.set(key, {
                        key,
                        jobId,
                        latest: row,
                        attempts: 0,
                        successCount: 0,
                        failureCount: 0,
                        startedAt: String(row.started_at || row.created_at || ''),
                        completedAt: String(row.completed_at || ''),
                        lastSuccessAt: '',
                        lastFailureAt: ''
                    });
                }
                const group = groupedAttempts.get(key);
                group.attempts += 1;
                const status = String(row.status || '').trim().toLowerCase();
                if (status === 'success') {
                    group.successCount += 1;
                    if (!group.lastSuccessAt || String(row.created_at || '') > group.lastSuccessAt) {
                        group.lastSuccessAt = String(row.created_at || '');
                    }
                } else if (status === 'failure') {
                    group.failureCount += 1;
                    if (!group.lastFailureAt || String(row.created_at || '') > group.lastFailureAt) {
                        group.lastFailureAt = String(row.created_at || '');
                    }
                }
                if (String(row.created_at || '') > String(group.latest?.created_at || '')) {
                    group.latest = row;
                }
            });

            const entries = await Promise.all(Array.from(groupedAttempts.values()).map(async (group) => {
                return buildRoutingLogEntryFromGroup({
                    group,
                    latest: group.latest || {},
                    dirCache,
                    includeSource: true,
                    includeTiming: true
                });
            }));

            const sortedEntries = entries
                .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

            return res.json({
                ok: true,
                date: date.key,
                type: String(req.query?.type || 'ap').toLowerCase() === 'ar' ? 'ar' : 'ap',
                entries: sortedEntries
            });
        }

        const eventRows = sqlite.prepare(`
            SELECT e.id, e.job_id, e.code_type, e.code_value, e.status, e.error_text,
                   COALESCE(j.output_json, e.output_json) AS output_json, e.created_at
                   ,e.message_id, e.thread_id
            FROM sharefile_job_events e
            LEFT JOIN sharefile_jobs j ON j.id = e.job_id
            WHERE e.code_type = ?
              AND e.created_at >= ?
              AND e.created_at < ?
            ORDER BY e.created_at DESC
        `).all(codeType, date.startIso, date.endIso);
        const grouped = new Map();
        eventRows.forEach((row) => {
            const jobId = String(row.job_id || '').trim();
            const key = buildRoutingGroupKey(row);
            if (!key) return;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    jobId: jobId || '',
                    latestEvent: row,
                    attempts: 0,
                    successCount: 0,
                    failureCount: 0,
                    lastSuccessAt: '',
                    lastFailureAt: ''
                });
            }
            const group = grouped.get(key);
            group.attempts += 1;
            const status = String(row.status || '').trim().toLowerCase();
            if (status === 'success') {
                group.successCount += 1;
                if (!group.lastSuccessAt || String(row.created_at || '') > group.lastSuccessAt) {
                    group.lastSuccessAt = String(row.created_at || '');
                }
            } else {
                group.failureCount += 1;
                if (!group.lastFailureAt || String(row.created_at || '') > group.lastFailureAt) {
                    group.lastFailureAt = String(row.created_at || '');
                }
            }
            if (String(row.created_at || '') > String(group.latestEvent?.created_at || '')) {
                group.latestEvent = row;
            }
        });

        const legacyRows = sqlite.prepare(`
            SELECT id, code_type, code_value, output_json, created_at
            FROM sharefile_jobs
            WHERE code_type = ?
              AND created_at >= ?
              AND created_at < ?
            ORDER BY created_at DESC
        `).all(codeType, date.startIso, date.endIso);
        legacyRows.forEach((row) => {
            const jobId = String(row.id || '').trim();
            if (!jobId || grouped.has(jobId)) return;
            grouped.set(jobId, {
                key: jobId,
                jobId,
                latestEvent: {
                    id: row.id,
                    job_id: row.id,
                    code_type: row.code_type,
                    code_value: row.code_value,
                    status: 'success',
                    error_text: '',
                    output_json: row.output_json,
                    created_at: row.created_at,
                    message_id: '',
                    thread_id: ''
                },
                attempts: 1,
                successCount: 1,
                failureCount: 0,
                lastSuccessAt: String(row.created_at || ''),
                lastFailureAt: ''
            });
        });

        const entries = await Promise.all(Array.from(grouped.values()).map(async (group) => {
            return buildRoutingLogEntryFromGroup({
                group,
                latest: group.latestEvent || {},
                dirCache
            });
        }));

        const sortedEntries = entries
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        res.json({
            ok: true,
            date: date.key,
            type: String(req.query?.type || 'ap').toLowerCase() === 'ar' ? 'ar' : 'ap',
            entries: sortedEntries
        });
    } catch (error) {
        console.error('Routing log read error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load routing log' });
    }
});

router.post('/routing-log/designation', async (req, res) => {
    try {
        const rawJobId = String(req.body?.jobId || '').trim();
        const designationInput = String(req.body?.designation || '').trim();
        if (!rawJobId) {
            return res.status(400).json({ ok: false, error: 'jobId is required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT id, job_id, code_type, code_value
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, code_value, output_json
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);

        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }

        const normalizedDesignation = sanitizeContributionToken(designationInput, '');
        if (!normalizedDesignation) {
            return res.status(400).json({ ok: false, error: 'Designation is required' });
        }

        const output = safeParseJson(jobRow.output_json || '{}');
        const codeType = String(jobRow.code_type || '').trim();
        const routeKind = String(output?.routing?.routeKind || '').toUpperCase();
        const isContribution = routeKind === 'CONTRIBUTION' || codeType === 'envelope';

        const envelopeNumber = compactWhitespace(output?.routing?.envelopeNumber || jobRow.code_value || '');
        const effectiveDesignation = isContribution
            ? resolveContributionDesignation({
                designation: normalizedDesignation,
                envelopeNumber
            }).designation
            : normalizedDesignation;
        const noteText = isContribution
            ? buildContributionNoteText({
                envelopeNumber,
                designation: effectiveDesignation
            })
            : `Budget code: ${compactWhitespace(jobRow.code_value || 'unknown') || 'unknown'} | Designation: ${effectiveDesignation}`;

        const files = normalizeJobFiles(output).filter((file) => file.path);
        if (files.length === 0) {
            return res.status(404).json({ ok: false, error: 'No saved PDFs found for this routing job' });
        }

        let updatedCount = 0;
        for (const file of files) {
            try {
                await replaceRoutingNoteInPdf(normalizeWindowsPath(file.path), noteText);
                updatedCount += 1;
            } catch (error) {
                console.warn(`Failed to restamp routed PDF: ${file.path}`, error?.message || error);
            }
        }
        if (updatedCount === 0) {
            return res.status(500).json({ ok: false, error: 'Unable to update any saved PDF for this routing job' });
        }

        const nextOutput = {
            ...output,
            routing: {
                ...(output?.routing || {}),
                routeKind: isContribution ? 'CONTRIBUTION' : (routeKind || 'BILL'),
                envelopeNumber,
                designation: effectiveDesignation,
                noteText,
                designationUpdatedAt: new Date().toISOString()
            }
        };

        persistRoutingLogUpdate({
            jobId: jobRow.id,
            output: nextOutput,
            historyAction: 'designation-update',
            historyDetails: {
                designation: effectiveDesignation,
                updatedFiles: updatedCount
            }
        });

        return res.json({
            ok: true,
            jobId: jobRow.id,
            designation: effectiveDesignation,
            noteText,
            updatedFiles: updatedCount
        });
    } catch (error) {
        console.error('Routing designation update error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update designation' });
    }
});

router.post('/routing-log/vendor', async (req, res) => {
    try {
        const rawJobId = String(req.body?.jobId || '').trim();
        const vendorInput = String(req.body?.vendor || '').trim();
        if (!rawJobId) {
            return res.status(400).json({ ok: false, error: 'jobId is required' });
        }
        const normalizedVendor = sanitizeVendorToken(vendorInput);
        if (!normalizedVendor) {
            return res.status(400).json({ ok: false, error: 'Vendor is required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT id, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, output_json
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);
        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }
        if (String(jobRow.code_type || '').trim() !== 'budget') {
            return res.status(400).json({ ok: false, error: 'Vendor rename is only supported for AP routing jobs' });
        }

        const output = safeParseJson(jobRow.output_json || '{}');
        const routeKind = String(output?.routing?.routeKind || '').toUpperCase() || 'BILL';
        const rawFiles = Array.isArray(output?.files) ? output.files : [];
        const normalizedFiles = normalizeJobFiles(output);
        if (!normalizedFiles.length) {
            return res.status(404).json({ ok: false, error: 'No saved files found for this routing job' });
        }

        let renamedCount = 0;
        const fileMutations = [];
        const updatedRawFiles = rawFiles.map((rawFile, index) => {
            const resolved = normalizedFiles.find((item) => item.fileIndex === index);
            if (!resolved?.path) return rawFile;
            const currentPath = normalizeWindowsPath(resolved.path);
            const currentName = basename(currentPath);
            const renamed = buildRenamedApFilename(currentName, {
                routeKind,
                vendor: normalizedVendor
            });
            if (!renamed || renamed === currentName) {
                if (rawFile && typeof rawFile === 'object') {
                    return {
                        ...rawFile,
                        name: rawFile.name || currentName,
                        path: rawFile.path || currentPath
                    };
                }
                return rawFile;
            }
            const targetPath = join(dirname(currentPath), renamed);
            return {
                __rename: true,
                index,
                from: currentPath,
                to: targetPath,
                rawFile,
                currentName,
                nextName: renamed
            };
        });

        const finalizedFiles = [];
        for (let i = 0; i < updatedRawFiles.length; i += 1) {
            const entry = updatedRawFiles[i];
            if (!entry || typeof entry !== 'object' || entry.__rename !== true) {
                finalizedFiles.push(entry);
                continue;
            }
            const uniqueTarget = await ensureUniqueFilePath(entry.to);
            await rename(entry.from, uniqueTarget);
            renamedCount += 1;
            fileMutations.push({
                fileIndex: Number(entry.index),
                action: 'rename',
                from: normalizeWindowsPath(entry.from),
                to: normalizeWindowsPath(uniqueTarget)
            });
            const finalName = basename(uniqueTarget);
            const baseRaw = entry.rawFile && typeof entry.rawFile === 'object' ? entry.rawFile : {};
            finalizedFiles.push({
                ...baseRaw,
                name: finalName,
                path: uniqueTarget
            });
        }

        const nextOutput = {
            ...output,
            files: finalizedFiles,
            routing: {
                ...(output?.routing || {}),
                routeKind,
                vendor: normalizedVendor,
                vendorFound: true,
                vendorUpdatedAt: new Date().toISOString()
            }
        };

        persistRoutingLogUpdate({
            jobId: jobRow.id,
            output: nextOutput,
            historyAction: 'vendor-update',
            historyDetails: {
                vendor: normalizedVendor,
                renamedFiles: renamedCount,
                fileMutations: fileMutations.sort((a, b) => Number(a.fileIndex) - Number(b.fileIndex))
            }
        });

        return res.json({
            ok: true,
            jobId: jobRow.id,
            vendor: normalizedVendor,
            renamedFiles: renamedCount
        });
    } catch (error) {
        console.error('Routing vendor update error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update vendor' });
    }
});

router.post('/routing-log/ap-entry', async (req, res) => {
    try {
        const rawJobId = String(req.body?.jobId || '').trim();
        const codeValueInput = compactWhitespace(req.body?.codeValue || '');
        const vendorInput = compactWhitespace(req.body?.vendor || '');
        const incomingFiles = Array.isArray(req.body?.files) ? req.body.files : [];
        if (!rawJobId) {
            return res.status(400).json({ ok: false, error: 'jobId is required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT id, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, code_value, output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);
        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }
        if (String(jobRow.code_type || '').trim() !== 'budget') {
            return res.status(400).json({ ok: false, error: 'AP entry editor is only supported for AP jobs' });
        }

        const nextCodeValue = codeValueInput || String(jobRow.code_value || '').trim() || 'unknown';
        const nextVendor = sanitizeVendorToken(vendorInput);
        const output = safeParseJson(jobRow.output_json || '{}');
        const targetDir = String(output?.targetDir || '').trim();
        const routeKind = String(output?.routing?.routeKind || '').toUpperCase() || 'BILL';
        const normalizedFiles = await normalizeJobFilesWithCurrentPaths(output, jobRow.created_at, new Map());
        if (!normalizedFiles.length) {
            return res.status(404).json({ ok: false, error: 'No saved files found for this routing job' });
        }

        const desiredNameByIndex = new Map();
        const desiredPathByIndex = new Map();
        const deletedIndexSet = new Set();
        incomingFiles.forEach((row) => {
            const idx = Number(row?.fileIndex);
            if (!Number.isInteger(idx) || idx < 0) return;
            if (row?.deleted === true) {
                deletedIndexSet.add(idx);
            }
            const rawName = sanitizeFilenameToken(row?.name || '');
            if (!rawName) return;
            const withExt = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
            desiredNameByIndex.set(idx, withExt);
            const rawPath = normalizeWindowsPath(row?.path || '');
            if (rawPath) desiredPathByIndex.set(idx, rawPath);
        });

        let renamedCount = 0;
        let deletedCount = 0;
        const dirCache = new Map();
        const nextFiles = [];
        const fileMutations = [];
        for (const file of normalizedFiles) {
            const fileIndex = Number(file.fileIndex);
            const currentPath = normalizeWindowsPath(file.path || '');
            const currentName = basename(currentPath || file.name || '');
            if (deletedIndexSet.has(fileIndex)) {
                const explicitPath = desiredPathByIndex.get(fileIndex);
                const candidatePath = currentPath
                    || (explicitPath && await pathExists(explicitPath) ? explicitPath : '')
                    || (targetDir ? join(targetDir, currentName) : '');
                if (candidatePath && await pathExists(candidatePath)) {
                    await rm(candidatePath, { force: true });
                    deletedCount += 1;
                    fileMutations.push({
                        fileIndex,
                        action: 'delete',
                        from: normalizeWindowsPath(candidatePath),
                        to: ''
                    });
                }
                continue;
            }
            let nextName = sanitizeFilenameToken(desiredNameByIndex.get(fileIndex) || '');
            if (!nextName) {
                nextName = buildRenamedApFilename(currentName, { routeKind, vendor: nextVendor }) || currentName;
            }
            if (!nextName.toLowerCase().endsWith('.pdf')) {
                nextName = `${nextName}.pdf`;
            }
            let finalPath = currentPath;
            if (finalPath && !(await pathExists(finalPath))) {
                finalPath = '';
            }

            // Manual re-attach support for stale/missing stored paths.
            if (!finalPath) {
                const explicitPath = desiredPathByIndex.get(fileIndex);
                if (explicitPath && await pathExists(explicitPath)) {
                    finalPath = explicitPath;
                }
                if (!finalPath && targetDir && currentName) {
                    const byCurrentNamePath = join(targetDir, currentName);
                    if (await pathExists(byCurrentNamePath)) {
                        finalPath = byCurrentNamePath;
                    }
                }
                if (!finalPath && targetDir && nextName) {
                    const byNamePath = join(targetDir, nextName);
                    if (await pathExists(byNamePath)) {
                        finalPath = byNamePath;
                    }
                    if (!finalPath) {
                        const resolvedPath = await resolveRenamedFilePath({
                            targetDir,
                            originalName: currentName || nextName,
                            createdAt: jobRow.created_at,
                            dirCache
                        });
                        if (resolvedPath) {
                            finalPath = normalizeWindowsPath(resolvedPath);
                        }
                    }
                }
            }

            if (finalPath && nextName && nextName !== basename(finalPath)) {
                const previousPath = normalizeWindowsPath(finalPath);
                const candidatePath = join(dirname(finalPath), nextName);
                const uniquePath = await ensureUniqueFilePath(candidatePath);
                await rename(finalPath, uniquePath);
                finalPath = uniquePath;
                renamedCount += 1;
                fileMutations.push({
                    fileIndex,
                    action: 'rename',
                    from: previousPath,
                    to: normalizeWindowsPath(finalPath)
                });
            }
            nextFiles.push({
                name: basename(finalPath || nextName || currentName),
                path: finalPath || currentPath || ''
            });
        }

        const nextOutput = {
            ...output,
            files: nextFiles,
            routing: {
                ...(output?.routing || {}),
                routeKind,
                vendor: nextVendor,
                vendorFound: Boolean(nextVendor),
                vendorUpdatedAt: new Date().toISOString()
            }
        };

        const persistedOutput = persistRoutingLogUpdate({
            jobId: jobRow.id,
            codeValue: nextCodeValue,
            output: nextOutput,
            historyAction: 'ap-entry-update',
            historyDetails: {
                codeValue: nextCodeValue,
                vendor: nextVendor,
                renamedFiles: renamedCount,
                deletedFiles: deletedCount,
                fileMutations: fileMutations.sort((a, b) => Number(a.fileIndex) - Number(b.fileIndex))
            }
        });

        const files = await normalizeJobFilesWithCurrentPaths(persistedOutput, jobRow.created_at, new Map());
        return res.json({
            ok: true,
            jobId: jobRow.id,
            codeValue: nextCodeValue,
            vendor: nextVendor,
            renamedFiles: renamedCount,
            deletedFiles: deletedCount,
            files
        });
    } catch (error) {
        console.error('AP routing entry update error:', error);
        const detail = String(error?.message || '').trim();
        return res.status(500).json({
            ok: false,
            error: detail ? `Failed to save AP routing entry: ${detail}` : 'Failed to save AP routing entry'
        });
    }
});

router.post('/routing-log/ar-entry', async (req, res) => {
    try {
        const rawJobId = String(req.body?.jobId || '').trim();
        const codeValueInput = compactWhitespace(req.body?.codeValue || '');
        const designationInput = compactWhitespace(req.body?.designation || '');
        const incomingFiles = Array.isArray(req.body?.files) ? req.body.files : [];
        if (!rawJobId) {
            return res.status(400).json({ ok: false, error: 'jobId is required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT id, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, code_value, output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);
        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }
        if (String(jobRow.code_type || '').trim() !== 'envelope') {
            return res.status(400).json({ ok: false, error: 'AR entry editor is only supported for AR jobs' });
        }

        const output = safeParseJson(jobRow.output_json || '{}');
        const targetDir = String(output?.targetDir || '').trim();
        const normalizedFiles = await normalizeJobFilesWithCurrentPaths(output, jobRow.created_at, new Map());
        if (!normalizedFiles.length) {
            return res.status(404).json({ ok: false, error: 'No saved files found for this routing job' });
        }

        const nextEnvelopeNumber = sanitizeContributionToken(
            codeValueInput || String(jobRow.code_value || '').trim(),
            'Unknown envelope'
        );
        const nextDesignation = resolveContributionDesignation({
            designation: sanitizeContributionToken(designationInput, ''),
            envelopeNumber: nextEnvelopeNumber
        }).designation;
        if (!nextDesignation) {
            return res.status(400).json({ ok: false, error: 'Designation is required' });
        }
        const noteText = buildContributionNoteText({
            envelopeNumber: nextEnvelopeNumber,
            designation: nextDesignation
        });

        const desiredNameByIndex = new Map();
        const desiredPathByIndex = new Map();
        const deletedIndexSet = new Set();
        incomingFiles.forEach((row) => {
            const idx = Number(row?.fileIndex);
            if (!Number.isInteger(idx) || idx < 0) return;
            if (row?.deleted === true) {
                deletedIndexSet.add(idx);
            }
            const rawName = sanitizeFilenameToken(row?.name || '');
            if (!rawName) return;
            const withExt = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
            desiredNameByIndex.set(idx, withExt);
            const rawPath = normalizeWindowsPath(row?.path || '');
            if (rawPath) desiredPathByIndex.set(idx, rawPath);
        });

        let renamedCount = 0;
        let deletedCount = 0;
        const dirCache = new Map();
        const nextFiles = [];
        const fileMutations = [];
        for (const file of normalizedFiles) {
            const fileIndex = Number(file.fileIndex);
            const currentPath = normalizeWindowsPath(file.path || '');
            const currentName = basename(currentPath || file.name || '');
            if (deletedIndexSet.has(fileIndex)) {
                const explicitPath = desiredPathByIndex.get(fileIndex);
                const candidatePath = currentPath
                    || (explicitPath && await pathExists(explicitPath) ? explicitPath : '')
                    || (targetDir ? join(targetDir, currentName) : '');
                if (candidatePath && await pathExists(candidatePath)) {
                    await rm(candidatePath, { force: true });
                    deletedCount += 1;
                    fileMutations.push({
                        fileIndex,
                        action: 'delete',
                        from: normalizeWindowsPath(candidatePath),
                        to: ''
                    });
                }
                continue;
            }

            let nextName = sanitizeFilenameToken(desiredNameByIndex.get(fileIndex) || '');
            if (!nextName) {
                nextName = currentName;
            }
            if (!nextName.toLowerCase().endsWith('.pdf')) {
                nextName = `${nextName}.pdf`;
            }
            let finalPath = currentPath;
            if (finalPath && !(await pathExists(finalPath))) {
                finalPath = '';
            }

            if (!finalPath) {
                const explicitPath = desiredPathByIndex.get(fileIndex);
                if (explicitPath && await pathExists(explicitPath)) {
                    finalPath = explicitPath;
                }
                if (!finalPath && targetDir && currentName) {
                    const byCurrentNamePath = join(targetDir, currentName);
                    if (await pathExists(byCurrentNamePath)) {
                        finalPath = byCurrentNamePath;
                    }
                }
                if (!finalPath && targetDir && nextName) {
                    const byNamePath = join(targetDir, nextName);
                    if (await pathExists(byNamePath)) {
                        finalPath = byNamePath;
                    }
                    if (!finalPath) {
                        const resolvedPath = await resolveRenamedFilePath({
                            targetDir,
                            originalName: currentName || nextName,
                            createdAt: jobRow.created_at,
                            dirCache
                        });
                        if (resolvedPath) {
                            finalPath = normalizeWindowsPath(resolvedPath);
                        }
                    }
                }
            }

            if (finalPath && nextName && nextName !== basename(finalPath)) {
                const previousPath = normalizeWindowsPath(finalPath);
                const candidatePath = join(dirname(finalPath), nextName);
                const uniquePath = await ensureUniqueFilePath(candidatePath);
                await rename(finalPath, uniquePath);
                finalPath = uniquePath;
                renamedCount += 1;
                fileMutations.push({
                    fileIndex,
                    action: 'rename',
                    from: previousPath,
                    to: normalizeWindowsPath(finalPath)
                });
            }
            nextFiles.push({
                name: basename(finalPath || nextName || currentName),
                path: finalPath || currentPath || ''
            });
        }

        for (const file of nextFiles) {
            const path = normalizeWindowsPath(file?.path || '');
            if (!path || !(await pathExists(path))) continue;
            try {
                await replaceRoutingNoteInPdf(path, noteText);
            } catch (error) {
                console.warn(`Failed to restamp routed PDF during AR entry save: ${path}`, error?.message || error);
            }
        }

        const nextOutput = {
            ...output,
            files: nextFiles,
            routing: {
                ...(output?.routing || {}),
                routeKind: 'CONTRIBUTION',
                envelopeNumber: nextEnvelopeNumber,
                designation: nextDesignation,
                noteText,
                designationUpdatedAt: new Date().toISOString()
            }
        };

        const persistedOutput = persistRoutingLogUpdate({
            jobId: jobRow.id,
            codeValue: nextEnvelopeNumber,
            output: nextOutput,
            historyAction: 'ar-entry-update',
            historyDetails: {
                envelopeNumber: nextEnvelopeNumber,
                designation: nextDesignation,
                renamedFiles: renamedCount,
                deletedFiles: deletedCount,
                fileMutations: fileMutations.sort((a, b) => Number(a.fileIndex) - Number(b.fileIndex))
            }
        });

        const files = await normalizeJobFilesWithCurrentPaths(persistedOutput, jobRow.created_at, new Map());
        return res.json({
            ok: true,
            jobId: jobRow.id,
            codeValue: nextEnvelopeNumber,
            envelopeNumber: nextEnvelopeNumber,
            designation: nextDesignation,
            isPledger: isPledgerEnvelope(nextEnvelopeNumber),
            renamedFiles: renamedCount,
            deletedFiles: deletedCount,
            files
        });
    } catch (error) {
        console.error('AR routing entry update error:', error);
        const detail = String(error?.message || '').trim();
        return res.status(500).json({
            ok: false,
            error: detail ? `Failed to save AR routing entry: ${detail}` : 'Failed to save AR routing entry'
        });
    }
});

router.post('/routing-log/ap-entry/attach-file', async (req, res) => {
    try {
        const rawJobId = String(req.body?.jobId || '').trim();
        const fileIndex = Number(req.body?.fileIndex);
        if (!rawJobId || !Number.isInteger(fileIndex) || fileIndex < 0) {
            return res.status(400).json({ ok: false, error: 'jobId and valid fileIndex are required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT id, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);
        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }
        if (String(jobRow.code_type || '').trim() !== 'budget') {
            return res.status(400).json({ ok: false, error: 'Attach is only supported for AP jobs' });
        }

        const output = safeParseJson(jobRow.output_json || '{}');
        const targetDir = String(output?.targetDir || '').trim();
        const normalizedFiles = await normalizeJobFilesWithCurrentPaths(output, jobRow.created_at, new Map());
        const target = normalizedFiles.find((item) => Number(item.fileIndex) === fileIndex);
        if (!target) {
            return res.status(404).json({ ok: false, error: 'File row not found for this routing job' });
        }

        const manualPath = normalizeWindowsPath(req.body?.path || '');
        const selectedPath = manualPath || await pickPdfFilePath({
            initialDirectory: targetDir,
            title: 'Select AP PDF to attach to this log entry'
        });
        if (!selectedPath) {
            return res.json({ ok: false, cancelled: true, error: 'File selection was cancelled' });
        }
        if (!selectedPath.toLowerCase().endsWith('.pdf')) {
            return res.status(400).json({ ok: false, error: 'Selected file must be a PDF' });
        }
        if (!(await pathExists(selectedPath))) {
            return res.status(404).json({ ok: false, error: 'Selected file was not found on disk' });
        }

        const rawFiles = Array.isArray(output?.files) ? [...output.files] : [];
        const currentRaw = rawFiles[fileIndex];
        if (currentRaw && typeof currentRaw === 'object') {
            rawFiles[fileIndex] = {
                ...currentRaw,
                name: basename(selectedPath),
                path: selectedPath
            };
        } else {
            rawFiles[fileIndex] = {
                name: basename(selectedPath),
                path: selectedPath
            };
        }

        const nextOutput = {
            ...output,
            files: rawFiles
        };

        const persistedOutput = persistRoutingLogUpdate({
            jobId: jobRow.id,
            output: nextOutput,
            historyAction: 'ap-attach-file',
            historyDetails: {
                fileIndex,
                selectedPath: normalizeWindowsPath(selectedPath)
            }
        });

        const files = await normalizeJobFilesWithCurrentPaths(persistedOutput, jobRow.created_at, new Map());
        return res.json({
            ok: true,
            jobId: jobRow.id,
            selectedPath,
            selectedName: basename(selectedPath),
            files
        });
    } catch (error) {
        console.error('AP routing attach file error:', error);
        const detail = String(error?.message || '').trim();
        return res.status(500).json({
            ok: false,
            error: detail ? `Failed to attach file: ${detail}` : 'Failed to attach file',
            detail
        });
    }
});

const apAttachUploadSingle = (req, res) => new Promise((resolveUpload, rejectUpload) => {
    apAttachUpload.single('file')(req, res, (error) => {
        if (error) rejectUpload(error);
        else resolveUpload();
    });
});

router.post('/routing-log/ap-entry/attach-upload', async (req, res) => {
    let uploadedTempPath = '';
    try {
        try {
            await apAttachUploadSingle(req, res);
        } catch (uploadError) {
            const uploadCode = String(uploadError?.code || '').trim();
            const uploadMessage = String(uploadError?.message || '').trim() || 'Upload failed';
            return res.status(400).json({
                ok: false,
                error: `Failed to attach file: ${uploadMessage}`,
                code: uploadCode || 'UPLOAD_ERROR',
                detail: uploadMessage
            });
        }
        uploadedTempPath = normalizeWindowsPath(req.file?.path || '');

        const rawJobId = String(req.body?.jobId || '').trim();
        const fileIndex = Number(req.body?.fileIndex);
        if (!rawJobId || !Number.isInteger(fileIndex) || fileIndex < 0) {
            return res.status(400).json({ ok: false, error: 'jobId and valid fileIndex are required' });
        }
        if (!req.file) {
            return res.status(400).json({ ok: false, error: 'PDF file is required' });
        }

        const uploadedName = sanitizeFilenameToken(basename(String(req.file.originalname || '').trim() || 'attached.pdf'));
        const uploadedPdfName = uploadedName.toLowerCase().endsWith('.pdf') ? uploadedName : `${uploadedName}.pdf`;

        const eventRow = sqlite.prepare(`
            SELECT id, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawJobId);
        const effectiveJobId = String(eventRow?.job_id || rawJobId).trim();
        const jobRow = sqlite.prepare(`
            SELECT id, code_type, output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(effectiveJobId);
        if (!jobRow) {
            return res.status(404).json({ ok: false, error: 'Routing job not found' });
        }
        if (String(jobRow.code_type || '').trim() !== 'budget') {
            return res.status(400).json({ ok: false, error: 'Attach is only supported for AP jobs' });
        }

        const output = safeParseJson(jobRow.output_json || '{}');
        const targetDir = String(output?.targetDir || '').trim();
        if (!targetDir) {
            return res.status(400).json({ ok: false, error: 'This log entry has no target folder to attach into' });
        }

        const normalizedFiles = await normalizeJobFilesWithCurrentPaths(output, jobRow.created_at, new Map());
        const target = normalizedFiles.find((item) => Number(item.fileIndex) === fileIndex);
        if (!target) {
            return res.status(404).json({ ok: false, error: 'File row not found for this routing job' });
        }

        let selectedPath = '';
        const existingByName = join(targetDir, uploadedPdfName);
        if (await pathExists(existingByName)) {
            selectedPath = normalizeWindowsPath(existingByName);
        } else {
            const desiredPath = await ensureUniqueFilePath(join(targetDir, uploadedPdfName));
            await moveFileWithFallback(uploadedTempPath, desiredPath);
            selectedPath = normalizeWindowsPath(desiredPath);
        }

        const rawFiles = Array.isArray(output?.files) ? [...output.files] : [];
        const currentRaw = rawFiles[fileIndex];
        if (currentRaw && typeof currentRaw === 'object') {
            rawFiles[fileIndex] = {
                ...currentRaw,
                name: basename(selectedPath),
                path: selectedPath
            };
        } else {
            rawFiles[fileIndex] = {
                name: basename(selectedPath),
                path: selectedPath
            };
        }

        const nextOutput = {
            ...output,
            files: rawFiles
        };

        const persistedOutput = persistRoutingLogUpdate({
            jobId: jobRow.id,
            output: nextOutput,
            historyAction: 'ap-attach-upload',
            historyDetails: {
                fileIndex,
                selectedPath: normalizeWindowsPath(selectedPath)
            }
        });

        const files = await normalizeJobFilesWithCurrentPaths(persistedOutput, jobRow.created_at, new Map());
        return res.json({
            ok: true,
            jobId: jobRow.id,
            selectedPath,
            selectedName: basename(selectedPath),
            files
        });
    } catch (error) {
        console.error('AP routing attach upload error:', error);
        const detail = String(error?.message || '').trim();
        return res.status(500).json({
            ok: false,
            error: detail ? `Failed to attach file: ${detail}` : 'Failed to attach file',
            detail
        });
    } finally {
        if (uploadedTempPath && await pathExists(uploadedTempPath)) {
            await rm(uploadedTempPath, { force: true }).catch(() => { });
        }
    }
});

router.post('/routing-log/reveal', async (req, res) => {
    try {
        const rawId = String(req.body?.jobId || '').trim();
        const fileIndex = Number(req.body?.fileIndex);
        if (!rawId || !Number.isInteger(fileIndex) || fileIndex < 0) {
            return res.status(400).json({ ok: false, error: 'jobId and valid fileIndex are required' });
        }

        const eventRow = sqlite.prepare(`
            SELECT output_json, job_id, created_at
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawId);

        const jobId = String(eventRow?.job_id || rawId).trim();
        const row = sqlite.prepare(`
            SELECT output_json, created_at
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(jobId);

        if (!row && !eventRow) {
            return res.status(404).json({ ok: false, error: 'Routing log entry not found' });
        }

        const output = safeParseJson(row?.output_json || eventRow?.output_json || '{}');
        const createdAt = String(row?.created_at || eventRow?.created_at || '').trim();
        const dirCache = new Map();
        const files = await normalizeJobFilesWithCurrentPaths(output, createdAt, dirCache);
        const target = files.find((file) => file.fileIndex === fileIndex);
        const targetDir = String(output?.targetDir || '').trim();
        let resolvedPath = normalizeWindowsPath(target?.path || '');
        if (!resolvedPath && target?.name && targetDir) {
            const byName = join(targetDir, target.name);
            if (await pathExists(byName)) {
                resolvedPath = normalizeWindowsPath(byName);
            }
        }
        if (!resolvedPath && target?.name && targetDir) {
            const renamedPath = await resolveRenamedFilePath({
                targetDir,
                originalName: target.name,
                createdAt,
                dirCache
            });
            if (renamedPath) {
                resolvedPath = normalizeWindowsPath(renamedPath);
            }
        }
        if (!resolvedPath) {
            return res.status(404).json({ ok: false, error: 'File path unavailable for this entry' });
        }

        const normalizedPath = resolvedPath;
        try {
            const result = await revealInExplorer(normalizedPath);
            return res.json({ ok: true, warning: result.warning || '' });
        } catch {
            const parentDir = dirname(normalizedPath);
            try {
                await openExplorerFolder(parentDir);
                return res.json({ ok: true, warning: 'File not found; opened parent folder instead.' });
            } catch (error) {
                const detail = String(error?.message || '').slice(0, 240);
                return res.status(500).json({
                    ok: false,
                    error: `Unable to open file location for: ${normalizedPath}`,
                    detail
                });
            }
        }
    } catch (error) {
        console.error('Routing log reveal error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to reveal file' });
    }
});

// POST /api/deposit-slip
router.post('/', upload.array('checks', 30), async (req, res) => {
    let outputDir = null;
    let imagePaths = null;
    try {
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'No check images uploaded' });
        }

        const debugOcr = req.body?.debugOcr === '1' || req.body?.debugOcr === 'true';
        const configPath = resolve(__dirname, '..', 'depositSlipConfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const templatePath = resolve(__dirname, '..', '..', config.templatePath || 'deposit slip template.pdf');

        outputDir = join(tmpdir(), `deposit-slip-${Date.now()}`);
        const outputPath = join(outputDir, 'deposit-slip.pdf');

        imagePaths = files.map((file) => ({
            path: file.path,
            source: file.originalname || basename(file.path)
        }));
        const checks = await extractChecksFromImages(imagePaths, {
            ocrRegions: config.ocrRegions,
            includeOcrLines: debugOcr,
            ocrEngines: config.ocrEngines,
            ocrRegionOrigin: config.ocrRegionOrigin,
            ocrRegionAnchor: config.ocrRegionAnchor,
            ocrModel: config.ocrModel,
            ocrCropMaxSize: config.ocrCropMaxSize,
            ocrPreviewOnly: config.ocrPreviewOnly === true,
            ocrAlign: config.ocrAlign
        });

        await buildDepositSlipPdf({
            templatePath,
            outputPath,
            checks,
            fieldMap: config.fieldMap || {}
        });

        const pdfBytes = await readFile(outputPath);
        const pdfBase64 = pdfBytes.toString('base64');
        res.json({
            pdfBase64,
            checks,
            debugOcr
        });
    } catch (error) {
        console.error('Deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build deposit slip' });
        }
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => { });
        }
        if (imagePaths?.length) {
            await Promise.all(
                imagePaths.map((file) => rm(file.path || file, { force: true }).catch(() => { }))
            );
        }
    }
});

// POST /api/deposit-slip/manual
router.post('/manual', async (req, res) => {
    let outputDir = null;
    try {
        const configPath = resolve(__dirname, '..', 'depositSlipConfig.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const templatePath = resolve(__dirname, '..', '..', config.templatePath || 'deposit slip template.pdf');

        const maxChecks = Array.isArray(config.fieldMap?.checks)
            ? config.fieldMap.checks.length
            : 18;
        const { manualChecks, cashTotal } = buildManualChecks(req.body?.checks || [], maxChecks);

        const clientTotals = parseJsonValue(req.body?.totals, {}) || {};
        const subtotalOverride = parseCurrencyOverride(clientTotals.subtotal);
        const totalOverride = parseCurrencyOverride(clientTotals.total);
        const subtotalValue = subtotalOverride != null
            ? subtotalOverride
            : manualChecks.reduce((sum, check) => sum + (Number.isFinite(check.amount) ? check.amount : 0), 0);
        const totalValue = totalOverride != null ? totalOverride : subtotalValue + cashTotal;

        const fundsReportEntries = normalizeFundsReportEntries(req.body?.fundsReport?.entries);
        const depositChecks = manualChecks;

        outputDir = join(tmpdir(), `deposit-slip-${Date.now()}`);
        const outputPath = join(outputDir, 'deposit-slip.pdf');

        await buildDepositSlipPdf({
            templatePath,
            outputPath,
            checks: depositChecks,
            fieldMap: config.fieldMap || {},
            totals: {
                cash: cashTotal,
                subtotal: subtotalValue,
                total: totalValue
            },
            fundsReport: {
                entries: fundsReportEntries,
                total: totalValue
            }
        });

        const pdfBytes = await readFile(outputPath);
        const saved = await saveDepositPdf(pdfBytes);
        res.json({
            fileId: saved.fileId,
            cashTotal: Number.isFinite(cashTotal) ? cashTotal : 0
        });
    } catch (error) {
        console.error('Manual deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build manual deposit slip' });
        }
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => { });
        }
    }
});

// POST /api/deposit-slip/print-base64
router.post('/print-base64', async (req, res) => {
    let outputDir = null;
    try {
        const rawBase64 = String(req.body?.pdfBase64 || '').trim();
        if (!rawBase64) {
            return res.status(400).json({ error: 'pdfBase64 is required' });
        }
        const normalized = rawBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        const pdfBuffer = Buffer.from(normalized, 'base64');
        outputDir = join(tmpdir(), `deposit-slip-print-${randomUUID()}`);
        await mkdir(outputDir, { recursive: true });
        const pdfPath = join(outputDir, 'deposit-slip.pdf');
        await writeFile(pdfPath, pdfBuffer);
        const escaped = pdfPath.replace(/'/g, "''");

        const preferredPrinter = String(process.env.DEPOSIT_PRINTER_NAME || '').trim();
        const printerName = preferredPrinter || await getDefaultPrinterName().catch(() => null);
        const escapedPrinter = printerName ? printerName.replace(/'/g, "''") : '';
        const sumatraPath = await resolveSumatraPdfPath();

        if (sumatraPath) {
            const sumatraArgs = printerName
                ? ['-silent', '-print-to', printerName, '-exit-on-print', pdfPath]
                : ['-silent', '-print-to-default', '-exit-on-print', pdfPath];
            await execFileAsync(sumatraPath, sumatraArgs, { windowsHide: true });
            return res.json({ success: true, printer: printerName || null, method: 'sumatra' });
        }

        const script = [
            `$path = '${escaped}'`,
            printerName ? `$printer = '${escapedPrinter}'` : `$printer = $null`,
            `$printed = $false`,
            `if ($printer) {`,
            `  try { Start-Process -FilePath $path -Verb PrintTo -ArgumentList $printer; $printed = $true } catch { }`,
            `}`,
            `if (-not $printed) { Start-Process -FilePath $path -Verb Print }`
        ].join('; ');

        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        res.json({ success: true, printer: printerName || null, method: 'shell' });
    } catch (error) {
        console.error('Deposit slip print error:', error);
        res.status(500).json({ error: 'Failed to print deposit slip' });
    } finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true }).catch(() => { });
        }
    }
});

// GET /api/deposit-slip/file/:id
router.get('/file/:id', async (req, res) => {
    const filePath = buildDepositFilePath(req.params.id);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid file id' });
    }
    try {
        await access(filePath);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="deposit-slip-${req.params.id}.pdf"`);
        return res.sendFile(filePath);
    } catch {
        return res.status(404).json({ error: 'Deposit file not found' });
    }
});

// DELETE /api/deposit-slip/file/:id
router.delete('/file/:id', async (req, res) => {
    const filePath = buildDepositFilePath(req.params.id);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid file id' });
    }
    try {
        await rm(filePath, { force: true });
        return res.json({ success: true });
    } catch (error) {
        console.error('Deposit slip delete error:', error);
        return res.status(500).json({ error: 'Failed to delete deposit file' });
    }
});

// POST /api/deposit-slip/print-file
router.post('/print-file', async (req, res) => {
    try {
        const fileId = String(req.body?.fileId || '').trim();
        const filePath = buildDepositFilePath(fileId);
        if (!filePath) {
            return res.status(400).json({ error: 'fileId is required' });
        }
        await access(filePath);
        const escaped = filePath.replace(/'/g, "''");
        const preferredPrinter = String(process.env.DEPOSIT_PRINTER_NAME || '').trim();
        const printerName = preferredPrinter || await getDefaultPrinterName().catch(() => null);
        const sumatraPath = await resolveSumatraPdfPath();

        if (sumatraPath) {
            const sumatraArgs = printerName
                ? ['-silent', '-print-to', printerName, '-exit-on-print', filePath]
                : ['-silent', '-print-to-default', '-exit-on-print', filePath];
            await execFileAsync(sumatraPath, sumatraArgs, { windowsHide: true });
            return res.json({ success: true, printer: printerName || null, method: 'sumatra' });
        }

        const escapedPrinter = printerName ? printerName.replace(/'/g, "''") : '';
        const script = [
            `$path = '${escaped}'`,
            printerName ? `$printer = '${escapedPrinter}'` : `$printer = $null`,
            `$printed = $false`,
            `if ($printer) {`,
            `  try { Start-Process -FilePath $path -Verb PrintTo -ArgumentList $printer; $printed = $true } catch { }`,
            `}`,
            `if (-not $printed) { Start-Process -FilePath $path -Verb Print }`
        ].join('; ');

        await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        return res.json({ success: true, printer: printerName || null, method: 'shell' });
    } catch (error) {
        console.error('Deposit slip print error:', error);
        return res.status(500).json({ error: 'Failed to print deposit slip' });
    }
});

// POST /api/deposit-slip/pdf
router.post('/pdf', depositBundleUpload.fields([
    { name: 'checksPdf', maxCount: 1 },
    { name: 'cashPdf', maxCount: 1 }
]), async (req, res) => {
    let checksPath = null;
    let cashPath = null;
    try {
        const checksFile = req.files?.checksPdf?.[0] || null;
        const cashFile = req.files?.cashPdf?.[0] || null;
        if (!checksFile) {
            return res.status(400).json({ error: 'Checks PDF is required' });
        }
        const slipFileId = String(req.body?.slipFileId || '').trim();
        const slipPath = buildDepositFilePath(slipFileId);
        if (!slipPath) {
            return res.status(400).json({ error: 'Deposit slip file is required' });
        }
        try {
            await access(slipPath);
        } catch {
            return res.status(404).json({ error: 'Deposit slip file not found' });
        }
        checksPath = checksFile.path;
        cashPath = cashFile?.path || null;

        const depositBytes = await readFile(slipPath);
        const depositDoc = await PDFDocument.load(depositBytes);
        const depositForm = depositDoc.getForm();
        depositForm.flatten();
        const finalDoc = await PDFDocument.create();
        const [depositPage] = await finalDoc.copyPages(depositDoc, [0]);
        finalDoc.addPage(depositPage);

        if (cashPath) {
            const cashBytes = await readFile(cashPath);
            const cashDoc = await PDFDocument.load(cashBytes);
            if (cashDoc.getPageCount() > 0) {
                const [cashPage] = await finalDoc.copyPages(cashDoc, [0]);
                finalDoc.addPage(cashPage);
            }
        }

        const checksBytes = await readFile(checksPath);
        const checksDoc = await PDFDocument.load(checksBytes);
        const checksPageCount = checksDoc.getPageCount();
        const expectedCheckPageCount = deriveExpectedCheckPageCount(req.body?.checks);
        let envelopePageIndexes = new Set();

        // Primary behavior: checks are first, envelopes are trailing pages.
        if (
            Number.isInteger(expectedCheckPageCount)
            && expectedCheckPageCount >= 0
            && expectedCheckPageCount <= checksPageCount
        ) {
            for (let idx = expectedCheckPageCount; idx < checksPageCount; idx += 1) {
                envelopePageIndexes.add(idx);
            }
        } else {
            // Fallback when payload doesn't provide a reliable check count.
            envelopePageIndexes = await classifyEnvelopePagesFromChecksPdf(checksPath);
        }
        await addChecksGridFromPdf(finalDoc, checksDoc, {
            pageWidth: depositPage.getWidth(),
            pageHeight: depositPage.getHeight(),
            envelopePageIndexes,
            envelopeRotateClockwiseDegrees: 90
        });

        const finalBytes = await finalDoc.save();
        const finalBuffer = Buffer.from(finalBytes);
        const saved = await saveDepositPdf(finalBuffer);
        res.json({ fileId: saved.fileId });
    } catch (error) {
        console.error('PDF deposit slip error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to build deposit packet' });
        }
    } finally {
        if (checksPath) {
            await rm(checksPath, { force: true }).catch(() => { });
        }
        if (cashPath) {
            await rm(cashPath, { force: true }).catch(() => { });
        }
    }
});

export default router;
