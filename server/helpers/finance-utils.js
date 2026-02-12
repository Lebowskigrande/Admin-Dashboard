import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access, mkdir, writeFile, readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { degrees } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execFileAsync = promisify(execFile);

export const DEPOSIT_OUTPUT_DIR = resolve(__dirname, '../deposit-outputs');

export const saveDepositPdf = async (pdfBytes) => {
    await mkdir(DEPOSIT_OUTPUT_DIR, { recursive: true });
    const fileId = randomUUID();
    const fileName = `deposit-slip-${fileId}.pdf`;
    const filePath = join(DEPOSIT_OUTPUT_DIR, fileName);
    await writeFile(filePath, pdfBytes);
    return { fileId, filePath, fileName };
};

export const buildDepositFilePath = (fileId) => {
    return join(DEPOSIT_OUTPUT_DIR, `deposit-slip-${fileId}.pdf`);
};

export const parseCurrencyOverride = (value) => {
    if (value == null) return null;
    const normalized = String(value).trim().replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

export const formatCurrencyValue = (value) => {
    const parsed = parseCurrencyOverride(value);
    if (!Number.isFinite(parsed)) return '';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(parsed);
};

export const sumCurrencyValues = (...values) => {
    const total = values.reduce((acc, entry) => {
        const parsed = parseCurrencyOverride(entry);
        return Number.isFinite(parsed) ? acc + parsed : acc;
    }, 0);
    if (!Number.isFinite(total) || total === 0) return '';
    return formatCurrencyValue(total);
};

export const buildManualChecks = (payload, maxChecks) => {
    const manualChecks = [];
    let cashTotal = 0;
    (Array.isArray(payload) ? payload : []).forEach((entry) => {
        if (!entry) return;
        const checkNumber = String(entry.checkNumber || '').trim();
        const rawAmount = String(entry.amount || '').trim().replace(/[^0-9.-]/g, '');
        const amount = Number.parseFloat(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        if (checkNumber && manualChecks.length < maxChecks) {
            manualChecks.push({ checkNumber, amount });
        } else {
            cashTotal += amount;
        }
    });
    return { manualChecks, cashTotal };
};

export const parseJsonValue = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
};

export const normalizeFundsReportEntries = (value) => {
    const entries = Array.isArray(value) ? value : parseJsonValue(value, []);
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => {
            const code = String(entry?.code || '').trim();
            const amount = parseCurrencyOverride(entry?.amount);
            if (!code || amount == null) return null;
            return { code, amount };
        })
        .filter(Boolean)
        .sort((a, b) => a.code.localeCompare(b.code));
};

export async function getDefaultPrinterName() {
    const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true }).Name"
    ], { windowsHide: true });
    const name = String(stdout || '')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
    if (!name) {
        throw new Error('Default printer not found.');
    }
    return name;
}

export const resolveSumatraPdfPath = async () => {
    const override = String(process.env.SUMATRA_PDF_PATH || '').trim();
    const candidates = [
        override,
        'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
        'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try next candidate.
        }
    }
    return null;
};

