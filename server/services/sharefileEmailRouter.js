import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { join, extname, dirname, resolve, basename } from 'path';
import { mkdir, writeFile, rm, readFile, stat, copyFile, unlink, access, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { chromium } from 'playwright';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { format as formatDate } from 'date-fns';
import xlsx from 'xlsx';

import { createOAuthClient, setStoredCredentials } from '../googleAuth.js';
import { getSharefileGmailTokens } from '../helpers/auth.js';
import { sqlite as db } from '../db.js';
import { extractVendorFromPdfBytes, extractVendorFromPdfText } from './apVendorExtractor.js';
import {
    extractGmailMessageText,
    sanitizeFileSegment,
    decodeGmailBody,
    collectGmailParts
} from '../helpers/hgk-utils.js';
import {
    extractEnvelopeFromTags as extractEnvelopeFromTagsHelper,
    resolveContributionDesignation
} from '../helpers/pledger-utils.js';

const DEFAULT_LOCAL_BASES = {
    budget: 'C:\\Users\\Secretary\\Dropbox\\Parish Administrator\\Accounting\\Pending AP',
    envelope: 'C:\\Users\\Secretary\\Dropbox\\Parish Administrator\\Accounting\\Pending AR'
};
const DEFAULT_CANONICAL_BASES = {
    budget: 'Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AP & Expenses\\00 Karina (AP & Expenses)',
    envelope: 'Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AR & Contributions\\00 Karina (AR & Contributions)'
};
const PROCESSED_LABEL = 'ShareFile Routed';
const execFileAsync = promisify(execFile);

const parseBaseDirectories = (raw, defaults) => {
    if (!raw) return defaults;
    try {
        const parsed = JSON.parse(raw);
        return { ...defaults, ...parsed };
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
            ? { ...defaults, ...extracted }
            : defaults;
    }
};

const getLocalBaseDirectories = () => parseBaseDirectories(
    process.env.SHAREFILE_ROUTER_LOCAL_BASES || '',
    DEFAULT_LOCAL_BASES
);

const getCanonicalBaseDirectories = () => parseBaseDirectories(
    process.env.SHAREFILE_ROUTER_CANONICAL_BASES || process.env.SHAREFILE_ROUTER_BASES || '',
    DEFAULT_CANONICAL_BASES
);

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
const escapeGmailSearchPhrase = (value) => String(value || '').replace(/"/g, '\\"').trim();

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

const MONTH_INDEX = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
};

const parseHeaderCalendarDate = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;

    const monthDayYear = raw.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (monthDayYear) {
        const month = MONTH_INDEX[String(monthDayYear[1] || '').toLowerCase()];
        const day = Number(monthDayYear[2]);
        const year = Number(monthDayYear[3]);
        if (Number.isInteger(month) && Number.isFinite(day) && Number.isFinite(year)) {
            return new Date(year, month, day, 12, 0, 0, 0);
        }
    }

    const dayMonthYear = raw.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
    if (dayMonthYear) {
        const day = Number(dayMonthYear[1]);
        const month = MONTH_INDEX[String(dayMonthYear[2] || '').toLowerCase()];
        const year = Number(dayMonthYear[3]);
        if (Number.isInteger(month) && Number.isFinite(day) && Number.isFinite(year)) {
            return new Date(year, month, day, 12, 0, 0, 0);
        }
    }

    const isoDate = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoDate) {
        const year = Number(isoDate[1]);
        const month = Number(isoDate[2]) - 1;
        const day = Number(isoDate[3]);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
            return new Date(year, month, day, 12, 0, 0, 0);
        }
    }

    const usDate = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (usDate) {
        const month = Number(usDate[1]) - 1;
        const day = Number(usDate[2]);
        let year = Number(usDate[3]);
        if (year < 100) year += 2000;
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
            return new Date(year, month, day, 12, 0, 0, 0);
        }
    }

    return null;
};

const parseEmailHeaderTimestamp = (dateHeader, fallback = new Date()) => {
    const fromCalendar = parseHeaderCalendarDate(dateHeader);
    if (fromCalendar && !Number.isNaN(fromCalendar.getTime())) return fromCalendar;

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

const stripQuotePrefix = (line) => String(line || '').replace(/^\s*>+\s?/, '').trimEnd();

const extractForwardedContributionContext = (bodyText) => {
    const normalized = normalizeContributionText(bodyText);
    const markerRegex = /(?:^|\n)\s*(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*(?:\n|$)/ig;
    let marker = markerRegex.exec(normalized);
    let lastMarker = null;
    while (marker) {
        lastMarker = marker;
        marker = markerRegex.exec(normalized);
    }
    if (!lastMarker) {
        return {
            usedForwarded: false,
            metadata: {},
            bodyText: normalized
        };
    }

    const forwardedRaw = normalized.slice(lastMarker.index + lastMarker[0].length).trim();
    if (!forwardedRaw) {
        return {
            usedForwarded: false,
            metadata: {},
            bodyText: normalized
        };
    }

    const lines = forwardedRaw.split('\n').map(stripQuotePrefix);
    const header = {};
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) {
            bodyStart = i + 1;
            break;
        }
        const m = line.match(/^(from|date|subject|to)\s*:\s*(.+)$/i);
        if (m?.[1]) {
            header[m[1].toLowerCase()] = m[2].trim();
            bodyStart = i + 1;
            continue;
        }
        if (i > 6) {
            bodyStart = i;
            break;
        }
    }

    const forwardedBody = lines.slice(bodyStart).join('\n').trim() || forwardedRaw;
    return {
        usedForwarded: true,
        metadata: {
            from: header.from || '',
            date: header.date || '',
            subject: header.subject || ''
        },
        bodyText: forwardedBody
    };
};

const resolveContributionContext = (metadata, bodyText) => {
    const forwarded = extractForwardedContributionContext(bodyText);
    const resolvedMetadata = {
        ...metadata,
        from: forwarded.metadata.from || metadata?.from || '',
        date: forwarded.metadata.date || metadata?.date || '',
        subject: forwarded.metadata.subject || metadata?.subject || ''
    };
    return {
        metadata: resolvedMetadata,
        bodyText: forwarded.bodyText || normalizeContributionText(bodyText),
        usedForwarded: forwarded.usedForwarded
    };
};

const selectThreadMessageForRouting = (messages, { requireContribution = false } = {}) => {
    const ordered = (Array.isArray(messages) ? messages : [])
        .slice()
        .sort((a, b) => Number(a?.internalDate || 0) - Number(b?.internalDate || 0));
    if (ordered.length === 0) return null;
    if (!requireContribution) return ordered[ordered.length - 1];

    const firstContribution = ordered.find((msg) => {
        const metadata = parseEmailMetadata(msg);
        const bodyText = extractGmailMessageText(msg) || msg?.snippet || '';
        const context = resolveContributionContext(metadata, bodyText);
        return isContributionEmail(context.metadata, context.bodyText);
    });
    return firstContribution || ordered[0];
};

const sortMessagesByInternalDate = (messages) => (Array.isArray(messages) ? messages : [])
    .slice()
    .sort((a, b) => Number(a?.internalDate || 0) - Number(b?.internalDate || 0));

const isPdfAttachment = (attachment) => {
    const filename = String(attachment?.filename || '').toLowerCase();
    const mimeType = String(attachment?.mimeType || '').toLowerCase();
    if (filename.endsWith('.pdf')) return true;
    if (mimeType.includes('pdf')) return true;
    return false;
};

const collectThreadPdfAttachments = (messages) => {
    const ordered = sortMessagesByInternalDate(messages);
    const collected = [];
    const seen = new Set();
    for (const message of ordered) {
        const list = collectAttachments(message?.payload).filter(isPdfAttachment);
        for (const attachment of list) {
            const key = `${message?.id || ''}:${attachment?.attachmentId || ''}`;
            if (!attachment?.attachmentId || seen.has(key)) continue;
            seen.add(key);
            collected.push({
                messageId: String(message?.id || '').trim(),
                attachmentId: String(attachment.attachmentId || '').trim(),
                filename: attachment.filename || 'attachment.pdf'
            });
        }
    }
    return collected;
};

