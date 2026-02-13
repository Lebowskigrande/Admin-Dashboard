import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { join, extname, dirname } from 'path';
import { mkdir, writeFile, rm, readFile, stat, copyFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { chromium } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { format as formatDate } from 'date-fns';

import { createOAuthClient, setStoredCredentials } from '../googleAuth.js';
import { getSharefileGmailTokens } from '../helpers/auth.js';
import { sqlite as db } from '../db.js';
import {
    extractGmailMessageText,
    sanitizeFileSegment,
    decodeGmailBody,
    collectGmailParts
} from '../helpers/hgk-utils.js';

const DEFAULT_ROOT = 'Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AR & Contributions\\james - temp test';
const PROCESSED_LABEL = 'ShareFile Routed';
const execFileAsync = promisify(execFile);
const DEFAULT_BASES = {
    budget: DEFAULT_ROOT,
    envelope: DEFAULT_ROOT
};

const getBaseDirectories = () => {
    const raw = process.env.SHAREFILE_ROUTER_BASES || '';
    if (!raw) return DEFAULT_BASES;
    try {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_BASES, ...parsed };
    } catch {
        // Fallback for .env values that contain unescaped Windows backslashes.
        // Example:
        // {"budget":"Y:\Folders\...\Test AP","envelope":"Y:\Folders\...\Test AR"}
        const extracted = {};
        const pattern = /"(budget|envelope)"\s*:\s*"([^"]*)"/gi;
        let match = pattern.exec(raw);
        while (match) {
            const key = String(match[1] || '').toLowerCase();
            const value = String(match[2] || '').trim();
            if (key && value) extracted[key] = value;
            match = pattern.exec(raw);
        }
        return Object.keys(extracted).length
            ? { ...DEFAULT_BASES, ...extracted }
            : DEFAULT_BASES;
    }
};

const ensureLabel = async (gmail, name) => {
    const listResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = Array.isArray(listResponse.data.labels) ? listResponse.data.labels : [];
    const existing = labels.find((label) => label.name === name);
    if (existing?.id) return existing.id;
    const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
        }
    });
    return created.data.id;
};

const getGmailClient = (tokens) => {
    const client = createOAuthClient();
    setStoredCredentials(client, tokens);
    return google.gmail({ version: 'v1', auth: client });
};

const collectAttachments = (part, collected = []) => {
    if (!part) return collected;
    if (part.filename && part.body?.attachmentId) {
        collected.push({
            filename: part.filename,
            attachmentId: part.body.attachmentId,
            mimeType: part.mimeType || ''
        });
    }
    if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => collectAttachments(child, collected));
    }
    return collected;
};

const parseEmailMetadata = (message) => {
    const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
    const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name)?.value || '';
    const subject = getHeader('subject');
    const from = getHeader('from');
    const date = getHeader('date');
    return { subject, from, date };
};

