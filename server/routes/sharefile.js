import express from 'express';
import multer from 'multer';
import { google } from 'googleapis';
import xlsx from 'xlsx';
import { resolve } from 'path';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { sqlite as db } from '../db.js';
import {
    requireAuth,
    requireAdmin,
    saveSharefileGmailTokens,
    getSharefileGmailTokens,
    getUserTokens,
    getSharefileRoutingAccounts,
    ensureSharefileRoutingAccount,
    setDefaultSharefileRoutingAccount,
    removeSharefileRoutingAccount,
    getDefaultSharefileRoutingAccountUserId
} from '../helpers/auth.js';
import { loadBudgetCodes } from '../helpers/budget-utils.js';
import {
    routeShareFileEmails,
    routeSharefileMessage,
    resolveSharefileMessageId,
    recordSharefileRoutingEvent,
    analyzeSharefilePdf,
    routeSharefilePdf
} from '../services/sharefileEmailRouter.js';
import { getAuthUrlWithRedirect, getTokensFromCodeWithRedirect, GOOGLE_SCOPES } from '../googleAuth.js';

const router = express.Router();
const pdfUpload = multer({
    dest: `${tmpdir()}\\sharefile-pdf-uploads`
});
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SHAREFILE_REDIRECT_URI = process.env.SHAREFILE_GOOGLE_REDIRECT_URI
    || (process.env.GOOGLE_REDIRECT_URI
        ? process.env.GOOGLE_REDIRECT_URI.replace('/auth/google/callback', '/auth/google/sharefile/callback')
        : '');
const SHAREFILE_EXTENSION_TOKEN = process.env.SHAREFILE_EXTENSION_TOKEN || '';
const SHAREFILE_EXTENSION_USER_ID = process.env.SHAREFILE_EXTENSION_USER_ID || '';
const SHAREFILE_EXTENSION_EMAIL = process.env.SHAREFILE_EXTENSION_EMAIL || '';
const SHAREFILE_DEBUG = String(process.env.SHAREFILE_DEBUG || '0') === '1';

const sharefileDebugLog = (...args) => {
    if (!SHAREFILE_DEBUG) return;
    console.log('[ShareFile Debug]', ...args);
};

const summarizeGoogleError = (error) => ({
    code: Number(error?.code || error?.response?.status || 0) || null,
    status: Number(error?.response?.status || 0) || null,
    message: String(error?.message || '').slice(0, 300)
});

const getExtensionGmailTokenCandidates = () => {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (userId, email, tokens) => {
        if (!tokens) return;
        const key = String(userId || '').trim() || String(email || '').trim();
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        candidates.push({ userId: userId || '', email: email || '', tokens });
    };

    if (SHAREFILE_EXTENSION_USER_ID) {
        pushCandidate(SHAREFILE_EXTENSION_USER_ID, '', getUserTokens(SHAREFILE_EXTENSION_USER_ID));
    }
    if (SHAREFILE_EXTENSION_EMAIL) {
        const user = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(SHAREFILE_EXTENSION_EMAIL);
        if (user?.id) {
            pushCandidate(user.id, SHAREFILE_EXTENSION_EMAIL, getUserTokens(user.id));
        }
    }

    const linkedAccounts = getSharefileRoutingAccounts().filter((account) => account.enabled);
    linkedAccounts.forEach((account) => {
        pushCandidate(account.userId, account.email, getUserTokens(account.userId));
    });
    if (candidates.length > 0) return candidates;

    pushCandidate('sharefile-gmail', '', getSharefileGmailTokens());
    return candidates;
};

const requireSharefileAuth = (req, res, next) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token && SHAREFILE_EXTENSION_TOKEN && token === SHAREFILE_EXTENSION_TOKEN) {
        return next();
    }
    if (req.user) {
        return next();
    }
    return res.status(401).json({ error: 'Invalid or missing token' });
};

const parseLegacyMessageId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^#?msg-f:/i, '');
    if (!/^\d+$/.test(cleaned)) return null;
    try {
        return BigInt(cleaned).toString(16);
    } catch {
        return null;
    }
};

const isApiMessageId = (value) => /^[0-9a-f]{10,}$/i.test(String(value || '').trim());

const normalizeMessageId = (gmail = {}) => {
    const direct = String(gmail.messageId || '').trim();
    if (direct) {
        if (isApiMessageId(direct)) {
            return direct;
        }
        if (/^#?msg-f:/i.test(direct)) {
            const parsed = parseLegacyMessageId(direct);
            if (parsed) return parsed;
        }
        // Ignore Gmail DOM ids like "#msg-a:r..." and resolve from threadId instead.
        if (/^#?msg-[a-z]:/i.test(direct)) {
            return null;
        }
        return null;
    }
    const legacy = parseLegacyMessageId(gmail.webMessageDomId || '');
    return legacy || null;
};