const buildConversationText = (messages) => {
    const ordered = sortMessagesByInternalDate(messages);
    if (ordered.length === 0) return '';
    return ordered.map((message, index) => {
        const metadata = parseEmailMetadata(message);
        const body = extractGmailMessageText(message) || message?.snippet || '';
        const headerLines = [
            `Message ${index + 1} of ${ordered.length}`,
            `From: ${metadata.from || ''}`,
            `Date: ${metadata.date || ''}`,
            `Subject: ${metadata.subject || ''}`
        ];
        return `${headerLines.join('\n')}\n\n${body}`;
    }).join('\n\n------------------------------------------------------------\n\n');
};

const formatContributionFilenameBase = ({ timestamp, donor, amount, sourceToken = '' }) => {
    const time = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
        ? timestamp
        : new Date();
    const datePart = formatDate(time, 'yyyy.MM.dd');
    const donorPart = sanitizeContributionToken(extractDonorLastName(donor), 'Unknown Donor').slice(0, 120);
    const sourcePart = sanitizeContributionToken(sourceToken, '');
    const normalizedAmount = normalizeCurrencyAmount(amount);
    const displayAmount = normalizedAmount
        ? (normalizedAmount.endsWith('.00') ? normalizedAmount.slice(0, -3) : normalizedAmount)
        : '';
    const amountPart = displayAmount ? `$${displayAmount}` : 'Unknown Amount';
    const parts = [datePart, sourcePart, donorPart, amountPart].filter(Boolean);
    return parts.join(' ');
};

const sanitizeApVendorToken = (value) => sanitizeContributionToken(value, '').slice(0, 120);

const resolveApVendor = async (pdfBytes, options = {}) => {
    try {
        const extracted = await extractVendorFromPdfBytes(pdfBytes, options);
        const vendor = sanitizeApVendorToken(extracted?.vendor || '');
        return {
            vendor,
            found: Boolean(vendor),
            confidence: Number(extracted?.confidence || 0) || 0
        };
    } catch {
        return { vendor: '', found: false, confidence: 0 };
    }
};

const resolveApVendorFromContext = (metadata, bodyText, conversationText = '') => {
    const text = [
        String(metadata?.from || ''),
        String(metadata?.subject || ''),
        String(bodyText || ''),
        String(conversationText || '')
    ].join('\n');
    const extracted = extractVendorFromPdfText(text);
    const vendor = sanitizeApVendorToken(extracted?.vendor || '');
    return {
        vendor,
        found: Boolean(vendor),
        confidence: Number(extracted?.confidence || 0) || 0
    };
};

const buildNoteText = (_metadata, extra = {}) => {
    if (String(extra?.routeKind || '').toUpperCase() === 'CONTRIBUTION') {
        const envelopeRaw = compactWhitespace(extra?.envelopeNumber || extra?.codeValue || '');
        const designation = sanitizeContributionToken(extra?.designation, 'Unknown designation');
        if (!envelopeRaw) {
            return `Designation: ${designation}`;
        }
        const envelopeNumber = sanitizeContributionToken(envelopeRaw, 'Unknown envelope');
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
    sourceToken,
    vendor = ''
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
        const vendorToken = sanitizeApVendorToken(vendor);
        baseName = `${yearMonth} SEEC ${kind} ${vendorToken || hhmmss}`;
    }

    return ensureUniquePath(targetDir, baseName);
};

const saveRoutedPdfOutput = async ({
    pdfBytes,
    sourcePdfPath = '',
    routeKind = 'BILL',
    filenameTimestamp,
    targetDir,
    donor = '',
    amount = '',
    sourceToken = '',
    noteText = '',
    tempDir = '',
    contextVendorFallback = '',
    apVendor = '',
    syncOutputToCanonical = null
} = {}) => {
    const isContributionRoute = String(routeKind || '').toUpperCase() === 'CONTRIBUTION';
    const vendorMeta = isContributionRoute
        ? { vendor: '' }
        : await resolveApVendor(pdfBytes, { sourcePdfPath });
    let nextApVendor = apVendor;
    if (!nextApVendor && vendorMeta.vendor) nextApVendor = vendorMeta.vendor;
    const { filename, targetPath } = await buildInvoiceFilename({
        kind: routeKind,
        timestamp: filenameTimestamp,
        targetDir,
        donor,
        amount,
        sourceToken,
        vendor: nextApVendor || vendorMeta.vendor || contextVendorFallback || ''
    });
    const notedBytes = await addNoteToPdf(pdfBytes, noteText);
    const tempPath = join(tempDir, filename);
    await writeFile(tempPath, notedBytes);
    await moveFileSafe(tempPath, targetPath);
    if (typeof syncOutputToCanonical === 'function') {
        await syncOutputToCanonical(targetPath);
    }
    return {
        apVendor: nextApVendor,
        file: {
            name: filename,
            path: targetPath,
            bytes: notedBytes.length
        },
        targetPath
    };
};

const normalizePersonName = (value) => String(value || '')
    .toLowerCase()
    .replace(/['".,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePersonToken = (value) => normalizePersonName(value)
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitNameTokens = (value) => normalizePersonToken(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const ENVELOPE_NAME_CONNECTORS = new Set([
    'and',
    '&',
    'the',
    'mr',
    'mrs',
    'ms',
    'dr'
]);
const PERSON_NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const getDonorFirstLast = (nameValue) => {
    const tokens = splitNameTokens(nameValue).filter((token) => !ENVELOPE_NAME_CONNECTORS.has(token));
    if (tokens.length === 0) return { first: '', last: '' };
    return {
        first: tokens[0] || '',
        last: tokens[tokens.length - 1] || ''
    };
};

const getComparableNameTokens = (value) => splitNameTokens(value)
    .filter((token) => !ENVELOPE_NAME_CONNECTORS.has(token))
    .filter((token) => !PERSON_NAME_SUFFIXES.has(token))
    .filter(Boolean);

const levenshteinDistance = (a, b) => {
    const left = String(a || '');
    const right = String(b || '');
    if (!left) return right.length;
    if (!right) return left.length;
    const dp = Array.from({ length: right.length + 1 }, (_, idx) => idx);
    for (let i = 1; i <= left.length; i += 1) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const nextPrev = dp[j];
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + cost
            );
            prev = nextPrev;
        }
    }
    return dp[right.length];
};

const computeNameSimilarity = (leftValue, rightValue) => {
    const left = normalizePersonToken(leftValue);
    const right = normalizePersonToken(rightValue);
    if (!left || !right) return 0;
    if (left === right) return 1;

    const leftTokens = getComparableNameTokens(left);
    const rightTokens = getComparableNameTokens(right);
    const leftLast = leftTokens.at(-1) || '';
    const rightLast = rightTokens.at(-1) || '';
    const leftFirst = leftTokens[0] || '';
    const rightFirst = rightTokens[0] || '';
    const lastMatches = Boolean(leftLast && rightLast && leftLast === rightLast);
    const firstMatches = Boolean(leftFirst && rightFirst && leftFirst === rightFirst);
    const firstInitialMatches = Boolean(
        leftFirst && rightFirst && leftFirst[0] === rightFirst[0]
    );

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    let intersection = 0;
    leftSet.forEach((token) => {
        if (rightSet.has(token)) intersection += 1;
    });
    const unionSize = Math.max(1, leftSet.size + rightSet.size - intersection);
    const tokenJaccard = intersection / unionSize;
    const contained = left.includes(right) || right.includes(left);
    const levDistance = levenshteinDistance(left, right);
    const maxLen = Math.max(left.length, right.length, 1);
    const levSimilarity = 1 - (levDistance / maxLen);

    let score = 0;
    if (lastMatches) score += 0.4;
    if (firstMatches) score += 0.28;
    else if (firstInitialMatches) score += 0.15;
    score += tokenJaccard * 0.2;
    score += Math.max(0, levSimilarity) * 0.12;
    if (contained) score += 0.08;
    return Math.max(0, Math.min(1, score));
};

const isSolidPersonMatch = ({ similarity = 0, donorName = '', displayName = '' } = {}) => {
    const donorTokens = getComparableNameTokens(donorName);
    const displayTokens = getComparableNameTokens(displayName);
    const donorLast = donorTokens.at(-1) || '';
    const displayLast = displayTokens.at(-1) || '';
    const donorFirst = donorTokens[0] || '';
    const displayFirst = displayTokens[0] || '';
    const lastMatches = Boolean(donorLast && displayLast && donorLast === displayLast);
    const firstMatches = Boolean(donorFirst && displayFirst && donorFirst === displayFirst);
    const firstInitialMatches = Boolean(donorFirst && displayFirst && donorFirst[0] === displayFirst[0]);
    if (similarity >= 0.97) return true;
    if (lastMatches && firstMatches && similarity >= 0.82) return true;
    if (
        lastMatches
        && firstInitialMatches
        && (donorFirst.length === 1 || displayFirst.length === 1)
        && similarity >= 0.66
    ) return true;
    if (lastMatches && firstInitialMatches && similarity >= 0.89) return true;
    return similarity >= 0.92;
};

