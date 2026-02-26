import { join, dirname, resolve, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { mkdir, readFile, writeFile, rm, access, readdir, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { addMonths, format } from 'date-fns';
import { sqlite as db } from '../db.js';
import { tableExists } from './db-utils.js';
import { normalizePersonRoles } from './people-utils.js';
import { parseJsonField } from './db-utils.js';
import {
    formatCurrencyValue,
    sumCurrencyValues,
    getDefaultPrinterName
} from './finance-utils.js';

import { buildDocumentPreview } from '../services/bulletinService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const VESTRY_PACKET_CACHE_DIR = join(__dirname, '..', 'vestry-packet-cache');
export const VESTRY_PACKET_CACHE_FILE = join(VESTRY_PACKET_CACHE_DIR, 'cache.json');

export const CERTIFICATE_TEMPLATE_DIR = join(homedir(), 'Dropbox', 'Parish Administrator', 'Vestry', 'Certificates');
export const FUND_A_CERT_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Certificates', 'Certificates Fund A');
export const FUND_B_CERT_BASE_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Certificates');
export const FIDELITY_CERT_DIR = join(homedir(), 'Dropbox', 'SENS REPORTS', 'Fidelity Account', 'Certificates for Transfer');

// --- Packet Cache Helpers ---

export const readVestryPacketCache = async () => {
    try {
        await access(VESTRY_PACKET_CACHE_FILE);
        const data = await readFile(VESTRY_PACKET_CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
};

export const writeVestryPacketCache = async (cache) => {
    await mkdir(VESTRY_PACKET_CACHE_DIR, { recursive: true });
    await writeFile(VESTRY_PACKET_CACHE_FILE, JSON.stringify(cache, null, 2));
};

export const safePacketCacheId = (itemId) => String(itemId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const removeCachedPacketFile = async (entry) => {
    if (entry?.path) {
        await rm(entry.path, { force: true }).catch(() => { });
    }
};

export const ensurePdf = async ({ filePath, originalName = '', mimetype = '' }) => {
    const originalExt = extname(originalName).toLowerCase();
    const isPdf = originalExt === '.pdf' || mimetype === 'application/pdf';
    if (isPdf) return { pdfPath: filePath, isConverted: false };

    const outputDir = join(tmpdir(), `vestry-packet-convert-${randomUUID()}`);
    await mkdir(outputDir, { recursive: true });
    try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const filePathExt = extname(filePath).toLowerCase();
        const effectiveExt = originalExt || filePathExt;
        const sourceBaseName = (effectiveExt
            ? basename(originalName || filePath, effectiveExt)
            : basename(originalName || filePath)) || `document-${Date.now()}`;
        const preferredOutputPath = join(outputDir, `${sourceBaseName}.pdf`);

        const escapePowerShellSingleQuoted = (value) => String(value || '').replace(/'/g, "''");
        const tryWordConversion = async () => {
            if (process.platform !== 'win32') return false;
            if (!['.doc', '.docx', '.rtf'].includes(effectiveExt)) return false;
            const safeSource = escapePowerShellSingleQuoted(filePath);
            const safeTarget = escapePowerShellSingleQuoted(preferredOutputPath);
            const psScript = `
$ErrorActionPreference = 'Stop'
$src = '${safeSource}'
$dst = '${safeTarget}'
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)
    $wdFormatPDF = 17
    $doc.SaveAs([ref]$dst, [ref]$wdFormatPDF)
}
finally {
    if ($doc -ne $null) { $doc.Close([ref]$false) }
    if ($word -ne $null) { $word.Quit() }
    if ($doc -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
    if ($word -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
`;
            try {
                await execFileAsync(
                    'powershell',
                    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
                    { windowsHide: true }
                );
                await access(preferredOutputPath);
                return true;
            } catch {
                return false;
            }
        };

        const convertedWithWord = await tryWordConversion();
        if (convertedWithWord) {
            return { pdfPath: preferredOutputPath, isConverted: true, outputDir };
        }

        await execFileAsync('soffice', [
            '--headless',
            '--convert-to',
            'pdf',
            '--outdir',
            outputDir,
            filePath
        ]);

        const candidateBaseNames = new Set([
            (originalExt ? basename(originalName, originalExt) : basename(originalName || '')).trim(),
            (filePathExt ? basename(filePath, filePathExt) : basename(filePath)).trim()
        ].filter(Boolean));

        let outputPath = '';
        for (const baseName of candidateBaseNames) {
            const candidate = join(outputDir, `${baseName}.pdf`);
            try {
                await access(candidate);
                outputPath = candidate;
                break;
            } catch {
                // Try next candidate.
            }
        }

        if (!outputPath) {
            const names = await readdir(outputDir).catch(() => []);
            const pdfNames = names.filter((name) => name.toLowerCase().endsWith('.pdf'));
            if (pdfNames.length === 1) {
                outputPath = join(outputDir, pdfNames[0]);
            } else if (pdfNames.length > 1) {
                const ranked = await Promise.all(pdfNames.map(async (name) => {
                    const fullPath = join(outputDir, name);
                    try {
                        const info = await stat(fullPath);
                        return { fullPath, mtimeMs: Number(info?.mtimeMs || 0) || 0 };
                    } catch {
                        return null;
                    }
                }));
                const best = ranked
                    .filter(Boolean)
                    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
                if (best?.fullPath) outputPath = best.fullPath;
            }
        }

        if (!outputPath) {
            throw new Error('Unable to locate converted PDF output.');
        }

        return { pdfPath: outputPath, isConverted: true, outputDir };
    } catch (error) {
        const message = error?.code === 'ENOENT'
            ? 'LibreOffice (soffice) is not installed or not on PATH. Upload PDFs or install LibreOffice.'
            : 'Unable to convert document to PDF.';
        throw new Error(message);
    }
};

// --- Certificate Helpers ---

const normalizeToken = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const getQuarterWord = (meetingDate) => {
    const previousMonth = (meetingDate.getMonth() + 11) % 12;
    const quarterIndex = Math.floor(previousMonth / 3);
    return ['first', 'second', 'third', 'fourth'][quarterIndex] || 'first';
};

export const getQuarterMonthLabels = (meetingDate) => {
    const previousMonth = (meetingDate.getMonth() + 11) % 12;
    const quarterIndex = Math.floor(previousMonth / 3);
    const startMonthIndex = quarterIndex * 3;
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return {
        start: monthNames[startMonthIndex],
        end: monthNames[startMonthIndex + 2]
    };
};

export const findVestryClerkName = () => {
    if (!tableExists('people')) {
        return 'Anne Sirimane';
    }
    const rows = db.prepare('SELECT display_name, roles, tags FROM people ORDER BY display_name').all();
    const matches = rows.find((row) => {
        const roleTokens = normalizePersonRoles(row.roles).map((role) => normalizeToken(role));
        const tagTokens = parseJsonField(row.tags).map((tag) => normalizeToken(tag));
        const allTokens = [...roleTokens, ...tagTokens];
        return allTokens.some((token) => token === 'vestry clerk' || token === 'vestryclerk' || token === 'clerk');
    });
    return matches?.display_name || 'Anne Sirimane';
};

export const resolveCertificateTemplatePath = (fundKey) => {
    if (fundKey === 'fidelity') {
        return join(CERTIFICATE_TEMPLATE_DIR, 'CERTIFICATE FOR TRANSFER-- Fidelity template.docx');
    }
    // Use the same templates for both monthly and quarterly runs; quarterly fields can be blank.
    const fundLabel = fundKey === 'funda' ? 'Fund A' : 'Fund B';
    return join(CERTIFICATE_TEMPLATE_DIR, `CERTIFICATE FOR REIMBURSEMENT-- ${fundLabel} template QTR.docx`);
};

export const resolveCertificateOutputDir = (fundKey, yearLabel) => {
    if (fundKey === 'fidelity') return FIDELITY_CERT_DIR;
    if (fundKey === 'funda') return FUND_A_CERT_DIR;
    return join(FUND_B_CERT_BASE_DIR, `Certificates Fund B ${yearLabel}`);
};

export const renderDocxTemplate = async (templatePath, data) => {
    const content = Buffer.isBuffer(templatePath)
        ? templatePath
        : await readFile(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '[[', end: ']]' },
        nullGetter: () => ''
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'nodebuffer' });
};

const FUND_A_BODY_MARKER = '<w:t>This certificate confirms that';
const FUND_A_BODY_PLACEHOLDER_PARAGRAPH = '<w:p><w:r><w:t>[[FUND_A_BODY_TEXT]]</w:t></w:r></w:p>';

const injectFundABodyPlaceholder = async (templatePath) => {
    const buffer = await readFile(templatePath);
    const zip = new PizZip(buffer);
    const entry = zip.file('word/document.xml');
    if (!entry) return buffer;
    const xml = entry.asText();
    const markerIndex = xml.indexOf(FUND_A_BODY_MARKER);
    if (markerIndex < 0) return buffer;
    const paragraphStart = xml.lastIndexOf('<w:p', markerIndex);
    const paragraphEnd = xml.indexOf('</w:p>', markerIndex);
    if (paragraphStart < 0 || paragraphEnd < 0) return buffer;
    const nextXml = `${xml.slice(0, paragraphStart)}${FUND_A_BODY_PLACEHOLDER_PARAGRAPH}${xml.slice(paragraphEnd + 6)}`;
    zip.file('word/document.xml', nextXml);
    return Buffer.from(zip.generate({ type: 'nodebuffer' }));
};

const buildDefaultFundABodyText = ({ monthLabel, yearLabel }) => (
    `This certificate confirms that on the above date the St. Edmund’s Vestry approved the transfer of $1,144.00 from SENS’ Fund A to St. Edmund’s Church Operating Fund. This amount represents 20% of the Associate Rector’s salary for the month of ${monthLabel} ${yearLabel} as detailed in the attached copy of the St. Edmund’s—SENS Joint Ledger.`
);

const resolveFundABodyText = ({ rawText = '', monthLabel, yearLabel }) => {
    const tokenValue = `${monthLabel} ${yearLabel}`.trim();
    const source = String(rawText || '').trim();
    const withDefault = source || buildDefaultFundABodyText({ monthLabel, yearLabel });
    return withDefault.replace(/\[\[\s*MONTH\s+YEAR\s*\]\]/gi, tokenValue);
};

export async function prepareVestryCertificate(payload) {
    const rawFund = String(payload?.fund || '').toLowerCase();
    const normalizedFund = rawFund.replace(/[^a-z]/g, '');
    if (!['funda', 'fundb', 'fidelity'].includes(normalizedFund)) {
        const error = new Error('Unknown fund selected.');
        error.status = 400;
        throw error;
    }

    const meetingDate = new Date(payload?.meetingDate || '');
    if (Number.isNaN(meetingDate.getTime())) {
        const error = new Error('A valid meeting date is required.');
        error.status = 400;
        throw error;
    }

    const isQuarterly = payload?.quarterly === true;

    const amounts = payload?.amounts || {};
    const monthlyAmount = String(amounts?.monthly || '');
    const interestAmount = String(amounts?.interest || '');

    const templatePath = resolveCertificateTemplatePath(normalizedFund, isQuarterly);
    if (!templatePath) {
        const error = new Error('Certificate template is not available.');
        error.status = 400;
        throw error;
    }
    await access(templatePath);

    const coveredMonthDate = addMonths(meetingDate, -1);
    const monthLabel = format(coveredMonthDate, 'MMMM');
    const yearLabel = format(coveredMonthDate, 'yyyy');
    const meetingLabel = format(meetingDate, 'MMMM d, yyyy');
    const quarterWord = getQuarterWord(meetingDate);
    const quarterLabels = getQuarterMonthLabels(meetingDate);
    const clerkName = findVestryClerkName();

    const totalValue = normalizedFund === 'fidelity'
        ? sumCurrencyValues(interestAmount)
        : sumCurrencyValues(monthlyAmount, interestAmount);

    const data = {
        MTG_DATE: meetingLabel,
        AMT_TOTAL: totalValue,
        AMT: totalValue,
        AMT_JL: normalizedFund === 'fundb' ? formatCurrencyValue(monthlyAmount) : '',
        AMT_INT: formatCurrencyValue(interestAmount),
        AMT_AR: normalizedFund === 'funda' ? formatCurrencyValue(monthlyAmount) : '',
        MONTH: monthLabel,
        YEAR: yearLabel,
        QUARTER: quarterWord,
        QTR_START: quarterLabels.start,
        QTR_END: quarterLabels.end,
        CLERK: clerkName,
        CLERK_NAME: clerkName
    };

    const outputPrefix = normalizedFund === 'fidelity'
        ? 'CERTIFICATE FOR TRANSFER--'
        : 'CERTIFICATE FOR REIMBURSEMENT--';
    const outputName = `${outputPrefix}${monthLabel} ${yearLabel}.docx`;
    const outputDir = resolveCertificateOutputDir(normalizedFund, yearLabel);

    let templateInput = templatePath;
    if (normalizedFund === 'funda') {
        data.FUND_A_BODY_TEXT = resolveFundABodyText({
            rawText: payload?.fundAText || '',
            monthLabel,
            yearLabel
        });
        templateInput = await injectFundABodyPlaceholder(templatePath);
    }

    return {
        data,
        templatePath,
        templateInput,
        outputName,
        outputDir
    };
}

export async function convertDocxBufferToPreviewBase64(docBuffer) {
    const outputDir = join(tmpdir(), `vestry-certificate-preview-${randomUUID()}`);
    const docxPath = join(outputDir, 'certificate-preview.docx');
    await mkdir(outputDir, { recursive: true });
    try {
        await writeFile(docxPath, docBuffer);
        const previewDataUrl = await buildDocumentPreview(docxPath, { force: true });
        if (!previewDataUrl) {
            throw new Error('Preview image could not be generated.');
        }
        const match = previewDataUrl.match(/^data:image\/png;base64,(.+)$/i);
        if (!match) {
            throw new Error('Preview image could not be generated.');
        }
        return match[1];
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => { });
    }
}

export async function printDocxBuffer(docBuffer) {
    const scriptPath = resolve(__dirname, '..', 'Print-WordToPrinter.ps1');
    await access(scriptPath);
    const printerName = await getDefaultPrinterName();
    const outputDir = join(tmpdir(), `vestry-certificate-print-${randomUUID()}`);
    const docxPath = join(outputDir, 'vestry-certificate.docx');
    await mkdir(outputDir, { recursive: true });
    try {
        await writeFile(docxPath, docBuffer);
        const escapedPath = docxPath.replace(/'/g, "''");
        const escapedPrinter = printerName.replace(/'/g, "''");
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        await execFileAsync('powershell', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-DocxPath',
            escapedPath,
            '-PrinterName',
            escapedPrinter
        ], { windowsHide: true });
    } finally {
        await rm(outputDir, { recursive: true, force: true }).catch(() => { });
    }
}
