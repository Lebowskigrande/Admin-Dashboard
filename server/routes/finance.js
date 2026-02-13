import express from 'express';
import multer from 'multer';
import { join, resolve, dirname, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdir, writeFile, readFile, rm, access } from 'fs/promises';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';
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

const parseLogDate = (raw) => {
    const value = String(raw || '').trim();
    const fallback = new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return {
            key: fallback.toISOString().slice(0, 10),
            startIso: new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 0, 0, 0, 0).toISOString(),
            endIso: new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate() + 1, 0, 0, 0, 0).toISOString()
        };
    }

    const [year, month, day] = value.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(start.getTime())) {
        return {
            key: fallback.toISOString().slice(0, 10),
            startIso: new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 0, 0, 0, 0).toISOString(),
            endIso: new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate() + 1, 0, 0, 0, 0).toISOString()
        };
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

const isRetriableFailure = ({ status, errorText, output }) => {
    if (String(status || '').toLowerCase() !== 'failure') return false;
    const diagnosticsRetriable = Number(output?.diagnostics?.retriable || 0);
    if (diagnosticsRetriable > 0) return true;
    const text = String(errorText || '').toLowerCase();
    return text.includes('timeout')
        || text.includes('temporar')
        || text.includes('econnreset')
        || text.includes('eai_again')
        || text.includes('enotfound')
        || text.includes('network')
        || text.includes('rate limit')
        || text.includes('429');
};

router.get('/routing-log', (req, res) => {
    try {
        const codeType = resolveRoutingCodeType(req.query?.type);
        const date = parseLogDate(req.query?.date);
        const eventRows = sqlite.prepare(`
            SELECT id, job_id, code_type, code_value, status, error_text, output_json, created_at
            FROM sharefile_job_events
            WHERE code_type = ?
              AND created_at >= ?
              AND created_at < ?
            ORDER BY created_at DESC
        `).all(codeType, date.startIso, date.endIso);

        const legacyRows = sqlite.prepare(`
            SELECT id, code_type, code_value, output_json, created_at
            FROM sharefile_jobs
            WHERE code_type = ?
              AND created_at >= ?
              AND created_at < ?
            ORDER BY created_at DESC
        `).all(codeType, date.startIso, date.endIso);
        const eventsByJobId = new Set(eventRows.map((row) => String(row.job_id || '').trim()).filter(Boolean));

        const eventEntries = eventRows.map((row) => {
            const output = safeParseJson(row.output_json);
            const files = normalizeJobFiles(output);
            const status = row.status || 'success';
            const errorText = row.error_text || '';
            return {
                id: row.id,
                jobId: row.job_id || null,
                codeType: row.code_type || '',
                codeValue: row.code_value || '',
                status,
                errorText,
                retriable: isRetriableFailure({ status, errorText, output }),
                createdAt: row.created_at,
                targetDir: String(output?.targetDir || ''),
                files
            };
        });

        const legacyEntries = legacyRows
            .filter((row) => !eventsByJobId.has(String(row.id || '').trim()))
            .map((row) => {
                const output = safeParseJson(row.output_json);
                const files = normalizeJobFiles(output);
                return {
                    id: row.id,
                    jobId: row.id,
                    codeType: row.code_type || '',
                    codeValue: row.code_value || '',
                    status: 'success',
                    errorText: '',
                    retriable: false,
                    createdAt: row.created_at,
                    targetDir: String(output?.targetDir || ''),
                    files
                };
            });

        const entries = [...eventEntries, ...legacyEntries]
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const diagnostics = {
            lastRunAt: entries[0]?.createdAt || null,
            processed: entries.length,
            failed: entries.filter((entry) => entry.status === 'failure').length,
            retriable: entries.filter((entry) => entry.retriable).length
        };

        res.json({
            ok: true,
            date: date.key,
            type: String(req.query?.type || 'ap').toLowerCase() === 'ar' ? 'ar' : 'ap',
            diagnostics,
            entries
        });
    } catch (error) {
        console.error('Routing log read error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load routing log' });
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
            SELECT output_json, job_id
            FROM sharefile_job_events
            WHERE id = ?
            LIMIT 1
        `).get(rawId);

        const jobId = String(eventRow?.job_id || rawId).trim();
        const row = sqlite.prepare(`
            SELECT output_json
            FROM sharefile_jobs
            WHERE id = ?
            LIMIT 1
        `).get(jobId);

        if (!row && !eventRow) {
            return res.status(404).json({ ok: false, error: 'Routing log entry not found' });
        }

        const output = safeParseJson(row?.output_json || eventRow?.output_json || '{}');
        const files = normalizeJobFiles(output);
        const target = files.find((file) => file.fileIndex === fileIndex);

        if (!target?.path) {
            return res.status(404).json({ ok: false, error: 'File path unavailable for this entry' });
        }

        try {
            await access(target.path);
        } catch {
            return res.status(404).json({ ok: false, error: 'File not found on disk' });
        }

        await execFileAsync('explorer.exe', ['/select,', target.path], { windowsHide: true });
        return res.json({ ok: true });
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
        await addChecksGridFromPdf(finalDoc, checksDoc, {
            pageWidth: depositPage.getWidth(),
            pageHeight: depositPage.getHeight()
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