export const addChecksGridFromPdf = async (pdfDoc, checksDoc, options = {}) => {
    const {
        pageWidth = 612,
        pageHeight = 792,
        margin = 36,
        columns = 2,
        rows = 3,
        colGap = 12,
        rowGap = 12
    } = options;
    if (!checksDoc) return;
    const pages = checksDoc.getPages();
    if (!pages.length) return;
    const perPage = columns * rows;
    const cellWidth = (pageWidth - margin * 2 - colGap * (columns - 1)) / columns;
    const cellHeight = (pageHeight - margin * 2 - rowGap * (rows - 1)) / rows;
    let pageIndex = 0;
    while (pageIndex < pages.length) {
        const gridPage = pdfDoc.addPage([pageWidth, pageHeight]);
        for (let slot = 0; slot < perPage && pageIndex < pages.length; slot += 1) {
            const column = slot % columns;
            const row = Math.floor(slot / columns);
            const targetX = margin + column * (cellWidth + colGap);
            const targetYTop = pageHeight - margin - row * (cellHeight + rowGap);
            const sourcePage = pages[pageIndex];
            const embedded = await pdfDoc.embedPage(sourcePage);
            const baseRotation = ((sourcePage.getRotation()?.angle || 0) % 360 + 360) % 360;
            const baseIsRotated = baseRotation === 90 || baseRotation === 270;
            const baseDisplayWidth = baseIsRotated ? embedded.height : embedded.width;
            const baseDisplayHeight = baseIsRotated ? embedded.width : embedded.height;
            const isPortrait = baseDisplayHeight > baseDisplayWidth;
            const rotation = (baseRotation + (isPortrait ? 180 : 0)) % 360;
            const isRotated = rotation === 90 || rotation === 270;
            const displayWidth = isRotated ? embedded.height : embedded.width;
            const displayHeight = isRotated ? embedded.width : embedded.height;
            const scale = Math.min(cellWidth / displayWidth, cellHeight / displayHeight, 1);
            const drawWidth = embedded.width * scale;
            const drawHeight = embedded.height * scale;
            const scaledDisplayWidth = displayWidth * scale;
            const scaledDisplayHeight = displayHeight * scale;
            const offsetX = targetX + (cellWidth - scaledDisplayWidth) / 2;
            const offsetY = targetYTop - scaledDisplayHeight - (cellHeight - scaledDisplayHeight) / 2;
            let drawX = offsetX;
            let drawY = offsetY;
            if (rotation === 90) {
                drawX = offsetX + scaledDisplayWidth;
            } else if (rotation === 180) {
                drawX = offsetX + scaledDisplayWidth;
                drawY = offsetY + scaledDisplayHeight;
            } else if (rotation === 270) {
                drawY = offsetY + scaledDisplayHeight;
            }
            gridPage.drawPage(embedded, {
                x: drawX,
                y: drawY,
                width: drawWidth,
                height: drawHeight,
                rotate: rotation ? degrees(rotation) : undefined
            });
            pageIndex += 1;
        }
    }
};

export const addCheckGridPages = async (pdfDoc, checks, options = {}) => {
    const {
        pageWidth = 612,
        pageHeight = 792,
        margin = 36,
        columns = 2,
        rows = 3,
        colGap = 12,
        rowGap = 12
    } = options;
    const perPage = columns * rows;
    if (!checks || checks.length === 0) return;
    let page = null;
    let drawn = 0;
    for (let index = 0; index < checks.length; index += 1) {
        const entry = checks[index];
        const base64 = entry?.alignedPreviewBase64;
        let imageBytes = null;
        if (base64) {
            imageBytes = Buffer.from(base64, 'base64');
        } else if (entry?.imagePath) {
            try {
                imageBytes = await readFile(entry.imagePath);
            } catch {
                imageBytes = null;
            }
        }
        if (!imageBytes) continue;
        if (drawn % perPage === 0) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
        }
        const position = drawn % perPage;
        const column = position % columns;
        const row = Math.floor(position / columns);
        const cellWidth = (pageWidth - margin * 2 - colGap * (columns - 1)) / columns;
        const cellHeight = (pageHeight - margin * 2 - rowGap * (rows - 1)) / rows;
        const targetX = margin + column * (cellWidth + colGap);
        const targetYTop = pageHeight - margin - row * (cellHeight + rowGap);
        const image = await pdfDoc.embedPng(imageBytes);
        const scaled = image.scale(Math.min(cellWidth / image.width, cellHeight / image.height, 1));
        const offsetX = targetX + (cellWidth - scaled.width) / 2;
        const offsetY = targetYTop - scaled.height;
        page.drawImage(image, {
            x: offsetX,
            y: offsetY,
            width: scaled.width,
            height: scaled.height
        });
        drawn += 1;
    }
};
