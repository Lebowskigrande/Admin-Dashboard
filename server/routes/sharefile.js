import express from 'express';
import { google } from 'googleapis';
import xlsx from 'xlsx';
import { resolve } from 'path';
import { sqlite as db } from '../db.js';
import {
    requireAuth,
    saveSharefileGmailTokens,
    getSharefileGmailTokens,
    getUserTokens,
    getSharefileRoutingAccounts,
    ensureSharefileRoutingAccount,
    setDefaultSharefileRoutingAccount,
    removeSharefileRoutingAccount,
    getDefaultSharefileRoutingAccountUserId
} from '../helpers/auth.js';
import { routeShareFileEmails, routeSharefileMessage, resolveSharefileMessageId, recordSharefileRoutingEvent } from '../services/sharefileEmailRouter.js';
import { getAuthUrlWithRedirect, getTokensFromCodeWithRedirect, GOOGLE_SCOPES } from '../googleAuth.js';
import {
    recordAdminAction,
    hasRequiredConfirmation,
    CONFIRM_ROUTE_ALL_PHRASE
} from '../helpers/adminAudit.js';

const router = express.Router();
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

const getErrorCode = (error) => Number(error?.code || error?.response?.status || 0) || 0;

const isAccountMismatchError = (error) => {
    const text = String(error?.message || '').toLowerCase();
    return text.includes('requested entity was not found')
        || text.includes('invalid id value');
};

const isCredentialError = (error) => {
    const code = getErrorCode(error);
    const text = String(error?.message || '').toLowerCase();
    if (code === 401 || code === 403) return true;
    return text.includes('invalid_grant')
        || text.includes('invalid credentials')
        || text.includes('unauthorized');
};

const isRetriableRoutingError = (error) => {
    const code = getErrorCode(error);
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(code)) return true;
    const text = String(error?.message || '').toLowerCase();
    return text.includes('timeout')
        || text.includes('temporar')
        || text.includes('econnreset')
        || text.includes('eai_again')
        || text.includes('enotfound')
        || text.includes('network');
};

