import express from 'express';
import { randomUUID } from 'crypto';
import {
    parseCookies,
    setCcStateCookie,
    CC_STATE_COOKIE
} from '../helpers/auth.js';
import {
    CC_AUTH_URL,
    CC_TOKEN_URL,
    CC_API_BASE,
    getCcUserId,
    getCcTokens,
    saveCcTokens,
    ensureCcAccessToken,
    fetchCcJson,
    fetchCcFromEmails
} from '../helpers/communications-utils.js';
import { createAndScheduleConstantContactEmail } from '../services/constantContactService.js';

const router = express.Router();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

router.get('/api/constant-contact/status', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    res.json({ connected: !!tokens?.access_token });
});

router.get('/api/constant-contact/debug', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    if (!tokens) {
        return res.json({ connected: false });
    }
    res.json({
        connected: !!tokens.access_token,
        scope: tokens.scope || null,
        tokenType: tokens.token_type || null,
        expiresAt: tokens.expires_at || null
    });
});

router.get('/api/constant-contact/from-emails', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const emails = await fetchCcFromEmails(tokens);
        res.json({ emails });
    } catch (error) {
        console.error('Constant Contact from emails failed:', error);
        res.status(500).json({ error: 'Failed to load Constant Contact from emails' });
    }
});

router.get('/api/constant-contact/debug-emails', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const response = await fetch(`${CC_API_BASE}/account/emails`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json'
            }
        });
        const payload = await response.json().catch(() => ({}));
        res.status(response.ok ? 200 : response.status).json({
            ok: response.ok,
            status: response.status,
            payload
        });
    } catch (error) {
        console.error('Constant Contact debug emails failed:', error);
        res.status(500).json({ error: 'Failed to debug Constant Contact emails' });
    }
});

router.get('/api/constant-contact/lists', async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }
        const data = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
        const lists = Array.isArray(data?.lists) ? data.lists : [];
        res.json({ lists });
    } catch (error) {
        console.error('Constant Contact lists failed:', error);
        res.status(500).json({ error: 'Failed to load Constant Contact lists' });
    }
});

router.get('/auth/constant-contact', (req, res) => {
    const clientId = process.env.CC_CLIENT_ID;
    const redirectUri = process.env.CC_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return res.status(500).send('Constant Contact not configured');
    }
    const state = randomUUID();
    setCcStateCookie(res, state);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'campaign_data contact_data account_read offline_access',
        state
    });
    console.log('Constant Contact auth URL', `${CC_AUTH_URL}?${params.toString()}`);
    res.redirect(`${CC_AUTH_URL}?${params.toString()}`);
});

router.get('/auth/constant-contact/callback', async (req, res) => {
    const { code, error, error_description: errorDescription, state } = req.query;
    if (error) {
        return res.status(400).send(errorDescription || 'Constant Contact authorization failed');
    }
    const cookies = parseCookies(req.headers.cookie || '');
    if (!state || !cookies[CC_STATE_COOKIE] || cookies[CC_STATE_COOKIE] !== state) {
        return res.status(400).send('Invalid OAuth state');
    }
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        const clientId = process.env.CC_CLIENT_ID;
        const clientSecret = process.env.CC_CLIENT_SECRET;
        const redirectUri = process.env.CC_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(500).send('Constant Contact not configured');
        }
        const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });
        const response = await fetch(CC_TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });
        if (!response.ok) {
            const payload = await response.text();
            throw new Error(payload || 'Failed to exchange Constant Contact token');
        }
        const tokens = await response.json();
        const userId = getCcUserId(req);
        saveCcTokens(userId, tokens);
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Constant Contact OAuth failed:', error);
        res.status(500).send('Constant Contact authentication failed');
    }
});

router.post('/api/constant-contact/email', async (req, res) => {
    try {
        const result = await createAndScheduleConstantContactEmail({
            userId: getCcUserId(req),
            input: req.body || {}
        });
        res.json(result);
    } catch (error) {
        console.error('Constant Contact email failed:', error?.message || error);
        const statusCode = Number(error?.statusCode || 500);
        res.status(statusCode).json({ error: error?.message || 'Failed to create Constant Contact email' });
    }
});

export default router;