const parseThreadFromGmailHref = (href) => {
    const raw = String(href || '').trim();
    if (!raw) return '';

    try {
        const hash = (raw.split('#')[1] || '').trim();
        if (!hash) return '';
        const parts = hash.split('/').filter(Boolean);
        const maybeId = parts.at(-1) || '';
        return /^[0-9a-f]{10,}$/i.test(maybeId) ? maybeId : '';
    } catch {
        return '';
    }
};

const fetchGoogleProfile = async (tokens) => {
    const oauth2 = google.oauth2('v2');
    const response = await oauth2.userinfo.get({ access_token: tokens.access_token });
    return response.data;
};

router.get('/api/sharefile/google/auth-url', requireAuth, (_req, res) => {
    if (!SHAREFILE_REDIRECT_URI) {
        return res.status(500).json({ error: 'Missing SHAREFILE_GOOGLE_REDIRECT_URI' });
    }
    res.json({ url: getAuthUrlWithRedirect(SHAREFILE_REDIRECT_URI), scopes: GOOGLE_SCOPES });
});

router.get('/auth/google/sharefile/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        if (!SHAREFILE_REDIRECT_URI) {
            return res.status(500).send('Missing SHAREFILE_GOOGLE_REDIRECT_URI');
        }
        const tokens = await getTokensFromCodeWithRedirect(code, SHAREFILE_REDIRECT_URI);
        const profile = await fetchGoogleProfile(tokens);
        const userId = `google-${profile.id}`;
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO users (id, email, display_name, avatar_url, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url
        `).run(
            userId,
            profile.email || '',
            profile.name || profile.email || 'ShareFile Gmail',
            profile.picture || '',
            now
        );
        db.prepare(`
            INSERT INTO user_tokens (id, user_id, access_token, refresh_token, expiry_date, scope, token_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expiry_date = excluded.expiry_date,
                scope = excluded.scope,
                token_type = excluded.token_type
        `).run(
            `token-sharefile-${userId}`,
            userId,
            tokens.access_token || null,
            tokens.refresh_token || null,
            tokens.expiry_date || null,
            tokens.scope || null,
            tokens.token_type || null,
            now
        );
        ensureSharefileRoutingAccount(userId);
        // Keep legacy fallback token in sync for backwards compatibility.
        saveSharefileGmailTokens(tokens);
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('ShareFile Gmail OAuth callback error:', error);
        res.status(500).send('Authentication failed');
    }
});

router.get('/api/sharefile/google/status', requireAuth, (_req, res) => {
    const accounts = getSharefileRoutingAccounts();
    const defaultUserId = getDefaultSharefileRoutingAccountUserId();
    const defaultAccount = accounts.find((account) => account.userId === defaultUserId)
        || accounts.find((account) => account.connected)
        || null;
    res.json({
        connected: accounts.some((account) => account.connected),
        account: defaultAccount ? { email: defaultAccount.email, display_name: defaultAccount.displayName } : null,
        accounts
    });
});

router.get('/api/sharefile/google/accounts', requireAdmin, (_req, res) => {
    const accounts = getSharefileRoutingAccounts();
    res.json({ ok: true, accounts });
});

router.post('/api/sharefile/google/accounts/default', requireAdmin, (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    const ok = setDefaultSharefileRoutingAccount(userId);
    if (!ok) return res.status(404).json({ ok: false, error: 'Account not found' });
    return res.json({ ok: true });
});

router.post('/api/sharefile/google/accounts/disconnect', requireAdmin, (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    const ok = removeSharefileRoutingAccount(userId, { removeTokens: true });
    if (!ok) return res.status(404).json({ ok: false, error: 'Account not found' });
    return res.json({ ok: true });
});

router.post('/api/sharefile/route-emails', requireAdmin, async (req, res) => {
    try {
        const result = await routeShareFileEmails({
            archive: false
        });
        res.json(result);
    } catch (error) {
        console.error('ShareFile route emails error:', error);
        res.status(500).json({ error: error?.message || 'Failed to route emails' });
    }
});

router.post('/api/sharefile/route-email', requireSharefileAuth, async (req, res) => {
    const payload = req.body || {};
    const gmail = payload.gmail || {};
    const href = gmail.href || payload?.page?.url || '';
    const threadFromHref = parseThreadFromGmailHref(href);
    const normalizedMessageId = normalizeMessageId(gmail);
    const effectiveThreadId = gmail.threadId || threadFromHref || null;
    const extraMeta = {
        codeType: payload.codeType,
        codeValue: payload.codeValue,
        routeKind: payload.routeKind,
        designation: payload.designation,
        vendor: payload.vendor,
        amount: payload.amount,
        clientTs: payload.client?.ts || ''
    };
    const normalizedRouteKind = String(extraMeta.routeKind || '').trim().toUpperCase();
    const normalizedCodeValue = String(extraMeta.codeValue || '').trim();
    const normalizedDesignation = String(extraMeta.designation || '').trim();
    const normalizedVendor = String(extraMeta.vendor || '').trim();

    if (!['BILL', 'DB', 'EFT', 'CHECK', 'CONTRIBUTION'].includes(normalizedRouteKind)) {
        return res.status(400).json({ error: 'Unsupported routeKind' });
    }
    if (normalizedRouteKind === 'CONTRIBUTION') {
        if (!normalizedCodeValue && !normalizedDesignation) {
            return res.status(400).json({ error: 'Contribution routing requires envelope number or designation' });
        }
        extraMeta.codeType = 'envelope';
    } else {
        if (!normalizedCodeValue) {
            return res.status(400).json({ error: 'AP routing requires a budget code' });
        }
        extraMeta.codeType = 'budget';
    }
    extraMeta.codeValue = normalizedCodeValue;
    extraMeta.designation = normalizedDesignation;
    extraMeta.vendor = normalizedVendor;
    extraMeta.amount = String(extraMeta.amount || '').trim();

    try {
        const tokenCandidates = getExtensionGmailTokenCandidates();
        if (!normalizedMessageId) {
            const message = 'Unable to resolve a specific Gmail messageId for routing';
            recordSharefileRoutingEvent({
                messageId: null,
                threadId: effectiveThreadId,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'failure',
                errorText: message
            });
            return res.status(400).json({ error: message });
        }
        sharefileDebugLog('route-email request', {
            providedMessageId: gmail.messageId || null,
            normalizedMessageId,
            providedThreadId: gmail.threadId || null,
            threadFromHref: threadFromHref || null,
            effectiveThreadId,
            codeType: extraMeta.codeType || '',
            codeValue: extraMeta.codeValue || '',
            candidateCount: tokenCandidates.length,
            extensionUserOverride: SHAREFILE_EXTENSION_USER_ID || null,
            extensionEmailOverride: SHAREFILE_EXTENSION_EMAIL || null
        });
        if (!tokenCandidates.length) {
            recordSharefileRoutingEvent({
                messageId: normalizedMessageId,
                threadId: effectiveThreadId,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'failure',
                errorText: 'No Gmail tokens configured for ShareFile extension'
            });
            return res.status(400).json({ error: 'No Gmail tokens configured for ShareFile extension' });
        }
        let lastError = null;
        for (const candidate of tokenCandidates) {
            try {
                sharefileDebugLog('route-email trying candidate', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    messageId: normalizedMessageId,
                    threadId: effectiveThreadId
                });
                const result = await routeSharefileMessage({
                    messageId: normalizedMessageId,
                    threadId: effectiveThreadId,
                    extraMeta,
                    archive: false,
                    messageOnly: true,
                    allowIdempotent: false,
                    tokensOverride: candidate.tokens
                });
                sharefileDebugLog('route-email candidate success', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    idempotent: !!result?.idempotent
                });
                return res.json({
                    ...result,
                    routedBy: {
                        userId: candidate.userId,
                        email: candidate.email || null
                    }
                });
            } catch (error) {
                lastError = error;
                sharefileDebugLog('route-email candidate failed', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    error: summarizeGoogleError(error)
                });
                const text = String(error?.message || '');
                const accountNotMatch = text.includes('Requested entity was not found.') || text.includes('Invalid id value');
                if (accountNotMatch) continue;
                throw error;
            }
        }
        sharefileDebugLog('route-email no matching candidate', {
            messageId: normalizedMessageId,
            threadId: effectiveThreadId,
            lastError: summarizeGoogleError(lastError)
        });
        throw lastError || new Error('No matching Gmail account found for this message');
    } catch (error) {
        console.error('ShareFile route email error:', error);
        recordSharefileRoutingEvent({
            messageId: normalizedMessageId,
            threadId: effectiveThreadId,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'failure',
            errorText: error?.message || 'Failed to route email'
        });
        res.status(500).json({ error: error?.message || 'Failed to route email' });
    }
});

router.post('/api/sharefile/analyze-pdf', requireAuth, pdfUpload.single('file'), async (req, res) => {
    const uploadPath = String(req.file?.path || '').trim();
    try {
        if (!uploadPath) {
            return res.status(400).json({ ok: false, error: 'PDF file is required' });
        }
        const pdfBytes = await readFile(uploadPath);
        const analysis = await analyzeSharefilePdf({
            pdfBytes,
            sourcePdfPath: uploadPath,
            routeKind: String(req.body?.routeKind || 'BILL').trim() || 'BILL'
        });
        return res.json({ ok: true, analysis });
    } catch (error) {
        console.error('ShareFile analyze PDF error:', error);
        return res.status(500).json({ ok: false, error: error?.message || 'Failed to analyze PDF' });
    } finally {
        if (uploadPath) {
            await rm(uploadPath, { force: true }).catch(() => { });
        }
    }
});

router.post('/api/sharefile/route-pdf', requireAuth, pdfUpload.single('file'), async (req, res) => {
    const uploadPath = String(req.file?.path || '').trim();
    try {
        const codeValue = String(req.body?.codeValue || '').trim();
        if (!uploadPath) {
            return res.status(400).json({ ok: false, error: 'PDF file is required' });
        }
        if (!codeValue) {
            return res.status(400).json({ ok: false, error: 'Budget code is required' });
        }

        const pdfBytes = await readFile(uploadPath);
        const result = await routeSharefilePdf({
            pdfBytes,
            sourcePdfPath: uploadPath,
            originalFilename: String(req.file?.originalname || '').trim(),
            extraMeta: {
                codeType: 'budget',
                codeValue,
                routeKind: String(req.body?.routeKind || 'BILL').trim() || 'BILL',
                vendor: String(req.body?.vendor || '').trim(),
                amount: String(req.body?.amount || '').trim(),
                clientTs: new Date().toISOString()
            }
        });
        return res.json(result);
    } catch (error) {
        console.error('ShareFile route PDF error:', error);
        return res.status(500).json({ ok: false, error: error?.message || 'Failed to route PDF' });
    } finally {
        if (uploadPath) {
            await rm(uploadPath, { force: true }).catch(() => { });
        }
    }
});

router.post('/api/sharefile/resolve-message-id', requireSharefileAuth, async (req, res) => {
    try {
        const tokenCandidates = getExtensionGmailTokenCandidates();
        if (!tokenCandidates.length) {
            return res.status(400).json({ error: 'No Gmail tokens configured for ShareFile extension' });
        }
        const threadId = String(req.body?.threadId || '').trim();
        if (!threadId) {
            return res.status(400).json({ error: 'threadId is required' });
        }
        sharefileDebugLog('resolve-message-id request', {
            threadId,
            candidateCount: tokenCandidates.length
        });
        for (const candidate of tokenCandidates) {
            const messageId = await resolveSharefileMessageId(threadId, candidate.tokens).catch((error) => {
                sharefileDebugLog('resolve-message-id candidate failed', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    threadId,
                    error: summarizeGoogleError(error)
                });
                return null;
            });
            if (messageId) {
                sharefileDebugLog('resolve-message-id candidate success', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    threadId,
                    messageId
                });
                return res.json({
                    ok: true,
                    messageId,
                    threadId,
                    resolvedBy: { userId: candidate.userId, email: candidate.email || null }
                });
            }
        }
        res.json({ ok: true, messageId: null, threadId });
    } catch (error) {
        console.error('ShareFile resolve message id error:', error);
        res.status(500).json({ error: error?.message || 'Failed to resolve messageId' });
    }
});

const loadEnvelopeNumbers = () => {
    const filePath = resolve(process.cwd(), 'envelope_numbers.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const entries = rows
        .map((row) => {
            const number = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!number || !name) return null;
            return {
                number,
                name,
                letter: name.charAt(0).toUpperCase()
            };
        })
        .filter(Boolean);
    return entries;
};

router.get('/api/sharefile/budget-codes', requireSharefileAuth, (_req, res) => {
    try {
        const entries = loadBudgetCodes();
        res.json({ ok: true, entries });
    } catch (error) {
        console.error('Budget codes load error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load budget codes' });
    }
});

router.get('/api/sharefile/envelope-numbers', requireSharefileAuth, (_req, res) => {
    try {
        const entries = loadEnvelopeNumbers();
        res.json({ ok: true, entries });
    } catch (error) {
        console.error('Envelope numbers load error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load envelope numbers' });
    }
});

export default router;