const getExtensionGmailTokenCandidates = () => {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (userId, email, tokens, source = 'linked') => {
        if (!tokens) return;
        const key = String(userId || '').trim() || String(email || '').trim();
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        candidates.push({ userId: userId || '', email: email || '', tokens, source });
    };

    // Optional extension hints should influence ordering but never hard-pin routing.
    if (SHAREFILE_EXTENSION_USER_ID) {
        pushCandidate(
            SHAREFILE_EXTENSION_USER_ID,
            '',
            getUserTokens(SHAREFILE_EXTENSION_USER_ID),
            'env-user-id'
        );
    }
    if (SHAREFILE_EXTENSION_EMAIL) {
        const user = db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(SHAREFILE_EXTENSION_EMAIL);
        if (user?.id) {
            pushCandidate(user.id, SHAREFILE_EXTENSION_EMAIL, getUserTokens(user.id), 'env-email');
        }
    }

    const linkedAccounts = getSharefileRoutingAccounts()
        .filter((account) => account.enabled && account.connected)
        .sort((a, b) => {
            const defaultDiff = Number(b.isDefault) - Number(a.isDefault);
            if (defaultDiff !== 0) return defaultDiff;
            const createdDiff = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
            if (createdDiff !== 0) return createdDiff;
            return String(a.userId || '').localeCompare(String(b.userId || ''));
        });
    linkedAccounts.forEach((account) => {
        pushCandidate(account.userId, account.email, getUserTokens(account.userId), 'linked');
    });
    if (candidates.length > 0) return candidates;

    pushCandidate('sharefile-gmail', '', getSharefileGmailTokens(), 'legacy-default');
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

const normalizeMessageId = (gmail = {}) => {
    const direct = String(gmail.messageId || '').trim();
    if (direct) {
        if (/^#?msg-f:/i.test(direct)) {
            const parsed = parseLegacyMessageId(direct);
            if (parsed) return parsed;
        }
        return direct;
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

router.get('/api/sharefile/google/accounts', requireAuth, (_req, res) => {
    const accounts = getSharefileRoutingAccounts();
    res.json({ ok: true, accounts });
});

router.post('/api/sharefile/google/accounts/default', requireAuth, (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    const ok = setDefaultSharefileRoutingAccount(userId);
    if (!ok) {
        recordAdminAction({
            req,
            action: 'sharefile.account.default',
            target: userId,
            status: 'failure',
            errorText: 'Account not found'
        });
        return res.status(404).json({ ok: false, error: 'Account not found' });
    }
    recordAdminAction({
        req,
        action: 'sharefile.account.default',
        target: userId,
        status: 'success'
    });
    return res.json({ ok: true });
});

router.post('/api/sharefile/google/accounts/disconnect', requireAuth, (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    const ok = removeSharefileRoutingAccount(userId, { removeTokens: true });
    if (!ok) {
        recordAdminAction({
            req,
            action: 'sharefile.account.disconnect',
            target: userId,
            status: 'failure',
            errorText: 'Account not found'
        });
        return res.status(404).json({ ok: false, error: 'Account not found' });
    }
    recordAdminAction({
        req,
        action: 'sharefile.account.disconnect',
        target: userId,
        status: 'success'
    });
    return res.json({ ok: true });
});

router.post('/api/sharefile/route-emails', requireAuth, async (req, res) => {
    try {
        if (!hasRequiredConfirmation(req.body?.confirmPhrase, CONFIRM_ROUTE_ALL_PHRASE)) {
            recordAdminAction({
                req,
                action: 'sharefile.route_emails',
                status: 'rejected',
                errorText: 'Missing confirmation phrase',
                details: { requiredPhrase: CONFIRM_ROUTE_ALL_PHRASE }
            });
            return res.status(400).json({
                error: `Confirmation required. Send confirmPhrase="${CONFIRM_ROUTE_ALL_PHRASE}" to proceed.`
            });
        }
        const result = await routeShareFileEmails({
            archive: true
        });
        recordAdminAction({
            req,
            action: 'sharefile.route_emails',
            status: 'success',
            details: { processed: Number(result?.processed || 0) }
        });
        res.json(result);
    } catch (error) {
        console.error('ShareFile route emails error:', error);
        recordAdminAction({
            req,
            action: 'sharefile.route_emails',
            status: 'failure',
            errorText: error?.message || 'Failed to route emails'
        });
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
        clientTs: payload.client?.ts || ''
    };
    const attempts = [];

    try {
        const tokenCandidates = getExtensionGmailTokenCandidates();
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
            const errorText = 'No Gmail tokens configured for ShareFile extension';
            recordSharefileRoutingEvent({
                messageId: normalizedMessageId,
                threadId: effectiveThreadId,
                codeType: extraMeta.codeType,
                codeValue: extraMeta.codeValue,
                status: 'failure',
                errorText,
                output: {
                    diagnostics: {
                        attempted: 0,
                        failed: 1,
                        retriable: 0,
                        attempts: []
                    }
                }
            });
            return res.status(400).json({ error: errorText });
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
                    archive: true,
                    tokensOverride: candidate.tokens
                });
                attempts.push({
                    userId: candidate.userId || '',
                    email: candidate.email || '',
                    source: candidate.source || 'linked',
                    status: 'success',
                    retriable: false
                });
                const failedAttempts = attempts.filter((attempt) => attempt.status === 'failure');
                const diagnostics = {
                    attempted: attempts.length,
                    failed: failedAttempts.length,
                    retriable: failedAttempts.filter((attempt) => attempt.retriable).length,
                    attempts
                };
                sharefileDebugLog('route-email candidate success', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    idempotent: !!result?.idempotent,
                    diagnostics
                });
                return res.json({
                    ...result,
                    routedBy: {
                        userId: candidate.userId,
                        email: candidate.email || null
                    },
                    routingDiagnostics: diagnostics
                });
            } catch (error) {
                lastError = error;
                const retriable = isRetriableRoutingError(error);
                const accountMismatch = isAccountMismatchError(error);
                const credentialError = isCredentialError(error);
                attempts.push({
                    userId: candidate.userId || '',
                    email: candidate.email || '',
                    source: candidate.source || 'linked',
                    status: 'failure',
                    retriable,
                    accountMismatch,
                    credentialError,
                    error: summarizeGoogleError(error)
                });
                sharefileDebugLog('route-email candidate failed', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    error: summarizeGoogleError(error)
                });
                if (accountMismatch || credentialError) continue;
                throw error;
            }
        }
        const failedAttempts = attempts.filter((attempt) => attempt.status === 'failure');
        const diagnostics = {
            attempted: attempts.length,
            failed: failedAttempts.length,
            retriable: failedAttempts.filter((attempt) => attempt.retriable).length,
            attempts
        };
        sharefileDebugLog('route-email no matching candidate', {
            messageId: normalizedMessageId,
            threadId: effectiveThreadId,
            lastError: summarizeGoogleError(lastError),
            diagnostics
        });
        throw lastError || new Error('No matching Gmail account found for this message');
    } catch (error) {
        console.error('ShareFile route email error:', error);
        const retriable = isRetriableRoutingError(error);
        const failedAttempts = attempts.filter((attempt) => attempt.status === 'failure');
        recordSharefileRoutingEvent({
            messageId: normalizedMessageId,
            threadId: effectiveThreadId,
            codeType: extraMeta.codeType,
            codeValue: extraMeta.codeValue,
            status: 'failure',
            errorText: error?.message || 'Failed to route email',
            output: {
                diagnostics: {
                    attempted: attempts.length,
                    failed: failedAttempts.length || 1,
                    retriable: failedAttempts.filter((attempt) => attempt.retriable).length || (retriable ? 1 : 0),
                    attempts
                }
            }
        });
        res.status(500).json({ error: error?.message || 'Failed to route email' });
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
                const accountMismatch = isAccountMismatchError(error);
                const credentialError = isCredentialError(error);
                sharefileDebugLog('resolve-message-id candidate failed', {
                    userId: candidate.userId || '',
                    email: candidate.email || null,
                    threadId,
                    accountMismatch,
                    credentialError,
                    error: summarizeGoogleError(error)
                });
                if (accountMismatch || credentialError) return null;
                throw error;
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

const loadBudgetCodes = () => {
    const filePath = resolve(process.cwd(), 'budget_codes.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const entries = [];
    let currentCategory = '';

    rows.forEach((row) => {
        const category = String(row[0] || '').trim();
        const codeRaw = String(row[1] || '').trim();
        const line = String(row[2] || '').trim();

        if (category) {
            currentCategory = category;
        }
        if (!currentCategory) return;

        if (line.toLowerCase() === 'div') {
            // Ignore divider marker rows; UI should render a flat category list.
            return;
        }

        if (!codeRaw) {
            if (line) {
                entries.push({ type: 'heading', category: currentCategory, label: line });
            }
            return;
        }

        entries.push({
            type: 'item',
            category: currentCategory,
            code: codeRaw,
            line
        });
    });

    return entries;
};

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

export const __TEST__ = {
    isAccountMismatchError,
    isCredentialError,
    isRetriableRoutingError
};