const normalizeEnvelopeDirectoryName = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const envelopeDirectoryCache = {
    loaded: false,
    rows: []
};

const loadEnvelopeDirectoryRows = () => {
    if (envelopeDirectoryCache.loaded) return envelopeDirectoryCache.rows;
    envelopeDirectoryCache.loaded = true;
    try {
        const filePath = resolve(process.cwd(), 'envelope_numbers.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        envelopeDirectoryCache.rows = rows
            .map((row) => {
                const number = String(row[0] || '').trim();
                const rawName = normalizeEnvelopeDirectoryName(row[1] || '');
                if (!number || !rawName) return null;

                const normalized = normalizePersonToken(rawName);
                const commaIndex = rawName.indexOf(',');
                const lastName = commaIndex >= 0
                    ? splitNameTokens(rawName.slice(0, commaIndex)).at(-1) || ''
                    : splitNameTokens(rawName).at(-1) || '';
                const afterComma = commaIndex >= 0 ? rawName.slice(commaIndex + 1) : rawName;
                const firstCandidates = splitNameTokens(afterComma)
                    .filter((token) => !ENVELOPE_NAME_CONNECTORS.has(token));
                return {
                    number,
                    rawName,
                    normalized,
                    lastName,
                    firstCandidates
                };
            })
            .filter(Boolean);
    } catch {
        envelopeDirectoryCache.rows = [];
    }
    return envelopeDirectoryCache.rows;
};

const extractEnvelopeFromTags = (tagsValue) => {
    return extractEnvelopeFromTagsHelper(tagsValue);
};

const extractEnvelopeFromPersonRow = (row) => {
    const fromTags = extractEnvelopeFromTags(row?.tags);
    if (fromTags) return fromTags;
    return compactWhitespace(row?.envelope_number || '');
};

const lookupContributionDonorIdentity = (donorName, { requireEnvelope = false } = {}) => {
    const normalizedDonor = normalizePersonName(donorName);
    if (!normalizedDonor) return null;

    const rows = db.prepare(`
        SELECT id, display_name, envelope_number, tags
        FROM people
        WHERE display_name IS NOT NULL
          AND TRIM(display_name) <> ''
    `).all();

    let bestMatch = null;

    for (const row of rows) {
        const normalizedDisplay = normalizePersonName(row.display_name || '');
        if (!normalizedDisplay) continue;
        const envelope = extractEnvelopeFromPersonRow(row);
        if (requireEnvelope && !envelope) continue;
        if (normalizedDisplay === normalizedDonor) {
            return {
                personId: String(row.id || '').trim(),
                personName: compactWhitespace(row.display_name || ''),
                envelopeNumber: envelope || '',
                matchConfidence: 1
            };
        }
        const similarity = computeNameSimilarity(normalizedDonor, normalizedDisplay);
        if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = {
                row,
                similarity
            };
        }
    }

    if (bestMatch && isSolidPersonMatch({
        similarity: bestMatch.similarity,
        donorName,
        displayName: bestMatch.row?.display_name || ''
    })) {
        return {
            personId: String(bestMatch.row?.id || '').trim(),
            personName: compactWhitespace(bestMatch.row?.display_name || ''),
            envelopeNumber: extractEnvelopeFromPersonRow(bestMatch.row) || '',
            matchConfidence: Number(bestMatch.similarity.toFixed(3))
        };
    }

    return null;
};

const lookupEnvelopeNumberByDonorName = (donorName) => {
    const linkedPersonMatch = lookupContributionDonorIdentity(donorName, { requireEnvelope: false });
    const envelopePersonMatch = linkedPersonMatch?.envelopeNumber
        ? linkedPersonMatch
        : lookupContributionDonorIdentity(donorName, { requireEnvelope: true });
    if (envelopePersonMatch?.envelopeNumber) {
        return {
            envelopeNumber: envelopePersonMatch.envelopeNumber,
            personMatch: envelopePersonMatch
        };
    }

    const envelopeRows = loadEnvelopeDirectoryRows();
    if (envelopeRows.length === 0) {
        return {
            envelopeNumber: '',
            personMatch: linkedPersonMatch || null
        };
    }

    const donor = getDonorFirstLast(donorName);
    const donorNormalized = normalizePersonToken(donorName);
    if (!donorNormalized) {
        return {
            envelopeNumber: '',
            personMatch: linkedPersonMatch || null
        };
    }

    const exact = envelopeRows.find((row) => row.normalized === donorNormalized);
    if (exact) {
        return {
            envelopeNumber: exact.number,
            personMatch: linkedPersonMatch || null
        };
    }

    const contained = envelopeRows.find((row) => (
        row.normalized.includes(donorNormalized) || donorNormalized.includes(row.normalized)
    ));
    if (contained) {
        return {
            envelopeNumber: contained.number,
            personMatch: linkedPersonMatch || null
        };
    }

    if (donor.last) {
        const sameLast = envelopeRows.filter((row) => row.lastName === donor.last);
        if (donor.first) {
            const sameLastFirst = sameLast.find((row) => row.firstCandidates.includes(donor.first));
            if (sameLastFirst) {
                return {
                    envelopeNumber: sameLastFirst.number,
                    personMatch: linkedPersonMatch || null
                };
            }
        }
        if (sameLast.length === 1) {
            return {
                envelopeNumber: sameLast[0].number,
                personMatch: linkedPersonMatch || null
            };
        }
    }

    return {
        envelopeNumber: '',
        personMatch: linkedPersonMatch || null
    };
};

