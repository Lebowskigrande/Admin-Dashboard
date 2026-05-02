import { access, readdir, stat } from 'fs/promises';
import { basename, extname, join, relative, resolve } from 'path';

import { google } from 'googleapis';
import xlsx from 'xlsx';

import { sqlite as db } from '../db.js';
import { parseNotes, tableExists } from '../helpers/db-utils.js';
import {
    getSharefileGmailTokens,
    getSharefileRoutingAccounts,
    getUserTokens
} from '../helpers/auth.js';
import { extractGmailMessageText } from '../helpers/hgk-utils.js';
import { findBulletinFile, findInsertFile } from '../helpers/file-utils.js';
import { normalizePersonName } from '../helpers/people-utils.js';
import { loadSundayOccurrences } from '../helpers/sunday-utils.js';
import { createOAuthClient, setStoredCredentials } from '../googleAuth.js';
import { buildDocumentPreview, buildDocumentStatus } from './bulletinService.js';
import { buildOrdersPanelData } from './ordersService.js';

const TASK_PANEL_TIME_ZONE = 'America/Los_Angeles';
const WORKSPACE_ROOT = resolve(process.cwd());
const DROPBOX_PARISH_ROOT = resolve('C:\\Users\\Secretary\\Dropbox\\Parish Administrator');
const DEPOSITS_ROOT = resolve(join(DROPBOX_PARISH_ROOT, 'Deposits'));
const PAYROLL_ROOT = resolve(join(DROPBOX_PARISH_ROOT, 'Timesheets'));
const RECEIVABLES_LOCAL_ROOT = resolve(join(DROPBOX_PARISH_ROOT, 'Accounting', 'Pending AR'));
const PAYABLES_LOCAL_ROOT = resolve(join(DROPBOX_PARISH_ROOT, 'Accounting', 'Pending AP'));
const RECEIVABLES_CANONICAL_ROOT = resolve('Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AR & Contributions');
const PAYABLES_CANONICAL_ROOT = resolve('Y:\\Folders\\St. Edmunds (SEEC)\\2026\\AP & Expenses');
const BANK_BRANCH = {
    name: 'Bank of America - San Marino',
    address: '2180 Huntington Dr, San Marino, CA 91108',
    closeHour: 16,
    sourceUrl: 'https://locators.bankofamerica.com/ca/sanmarino/financial-centers-san-marino-9410.html',
    directionsUrl: 'https://www.google.com/maps/dir/?api=1&origin=1175+S+San+Gabriel+Blvd,+San+Gabriel,+CA+91776&destination=2180+Huntington+Dr,+San+Marino,+CA+91108&travelmode=driving'
};
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OFFICE_MAILBOX_EMAILS = ['office@saintedmunds.org', 'office@saintedmunds.com'];
const MAIL_STRONG_SUBJECT_PATTERNS = [
    /^delivered:/i,
    /^out for delivery/i,
    /^shipped:/i,
    /^shipment delivered/i,
    /^tracking update/i,
    /^arriving today/i,
    /^ready for pickup/i,
    /\bpackage delivered\b/i,
    /\bhas been delivered\b/i,
    /\bout for delivery\b/i,
    /\btracking number\b/i
];
const MAIL_WEAK_SUBJECT_PATTERNS = [
    /\bdelivered\b/i,
    /\bshipped\b/i,
    /\bshipment\b/i,
    /\barriving\b/i,
    /\bon the way\b/i,
    /\bdelivery today\b/i
];
const MAIL_BODY_PATTERNS = [
    /\btracking(?: number| id)?\b/i,
    /\border(?: number| #)?\b/i,
    /\bpackage\b/i,
    /\bshipment\b/i,
    /\bcarrier\b/i,
    /\bdelivered\b/i,
    /\bout for delivery\b/i,
    /\barriving today\b/i,
    /\bleft (?:at|near|in)\b/i,
    /\bstops? away\b/i
];
const MAIL_PROMO_PATTERNS = [
    /\bdelivered to your door\b/i,
    /\bshop now\b/i,
    /\border now\b/i,
    /\bsave(?: up to)?\b/i,
    /\bsale\b/i,
    /\bdeal\b/i,
    /\boffer\b/i,
    /\bdiscount\b/i,
    /\bpromo\b/i,
    /\bsupplies you need\b/i,
    /\bessentials\b/i,
    /\bfree shipping\b/i,
    /\bunsubscribe\b/i,
    /\bview in browser\b/i
];
const MAIL_TRANSACTIONAL_DOMAINS = [
    'amazon.com',
    'updates.amazon.com',
    'ups.com',
    'fedex.com',
    'usps.com',
    'informeddelivery.usps.com',
    'ontrac.com',
    'lasership.com',
    'veho.com',
    'dhl.com'
];
const MAIL_PROMO_DOMAINS = [
    'constantcontact.com',
    'mailchimpapp.com',
    'hubspotemail.net',
    'marketing.',
    'newsletter.'
];
const MAIL_STATUS_ORDER = ['ordered', 'shipped', 'out_for_delivery', 'delivered'];
const MAIL_STATUS_LABELS = {
    ordered: 'Ordered',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered'
};

const fileExists = async (filePath) => {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
};

const toDateKey = (value) => {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    date.setHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10);
};

