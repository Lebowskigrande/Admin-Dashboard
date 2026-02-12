import { join, dirname, resolve, basename, extname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { mkdir, readFile, writeFile, rm, access, copyFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { addMonths, format } from 'date-fns';
import { sqlite as db } from '../db.js';
import { tableExists } from './db-utils.js';
import { normalizePersonRoles } from './people-utils.js';
import { parseJsonField } from './db-utils.js';
import {
    parseCurrencyOverride,
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
        await execFileAsync('soffice', [
            '--headless',
            '--convert-to',
            'pdf',
            '--outdir',
            outputDir,
            filePath
        ]);
        const baseName = originalExt ? basename(originalName, originalExt) : basename(filePath);
        const outputPath = join(outputDir, `${baseName}.pdf`);
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

export const resolveCertificateTemplatePath = (fundKey, isQuarterly) => {
    if (fundKey === 'fidelity') {
        return join(CERTIFICATE_TEMPLATE_DIR, 'CERTIFICATE FOR TRANSFER-- Fidelity template.docx');
    }
    if (!isQuarterly) return '';
    const fundLabel = fundKey === 'funda' ? 'Fund A' : 'Fund B';
    return join(CERTIFICATE_TEMPLATE_DIR, `CERTIFICATE FOR REIMBURSEMENT-- ${fundLabel} template QTR.docx`);
};

export const resolveCertificateOutputDir = (fundKey, yearLabel) => {
    if (fundKey === 'fidelity') return FIDELITY_CERT_DIR;
    if (fundKey === 'funda') return FUND_A_CERT_DIR;
    return join(FUND_B_CERT_BASE_DIR, `Certificates Fund B ${yearLabel}`);
};

export const renderDocxTemplate = async (templatePath, data) => {
    const content = await readFile(templatePath, 'binary');
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
    if (!isQuarterly) {
        const error = new Error('Quarterly templates are not configured yet.');
        error.status = 400;
        throw error;
    }

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

    return {
        data,
        templatePath,
        outputName,
        outputDir
    };
}

export async function convertDocxBufferToPreviewBase64(docBuffer, outputName) {
    const sanitizeFileName = (value) => String(value || '').replace(/[<>:"/\\|?*]/g, '').trim();
    const baseName = sanitizeFileName(basename(outputName || 'certificate', extname(outputName || ''))) || 'certificate';
    const outputDir = join(tmpdir(), `vestry-certificate-preview-${randomUUID()}`);
    const docxPath = join(outputDir, `${baseName}.docx`);
    await mkdir(outputDir, { recursive: true });
    try {
        await writeFile(docxPath, docBuffer);
        const previewDataUrl = await buildDocumentPreview(docxPath);
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