const parseNameFromContributionPatterns = (text) => {
    const full = String(text || '');
    if (!full) return '';

    const patterns = [
        /contributor\s*[:-]?\s*([A-Za-z][A-Za-z'., -]{1,120})/i,
        /you received\s+\$[0-9,]+(?:\.[0-9]{2})?\s+from\s+([A-Za-z][A-Za-z'., -]{1,120})/i,
        /([A-Za-z][A-Za-z'., -]{1,120})\s+sent you\s+\$[0-9,]+(?:\.[0-9]{2})?/i
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
    const raw = compactWhitespace(value)
        .split(/\b(?:begin forwarded message|forwarded message|from:|sent:|to:|subject:|on .+ wrote:)\b/i)[0]
        .trim();
    if (!raw) return fallback;
    const pledgeMatch = raw.match(/^(\d{4})\s+pledge(?:\s+payment)?$/i);
    if (pledgeMatch?.[1]) return `${pledgeMatch[1]} pledge`;
    const clipped = raw.slice(0, 120).trim();
    return clipped || fallback;
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

const parseContributionFields = ({ bodyText, envelopeFallback, designationFallback = '' }) => {
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
            /^donor\s*[:-]\s*(.+)$/i,
            /^name\s*[:-]\s*(.+)$/i,
            /^contributor\s*[:-]?\s*(.+)$/i
        ]) ||
        parseNameFromContributionPatterns(text) ||
        (bofa?.donor || '') ||
        'Unknown donor';

    const candidateDesignation = normalizeContributionDesignation(
        designationFallback ||
        allocationDesignation ||
        findLabeledValue([
            /^designation\s*[:-]\s*(.+)$/i,
            /^fund\s*[:-]\s*(.+)$/i,
            /^purpose\s*[:-]\s*(.+)$/i,
            /^i would like my donation to be allocated to:\s*(.+)$/i
        ]) ||
        (bofa?.designation || ''),
        bofa ? 'NPO' : 'Unknown designation'
    );

    const lookup = lookupEnvelopeNumberByDonorName(donor);
    const envelopeFromEmailOrLookup =
        findLabeledValue([
            /^envelope(?:\s*number|\s*#)?\s*[:-]\s*([A-Za-z0-9-]+)$/i,
            /^env(?:elope)?(?:\s*#|\s*number)?\s*[:-]\s*([A-Za-z0-9-]+)$/i
        ]) ||
        String(envelopeFallback || '').trim() ||
        lookup.envelopeNumber;

    const isRentDesignation = /\brent\b/i.test(String(candidateDesignation || ''));
    const envelopeNumber = envelopeFromEmailOrLookup || (isRentDesignation ? '' : 'Unknown envelope');
    const designation = resolveContributionDesignation({
        designation: candidateDesignation,
        envelopeNumber
    }).designation;

    const amount = bofa?.amount || extractWebsiteAmount() || '';

    return {
        donor,
        designation,
        envelopeNumber,
        amount,
        personId: lookup.personMatch?.personId || '',
        personName: lookup.personMatch?.personName || '',
        personMatchConfidence: lookup.personMatch?.matchConfidence || 0
    };
};

export const __TEST__ = {
    parseContributionFields,
    buildNoteText,
    formatContributionFilenameBase,
    isContributionEmail,
    getContributionSourceToken,
    extractDonorLastName,
    extractEnvelopeFromTags,
    resolveContributionContext,
    selectThreadMessageForRouting,
    parseEmailHeaderTimestamp,
    collectThreadPdfAttachments,
    buildConversationText
};

const renderEmailToPdf = async (metadata, bodyText) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage();
    let { height } = page.getSize();
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
            ({ height } = page.getSize());
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

const collectInlineCidParts = (part, collected = []) => {
    if (!part) return collected;
    const headers = Array.isArray(part.headers) ? part.headers : [];
    const cidHeader = headers.find((header) => String(header?.name || '').toLowerCase() === 'content-id');
    const contentIdRaw = String(cidHeader?.value || '').trim();
    const contentId = contentIdRaw
        .replace(/^cid:/i, '')
        .replace(/^<|>$/g, '')
        .trim();
    if (contentId && part.body?.attachmentId) {
        collected.push({
            attachmentId: part.body.attachmentId,
            contentId,
            mimeType: part.mimeType || 'application/octet-stream'
        });
    }
    if (Array.isArray(part.parts)) {
        part.parts.forEach((child) => collectInlineCidParts(child, collected));
    }
    return collected;
};

const resolveMessageHtmlForRender = async (gmail, message) => {
    const htmlBody = extractGmailMessageHtml(message);
    if (!htmlBody) {
        const textBody = extractGmailMessageText(message) || message?.snippet || '';
        return `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(textBody)}</pre>`;
    }

    if (!/cid:/i.test(htmlBody)) {
        return htmlBody;
    }

    const inlineParts = collectInlineCidParts(message?.payload);
    if (inlineParts.length === 0) {
        return htmlBody;
    }

    let resolvedHtml = htmlBody;
    for (const inlinePart of inlineParts) {
        try {
            const response = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: String(message?.id || '').trim(),
                id: inlinePart.attachmentId
            });
            const data = response.data?.data;
            if (!data) continue;
            const bytes = decodeAttachmentData(data);
            const mimeType = String(inlinePart.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
            const dataUri = `data:${mimeType};base64,${bytes.toString('base64')}`;
            const cid = escapeRegex(inlinePart.contentId);
            const cidPattern = new RegExp(`cid:\\s*<?${cid}>?`, 'gi');
            resolvedHtml = resolvedHtml.replace(cidPattern, dataUri);
        } catch (error) {
            console.warn('Failed to inline cid attachment for email PDF render:', error?.message || error);
        }
    }

    return resolvedHtml;
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

const buildConversationHtml = async (gmail, messages) => {
    const ordered = sortMessagesByInternalDate(messages);
    const sections = [];
    for (let index = 0; index < ordered.length; index += 1) {
        const message = ordered[index];
        const metadata = parseEmailMetadata(message);
        const htmlBody = await resolveMessageHtmlForRender(gmail, message);
        sections.push(`
            <section class="message-block">
                <div class="message-header">
                    <div class="message-index">Message ${index + 1} of ${ordered.length}</div>
                    <div class="message-meta">
                        ${metadata.from ? `<span><strong>From:</strong> ${escapeHtml(metadata.from)}</span>` : ''}
                        ${metadata.date ? `<span><strong>Date:</strong> ${escapeHtml(metadata.date)}</span>` : ''}
                        ${metadata.subject ? `<span><strong>Subject:</strong> ${escapeHtml(metadata.subject)}</span>` : ''}
                    </div>
                </div>
                <div class="message-body">${htmlBody}</div>
            </section>
        `);
    }

    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>Email conversation</title>
            <style>
                body { font-family: "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 24px; }
                .message-block { border: 1px solid #d9dee2; border-radius: 8px; margin-bottom: 18px; overflow: hidden; }
                .message-header { background: #f8fafc; border-bottom: 1px solid #d9dee2; padding: 10px 12px; }
                .message-index { font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px; }
                .message-meta { font-size: 12px; color: #475569; line-height: 1.45; }
                .message-meta span { display: block; }
                .message-body { padding: 12px; font-size: 13px; line-height: 1.45; }
                img { max-width: 100%; height: auto; }
                table { border-collapse: collapse; max-width: 100%; }
                td, th { border: 1px solid #e1e6ea; padding: 6px 8px; }
                pre { white-space: pre-wrap; }
            </style>
        </head>
        <body>
            ${sections.join('\n')}
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

const resolveOutputFilePath = (output, fileEntry) => {
    if (typeof fileEntry === 'string') {
        const raw = fileEntry.trim();
        if (!raw) return '';
        return raw;
    }
    if (!fileEntry || typeof fileEntry !== 'object') return '';
    const explicitPath = String(fileEntry.path || fileEntry.filePath || fileEntry.file_path || '').trim();
    if (explicitPath) return explicitPath;
    return '';
};

const hasExistingOutputFiles = async (output) => {
    const files = Array.isArray(output?.files) ? output.files : [];
    if (files.length === 0) return false;
    for (const fileEntry of files) {
        const resolvedPath = resolveOutputFilePath(output, fileEntry);
        if (!resolvedPath) continue;
        try {
            await access(resolvedPath);
            return true;
        } catch {
            // keep checking other outputs
        }
    }
    return false;
};

const listDirectoryFiles = async (dirPath) => {
    try {
        const names = await readdir(dirPath);
        const rows = await Promise.all(names.map(async (name) => {
            const fullPath = join(dirPath, name);
            try {
                const info = await stat(fullPath);
                if (!info.isFile()) return null;
                return {
                    name,
                    path: fullPath,
                    size: Number(info.size || 0),
                    mtimeMs: Number(info.mtimeMs || 0)
                };
            } catch {
                return null;
            }
        }));
        return rows.filter(Boolean);
    } catch {
        return [];
    }
};

const isSyncableFileName = (name) => String(name || '').toLowerCase().endsWith('.pdf');

const syncLocalMirrorFromCanonical = async (codeType) => {
    const localBases = getLocalBaseDirectories();
    const canonicalBases = getCanonicalBaseDirectories();
    const localDir = String(localBases?.[codeType] || '').trim();
    const canonicalDir = String(canonicalBases?.[codeType] || '').trim();
    if (!localDir || !canonicalDir) {
        return { ok: false, reason: 'missing-base-config' };
    }

    try {
        await mkdir(localDir, { recursive: true });
    } catch {
        return { ok: false, reason: 'local-dir-unavailable' };
    }

    try {
        const info = await stat(canonicalDir);
        if (!info?.isDirectory?.()) {
            return { ok: false, reason: 'canonical-dir-unavailable' };
        }
    } catch {
        return { ok: false, reason: 'canonical-dir-unavailable' };
    }

    const canonicalFiles = (await listDirectoryFiles(canonicalDir)).filter((file) => isSyncableFileName(file.name));

    const canonicalByName = new Map(canonicalFiles.map((file) => [String(file.name || '').toLowerCase(), file]));
    const localFiles = (await listDirectoryFiles(localDir)).filter((file) => isSyncableFileName(file.name));
    const localByName = new Map(localFiles.map((file) => [String(file.name || '').toLowerCase(), file]));

    let copied = 0;
    for (const canonicalFile of canonicalFiles) {
        const key = String(canonicalFile.name || '').toLowerCase();
        const localFile = localByName.get(key);
        const needsCopy = !localFile
            || Number(localFile.size || 0) !== Number(canonicalFile.size || 0)
            || Number(localFile.mtimeMs || 0) + 1000 < Number(canonicalFile.mtimeMs || 0);
        if (!needsCopy) continue;
        await copyFile(canonicalFile.path, join(localDir, canonicalFile.name));
        copied += 1;
    }

    let removed = 0;
    for (const localFile of localFiles) {
        const key = String(localFile.name || '').toLowerCase();
        if (canonicalByName.has(key)) continue;
        try {
            await unlink(localFile.path);
            removed += 1;
        } catch {
            // Ignore local deletion failures and continue.
        }
    }

    return { ok: true, copied, removed };
};

const publishLocalFileToCanonical = async ({ codeType, localPath }) => {
    const canonicalBases = getCanonicalBaseDirectories();
    const canonicalDir = String(canonicalBases?.[codeType] || '').trim();
    const normalizedLocalPath = String(localPath || '').trim();
    if (!canonicalDir || !normalizedLocalPath) {
        return { ok: false, reason: 'missing-base-config' };
    }
    try {
        await mkdir(canonicalDir, { recursive: true });
        const targetPath = join(canonicalDir, basename(normalizedLocalPath));
        await copyFile(normalizedLocalPath, targetPath);
        return { ok: true, canonicalPath: targetPath };
    } catch (error) {
        return { ok: false, reason: String(error?.message || 'canonical-publish-failed') };
    }
};

export const syncSharefileLocalMirrors = async ({ codeType = '' } = {}) => {
    const targetType = String(codeType || '').trim();
    if (targetType) {
        return { [targetType]: await syncLocalMirrorFromCanonical(targetType) };
    }
    const results = {};
    results.budget = await syncLocalMirrorFromCanonical('budget');
    results.envelope = await syncLocalMirrorFromCanonical('envelope');
    return results;
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
    const bases = getLocalBaseDirectories();
    return bases[codeType] || bases.budget || process.cwd();
};

const getSharefileJob = (messageId, codeType, codeValue) => {
    if (!messageId) return null;
    return db.prepare(`
        SELECT * FROM sharefile_jobs
        WHERE message_id = ? AND code_type = ? AND code_value = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `).get(messageId, codeType || '', codeValue || '');
};

const saveSharefileJob = ({ messageId, threadId, codeType, codeValue, output }) => {
    const now = new Date().toISOString();
    const id = `job-${randomUUID()}`;
    try {
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
    } catch (error) {
        const conflict = String(error?.message || '').toLowerCase().includes('unique');
        if (!conflict) throw error;
        const existing = getSharefileJob(messageId, codeType, codeValue);
        if (!existing?.id) throw error;
        db.prepare(`
            UPDATE sharefile_jobs
            SET thread_id = ?,
                output_json = ?
            WHERE id = ?
        `).run(
            threadId || null,
            JSON.stringify(output || {}),
            existing.id
        );
        return {
            id: existing.id,
            created_at: String(existing.created_at || now).trim() || now,
            updated: true
        };
    }
};

const saveOrUpdateSharefileJob = ({ existingJobId = '', messageId, threadId, codeType, codeValue, output }) => {
    const now = new Date().toISOString();
    const normalizedMessageId = String(messageId || '').trim();
    const normalizedCodeType = String(codeType || '').trim();
    const normalizedCodeValue = String(codeValue || '').trim();
    const normalizedExistingId = String(existingJobId || '').trim();
    if (normalizedExistingId) {
        const result = db.prepare(`
            UPDATE sharefile_jobs
            SET message_id = ?,
                thread_id = ?,
                code_type = ?,
                code_value = ?,
                output_json = ?
            WHERE id = ?
        `).run(
            normalizedMessageId || null,
            threadId || null,
            normalizedCodeType,
            normalizedCodeValue,
            JSON.stringify(output || {}),
            normalizedExistingId
        );
        if (result?.changes > 0) {
            const existingRow = db.prepare('SELECT created_at FROM sharefile_jobs WHERE id = ? LIMIT 1').get(normalizedExistingId);
            return { id: normalizedExistingId, created_at: String(existingRow?.created_at || now).trim() || now, updated: true };
        }
    }

    const existingByLogicalKey = getSharefileJob(normalizedMessageId, normalizedCodeType, normalizedCodeValue);
    if (existingByLogicalKey?.id) {
        db.prepare(`
            UPDATE sharefile_jobs
            SET thread_id = ?,
                output_json = ?
            WHERE id = ?
        `).run(
            threadId || null,
            JSON.stringify(output || {}),
            existingByLogicalKey.id
        );
        return {
            id: existingByLogicalKey.id,
            created_at: String(existingByLogicalKey.created_at || now).trim() || now,
            updated: true
        };
    }

    return saveSharefileJob({
        messageId: normalizedMessageId,
        threadId,
        codeType: normalizedCodeType,
        codeValue: normalizedCodeValue,
        output
    });
};

export const recordSharefileRoutingEvent = ({
    attemptId = '',
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
        const normalizedAttemptId = String(attemptId || '').trim();
        const normalizedMessageId = String(messageId || '').trim();
        const normalizedCodeType = String(codeType || '').trim();
        const normalizedCodeValue = String(codeValue || '').trim();
        const normalizedStatus = String(status || 'success').trim() || 'success';
        if (normalizedAttemptId) {
            const existing = db.prepare(`
                SELECT id, created_at
                FROM sharefile_job_events
                WHERE attempt_id = ?
                  AND message_id = ?
                  AND code_type = ?
                  AND code_value = ?
                  AND status = ?
                LIMIT 1
            `).get(
                normalizedAttemptId,
                normalizedMessageId || null,
                normalizedCodeType,
                normalizedCodeValue,
                normalizedStatus
            );
            if (existing?.id) {
                db.prepare(`
                    UPDATE sharefile_job_events
                    SET job_id = ?,
                        thread_id = ?,
                        error_text = ?,
                        output_json = ?
                    WHERE id = ?
                `).run(
                    jobId || null,
                    threadId || null,
                    errorText || '',
                    output ? JSON.stringify(output) : null,
                    existing.id
                );
                return {
                    id: existing.id,
                    created_at: String(existing.created_at || '').trim() || new Date().toISOString(),
                    deduped: true
                };
            }
        }
        const id = `job-event-${randomUUID()}`;
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO sharefile_job_events (
                id, attempt_id, job_id, message_id, thread_id, code_type, code_value, status, error_text, output_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            normalizedAttemptId || null,
            jobId || null,
            normalizedMessageId || null,
            threadId || null,
            normalizedCodeType,
            normalizedCodeValue,
            normalizedStatus,
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
    rootPath = '',
    archive = true,
    searchLabel = '',
    removeLabelOnSuccess = '',
    includeAlreadyProcessed = false,
    requireContribution = false
} = {}) => {
    const tokens = getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }

    const client = createOAuthClient();
    setStoredCredentials(client, tokens);
    const gmail = google.gmail({ version: 'v1', auth: client });
    const processedLabelId = await ensureLabel(gmail, PROCESSED_LABEL);
    const successCleanupLabel = String(removeLabelOnSuccess || '').trim();
    const successCleanupLabelId = successCleanupLabel
        ? await ensureLabel(gmail, successCleanupLabel)
        : null;

    const effectiveSearchLabel = String(searchLabel || '').trim();
    const queryTerms = [];
    if (effectiveSearchLabel) {
        queryTerms.push(`label:"${escapeGmailSearchPhrase(effectiveSearchLabel)}"`);
    } else {
        queryTerms.push('label:inbox');
    }
    if (!includeAlreadyProcessed) {
        queryTerms.push(`-label:"${escapeGmailSearchPhrase(PROCESSED_LABEL)}"`);
    }
    const query = queryTerms.join(' ').trim();

    const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query
    });
    const messages = Array.isArray(listResponse.data.messages) ? listResponse.data.messages : [];
    if (messages.length === 0) return { processed: 0, failed: 0, total: 0, skippedThreadDuplicates: 0 };

    const seenThreads = new Set();
    const queuedEntries = [];
    for (const entry of messages) {
        const threadKey = String(entry?.threadId || entry?.id || '').trim();
        if (!threadKey) continue;
        if (seenThreads.has(threadKey)) continue;
        seenThreads.add(threadKey);
        queuedEntries.push(entry);
    }
    const skippedThreadDuplicates = Math.max(0, messages.length - queuedEntries.length);

    let processed = 0;
    let failed = 0;

    for (const entry of queuedEntries) {
        let tempDir = '';
        let attemptId = '';
        let existingJob = null;
        let message = null;
        let threadMessages = [];
        let effectiveMessageId = String(entry?.id || '').trim();
        let metadata = { subject: '', from: '', date: '' };
        let routeKind = 'BILL';
        let contributionMeta = null;
        let codeType = 'budget';
        let codeValue = '';
        try {
            const threadIdForLookup = String(entry?.threadId || '').trim();
            if (threadIdForLookup) {
                const threadResponse = await gmail.users.threads.get({
                    userId: 'me',
                    id: threadIdForLookup,
                    format: 'full'
                });
                threadMessages = Array.isArray(threadResponse.data?.messages) ? threadResponse.data.messages : [];
                message = selectThreadMessageForRouting(threadMessages, { requireContribution }) || null;
            }
            if (!message) {
                const messageResponse = await gmail.users.messages.get({
                    userId: 'me',
                    id: entry.id,
                    format: 'full'
                });
                message = messageResponse.data;
                if (threadMessages.length === 0) {
                    threadMessages = [message];
                }
            }
            effectiveMessageId = String(message?.id || entry?.id || '').trim();
            metadata = parseEmailMetadata(message);
            const bodyText = extractGmailMessageText(message) || message.snippet || '';
            const contributionContext = resolveContributionContext(metadata, bodyText);
            routeKind = isContributionEmail(contributionContext.metadata, contributionContext.bodyText)
                ? 'CONTRIBUTION'
                : 'BILL';
            if (requireContribution && routeKind !== 'CONTRIBUTION') {
                throw new Error('Email does not match supported contribution formats');
            }
            contributionMeta = routeKind === 'CONTRIBUTION'
                ? parseContributionFields({
                    metadata: contributionContext.metadata,
                    bodyText: contributionContext.bodyText,
                    envelopeFallback: '',
                    designationFallback: ''
                })
                : null;
            codeType = routeKind === 'CONTRIBUTION' ? 'envelope' : 'budget';
            codeValue = routeKind === 'CONTRIBUTION'
                ? String(contributionMeta?.envelopeNumber || '').trim()
                : '';
            const resolvedRoot = rootPath || buildTargetDir({
                codeType,
                codeValue,
                clientTs: new Date(Number(message?.internalDate) || Date.now()).toISOString()
            });
            await mkdir(resolvedRoot, { recursive: true });
            await syncLocalMirrorFromCanonical(codeType).catch(() => ({ ok: false }));

            const noteText = buildNoteText(metadata, {
                routeKind,
                donor: contributionMeta?.donor || '',
                envelopeNumber: contributionMeta?.envelopeNumber || '',
                designation: contributionMeta?.designation || '',
                amount: contributionMeta?.amount || ''
            });
            const attachments = collectAttachments(message.payload);
            const isContributionRoute = routeKind === 'CONTRIBUTION';
            const threadPdfAttachments = !isContributionRoute
                ? collectThreadPdfAttachments(threadMessages)
                : [];
            const useThreadPdfAttachments = !isContributionRoute && threadPdfAttachments.length > 0;
            const conversationText = !isContributionRoute && !useThreadPdfAttachments
                ? buildConversationText(threadMessages)
                : '';
            const contextVendorMeta = isContributionRoute
                ? { vendor: '', found: false, confidence: 0 }
                : resolveApVendorFromContext(metadata, bodyText, conversationText);
            const routingTimestamp = new Date(Number(message?.internalDate) || Date.now());
            const filenameTimestamp = routeKind === 'CONTRIBUTION'
                ? parseEmailHeaderTimestamp(contributionContext.metadata?.date, routingTimestamp)
                : routingTimestamp;
            const sourceToken = routeKind === 'CONTRIBUTION'
                ? getContributionSourceToken(contributionContext.metadata?.from)
                : '';

            const removeLabelIds = [
                ...(archive ? ['INBOX'] : []),
                ...(successCleanupLabelId ? [successCleanupLabelId] : [])
            ];
            const threadId = message.threadId || '';
            const applySuccessLabels = async () => {
                if (threadId) {
                    await gmail.users.threads.modify({
                        userId: 'me',
                        id: threadId,
                        requestBody: {
                            addLabelIds: [processedLabelId],
                            removeLabelIds
                        }
                    });
                } else {
                    await gmail.users.messages.modify({
                        userId: 'me',
                        id: effectiveMessageId,
                        requestBody: {
                            addLabelIds: [processedLabelId],
                            removeLabelIds
                        }
                    });
                }
            };

            existingJob = getSharefileJob(effectiveMessageId, codeType, codeValue);
            const attempt = startRoutingAttempt({
                jobId: existingJob?.id || null,
                messageId: effectiveMessageId,
                threadId: threadId || null,
                codeType,
                codeValue,
                source: 'poller'
            });
            attemptId = String(attempt?.id || '').trim();
            if (existingJob) {
                let existingOutput = {};
                try {
                    existingOutput = JSON.parse(existingJob.output_json || '{}');
                } catch {
                    existingOutput = {};
                }
                const existingFilesPresent = await hasExistingOutputFiles(existingOutput);
                if (existingFilesPresent) {
                    recordSharefileRoutingEvent({
                        attemptId,
                        jobId: existingJob.id,
                        messageId: effectiveMessageId,
                        threadId: threadId || null,
                        codeType,
                        codeValue,
                        status: 'success',
                        output: existingOutput
                    });
                    completeRoutingAttempt({
                        attemptId,
                        jobId: existingJob.id,
                        status: 'success',
                        output: existingOutput,
                        writtenFiles: (Array.isArray(existingOutput?.files) ? existingOutput.files : [])
                            .map((fileEntry) => resolveOutputFilePath(existingOutput, fileEntry))
                            .filter(Boolean)
                    });
                    await applySuccessLabels();
                    processed += 1;
                    continue;
                }
            }

            tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
            await mkdir(tempDir, { recursive: true });
            const outputs = [];
            const canonicalSync = { published: 0, failed: 0, lastError: '' };
            const syncOutputToCanonical = async (localPath) => {
                const result = await publishLocalFileToCanonical({ codeType, localPath });
                if (result?.ok) {
                    canonicalSync.published += 1;
                    return;
                }
                canonicalSync.failed += 1;
                canonicalSync.lastError = String(result?.reason || '').trim();
            };
            const contextVendorFallback = contextVendorMeta.vendor || '';
            let apVendor = '';
            if (useThreadPdfAttachments) {
                let index = 0;
                for (const source of threadPdfAttachments) {
                    const attachmentResponse = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: source.messageId,
                        id: source.attachmentId
                    });
                    const data = attachmentResponse.data?.data;
                    if (!data) continue;
                    const rawBytes = decodeAttachmentData(data);
                    const sourcePath = join(tempDir, source.filename || `attachment-${index}.pdf`);
                    await writeFile(sourcePath, rawBytes);
                    const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                    const pdfBytes = await readFile(pdfPath);
                    const routed = await saveRoutedPdfOutput({
                        pdfBytes,
                        sourcePdfPath: pdfPath,
                        routeKind,
                        filenameTimestamp,
                        targetDir: resolvedRoot,
                        donor: contributionMeta?.donor || '',
                        amount: contributionMeta?.amount || '',
                        sourceToken,
                        noteText,
                        tempDir,
                        contextVendorFallback,
                        apVendor,
                        syncOutputToCanonical
                    });
                    apVendor = routed.apVendor;
                    outputs.push(routed.targetPath);
                    index += 1;
                }
            } else if (attachments.length === 0) {
                let pdfBytes;
                try {
                    const html = isContributionRoute
                        ? buildEmailHtml(metadata, await resolveMessageHtmlForRender(gmail, message), bodyText)
                        : await buildConversationHtml(gmail, threadMessages);
                    pdfBytes = await renderEmailHtmlToPdf(html);
                } catch (error) {
                    if (isContributionRoute) {
                        console.warn('HTML email render failed, falling back to text PDF:', error);
                        pdfBytes = await renderEmailToPdf(metadata, bodyText);
                    } else {
                        console.warn('Conversation HTML render failed, falling back to text PDF:', error);
                        pdfBytes = await renderEmailToPdf({ subject: 'Email conversation' }, conversationText || bodyText);
                    }
                }
                if (!apVendor && contextVendorFallback) apVendor = contextVendorFallback;
                const routed = await saveRoutedPdfOutput({
                    pdfBytes,
                    sourcePdfPath: '',
                    routeKind,
                    filenameTimestamp,
                    targetDir: resolvedRoot,
                    donor: contributionMeta?.donor || '',
                    amount: contributionMeta?.amount || '',
                    sourceToken,
                    noteText,
                    tempDir,
                    contextVendorFallback,
                    apVendor,
                    syncOutputToCanonical
                });
                apVendor = routed.apVendor || apVendor;
                outputs.push(routed.targetPath);
            } else {
                let index = 0;
                for (const attachment of attachments) {
                    const attachmentResponse = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: effectiveMessageId,
                        id: attachment.attachmentId
                    });
                    const data = attachmentResponse.data?.data;
                    if (!data) continue;
                    const rawBytes = decodeAttachmentData(data);
                    const sourcePath = join(tempDir, attachment.filename || `attachment-${index}`);
                    await writeFile(sourcePath, rawBytes);
                    const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                    const pdfBytes = await readFile(pdfPath);
                    const routed = await saveRoutedPdfOutput({
                        pdfBytes,
                        sourcePdfPath: pdfPath,
                        routeKind,
                        filenameTimestamp,
                        targetDir: resolvedRoot,
                        donor: contributionMeta?.donor || '',
                        amount: contributionMeta?.amount || '',
                        sourceToken,
                        noteText,
                        tempDir,
                        contextVendorFallback,
                        apVendor,
                        syncOutputToCanonical
                    });
                    apVendor = routed.apVendor;
                    outputs.push(routed.targetPath);
                    index += 1;
                }
            }

            const output = {
                targetDir: resolvedRoot,
                files: outputs,
                routing: {
                    routeKind,
                    envelopeNumber: contributionMeta?.envelopeNumber || codeValue || '',
                    designation: contributionMeta?.designation || '',
                    noteText: routeKind === 'CONTRIBUTION' ? noteText : '',
                    personId: routeKind === 'CONTRIBUTION' ? String(contributionMeta?.personId || '').trim() : '',
                    personName: routeKind === 'CONTRIBUTION' ? String(contributionMeta?.personName || '').trim() : '',
                    personMatchConfidence: routeKind === 'CONTRIBUTION'
                        ? Number(contributionMeta?.personMatchConfidence || 0)
                        : 0,
                    vendor: routeKind === 'CONTRIBUTION' ? '' : (apVendor || contextVendorFallback),
                    vendorFound: routeKind === 'CONTRIBUTION' ? false : Boolean(apVendor || contextVendorFallback),
                    canonicalPublishedCount: canonicalSync.published,
                    canonicalFailedCount: canonicalSync.failed,
                    canonicalLastError: canonicalSync.lastError || ''
                }
            };
            const job = saveOrUpdateSharefileJob({
                existingJobId: existingJob?.id || '',
                messageId: effectiveMessageId,
                threadId: threadId || null,
                codeType,
                codeValue,
                output
            });
            recordSharefileRoutingEvent({
                attemptId,
                jobId: job.id,
                messageId: effectiveMessageId,
                threadId: threadId || null,
                codeType,
                codeValue,
                status: 'success',
                output
            });
            completeRoutingAttempt({
                attemptId,
                jobId: job.id,
                status: 'success',
                output,
                writtenFiles: outputs
            });

            await applySuccessLabels();
            processed += 1;
        } catch (error) {
            failed += 1;
            console.error('ShareFile route emails poll error:', error);
            recordSharefileRoutingEvent({
                attemptId,
                jobId: existingJob?.id || null,
                messageId: effectiveMessageId,
                threadId: message?.threadId || null,
                codeType,
                codeValue,
                status: 'failure',
                errorText: error?.message || 'Failed to route email'
            });
            completeRoutingAttempt({
                attemptId,
                jobId: existingJob?.id || null,
                status: 'failure',
                errorText: error?.message || 'Failed to route email'
            });
        } finally {
            if (tempDir) {
                await rm(tempDir, { recursive: true, force: true });
            }
        }
    }

    return { processed, failed, total: queuedEntries.length, skippedThreadDuplicates };
};

const startRoutingAttempt = ({
    jobId = null,
    messageId = null,
    threadId = null,
    codeType = '',
    codeValue = '',
    source = 'manual'
} = {}) => {
    try {
        const id = `routing-attempt-${randomUUID()}`;
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO routing_attempts (
                id, job_id, message_id, thread_id, code_type, code_value, source,
                status, error_text, output_json, written_files_json,
                started_at, completed_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            jobId || null,
            messageId || null,
            threadId || null,
            codeType || '',
            codeValue || '',
            source || 'manual',
            'started',
            '',
            null,
            JSON.stringify([]),
            now,
            null,
            now,
            now
        );
        return { id, startedAt: now };
    } catch (error) {
        console.warn('Failed to create routing attempt:', error);
        return null;
    }
};

const completeRoutingAttempt = ({
    attemptId = '',
    jobId = null,
    status = 'success',
    errorText = '',
    output = null,
    writtenFiles = []
} = {}) => {
    const id = String(attemptId || '').trim();
    if (!id) return;
    try {
        const now = new Date().toISOString();
        db.prepare(`
            UPDATE routing_attempts
            SET job_id = ?,
                status = ?,
                error_text = ?,
                output_json = ?,
                written_files_json = ?,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
        `).run(
            jobId || null,
            status || 'success',
            errorText || '',
            output ? JSON.stringify(output) : null,
            JSON.stringify(Array.isArray(writtenFiles) ? writtenFiles : []),
            now,
            now,
            id
        );
    } catch (error) {
        console.warn('Failed to finalize routing attempt:', error);
    }
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
    tokensOverride = null,
    messageOnly = true,
    allowIdempotent = false
} = {}) => {
    const tokens = tokensOverride || getSharefileGmailTokens();
    if (!tokens) {
        throw new Error('No ShareFile Gmail tokens configured');
    }
    if (!messageId) {
        throw new Error('Missing messageId');
    }

    const gmail = getGmailClient(tokens);
    const labelId = await ensureLabel(gmail, PROCESSED_LABEL);
    let effectiveMessageId = messageId;
    let message;
    const messageResponse = await gmail.users.messages.get({
        userId: 'me',
        id: effectiveMessageId,
        format: 'full'
    });
    message = messageResponse.data;
    messageId = effectiveMessageId;
    const effectiveThreadId = String(threadId || message?.threadId || '').trim();
    let threadMessages = [message];
    if (effectiveThreadId) {
        try {
            const threadResponse = await gmail.users.threads.get({
                userId: 'me',
                id: effectiveThreadId,
                format: 'full'
            });
            const threadList = Array.isArray(threadResponse.data?.messages) ? threadResponse.data.messages : [];
            if (threadList.length > 0) {
                threadMessages = threadList;
            }
        } catch {
            // Keep single-message fallback for manual routes if thread lookup is unavailable.
        }
    }
    const metadata = parseEmailMetadata(message);
    const bodyText = extractGmailMessageText(message) || message.snippet || '';
    const contributionContext = resolveContributionContext(metadata, bodyText);
    const inferredRouteKind = isContributionEmail(
        contributionContext.metadata,
        contributionContext.bodyText
    ) ? 'CONTRIBUTION' : 'BILL';
    const routeKind = normalizeRouteKind(extraMeta.routeKind || inferredRouteKind);
    const contributionMeta = routeKind === 'CONTRIBUTION'
        ? parseContributionFields({
            metadata: contributionContext.metadata,
            bodyText: contributionContext.bodyText,
            envelopeFallback: extraMeta.codeValue,
            designationFallback: extraMeta.designation
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
    const isContributionRoute = routeKind === 'CONTRIBUTION';
    const threadPdfAttachments = !isContributionRoute
        ? collectThreadPdfAttachments(threadMessages)
        : [];
    const useThreadPdfAttachments = !isContributionRoute && attachments.length === 0 && threadPdfAttachments.length > 0;
    const allowThreadContext = !messageOnly || useThreadPdfAttachments;
    const conversationText = !isContributionRoute && allowThreadContext && !useThreadPdfAttachments
        ? buildConversationText(threadMessages)
        : '';
    const contextVendorMeta = isContributionRoute
        ? { vendor: '', found: false, confidence: 0 }
        : resolveApVendorFromContext(metadata, bodyText, conversationText);
    const clientTsDate = extraMeta?.clientTs ? new Date(extraMeta.clientTs) : null;
    const routingTimestamp = clientTsDate && !Number.isNaN(clientTsDate.getTime())
        ? clientTsDate
        : new Date(Number(message?.internalDate) || Date.now());
    const filenameTimestamp = routeKind === 'CONTRIBUTION'
        ? parseEmailHeaderTimestamp(contributionContext.metadata?.date, routingTimestamp)
        : routingTimestamp;
    const sourceToken = routeKind === 'CONTRIBUTION'
        ? getContributionSourceToken(contributionContext.metadata?.from)
        : '';

    const resolvedRoot = rootPath || buildTargetDir({
        codeType: extraMeta.codeType,
        codeValue: extraMeta.codeValue,
        clientTs: extraMeta.clientTs
    });
    await mkdir(resolvedRoot, { recursive: true });
    await syncLocalMirrorFromCanonical(extraMeta.codeType).catch(() => ({ ok: false }));
    const tempDir = join(tmpdir(), `sharefile-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    let existing = null;
    let attemptId = '';
    try {
        existing = getSharefileJob(messageId, extraMeta.codeType, extraMeta.codeValue);
        const attempt = startRoutingAttempt({
            jobId: existing?.id || null,
            messageId,
            threadId: effectiveThreadId || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            source: 'manual'
        });
        attemptId = String(attempt?.id || '').trim();
        if (allowIdempotent && existing) {
            let existingOutput = {};
            try {
                existingOutput = JSON.parse(existing.output_json || '{}');
            } catch {
                existingOutput = {};
            }
            const existingFilesPresent = await hasExistingOutputFiles(existingOutput);
            if (existingFilesPresent) {
                recordSharefileRoutingEvent({
                    attemptId,
                    jobId: existing.id,
                    messageId,
                    threadId: threadId || message.threadId || null,
                    codeType: extraMeta.codeType,
                    codeValue: extraMeta.codeValue,
                    status: 'success',
                    output: existingOutput
                });
                completeRoutingAttempt({
                    attemptId,
                    jobId: existing.id,
                    status: 'success',
                    output: existingOutput,
                    writtenFiles: (Array.isArray(existingOutput?.files) ? existingOutput.files : [])
                        .map((fileEntry) => resolveOutputFilePath(existingOutput, fileEntry))
                        .filter(Boolean)
                });
                return { ok: true, idempotent: true, output: existingOutput };
            }
        }

        const outputFiles = [];
        const canonicalSync = { published: 0, failed: 0, lastError: '' };
        const syncOutputToCanonical = async (localPath) => {
            const result = await publishLocalFileToCanonical({
                codeType: extraMeta.codeType,
                localPath
            });
            if (result?.ok) {
                canonicalSync.published += 1;
                return;
            }
            canonicalSync.failed += 1;
            canonicalSync.lastError = String(result?.reason || '').trim();
        };
        const contextVendorFallback = contextVendorMeta.vendor || '';
        let apVendor = '';
        if (useThreadPdfAttachments) {
            let index = 0;
            for (const source of threadPdfAttachments) {
                const attachmentResponse = await gmail.users.messages.attachments.get({
                    userId: 'me',
                    messageId: source.messageId,
                    id: source.attachmentId
                });
                const data = attachmentResponse.data?.data;
                if (!data) continue;
                const rawBytes = decodeAttachmentData(data);
                const sourcePath = join(tempDir, source.filename || `attachment-${index}.pdf`);
                await writeFile(sourcePath, rawBytes);
                const pdfPath = await convertToPdfIfNeeded(sourcePath, tempDir);
                const pdfBytes = await readFile(pdfPath);
                const routed = await saveRoutedPdfOutput({
                    pdfBytes,
                    sourcePdfPath: pdfPath,
                    routeKind,
                    filenameTimestamp,
                    targetDir: resolvedRoot,
                    donor: contributionMeta?.donor || '',
                    amount: contributionMeta?.amount || '',
                    sourceToken,
                    noteText,
                    tempDir,
                    contextVendorFallback,
                    apVendor,
                    syncOutputToCanonical
                });
                apVendor = routed.apVendor;
                outputFiles.push(routed.file);
                index += 1;
            }
        } else if (attachments.length === 0) {
            let pdfBytes;
            try {
                const html = isContributionRoute
                    ? buildEmailHtml(metadata, await resolveMessageHtmlForRender(gmail, message), bodyText)
                    : await buildConversationHtml(gmail, threadMessages);
                pdfBytes = await renderEmailHtmlToPdf(html);
            } catch (error) {
                if (isContributionRoute) {
                    console.warn('HTML email render failed, falling back to text PDF:', error);
                    pdfBytes = await renderEmailToPdf(metadata, bodyText);
                } else {
                    console.warn('Conversation HTML render failed, falling back to text PDF:', error);
                    pdfBytes = await renderEmailToPdf({ subject: 'Email conversation' }, conversationText || bodyText);
                }
            }
            if (!apVendor && contextVendorFallback) apVendor = contextVendorFallback;
            const routed = await saveRoutedPdfOutput({
                pdfBytes,
                sourcePdfPath: '',
                routeKind,
                filenameTimestamp,
                targetDir: resolvedRoot,
                donor: contributionMeta?.donor || '',
                amount: contributionMeta?.amount || '',
                sourceToken,
                noteText,
                tempDir,
                contextVendorFallback,
                apVendor,
                syncOutputToCanonical
            });
            apVendor = routed.apVendor || apVendor;
            outputFiles.push(routed.file);
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
                const routed = await saveRoutedPdfOutput({
                    pdfBytes,
                    sourcePdfPath: pdfPath,
                    routeKind,
                    filenameTimestamp,
                    targetDir: resolvedRoot,
                    donor: contributionMeta?.donor || '',
                    amount: contributionMeta?.amount || '',
                    sourceToken,
                    noteText,
                    tempDir,
                    contextVendorFallback,
                    apVendor,
                    syncOutputToCanonical
                });
                apVendor = routed.apVendor;
                outputFiles.push(routed.file);
                index += 1;
            }
        }

        const thread = threadId || message.threadId;
        if (thread && !messageOnly) {
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
            files: outputFiles,
            routing: {
                routeKind,
                envelopeNumber: contributionMeta?.envelopeNumber || extraMeta.codeValue || '',
                designation: contributionMeta?.designation || '',
                noteText: routeKind === 'CONTRIBUTION' ? noteText : '',
                personId: routeKind === 'CONTRIBUTION' ? String(contributionMeta?.personId || '').trim() : '',
                personName: routeKind === 'CONTRIBUTION' ? String(contributionMeta?.personName || '').trim() : '',
                personMatchConfidence: routeKind === 'CONTRIBUTION'
                    ? Number(contributionMeta?.personMatchConfidence || 0)
                    : 0,
                vendor: routeKind === 'CONTRIBUTION' ? '' : (apVendor || contextVendorFallback),
                vendorFound: routeKind === 'CONTRIBUTION' ? false : Boolean(apVendor || contextVendorFallback),
                canonicalPublishedCount: canonicalSync.published,
                canonicalFailedCount: canonicalSync.failed,
                canonicalLastError: canonicalSync.lastError || ''
            }
        };
        const job = saveOrUpdateSharefileJob({
            existingJobId: existing?.id || '',
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            output
        });
        recordSharefileRoutingEvent({
            attemptId,
            jobId: job.id,
            messageId,
            threadId: thread || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'success',
            output
        });
        completeRoutingAttempt({
            attemptId,
            jobId: job.id,
            status: 'success',
            output,
            writtenFiles: outputFiles
                .map((file) => String(file?.path || '').trim())
                .filter(Boolean)
        });
        return { ok: true, jobId: job.id, resolved: { messageId, threadId: thread || null }, output };
    } catch (error) {
        recordSharefileRoutingEvent({
            attemptId,
            jobId: existing?.id || null,
            messageId,
            threadId: effectiveThreadId || null,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'failure',
            errorText: error?.message || 'Failed to route email'
        });
        completeRoutingAttempt({
            attemptId,
            jobId: existing?.id || null,
            status: 'failure',
            errorText: error?.message || 'Failed to route email'
        });
        throw error;
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};