const _parseDateKeyLocal = (dateKey) => {
    const match = String(dateKey || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date(dateKey);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
};

const toMonthDayKey = (value) => {
    const text = String(value || '').trim();
    const iso = text.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}/${iso[2]}`;
    const us = text.match(/^(\d{2})\/(\d{2})(?:\/\d{2,4})?$/);
    if (us) return `${us[1]}/${us[2]}`;
    return '';
};

const parseFileAmount = (name) => {
    const match = String(name || '').match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (!match?.[1]) return null;
    const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const parseFileDate = (name) => {
    const text = String(name || '');
    const dotted = text.match(/\b(\d{4})\.(\d{2})\.(\d{2})\b/);
    if (dotted) {
        return `${dotted[1]}-${dotted[2]}-${dotted[3]}`;
    }
    const dashed = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (dashed) {
        return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
    }
    return '';
};

const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
};

const chooseFirstExistingRoot = async (roots = []) => {
    for (const root of roots) {
        if (await fileExists(root)) return root;
    }
    return '';
};

const walkFiles = async (rootPath, maxDepth = 3, currentDepth = 0) => {
    if (!rootPath || currentDepth > maxDepth) return [];
    try {
        const entries = await readdir(rootPath, { withFileTypes: true });
        const results = [];
        for (const entry of entries) {
            const fullPath = join(rootPath, entry.name);
            if (entry.isFile()) {
                results.push(fullPath);
                continue;
            }
            if (entry.isDirectory()) {
                results.push(...await walkFiles(fullPath, maxDepth, currentDepth + 1));
            }
        }
        return results;
    } catch {
        return [];
    }
};

const buildFileHistory = async ({
    roots = [],
    limit = 24,
    maxDepth = 3,
    includeFile = null
} = {}) => {
    const root = await chooseFirstExistingRoot(roots);
    if (!root) {
        return {
            root: '',
            available: false,
            files: []
        };
    }
    const files = await walkFiles(root, maxDepth);
    const filtered = typeof includeFile === 'function'
        ? files.filter((filePath) => includeFile(filePath))
        : files;
    const withStats = await Promise.all(filtered.map(async (filePath) => {
        try {
            const details = await stat(filePath);
            return {
                name: basename(filePath),
                path: filePath,
                relativePath: relative(root, filePath),
                modifiedAt: details.mtime.toISOString(),
                sizeBytes: Number(details.size || 0),
                sizeLabel: formatBytes(details.size || 0),
                extension: extname(filePath).toLowerCase(),
                amount: parseFileAmount(filePath),
                fileDate: parseFileDate(filePath)
            };
        } catch {
            return null;
        }
    }));
    return {
        root,
        available: true,
        files: withStats
            .filter(Boolean)
            .sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')))
            .slice(0, limit)
    };
};

const getPreferredMailTokens = () => {
    const accounts = getSharefileRoutingAccounts();
    for (const preferredEmail of OFFICE_MAILBOX_EMAILS) {
        const account = accounts.find((entry) => (
            entry.enabled
            && entry.connected
            && String(entry.email || '').trim().toLowerCase() === preferredEmail
        ));
        if (account?.userId) {
            const tokens = getUserTokens(account.userId);
            if (tokens) {
                return {
                    tokens,
                    mailbox: preferredEmail
                };
            }
        }
    }
    const fallback = getSharefileGmailTokens();
    return fallback
        ? {
            tokens: fallback,
            mailbox: String(fallback.user_id || '').trim()
        }
        : null;
};

const getGmailClient = () => {
    const preferred = getPreferredMailTokens();
    if (!preferred?.tokens) return null;
    const client = createOAuthClient();
    setStoredCredentials(client, preferred.tokens);
    return {
        gmail: google.gmail({ version: 'v1', auth: client }),
        mailbox: preferred.mailbox
    };
};

const extractHeader = (headers = [], name = '') => {
    const target = String(name || '').trim().toLowerCase();
    const match = (Array.isArray(headers) ? headers : []).find((header) => String(header?.name || '').trim().toLowerCase() === target);
    return String(match?.value || '').trim();
};

const parseEmailAddress = (fromHeader = '') => {
    const raw = String(fromHeader || '').trim();
    const angleMatch = raw.match(/<([^>]+)>/);
    const email = String(angleMatch?.[1] || raw).trim().toLowerCase();
    return email.includes('@') ? email : '';
};

const getEmailDomain = (fromHeader = '') => {
    const email = parseEmailAddress(fromHeader);
    return email.split('@')[1] || '';
};

const matchesAnyPattern = (value = '', patterns = []) => patterns.some((pattern) => pattern.test(String(value || '')));

const normalizePackageText = (value = '') => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,:;])/g, '$1')
    .trim();

const normalizePackageKeySegment = (value = '') => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const canonicalizePackageName = (value = '') => normalizePackageText(value)
    .toLowerCase()
    .replace(/\+\s*\d+\s+more items?/i, '')
    .replace(/\band\s+\d+\s+more items?/i, '')
    .replace(/^amazon(?:\.com)?\s*/i, '')
    .replace(/\bpackage\b/gi, '')
    .replace(/\bshipment\b/gi, '')
    .replace(/\bdelivery\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const maskTrackingNumber = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 8) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const determinePackageStatus = ({ subject = '', body = '', snippet = '' } = {}) => {
    const combinedText = `${subject}\n${snippet}\n${body}`;
    if (matchesAnyPattern(subject, MAIL_STRONG_SUBJECT_PATTERNS) || /\bdelivered\b/i.test(combinedText)) {
        if (/^delivered:/i.test(subject) || /\bhas been delivered\b/i.test(combinedText) || /\bpackage delivered\b/i.test(combinedText)) {
            return 'delivered';
        }
    }
    if (/\bout for delivery\b/i.test(subject) || /\bout for delivery\b/i.test(combinedText) || /\barriving today\b/i.test(combinedText) || /\bstops? away\b/i.test(combinedText)) {
        return 'out_for_delivery';
    }
    if (/\bshipped\b/i.test(subject) || /\bon the way\b/i.test(combinedText) || /\btracking update\b/i.test(subject) || /\btracking number\b/i.test(combinedText) || /\bshipment\b/i.test(subject)) {
        return 'shipped';
    }
    if (/\border confirmed\b/i.test(subject) || /\bthanks for your order\b/i.test(combinedText) || /\byour order\b/i.test(subject) || /\border(?: has been)? placed\b/i.test(combinedText) || /\border update\b/i.test(subject)) {
        return 'ordered';
    }
    return '';
};

const detectCarrier = ({ from = '', subject = '', body = '', snippet = '' } = {}) => {
    const domain = getEmailDomain(from);
    const combined = `${from}\n${subject}\n${snippet}\n${body}`;
    if (domain.includes('amazon.com') || /\bamazon\b/i.test(combined)) return 'Amazon';
    if (domain.includes('ups.com') || /\bups\b/i.test(combined)) return 'UPS';
    if (domain.includes('fedex.com') || /\bfedex\b/i.test(combined)) return 'FedEx';
    if (domain.includes('usps.com') || /\busps\b/i.test(combined) || /\bpostal service\b/i.test(combined)) return 'USPS';
    if (domain.includes('dhl.com') || /\bdhl\b/i.test(combined)) return 'DHL';
    if (domain.includes('ontrac.com') || /\bontrac\b/i.test(combined)) return 'OnTrac';
    if (domain.includes('lasership.com') || /\blasership\b/i.test(combined)) return 'LaserShip';
    if (domain.includes('veho.com') || /\bveho\b/i.test(combined)) return 'Veho';
    return domain || 'Delivery';
};

const extractTrackingNumber = ({ subject = '', body = '', snippet = '', carrier = '' } = {}) => {
    const combined = `${subject}\n${snippet}\n${body}`;
    const patterns = [
        /\b(1Z[0-9A-Z]{16})\b/i,
        /\b(TBA\d{12})\b/i,
        /\b((?:94|93|92|95)\d{20,22})\b/,
        /tracking(?: number| #| no\.?)?[:\s-]*([A-Z0-9-]{8,34})/i
    ];
    for (const pattern of patterns) {
        const match = combined.match(pattern);
        if (!match?.[1]) continue;
        const candidate = String(match[1] || '').trim();
        if (/^\d{12,22}$/.test(candidate)) {
            if (carrier === 'FedEx' || carrier === 'USPS' || /\b(fedex|usps|tracking)\b/i.test(combined)) return candidate;
            continue;
        }
        return candidate;
    }
    return '';
};

const extractOrderNumber = ({ subject = '', body = '', snippet = '' } = {}) => {
    const combined = `${subject}\n${snippet}\n${body}`;
    const amazonMatch = combined.match(/\b(\d{3}-\d{7}-\d{7})\b/);
    if (amazonMatch?.[1]) return amazonMatch[1];
    const genericMatch = combined.match(/\border(?: number| #| no\.?)?[:\s-]*([A-Z0-9-]{6,32})\b/i);
    return String(genericMatch?.[1] || '').trim();
};

const extractPackageName = ({ subject = '', body = '', snippet = '' } = {}) => {
    const subjectText = normalizePackageText(subject)
        .replace(/^(delivered|out for delivery|shipped|tracking update|arriving today|ready for pickup|order confirmed|order update)[:\s-]*/i, '')
        .replace(/^your order(?: of)?\s*/i, '')
        .replace(/^package(?: update)?[:\s-]*/i, '')
        .trim();

    const multiItemMatch = subjectText.match(/^(?:\d+\s+)?["“]?([^"”]+?)["”]?\s+and\s+(\d+)\s+more items?/i);
    if (multiItemMatch?.[1]) {
        return normalizePackageText(`${multiItemMatch[1]} + ${multiItemMatch[2]} more items`);
    }

    const quotedMatch = subjectText.match(/["“]([^"”]+)["”]/);
    if (quotedMatch?.[1]) {
        return normalizePackageText(quotedMatch[1]);
    }

    if (subjectText && !/^(your order|amazon\.com|shipment|package)$/i.test(subjectText)) {
        return subjectText.slice(0, 140);
    }

    const bodyPatterns = [
        /items? in (?:this )?(?:shipment|package)[:\s-]+([^\n]{8,140})/i,
        /package(?: contains| includes)?[:\s-]+([^\n]{8,140})/i,
        /your order of\s+([^\n]{8,140})/i
    ];
    const combined = `${snippet}\n${body}`;
    for (const pattern of bodyPatterns) {
        const match = combined.match(pattern);
        if (match?.[1]) return normalizePackageText(match[1]).slice(0, 140);
    }

    return '';
};

const classifyPackageMessage = ({ subject = '', from = '', snippet = '', body = '' } = {}) => {
    const normalizedSubject = String(subject || '').trim();
    const normalizedSnippet = String(snippet || '').trim();
    const normalizedBody = String(body || '').trim();
    const combinedText = `${normalizedSubject}\n${normalizedSnippet}\n${normalizedBody}`;
    const domain = getEmailDomain(from);
    const status = determinePackageStatus({
        subject: normalizedSubject,
        body: normalizedBody,
        snippet: normalizedSnippet
    });

    let score = 0;
    const reasons = [];

    if (status === 'delivered' || status === 'out_for_delivery') {
        score += 5;
        reasons.push(`status-${status}`);
    } else if (status === 'shipped') {
        score += 4;
        reasons.push('status-shipped');
    } else if (status === 'ordered') {
        score += 3;
        reasons.push('status-ordered');
    } else if (matchesAnyPattern(normalizedSubject, MAIL_WEAK_SUBJECT_PATTERNS)) {
        score += 2;
        reasons.push('weak-subject');
    }

    const bodySignalCount = MAIL_BODY_PATTERNS.reduce((count, pattern) => (
        pattern.test(combinedText) ? count + 1 : count
    ), 0);
    if (bodySignalCount >= 3) {
        score += 4;
        reasons.push('body-strong');
    } else if (bodySignalCount >= 2) {
        score += 2;
        reasons.push('body-medium');
    } else if (bodySignalCount >= 1) {
        score += 1;
        reasons.push('body-light');
    }

    if (MAIL_TRANSACTIONAL_DOMAINS.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
        score += 3;
        reasons.push('transactional-domain');
    }

    if (MAIL_PROMO_DOMAINS.some((candidate) => domain.includes(candidate))) {
        score -= 3;
        reasons.push('promo-domain');
    }

    const promoSignalCount = MAIL_PROMO_PATTERNS.reduce((count, pattern) => (
        pattern.test(combinedText) ? count + 1 : count
    ), 0);
    if (promoSignalCount >= 2) {
        score -= 5;
        reasons.push('promo-strong');
    } else if (promoSignalCount >= 1) {
        score -= 2;
        reasons.push('promo-light');
    }

    if (/\bunsubscribe\b/i.test(normalizedSnippet) && !/\btracking\b/i.test(combinedText)) {
        score -= 2;
        reasons.push('unsubscribe');
    }

    const confidence = status && score >= 5 ? 'high' : 'ignore';

    return {
        status,
        confidence,
        score,
        reasons,
        domain
    };
};

const listGmailMessages = async ({ gmail, query, maxPages = 3, pageSize = 100 } = {}) => {
    const collected = [];
    let pageToken = undefined;
    let pageCount = 0;

    while (pageCount < maxPages) {
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: pageSize,
            pageToken
        });
        const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
        collected.push(...messages);
        pageToken = response.data?.nextPageToken || undefined;
        pageCount += 1;
        if (!pageToken || messages.length === 0) break;
    }

    return collected;
};

const buildPackageKey = ({ trackingNumber = '', orderNumber = '', threadId = '', packageName = '', carrier = '', domain = '' } = {}) => {
    const canonicalPackageName = canonicalizePackageName(packageName);
    const packageNameKey = normalizePackageKeySegment(canonicalPackageName || packageName);
    if (trackingNumber) return `track:${normalizePackageKeySegment(trackingNumber)}`;
    if (orderNumber && packageNameKey) return `order:${normalizePackageKeySegment(orderNumber)}:${packageNameKey}`;
    if (orderNumber) return `order:${normalizePackageKeySegment(orderNumber)}`;
    if (threadId) return `thread:${normalizePackageKeySegment(threadId)}`;
    if (packageNameKey && carrier) return `item:${normalizePackageKeySegment(carrier)}:${packageNameKey}`;
    if (packageNameKey && domain) return `item:${normalizePackageKeySegment(domain)}:${packageNameKey}`;
    if (orderNumber) return `order:${normalizePackageKeySegment(orderNumber)}`;
    return '';
};

const buildPackageEvent = ({ messageId = '', threadId = '', subject = '', from = '', date = '', snippet = '', body = '' } = {}) => {
    const classification = classifyPackageMessage({ subject, from, snippet, body });
    if (classification.confidence !== 'high' || !classification.status) return null;

    const carrier = detectCarrier({ from, subject, body, snippet });
    const trackingNumber = extractTrackingNumber({ subject, body, snippet, carrier });
    const orderNumber = extractOrderNumber({ subject, body, snippet });
    const packageName = extractPackageName({ subject, body, snippet }) || `${carrier} package`;
    const packageKey = buildPackageKey({
        trackingNumber,
        orderNumber,
        threadId,
        packageName,
        carrier,
        domain: classification.domain
    });
    if (!packageKey) return null;

    return {
        id: messageId,
        threadId,
        packageKey,
        packageName,
        carrier,
        trackingNumber,
        orderNumber,
        status: classification.status,
        statusLabel: MAIL_STATUS_LABELS[classification.status] || classification.status,
        date,
        snippet
    };
};

const summarizePackages = (events = []) => {
    const grouped = new Map();
    const uniqueEvents = [...new Map(events.filter(Boolean).map((event) => [event.id, event])).values()];

    uniqueEvents.forEach((event) => {
        const existing = grouped.get(event.packageKey) || [];
        existing.push(event);
        grouped.set(event.packageKey, existing);
    });

    return [...grouped.entries()].map(([packageKey, packageEvents]) => {
        const sortedEvents = [...packageEvents].sort((a, b) => {
            const timeDelta = new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
            if (timeDelta !== 0) return timeDelta;
            return MAIL_STATUS_ORDER.indexOf(a.status) - MAIL_STATUS_ORDER.indexOf(b.status);
        });
        const latestEvent = sortedEvents[sortedEvents.length - 1] || null;
        const reachedStatuses = new Set(sortedEvents.map((event) => event.status));
        return {
            id: packageKey,
            packageName: latestEvent?.packageName || 'Package',
            carrier: latestEvent?.carrier || '',
            trackingNumber: latestEvent?.trackingNumber || '',
            trackingNumberDisplay: maskTrackingNumber(latestEvent?.trackingNumber || ''),
            orderNumber: latestEvent?.orderNumber || '',
            latestStatus: latestEvent?.status || '',
            latestStatusLabel: latestEvent?.statusLabel || '',
            latestAt: latestEvent?.date || '',
            updates: sortedEvents.map((event) => ({
                id: event.id,
                status: event.status,
                statusLabel: event.statusLabel,
                at: event.date,
                trackingNumber: event.trackingNumber,
                orderNumber: event.orderNumber
            })),
            progress: MAIL_STATUS_ORDER.map((status) => ({
                key: status,
                label: MAIL_STATUS_LABELS[status],
                reached: reachedStatuses.has(status),
                isCurrent: latestEvent?.status === status
            }))
        };
    }).sort((a, b) => new Date(b.latestAt || 0).getTime() - new Date(a.latestAt || 0).getTime());
};

const _getExpectedPackages = async () => {
    const gmailClient = getGmailClient();
    if (!gmailClient?.gmail) {
        return {
            connected: false,
            refreshedAt: new Date().toISOString(),
            packages: [],
            mailbox: '',
            note: 'Office Gmail is not connected.'
        };
    }

    try {
        const { gmail, mailbox } = gmailClient;
        const queries = [
            'label:inbox newer_than:45d subject:delivered',
            'label:inbox newer_than:45d subject:shipped',
            'label:inbox newer_than:45d subject:"out for delivery"',
            'label:inbox newer_than:45d subject:"tracking update"',
            'label:inbox newer_than:45d subject:arriving',
            'label:inbox newer_than:45d subject:shipment',
            'label:inbox newer_than:45d subject:"order confirmed"',
            'label:inbox newer_than:45d subject:"your order"',
            'label:inbox newer_than:45d subject:"order update"',
            'label:inbox newer_than:45d'
        ];
        const queryResults = await Promise.all(queries.map((query, index) => listGmailMessages({
            gmail,
            query,
            maxPages: index === queries.length - 1 ? 5 : 2,
            pageSize: 100
        })));
        const entries = [...new Map(
            queryResults
                .flat()
                .filter((entry) => entry?.id)
                .map((entry) => [entry.id, entry])
        ).values()].slice(0, 220);
        const messageDetails = await Promise.all(entries.map(async (entry) => {
            try {
                const response = await gmail.users.messages.get({
                    userId: 'me',
                    id: entry.id,
                    format: 'full'
                });
                const headers = response.data?.payload?.headers || [];
                const subject = extractHeader(headers, 'Subject');
                const from = extractHeader(headers, 'From');
                const date = extractHeader(headers, 'Date');
                const snippet = String(response.data?.snippet || '').trim();
                const body = extractGmailMessageText(response.data) || '';
                return buildPackageEvent({
                    messageId: entry.id,
                    threadId: String(response.data?.threadId || '').trim(),
                    subject,
                    from,
                    date,
                    snippet,
                    body
                });
            } catch {
                return null;
            }
        }));
        const packages = summarizePackages(messageDetails.filter(Boolean));
        return {
            connected: true,
            refreshedAt: new Date().toISOString(),
            mailbox,
            packages
        };
    } catch (error) {
        return {
            connected: true,
            refreshedAt: new Date().toISOString(),
            packages: [],
            mailbox: gmailClient.mailbox || '',
            note: error?.message || 'Unable to read office Gmail.'
        };
    }
};

const getLastMailCheckedAt = () => {
    if (!tableExists('task_instances')) return '';
    const instanceRow = db.prepare(`
        SELECT completed_at
        FROM task_instances
        WHERE completed_at IS NOT NULL
          AND (list_key = 'mail' OR list_key LIKE 'mail-%')
        ORDER BY completed_at DESC
        LIMIT 1
    `).get();
    if (instanceRow?.completed_at) return instanceRow.completed_at;

    if (!tableExists('task_progress_history')) return '';
    const historyRows = db.prepare(`
        SELECT after_json, to_completed_at, created_at
        FROM task_progress_history
        ORDER BY created_at DESC
        LIMIT 250
    `).all();
    for (const row of historyRows) {
        try {
            const after = row.after_json ? JSON.parse(row.after_json) : null;
            const listKey = String(after?.list_key || '').toLowerCase();
            if ((listKey === 'mail' || listKey.startsWith('mail-')) && after?.completed_at) {
                return after.completed_at;
            }
        } catch {
            continue;
        }
    }
    return '';
};

const getZonedDateParts = (date = new Date()) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TASK_PANEL_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute)
    };
};

const getBranchStatus = () => {
    const zoned = getZonedDateParts(new Date());
    const nowMinutes = (zoned.hour * 60) + zoned.minute;
    const closeMinutes = BANK_BRANCH.closeHour * 60;
    const isWeekend = new Date(`${zoned.year}-${String(zoned.month).padStart(2, '0')}-${String(zoned.day).padStart(2, '0')}T12:00:00`).getDay();
    const isOpenDay = isWeekend >= 1 && isWeekend <= 5;
    const minutesToClose = isOpenDay ? Math.max(0, closeMinutes - nowMinutes) : 0;
    return {
        closesAt: '4:00 PM',
        isOpenToday: isOpenDay,
        minutesToClose,
        statusLabel: !isOpenDay
            ? 'Closed today'
            : minutesToClose <= 0
                ? 'Closed'
                : `${minutesToClose} min to close`,
        directionsUrl: BANK_BRANCH.directionsUrl,
        trafficLabel: 'Open live directions for current traffic'
    };
};

const parseBirthdayWorkbook = () => {
    const workbookPath = resolve(join(WORKSPACE_ROOT, 'birthday list.XLSX'));
    if (!xlsx || !workbookPath) return [];
    try {
        const workbook = xlsx.readFile(workbookPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
        const birthdays = [];
        let currentSection = '';
        rows.forEach((row) => {
            const firstCell = String(row?.[0] || '').trim();
            const dateValue = toMonthDayKey(row?.[5] || '');
            if (/^birthdays$/i.test(firstCell)) {
                currentSection = 'birthdays';
                return;
            }
            if (/^anniversaries$/i.test(firstCell)) {
                currentSection = 'anniversaries';
                return;
            }
            if (currentSection !== 'birthdays' || !firstCell || !dateValue) return;
            birthdays.push({
                name: firstCell,
                monthDay: dateValue,
                contact: String(row?.[6] || '').trim()
            });
        });
        return birthdays;
    } catch {
        return [];
    }
};

const getUpcomingBirthdayRange = () => {
    const today = new Date();
    const base = new Date(today);
    base.setHours(0, 0, 0, 0);
    const day = base.getDay();
    const delta = (7 - day) % 7 || 7;
    const sunday = new Date(base);
    sunday.setDate(sunday.getDate() + delta);
    const saturday = new Date(sunday);
    saturday.setDate(saturday.getDate() + 6);
    return {
        start: sunday,
        end: saturday
    };
};

const getUpcomingBirthdays = () => {
    const birthdays = parseBirthdayWorkbook();
    const peopleDirectory = getPeopleDirectory();
    const range = getUpcomingBirthdayRange();
    const startYear = range.start.getFullYear();
    const candidates = birthdays.map((entry) => {
        const [month, day] = String(entry.monthDay || '').split('/').map((part) => Number(part));
        if (!month || !day) return null;
        const candidate = new Date(startYear, month - 1, day, 12, 0, 0, 0);
        const matchedPerson = findBirthdayPerson(entry, peopleDirectory);
        return {
            ...entry,
            personId: matchedPerson?.id || '',
            personCategory: matchedPerson?.category || '',
            displayName: matchedPerson?.display_name || normalizeBirthdayDisplayName(entry.name),
            address: matchedPerson?.address || '',
            date: candidate.toISOString(),
            weekday: WEEKDAY_LABELS[candidate.getDay()] || ''
        };
    }).filter(Boolean);

    return {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        items: candidates.filter((entry) => {
            const entryDate = new Date(entry.date);
            return entryDate >= range.start && entryDate <= range.end;
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    };
};

const parseTimesheetOrigin = (originId, dueAt = '') => {
    const match = String(originId || '').match(/^timesheets-(\d{4})-(\d{2})-([ab])$/);
    if (!match) {
        return {
            label: String(originId || 'Payroll'),
            payPeriodStart: '',
            payPeriodEnd: '',
            dueAt: dueAt || ''
        };
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const half = match[3];
    let payPeriodStart = null;
    let payPeriodEnd = null;

    if (half === 'a') {
        payPeriodEnd = new Date(year, month, 10, 12, 0, 0, 0);
        payPeriodStart = new Date(year, month - 1, 26, 12, 0, 0, 0);
    } else {
        payPeriodEnd = new Date(year, month, 25, 12, 0, 0, 0);
        payPeriodStart = new Date(year, month, 11, 12, 0, 0, 0);
    }

    return {
        label: `${match[1]}-${match[2]} ${half.toUpperCase()}`,
        payPeriodStart: toDateKey(payPeriodStart),
        payPeriodEnd: toDateKey(payPeriodEnd),
        dueAt: dueAt || ''
    };
};

const findRepoTimesheetDocument = async () => {
    const files = await walkFiles(WORKSPACE_ROOT, 2);
    const match = files.find((filePath) => /timesheet|payroll/i.test(basename(filePath)));
    return match ? {
        name: basename(match),
        path: match
    } : null;
};

const getTaskInstanceMeta = (taskId) => {
    if (!taskId || !tableExists('task_instances')) return null;
    return db.prepare(`
        SELECT ti.id, ti.due_at, ti.list_key, src.origin_type, src.origin_id
        FROM task_instances ti
        LEFT JOIN view_task_source src ON src.task_instance_id = ti.id
        WHERE ti.id = ?
        LIMIT 1
    `).get(taskId);
};

const normalizeBirthdayDisplayName = (value = '') => {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    const commaMatch = text.match(/^([^,]+),\s*(.+)$/);
    if (commaMatch) {
        return `${commaMatch[2]} ${commaMatch[1]}`.replace(/\s+/g, ' ').trim();
    }
    return text;
};

const formatPersonAddress = (row = {}) => {
    const street = [row.address_line1, row.address_line2].filter(Boolean).join(', ');
    const cityStateZip = [
        row.city,
        [row.state, row.postal_code].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
    return [street, cityStateZip].filter(Boolean).join(', ');
};

const getPeopleDirectory = () => {
    if (!tableExists('people')) return [];
    return db.prepare(`
        SELECT
            id,
            display_name,
            category,
            address_line1,
            address_line2,
            city,
            state,
            postal_code
        FROM people
        ORDER BY display_name
    `).all().map((row) => ({
        ...row,
        display_name: String(row.display_name || '').trim(),
        normalized_name: normalizePersonName(row.display_name || ''),
        address: formatPersonAddress(row)
    }));
};

const findBirthdayPerson = (entry, peopleDirectory = []) => {
    const normalizedVariants = Array.from(new Set([
        normalizePersonName(entry?.name || ''),
        normalizePersonName(normalizeBirthdayDisplayName(entry?.name || ''))
    ].filter(Boolean)));
    if (!normalizedVariants.length) return null;

    const exact = peopleDirectory.find((person) => normalizedVariants.includes(person.normalized_name));
    if (exact) return exact;

    const tokens = normalizePersonName(normalizeBirthdayDisplayName(entry?.name || '')).split(' ').filter(Boolean);
    if (tokens.length < 2) return null;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    return peopleDirectory.find((person) => {
        const personTokens = String(person.normalized_name || '').split(' ').filter(Boolean);
        if (personTokens.length < 2) return false;
        const personFirst = personTokens[0];
        const personLast = personTokens[personTokens.length - 1];
        return personLast === last && (personFirst === first || personFirst.startsWith(first) || first.startsWith(personFirst));
    }) || null;
};

const getEventOccurrencePanelContext = (occurrenceId) => {
    if (!occurrenceId || !tableExists('event_occurrences') || !tableExists('events')) return null;
    const row = db.prepare(`
        SELECT
            o.id AS occurrence_id,
            o.date,
            o.start_time,
            o.end_time,
            o.building_id,
            o.notes,
            e.id AS event_id,
            e.title,
            e.description,
            e.metadata,
            t.name AS type_name,
            t.slug AS type_slug,
            c.name AS category_name
        FROM event_occurrences o
        JOIN events e ON e.id = o.event_id
        LEFT JOIN event_types t ON t.id = e.event_type_id
        LEFT JOIN event_categories c ON c.id = t.category_id
        WHERE o.id = ?
        LIMIT 1
    `).get(occurrenceId);
    if (!row) return null;
    return {
        ...row,
        notes: parseNotes(row.notes),
        metadata: parseNotes(row.metadata)
    };
};

const getEventAssignments = (occurrenceId) => {
    if (!occurrenceId || !tableExists('assignments')) return [];
    return db.prepare(`
        SELECT
            a.role_key,
            a.person_id,
            COALESCE(p.display_name, a.person_id) AS display_name,
            COALESCE(p.category, '') AS category
        FROM assignments a
        LEFT JOIN people p ON p.id = a.person_id
        WHERE a.occurrence_id = ?
        ORDER BY a.role_key ASC, COALESCE(p.display_name, a.person_id) ASC
    `).all(occurrenceId);
};

const listEventDocuments = async (occurrenceId, sectionKey = '') => {
    if (!occurrenceId || !tableExists('event_documents')) return [];
    const rows = db.prepare(`
        SELECT id, doc_type, label, file_name, file_path, created_at
        FROM event_documents
        WHERE occurrence_id = ?
        ORDER BY created_at DESC
        LIMIT 24
    `).all(occurrenceId);

    const normalizedSectionKey = String(sectionKey || '').trim().toLowerCase();
    const filtered = rows.filter((row) => {
        if (normalizedSectionKey === 'contracts') return row.doc_type === 'contract';
        if (['bulletin', 'bulletin8', 'bulletin10'].includes(normalizedSectionKey)) {
            return row.doc_type === 'bulletin' || /bulletin/i.test(row.file_name || '');
        }
        if (normalizedSectionKey === 'insert') {
            return /insert/i.test(row.file_name || '') || row.doc_type === 'attachment';
        }
        if (normalizedSectionKey === 'documents') return true;
        return true;
    });

    return Promise.all(filtered.map(async (row, index) => {
        const preview = index < 3 ? await buildDocumentPreview(row.file_path).catch(() => '') : '';
        return {
            id: row.id,
            docType: row.doc_type,
            label: row.label || row.file_name || 'Document',
            name: row.file_name || '',
            path: row.file_path || '',
            createdAt: row.created_at || '',
            preview
        };
    }));
};

const getEventContactSummary = (context = {}) => {
    const template = context.notes?.template && typeof context.notes.template === 'object'
        ? context.notes.template
        : {};
    const metadata = context.metadata && typeof context.metadata === 'object'
        ? context.metadata
        : {};
    return String(
        template.contact_person
        || metadata.contact_person
        || metadata.contactName
        || metadata.family_contact
        || ''
    ).trim();
};

const getSundayLiturgicalContext = (dateKey) => {
    const liturgical = tableExists('liturgical_days')
        ? db.prepare(`
            SELECT feast, color, readings
            FROM liturgical_days
            WHERE date = ?
            LIMIT 1
        `).get(dateKey)
        : null;
    return {
        date: dateKey,
        name: liturgical?.feast || 'Sunday',
        color: liturgical?.color || '',
        readings: liturgical?.readings || ''
    };
};

const getSundayRoster = (dateKey) => {
    const occurrencesByDate = loadSundayOccurrences(dateKey, dateKey);
    const occurrences = Array.isArray(occurrencesByDate?.[dateKey]) ? occurrencesByDate[dateKey] : [];
    return occurrences
        .filter((occurrence) => ['08:00', '10:00'].includes(String(occurrence?.start_time || '')))
        .sort((a, b) => String(a?.start_time || '').localeCompare(String(b?.start_time || '')))
        .map((occurrence) => ({
            time: occurrence.start_time || '',
            rite: occurrence.rite || (String(occurrence.start_time || '').startsWith('08') ? 'Rite I' : 'Rite II'),
            location: occurrence.building_id || '',
            roles: Object.entries(occurrence.roles || {})
                .filter(([, people]) => Array.isArray(people) && people.length > 0)
                .map(([roleKey, people]) => ({
                    roleKey,
                    people
                }))
        }));
};

const getSundayDocuments = async (dateKey) => {
    const [bulletin10Path, bulletin8Path, insertPath] = await Promise.all([
        findBulletinFile(dateKey, '10am'),
        findBulletinFile(dateKey, '8am'),
        findInsertFile(dateKey)
    ]);
    const [bulletin10, bulletin8, insert] = await Promise.all([
        buildDocumentStatus(bulletin10Path, { includePreview: true }),
        buildDocumentStatus(bulletin8Path, { includePreview: true }),
        buildDocumentStatus(insertPath, { includePreview: true })
    ]);
    return { bulletin10, bulletin8, insert };
};

const buildMailPanel = async () => ({
    kind: 'mail',
    title: 'Mail',
    lastCheckedAt: getLastMailCheckedAt(),
    autoProgress: false
});

const buildDepositsPanel = async () => ({
    kind: 'deposits',
    title: 'Deposits',
    history: await buildFileHistory({
        roots: [DEPOSITS_ROOT],
        limit: 18,
        maxDepth: 3,
        includeFile: (filePath) => extname(filePath).toLowerCase() === '.pdf'
    }),
    branch: {
        ...BANK_BRANCH,
        ...getBranchStatus()
    },
    autoProgress: false
});

const buildReceivablesPanel = async () => ({
    kind: 'receivables',
    title: 'Receivables',
    history: await buildFileHistory({
        roots: [RECEIVABLES_CANONICAL_ROOT, RECEIVABLES_LOCAL_ROOT],
        limit: 18,
        maxDepth: 2,
        includeFile: (filePath) => extname(filePath).toLowerCase() === '.pdf'
    }),
    autoProgress: false
});

const buildPayablesPanel = async () => ({
    kind: 'payables',
    title: 'Payables',
    history: await buildFileHistory({
        roots: [PAYABLES_CANONICAL_ROOT, PAYABLES_LOCAL_ROOT],
        limit: 18,
        maxDepth: 2,
        includeFile: (filePath) => extname(filePath).toLowerCase() === '.pdf'
    }),
    autoProgress: false
});

const buildBirthdaysPanel = async () => ({
    kind: 'birthdays',
    title: 'Birthday Cards',
    upcoming: getUpcomingBirthdays(),
    autoProgress: false
});

const buildPayrollPanel = async (taskMeta = null) => {
    const timesheetOriginId = String(taskMeta?.origin_id || '');
    const period = parseTimesheetOrigin(timesheetOriginId, taskMeta?.due_at || '');
    const history = await buildFileHistory({
        roots: [PAYROLL_ROOT],
        limit: 18,
        maxDepth: 2,
        includeFile: (filePath) => /\.(pdf|docx?|xlsx?)$/i.test(filePath)
    });
    const repoDocument = await findRepoTimesheetDocument();
    return {
        kind: 'payroll',
        title: 'Payroll',
        period,
        history,
        repoDocument: repoDocument || (history.files[0] ? {
            name: history.files[0].name,
            path: history.files[0].path
        } : null),
        autoProgress: !!(repoDocument?.path || history.files[0]?.path)
    };
};

const buildSundayPanel = async (dateKey, sectionKey) => {
    const [liturgical, documents] = await Promise.all([
        Promise.resolve(getSundayLiturgicalContext(dateKey)),
        getSundayDocuments(dateKey)
    ]);
    return {
        kind: 'sunday',
        title: 'Sunday Planning',
        context: liturgical,
        selectedView: sectionKey || 'bulletin10',
        documents,
        roster: getSundayRoster(dateKey),
        autoProgress: ['bulletin8', 'bulletin10', 'insert'].includes(String(sectionKey || '').toLowerCase())
            && !!(documents.bulletin8?.path || documents.bulletin10?.path || documents.insert?.path)
    };
};

const buildEventPanel = async (occurrenceId, sectionKey) => {
    const context = getEventOccurrencePanelContext(occurrenceId);
    if (!context) {
        return {
            kind: 'empty',
            title: 'Task Data'
        };
    }
    const normalizedSectionKey = String(sectionKey || '').trim().toLowerCase();
    const assignments = getEventAssignments(occurrenceId);
    const documents = await listEventDocuments(occurrenceId, normalizedSectionKey);
    const roleGroups = assignments.reduce((acc, row) => {
        const key = String(row.role_key || '').trim() || 'people';
        if (!acc[key]) {
            acc[key] = {
                roleKey: key,
                people: []
            };
        }
        acc[key].people.push({
            id: row.person_id,
            displayName: row.display_name,
            category: row.category || 'parishioner'
        });
        return acc;
    }, {});
    return {
        kind: 'event',
        title: context.title || context.type_name || 'Event',
        selectedView: normalizedSectionKey || 'people',
        context: {
            occurrenceId: context.occurrence_id,
            eventId: context.event_id,
            title: context.title || 'Event',
            typeName: context.type_name || 'Event',
            categoryName: context.category_name || '',
            date: context.date || '',
            startTime: context.start_time || '',
            endTime: context.end_time || '',
            buildingId: context.building_id || '',
            description: context.description || '',
            contactPerson: getEventContactSummary(context)
        },
        notes: {
            internal: String(context.notes?.internal || '').trim()
        },
        roleGroups: Object.values(roleGroups),
        documents,
        autoProgress: (
            ['bulletin', 'bulletin8', 'bulletin10', 'insert', 'documents', 'contracts'].includes(normalizedSectionKey)
            && documents.some((document) => document.path)
        ) || (
            ['clergy', 'music', 'people', 'roles'].includes(normalizedSectionKey)
            && assignments.length > 0
        )
    };
};

export const getTaskPanelData = async ({
    originType = '',
    originId = '',
    sectionKey = '',
    taskId = ''
} = {}) => {
    const normalizedOriginType = String(originType || '').trim().toLowerCase();
    const normalizedSectionKey = String(sectionKey || '').trim().toLowerCase();
    const taskMeta = getTaskInstanceMeta(taskId);

    if (normalizedOriginType === 'sunday' && originId) {
        return buildSundayPanel(originId, normalizedSectionKey);
    }
    if (normalizedOriginType === 'event' && originId) {
        return buildEventPanel(originId, normalizedSectionKey);
    }

    if (normalizedSectionKey === 'mail') {
        return buildMailPanel();
    }
    if (normalizedSectionKey === 'deposits') {
        return buildDepositsPanel();
    }
    if (normalizedSectionKey === 'donations' || normalizedSectionKey === 'receivables') {
        return buildReceivablesPanel();
    }
    if (normalizedSectionKey === 'bills' || normalizedSectionKey === 'payables') {
        return buildPayablesPanel();
    }
    if (normalizedSectionKey === 'birthdays' || normalizedSectionKey === 'birthday') {
        return buildBirthdaysPanel();
    }
    if (normalizedSectionKey === 'timesheets' || normalizedSectionKey === 'payroll') {
        return buildPayrollPanel(taskMeta);
    }
    if (normalizedSectionKey === 'orders' || normalizedSectionKey === 'ordering') {
        return await buildOrdersPanelData();
    }

    if (normalizedOriginType === 'sunday' && originId) {
        return buildSundayPanel(originId, normalizedSectionKey);
    }
    if (normalizedOriginType === 'event' && originId) {
        return buildEventPanel(originId, normalizedSectionKey);
    }

    return {
        kind: 'empty',
        title: 'Task Data'
    };
};
