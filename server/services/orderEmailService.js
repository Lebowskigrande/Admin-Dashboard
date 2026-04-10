import { google } from 'googleapis';

import {
    getSharefileGmailTokens,
    getSharefileRoutingAccounts,
    getUserTokens
} from '../helpers/auth.js';
import { extractGmailMessageText } from '../helpers/hgk-utils.js';
import { createOAuthClient, setStoredCredentials } from '../googleAuth.js';

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

    const multiItemMatch = subjectText.match(/^(?:\d+\s+)?["â€œ]?([^"â€]+?)["â€]?\s+and\s+(\d+)\s+more items?/i);
    if (multiItemMatch?.[1]) {
        return normalizePackageText(`${multiItemMatch[1]} + ${multiItemMatch[2]} more items`);
    }

    const quotedMatch = subjectText.match(/["â€œ]([^"â€]+)["â€]/);
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
    if (status === 'delivered' || status === 'out_for_delivery') {
        score += 5;
    } else if (status === 'shipped') {
        score += 4;
    } else if (status === 'ordered') {
        score += 3;
    } else if (matchesAnyPattern(normalizedSubject, MAIL_WEAK_SUBJECT_PATTERNS)) {
        score += 2;
    }

    const bodySignalCount = MAIL_BODY_PATTERNS.reduce((count, pattern) => (
        pattern.test(combinedText) ? count + 1 : count
    ), 0);
    if (bodySignalCount >= 3) score += 4;
    else if (bodySignalCount >= 2) score += 2;
    else if (bodySignalCount >= 1) score += 1;

    if (MAIL_TRANSACTIONAL_DOMAINS.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
        score += 3;
    }
    if (MAIL_PROMO_DOMAINS.some((candidate) => domain.includes(candidate))) {
        score -= 3;
    }

    const promoSignalCount = MAIL_PROMO_PATTERNS.reduce((count, pattern) => (
        pattern.test(combinedText) ? count + 1 : count
    ), 0);
    if (promoSignalCount >= 2) score -= 5;
    else if (promoSignalCount >= 1) score -= 2;

    if (/\bunsubscribe\b/i.test(normalizedSnippet) && !/\btracking\b/i.test(combinedText)) {
        score -= 2;
    }

    return {
        status,
        confidence: status && score >= 5 ? 'high' : 'ignore',
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

export const getTrackedEmailOrders = async () => {
    const gmailClient = getGmailClient();
    if (!gmailClient?.gmail) {
        return {
            connected: false,
            refreshedAt: new Date().toISOString(),
            mailbox: '',
            packages: [],
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
                return buildPackageEvent({
                    messageId: entry.id,
                    threadId: String(response.data?.threadId || '').trim(),
                    subject: extractHeader(headers, 'Subject'),
                    from: extractHeader(headers, 'From'),
                    date: extractHeader(headers, 'Date'),
                    snippet: String(response.data?.snippet || '').trim(),
                    body: extractGmailMessageText(response.data) || ''
                });
            } catch {
                return null;
            }
        }));
        return {
            connected: true,
            refreshedAt: new Date().toISOString(),
            mailbox,
            packages: summarizePackages(messageDetails.filter(Boolean))
        };
    } catch (error) {
        return {
            connected: true,
            refreshedAt: new Date().toISOString(),
            mailbox: gmailClient.mailbox || '',
            packages: [],
            note: error?.message || 'Unable to read office Gmail.'
        };
    }
};