const decodeAttachmentData = (data) => {
    if (!data) return Buffer.from('');
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
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

const normalizeCurrencyAmount = (value) => {
    const raw = String(value || '').replace(/\$/g, '').replace(/,/g, '').trim();
    if (!raw) return '';
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return '';
    return parsed.toFixed(2);
};

const parseEmailHeaderTimestamp = (dateHeader, fallback = new Date()) => {
    const parsed = new Date(String(dateHeader || '').trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return fallback instanceof Date && !Number.isNaN(fallback.getTime()) ? fallback : new Date();
};

const getContributionSourceToken = (fromHeader) => {
    const from = String(fromHeader || '').toLowerCase();
    if (from.includes('office@saintedmunds.org') || from.includes('office@saintedmunds.com')) {
        return 'PayPal';
    }
    if (from.includes('bank of america') || from.includes('customerservice@ealerts.bankofamerica.com')) {
        return 'Zelle';
    }
    return '';
};

const extractDonorLastName = (donor) => {
    const cleaned = sanitizeContributionToken(donor, 'Unknown Donor');
    const compact = cleaned.replace(/\s+/g, ' ').trim();
    if (!compact) return 'Unknown Donor';
    const parts = compact.split(' ').filter(Boolean);
    if (parts.length === 0) return 'Unknown Donor';
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    while (parts.length > 1) {
        const tail = parts[parts.length - 1].replace(/\./g, '').toLowerCase();
        if (suffixes.has(tail)) {
            parts.pop();
            continue;
        }
        break;
    }
    return parts[parts.length - 1] || 'Unknown Donor';
};

const normalizeContributionText = (value) => String(value || '')
    .replace(/\r/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const formatContributionFilenameBase = ({ timestamp, donor, amount, sourceToken = '' }) => {
    const time = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
        ? timestamp
        : new Date();
    const datePart = formatDate(time, 'yyyy.MM.dd');
    const donorPart = sanitizeContributionToken(extractDonorLastName(donor), 'Unknown Donor').slice(0, 120);
    const sourcePart = sanitizeContributionToken(sourceToken, '');
    const amountPart = normalizeCurrencyAmount(amount) || 'Unknown Amount';
    const parts = [datePart, sourcePart, donorPart, amountPart].filter(Boolean);
    return parts.join(' ');
};

const buildNoteText = (_metadata, extra = {}) => {
    if (String(extra?.routeKind || '').toUpperCase() === 'CONTRIBUTION') {
        const envelopeNumber = sanitizeContributionToken(
            extra?.envelopeNumber || extra?.codeValue,
            'Unknown envelope'
        );
        const designation = sanitizeContributionToken(extra?.designation, 'Unknown designation');
        return `Envelope: ${envelopeNumber} | Designation: ${designation}`;
    }

    const code = String(extra?.codeValue || '').trim() || 'unknown';
    const timestamp = extra?.clientTs ? new Date(extra.clientTs) : new Date();
    const date = timestamp.toLocaleDateString();
    const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Budget code: ${code}. Approved by James Clark on ${date} at ${time}.`;
};

const normalizeRouteKind = (value) => {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'DB') return 'DB';
    if (upper === 'CONTRIBUTION') return 'CONTRIBUTION';
    return 'BILL';
};

const isContributionEmail = (metadata, bodyText) => {
    const from = String(metadata?.from || '').toLowerCase();
    const body = String(bodyText || '').toLowerCase();
    if (from.includes('office@saintedmunds.com')) return true;
    if (from.includes('bank of america') || from.includes('customerservice@ealerts.bankofamerica.com')) return true;
    if (body.includes('i would like my donation to be allocated to')) return true;
    if (body.includes('sent you $') && body.includes('view your balance')) return true;
    return false;
};

const ensureUniquePath = async (dir, filename) => {
    const base = filename.replace(/\.pdf$/i, '');
    const ext = '.pdf';
    let candidate = `${base}${ext}`;
    let counter = 2;
    while (true) {
        try {
            await access(join(dir, candidate));
            candidate = `${base}-${counter}${ext}`;
            counter += 1;
        } catch {
            return { filename: candidate, targetPath: join(dir, candidate) };
        }
    }
};

const buildInvoiceFilename = async ({
    kind,
    timestamp,
    targetDir,
    donor,
    amount,
    sourceToken
}) => {
    const time = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
        ? timestamp
        : new Date();
    let baseName = '';

    if (String(kind || '').toUpperCase() === 'CONTRIBUTION') {
        baseName = formatContributionFilenameBase({ timestamp: time, donor, amount, sourceToken });
    } else {
        const yearMonth = formatDate(time, 'yyyy.MM');
        const hhmmss = formatDate(time, 'HHmmss');
        baseName = `${yearMonth} SEEC ${kind} ${hhmmss}`;
    }

    return ensureUniquePath(targetDir, baseName);
};

const parseDisplayNameFromFromHeader = (fromHeader) => {
    const raw = String(fromHeader || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(.*?)\s*<[^>]+>\s*$/);
    if (match?.[1]) return match[1].trim().replace(/^"|"$/g, '');
    if (!raw.includes('@')) return raw.replace(/^"|"$/g, '');
    return '';
};

const normalizePersonName = (value) => String(value || '')
    .toLowerCase()
    .replace(/['".,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const extractEnvelopeFromTags = (tagsValue) => {
    const tags = String(tagsValue || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const envTag = tags.find((tag) => /^env-\d+/i.test(tag));
    if (!envTag) return '';
    return envTag.replace(/^env-/i, '').trim();
};

const lookupEnvelopeNumberByDonorName = (donorName) => {
    const normalizedDonor = normalizePersonName(donorName);
    if (!normalizedDonor) return '';

    const rows = db.prepare(`
        SELECT display_name, tags
        FROM people
        WHERE tags IS NOT NULL
          AND tags <> ''
    `).all();

    for (const row of rows) {
        const normalizedDisplay = normalizePersonName(row.display_name || '');
        if (!normalizedDisplay) continue;
        if (normalizedDisplay === normalizedDonor) {
            return extractEnvelopeFromTags(row.tags);
        }
    }

    for (const row of rows) {
        const normalizedDisplay = normalizePersonName(row.display_name || '');
        if (!normalizedDisplay) continue;
        if (normalizedDisplay.includes(normalizedDonor) || normalizedDonor.includes(normalizedDisplay)) {
            const envelope = extractEnvelopeFromTags(row.tags);
            if (envelope) return envelope;
        }
    }

    const donorLast = normalizedDonor.split(' ').filter(Boolean).at(-1) || '';
    if (!donorLast) return '';
    for (const row of rows) {
        const normalizedDisplay = normalizePersonName(row.display_name || '');
        if (!normalizedDisplay) continue;
        const displayLast = normalizedDisplay.split(' ').filter(Boolean).at(-1) || '';
        if (displayLast && displayLast === donorLast) {
            const envelope = extractEnvelopeFromTags(row.tags);
            if (envelope) return envelope;
        }
    }

    return '';
};

const parseNameFromContributionPatterns = (text) => {
    const full = String(text || '');
    if (!full) return '';

    const patterns = [
        /contributor\s*[:\-]?\s*([A-Za-z][A-Za-z'.,\- ]{1,120})/i,
        /you received\s+\$[0-9,]+(?:\.[0-9]{2})?\s+from\s+([A-Za-z][A-Za-z'.,\- ]{1,120})/i,
        /([A-Za-z][A-Za-z'.,\- ]{1,120})\s+sent you\s+\$[0-9,]+(?:\.[0-9]{2})?/i
    ];

    for (const regex of patterns) {
        const match = full.match(regex);
        if (match?.[1]) {
            return match[1].replace(/\s+/g, ' ').trim();
        }
    }

    return '';
};

const normalizeContributionDesignation = (value, fallback = 'Unknown designation') => {
    const raw = compactWhitespace(value);
    if (!raw) return fallback;
    const pledgeMatch = raw.match(/^(\d{4})\s+pledge(?:\s+payment)?$/i);
    if (pledgeMatch?.[1]) return `${pledgeMatch[1]} pledge`;
    return raw;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractLabeledBlockFirstLine = (text, label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
        `(?:^|\\n)\\s*${escapedLabel}\\s*:\\s*(?:\\n+)?([\\s\\S]*?)(?=\\n\\s*[A-Za-z][A-Za-z0-9 /&()#,'-]{1,80}:\\s*(?:\\n|$)|\\n\\s*Order\\b|\\n\\s*Product\\b|\\n\\s*Sub\\s*Total\\b|$)`,
        'i'
    );
    const match = String(text || '').match(regex);
    if (!match?.[1]) return '';
    const firstLine = match[1]
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
    return firstLine || '';
};

const extractInlineLabelValue = (text, label, nextLabels = []) => {
    const escapedLabel = escapeRegex(label);
    const next = nextLabels
        .map((item) => escapeRegex(item))
        .join('|');
    const boundary = next ? `(?=\\s+(?:${next})\\s*:|$)` : `(?=$)`;
    const regex = new RegExp(`\\b${escapedLabel}\\s*:\\s*([\\s\\S]*?)${boundary}`, 'i');
    const match = String(text || '').match(regex);
    return compactWhitespace(match?.[1] || '');
};

const parseBofAContributionPattern = (text) => {
    const match = String(text || '').match(
        /(?:^|\s)\s*([A-Za-z][A-Za-z'., -]{1,120})\s+sent you\s+\$([0-9,]+(?:\.[0-9]{2})?)\s*([\s\S]*?)(?=\s*View your balance\b)/i
    );
    if (!match?.[1]) return null;
    const donor = compactWhitespace(match[1]);
    const amount = normalizeCurrencyAmount(match[2]);
    const between = String(match[3] || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
    const blockedDesignation = /^(?:view your balance|please allow up to)/i;
    const designation = blockedDesignation.test(between)
        ? 'NPO'
        : normalizeContributionDesignation(between, 'NPO');
    return {
        donor: donor || '',
        designation,
        amount
    };
};

const parseContributionFields = ({ metadata, bodyText, envelopeFallback }) => {
    const text = normalizeContributionText(bodyText);
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const findLabeledValue = (patterns) => {
        for (const line of lines) {
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match?.[1]) return match[1].trim();
            }
        }
        return '';
    };

    const namedDonor =
        extractLabeledBlockFirstLine(text, 'Name')
        || extractInlineLabelValue(text, 'Name', ['Address', 'Email', 'I would like my donation to be allocated to', 'Order', 'Product']);

    const allocationDesignation =
        extractLabeledBlockFirstLine(text, 'I would like my donation to be allocated to')
        || extractInlineLabelValue(text, 'I would like my donation to be allocated to', ['Order', 'Product', 'Sub Total', 'Address', 'Email']);
    const bofa = parseBofAContributionPattern(text);

    const extractWebsiteAmount = () => {
        const subtotalMatch = text.match(/Sub\s*Total\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
        if (subtotalMatch?.[1]) return normalizeCurrencyAmount(subtotalMatch[1]);
        const donationIndex = lines.findIndex((line) => /^Donation Amount\s*:?\s*$/i.test(line) || /^Donation Amount\s*:/i.test(line));
        if (donationIndex >= 0) {
            const nearby = lines.slice(donationIndex, donationIndex + 10).join('\n');
            const amountMatches = [...nearby.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)/g)];
            const last = amountMatches.at(-1)?.[1] || '';
            return normalizeCurrencyAmount(last);
        }
        const allAmounts = [...text.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)/g)];
        return normalizeCurrencyAmount(allAmounts.at(-1)?.[1] || '');
    };

    const donor =
        namedDonor ||
        findLabeledValue([
            /^donor\s*[:\-]\s*(.+)$/i,
            /^name\s*[:\-]\s*(.+)$/i,
            /^contributor\s*[:\-]?\s*(.+)$/i
        ]) ||
        parseNameFromContributionPatterns(text) ||
        (bofa?.donor || '') ||
        'Unknown donor';

    const designation = normalizeContributionDesignation(
        allocationDesignation ||
        findLabeledValue([
            /^designation\s*[:\-]\s*(.+)$/i,
            /^fund\s*[:\-]\s*(.+)$/i,
            /^purpose\s*[:\-]\s*(.+)$/i,
            /^i would like my donation to be allocated to:\s*(.+)$/i
        ]) ||
        (bofa?.designation || ''),
        bofa ? 'NPO' : 'Unknown designation'
    );

    const envelopeNumber =
        findLabeledValue([
            /^envelope(?:\s*number|\s*#)?\s*[:\-]\s*([A-Za-z0-9-]+)$/i,
            /^env(?:elope)?(?:\s*#|\s*number)?\s*[:\-]\s*([A-Za-z0-9-]+)$/i
        ]) ||
        String(envelopeFallback || '').trim() ||
        lookupEnvelopeNumberByDonorName(donor) ||
        'Unknown envelope';

    const amount = bofa?.amount || extractWebsiteAmount() || '';

    return { donor, designation, envelopeNumber, amount };
};

export const __TEST__ = {
    parseContributionFields,
    buildNoteText,
    formatContributionFilenameBase,
    isContributionEmail,
    getContributionSourceToken,
    extractDonorLastName
};

const renderEmailToPdf = async (metadata, bodyText) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage();
    let { width, height } = page.getSize();
    const margin = 50;
    const lineHeight = 14;
    let cursorY = height - margin;

    const title = metadata?.subject || 'Email';
    page.drawText(title, { x: margin, y: cursorY, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
    cursorY -= lineHeight * 2;

    const lines = String(bodyText || '').split(/\r?\n/);
    lines.forEach((line) => {
        if (cursorY < margin) {
            page = doc.addPage();
            ({ width, height } = page.getSize());
            cursorY = height - margin;
        }
        page.drawText(line, { x: margin, y: cursorY, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
        cursorY -= lineHeight;
    });

    return doc.save();
};

const extractGmailMessageHtml = (message) => {
    const payload = message?.payload;
    if (!payload) return '';
    const htmlParts = collectGmailParts(payload, 'text/html');
    if (htmlParts.length > 0) {
        return htmlParts.map(decodeGmailBody).join('\n');
    }
    return '';
};

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildEmailHtml = (metadata, htmlBody, fallbackText) => {
    const subject = escapeHtml(metadata?.subject || 'Email');
    const from = escapeHtml(metadata?.from || '');
    const date = escapeHtml(metadata?.date || '');
    const body = htmlBody
        ? htmlBody
        : `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(fallbackText || '')}</pre>`;
    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${subject}</title>
            <style>
                body { font-family: "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 32px; }
                .header { border-bottom: 1px solid #d9dee2; padding-bottom: 12px; margin-bottom: 16px; }
                .subject { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
                .meta { font-size: 12px; color: #5b6770; }
                .meta span { display: block; margin-top: 2px; }
                .body { font-size: 13px; line-height: 1.45; }
                img { max-width: 100%; height: auto; }
                table { border-collapse: collapse; max-width: 100%; }
                td, th { border: 1px solid #e1e6ea; padding: 6px 8px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="subject">${subject}</div>
                <div class="meta">
                    ${from ? `<span><strong>From:</strong> ${from}</span>` : ''}
                    ${date ? `<span><strong>Date:</strong> ${date}</span>` : ''}
                </div>
            </div>
            <div class="body">${body}</div>
        </body>
        </html>
    `;
};

const renderEmailHtmlToPdf = async (html) => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        if (typeof page.emulateMediaType === 'function') {
            await page.emulateMediaType('screen');
        } else if (typeof page.emulateMedia === 'function') {
            await page.emulateMedia({ media: 'screen' });
        }
        const pdfBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' }
        });
        return pdfBuffer;
    } finally {
        await browser.close();
    }
};

const addNoteToPdf = async (pdfBytes, noteText) => {
    const doc = await PDFDocument.load(pdfBytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const margin = 36;
    pages.forEach((page) => {
        const { width } = page.getSize();
        page.drawText(noteText, {
            x: margin,
            y: margin,
            size: 9,
            font,
            color: rgb(0.2, 0.2, 0.2),
            maxWidth: width - margin * 2
        });
    });
    const page = pages[0] || doc.addPage();
    const annotation = doc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: [margin, margin, margin + 1, margin + 1],
        Contents: PDFString.of(noteText),
        Name: PDFName.of('Comment'),
        Open: false
    });
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
        annots.push(annotation);
    } else {
        page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
    }
    return doc.save();
};

const moveFileSafe = async (sourcePath, targetPath) => {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath);
};

const convertToPdfIfNeeded = async (sourcePath, outDir) => {
    const ext = extname(sourcePath).toLowerCase();
    if (ext === '.pdf') return sourcePath;
    const soffice = 'soffice';
    try {
        await execFileAsync(soffice, [
            '--headless',
            '--convert-to',
            'pdf',
            '--outdir',
            outDir,
            sourcePath
        ], { windowsHide: true });
        const candidate = sourcePath.replace(ext, '.pdf');
        const exists = await stat(candidate).then(() => true).catch(() => false);
        if (exists) return candidate;
    } catch {
        // fall through to placeholder
    }
    const placeholder = await PDFDocument.create();
    const font = await placeholder.embedFont(StandardFonts.Helvetica);
    const page = placeholder.addPage();
    page.drawText('Attachment conversion placeholder', { x: 50, y: 700, size: 14, font });
    page.drawText(`Original file: ${sourcePath}`, { x: 50, y: 680, size: 10, font });
    const placeholderBytes = await placeholder.save();
    const targetPath = join(outDir, `${sanitizeFileSegment(sourcePath)}.pdf`);
    await writeFile(targetPath, placeholderBytes);
    return targetPath;
};

const buildTargetDir = ({ codeType }) => {
    const bases = getBaseDirectories();
    return bases[codeType] || DEFAULT_ROOT;
};

const getSharefileJob = (messageId, codeType, codeValue) => {
    if (!messageId) return null;
    return db.prepare(`
        SELECT * FROM sharefile_jobs
        WHERE message_id = ? AND code_type = ? AND code_value = ?
        LIMIT 1
    `).get(messageId, codeType || '', codeValue || '');
};

const saveSharefileJob = ({ messageId, threadId, codeType, codeValue, output }) => {
    const now = new Date().toISOString();
    const id = `job-${randomUUID()}`;
    db.prepare(`
        INSERT INTO sharefile_jobs (id, message_id, thread_id, code_type, code_value, output_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        id,
        messageId,
        threadId || null,
        codeType || '',
        codeValue || '',
        JSON.stringify(output || {}),
        now
    );
    return { id, created_at: now };
};

export const recordSharefileRoutingEvent = ({
    jobId = null,
    messageId = null,
    threadId = null,
    codeType = '',
    codeValue = '',
    status = 'success',
    errorText = '',
    output = null
} = {}) => {
    try {
        const id = `job-event-${randomUUID()}`;
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO sharefile_job_events (
                id, job_id, message_id, thread_id, code_type, code_value, status, error_text, output_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            jobId || null,
            messageId || null,
            threadId || null,
            codeType || '',
            codeValue || '',
            status || 'success',
            errorText || '',
            output ? JSON.stringify(output) : null,
            now
        );
        return { id, created_at: now };
    } catch (error) {
        console.warn('Failed to record sharefile routing event:', error);
        return null;
    }
};

export const routeShareFileEmails = async ({
    rootPath = DEFAULT_ROOT,
    archive = true
} = {}) => {
    const tokens = getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }

    const client = createOAuthClient();
    setStoredCredentials(client, tokens);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const labelId = await ensureLabel(gmail, PROCESSED_LABEL);

    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: `label:inbox -label:"${PROCESSED_LABEL}"`
    });
    const messages = Array.isArray(listResponse.data.messages) ? listResponse.data.messages : [];
    if (messages.length === 0) return { processed: 0 };

    await mkdir(rootPath, { recursive: true });
    let processed = 0;

    for (const entry of messages) {
        const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: entry.id,
            format: 'full'
        });
        const message = messageResponse.data;
        const metadata = parseEmailMetadata(message);
        const bodyText = extractGmailMessageText(message) || message.snippet || '';
        const routeKind = isContributionEmail(metadata, bodyText) ? 'CONTRIBUTION' : 'BILL';
        const contributionMeta = routeKind === 'CONTRIBUTION'
            ? parseContributionFields({ metadata, bodyText, envelopeFallback: '' })
            : null;
        const noteText = buildNoteText(metadata, {
            routeKind,
            donor: contributionMeta?.donor || '',
            envelopeNumber: contributionMeta?.envelopeNumber || '',
            designation: contributionMeta?.designation || '',
            amount: contributionMeta?.amount || ''
        });
        const attachments = collectAttachments(message.payload);
        const routingTimestamp = new Date(Number(message?.internalDate) || Date.now());
        const filenameTimestamp = routeKind === 'CONTRIBUTION'
            ? parseEmailHeaderTimestamp(metadata?.date, routingTimestamp)
            : routingTimestamp;
        const sourceToken = routeKind === 'CONTRIBUTION'
            ? getContributionSourceToken(metadata?.from)
            : '';

        const tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
        await mkdir(tempDir, { recursive: true });
        const outputs = [];

        try {
            if (attachments.length === 0) {
                const htmlBody = extractGmailMessageHtml(message);
                let pdfBytes;
                try {
                    const html = buildEmailHtml(metadata, htmlBody, bodyText);
                    pdfBytes = await renderEmailHtmlToPdf(html);
                } catch (error) {
                    console.warn('HTML email render failed, falling back to text PDF:', error);
                    pdfBytes = await renderEmailToPdf(metadata, bodyText);
                }
                const { filename, targetPath } = await buildInvoiceFilename({
                    kind: routeKind,
                    timestamp: filenameTimestamp,
                    targetDir: rootPath,
                    donor: contributionMeta?.donor || '',
                    amount: contributionMeta?.amount || '',
                    sourceToken
                });
                const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                const tempPath = join(tempDir, filename);
                await writeFile(tempPath, notedBytes);
                await moveFileSafe(tempPath, targetPath);
                outputs.push(targetPath);
            } else {
                let index = 0;
                for (const attachment of attachments) {
                    const attachmentResponse = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: entry.id,
                        id: attachment.attachmentId
                    });
                    const data = attachmentResponse.data?.data;
                    if (!data) continue;
                    const rawBytes = decodeAttachmentData(data);
                    const sourcePath = join(tempDir, attachment.filename || `attachment-${index}`);
                    await writeFile(sourcePath, rawBytes);
                    const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                    const pdfBytes = await readFile(pdfPath);
                    const { filename, targetPath } = await buildInvoiceFilename({
                        kind: routeKind,
                        timestamp: filenameTimestamp,
                        targetDir: rootPath,
                        donor: contributionMeta?.donor || '',
                        amount: contributionMeta?.amount || '',
                        sourceToken
                    });
                    const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                    const tempPath = join(tempDir, filename);
                    await writeFile(tempPath, notedBytes);
                    await moveFileSafe(tempPath, targetPath);
                    outputs.push(targetPath);
                    index += 1;
                }
            }

            const threadId = message.threadId || '';
            if (threadId) {
                await gmail.users.threads.modify({
                    userId: 'me',
                    id: threadId,
                    requestBody: {
                        addLabelIds: [labelId],
                        removeLabelIds: archive ? ['INBOX'] : []
                    }
                });
            } else {
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: entry.id,
                    requestBody: {
                        addLabelIds: [labelId],
                        removeLabelIds: archive ? ['INBOX'] : []
                    }
                });
            }
            processed += 1;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    return { processed };
};

export const resolveSharefileMessageId = async (threadId, tokensOverride = null) => {
    const tokens = tokensOverride || getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }
    if (!threadId) return null;
    const gmail = getGmailClient(tokens);
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
    const messages = Array.isArray(thread.data?.messages) ? thread.data.messages : [];
    if (messages.length === 0) return null;
    const latest = messages
        .slice()
        .sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
        .pop();
    return latest?.id || null;
};

export const routeSharefileMessage = async ({
    messageId,
    threadId,
    rootPath,
    archive = true,
    extraMeta = {},
    tokensOverride = null
} = {}) => {
    const tokens = tokensOverride || getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }
    if (!messageId && threadId) {
        messageId = await resolveSharefileMessageId(threadId, tokens);
    }
    if (!messageId) {
        throw new Error('Missing messageId');
    }

    const gmail = getGmailClient(tokens);
    const labelId = await ensureLabel(gmail, PROCESSED_LABEL);
    let effectiveMessageId = messageId;
    let message;
    try {
        const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: effectiveMessageId,
            format: 'full'
        });
        message = messageResponse.data;
    } catch (error) {
        const status = Number(error?.code || error?.response?.status || 0);
        const notFound = status === 404 || String(error?.message || '').includes('Requested entity was not found.');
        if (!notFound || !threadId) throw error;

        const resolvedMessageId = await resolveSharefileMessageId(threadId, tokens);
        if (!resolvedMessageId || resolvedMessageId === effectiveMessageId) throw error;

        const retryResponse = await gmail.users.messages.get({
            userId: 'me',
            id: resolvedMessageId,
            format: 'full'
        });
        effectiveMessageId = resolvedMessageId;
        message = retryResponse.data;
    }
    messageId = effectiveMessageId;
    const metadata = parseEmailMetadata(message);
    const bodyText = extractGmailMessageText(message) || message.snippet || '';
    const inferredRouteKind = isContributionEmail(metadata, bodyText) ? 'CONTRIBUTION' : 'BILL';
    const routeKind = normalizeRouteKind(extraMeta.routeKind || inferredRouteKind);
    const contributionMeta = routeKind === 'CONTRIBUTION'
        ? parseContributionFields({
            bodyText,
            envelopeFallback: extraMeta.codeValue
        })
        : null;
    const noteText = buildNoteText(metadata, {
        ...extraMeta,
        routeKind,
        donor: contributionMeta?.donor || '',
        envelopeNumber: contributionMeta?.envelopeNumber || '',
        designation: contributionMeta?.designation || '',
        amount: contributionMeta?.amount || ''
    });
    const attachments = collectAttachments(message.payload);
    const clientTsDate = extraMeta?.clientTs ? new Date(extraMeta.clientTs) : null;
    const routingTimestamp = clientTsDate && !Number.isNaN(clientTsDate.getTime())
        ? clientTsDate
        : new Date(Number(message?.internalDate) || Date.now());
    const filenameTimestamp = routeKind === 'CONTRIBUTION'
        ? parseEmailHeaderTimestamp(metadata?.date, routingTimestamp)
        : routingTimestamp;
    const sourceToken = routeKind === 'CONTRIBUTION'
        ? getContributionSourceToken(metadata?.from)
        : '';

    const resolvedRoot = rootPath || buildTargetDir({
        codeType: extraMeta.codeType,
        codeValue: extraMeta.codeValue,
        clientTs: extraMeta.clientTs
    });
    await mkdir(resolvedRoot, { recursive: true });
    const tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
        const existing = getSharefileJob(messageId, extraMeta.codeType, extraMeta.codeValue);
        if (existing) {
            const existingOutput = JSON.parse(existing.output_json || '{}');
            recordSharefileRoutingEvent({
                jobId: existing.id,
                messageId,
                threadId: threadId || message.threadId || null,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'success',
                output: existingOutput
            });
            return { ok: true, idempotent: true, output: existingOutput };
        }

        const outputFiles = [];
    if (attachments.length === 0) {
            const htmlBody = extractGmailMessageHtml(message);
            let pdfBytes;
            try {
                const html = buildEmailHtml(metadata, htmlBody, bodyText);
                pdfBytes = await renderEmailHtmlToPdf(html);
            } catch (error) {
                console.warn('HTML email render failed, falling back to text PDF:', error);
                pdfBytes = await renderEmailToPdf(metadata, bodyText);
            }
            const { filename, targetPath } = await buildInvoiceFilename({
                kind: routeKind,
                timestamp: filenameTimestamp,
                targetDir: resolvedRoot,
                donor: contributionMeta?.donor || '',
                amount: contributionMeta?.amount || '',
                sourceToken
            });
            const notedBytes = await addNoteToPdf(pdfBytes, noteText);
            const tempPath = join(tempDir, filename);
            await writeFile(tempPath, notedBytes);
            await moveFileSafe(tempPath, targetPath);
            outputFiles.push({ name: filename, bytes: notedBytes.length });
    } else {
            let index = 0;
            for (const attachment of attachments) {
                const attachmentResponse = await gmail.users.messages.attachments.get({
                    userId: 'me',
                    messageId,
                    id: attachment.attachmentId
                });
                const data = attachmentResponse.data?.data;
                if (!data) continue;
                const rawBytes = decodeAttachmentData(data);
                const sourcePath = join(tempDir, attachment.filename || `attachment-${index}`);
                await writeFile(sourcePath, rawBytes);
                const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                const pdfBytes = await readFile(pdfPath);
                const { filename, targetPath } = await buildInvoiceFilename({
                    kind: routeKind,
                    timestamp: filenameTimestamp,
                    targetDir: resolvedRoot,
                    donor: contributionMeta?.donor || '',
                    amount: contributionMeta?.amount || '',
                    sourceToken
                });
                const notedBytes = await addNoteToPdf(pdfBytes, noteText);
                const tempPath = join(tempDir, filename);
                await writeFile(tempPath, notedBytes);
                await moveFileSafe(tempPath, targetPath);
                outputFiles.push({ name: filename, bytes: notedBytes.length });
                index += 1;
            }
        }

        const thread = threadId || message.threadId;
        if (thread) {
            await gmail.users.threads.modify({
                userId: 'me',
                id: thread,
                requestBody: {
                    addLabelIds: [labelId],
                    removeLabelIds: archive ? ['INBOX'] : []
                }
            });
        } else {
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    addLabelIds: [labelId],
                    removeLabelIds: archive ? ['INBOX'] : []
                }
            });
        }
        const output = {
            targetDir: resolvedRoot,
            files: outputFiles
        };
        const job = saveSharefileJob({
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            output
        });
        recordSharefileRoutingEvent({
            jobId: job.id,
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'success',
            output
        });
        return { ok: true, jobId: job.id, resolved: { messageId, threadId: thread || null }, output };
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};
