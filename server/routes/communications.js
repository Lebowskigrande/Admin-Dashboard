import express from 'express';
import { randomUUID } from 'crypto';
import { sqlite as db } from '../db.js';
import {
    parseCookies,
    setCcStateCookie,
    CC_STATE_COOKIE,
    requireAuth,
    requireAdmin
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
    fetchCcFromEmails,
    findCcListId,
    getNextSaturdayAtSix,
    loadEmailTemplate,
    sanitizeEmailHtml
} from '../helpers/communications-utils.js';

const router = express.Router();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

router.use('/api/constant-contact', requireAuth);

router.get('/api/constant-contact/status', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    res.json({ connected: !!tokens?.access_token });
});

router.post('/api/constant-contact/disconnect', requireAdmin, (req, res) => {
    try {
        const userId = getCcUserId(req);
        db.prepare('DELETE FROM constant_contact_tokens WHERE user_id = ?').run(userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Constant Contact disconnect failed:', error);
        res.status(500).json({ error: 'Failed to disconnect Constant Contact' });
    }
});

router.get('/api/constant-contact/debug', (req, res) => {
    const userId = getCcUserId(req);
    const tokens = getCcTokens(userId);
    if (!tokens) {
        return res.json({ connected: false });
    }
    return res.json({
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
        return res.json({ emails });
    } catch (error) {
        console.error('Constant Contact from emails failed:', error);
        return res.status(500).json({ error: 'Failed to load Constant Contact from emails' });
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
        return res.status(response.ok ? 200 : response.status).json({
            ok: response.ok,
            status: response.status,
            payload
        });
    } catch (error) {
        console.error('Constant Contact debug emails failed:', error);
        return res.status(500).json({ error: 'Failed to debug Constant Contact emails' });
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
        return res.json({ lists });
    } catch (error) {
        console.error('Constant Contact lists failed:', error);
        return res.status(500).json({ error: 'Failed to load Constant Contact lists' });
    }
});

router.get('/auth/constant-contact', requireAuth, (req, res) => {
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
    return res.redirect(`${CC_AUTH_URL}?${params.toString()}`);
});

router.get('/auth/constant-contact/callback', requireAuth, async (req, res) => {
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
        return res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Constant Contact OAuth failed:', error);
        return res.status(500).send('Constant Contact authentication failed');
    }
});

router.post('/api/constant-contact/email', requireAdmin, async (req, res) => {
    try {
        const userId = getCcUserId(req);
        const tokens = await ensureCcAccessToken(userId);
        if (!tokens?.access_token) {
            return res.status(401).json({ error: 'Constant Contact not connected' });
        }

        const {
            date,
            sundayName,
            youtubeLink,
            pdfUrl,
            imageUrl,
            testEmpty,
            fromEmail: requestedFromEmail
        } = req.body || {};

        if (!testEmpty && (!date || !sundayName || !youtubeLink || !pdfUrl || !imageUrl)) {
            return res.status(400).json({ error: 'Missing email data' });
        }

        let listId = await findCcListId(tokens, 'Active Members');
        if (!listId) {
            const listData = await fetchCcJson(`${CC_API_BASE}/contact_lists`, tokens);
            const lists = Array.isArray(listData?.lists) ? listData.lists : [];
            listId = lists[0]?.list_id || null;
        }
        if (!listId) {
            return res.status(404).json({ error: 'No Constant Contact lists available' });
        }

        const template = testEmpty ? '' : await loadEmailTemplate();
        const html = testEmpty
            ? '<html><body><p>Test email</p></body></html>'
            : sanitizeEmailHtml(template
                .replace(/\[\[\[DATE\]\]\]/g, date)
                .replace(/\[\[\[SUNDAY_NAME\]\]\]/g, sundayName)
                .replace(/\[\[\[YOUTUBE_LINK\]\]\]/g, youtubeLink)
                .replace(/\[\[\[IMG_SRC\]\]\]/g, imageUrl)
                .replace(/\[\[\[PDF_SRC\]\]\]/g, pdfUrl));
        const minimalHtml = testEmpty ? html : `
<html>
  <body>
    <h1>${sundayName}</h1>
    <p>${date}</p>
    <p><a href="${youtubeLink}">Watch the livestream</a></p>
    <p><a href="${pdfUrl}">Download the bulletin</a></p>
    <img src="${imageUrl}" alt="Sunday Bulletin preview" />
  </body>
</html>`;

        const normalizeEmail = (value) => (value || '').trim().toLowerCase();
        const allowedEmails = await fetchCcFromEmails(tokens).catch(() => []);
        const confirmedEmails = allowedEmails.filter((entry) => {
            const status = (entry?.status || '').toLowerCase();
            return status === 'confirmed' || status === 'verified' || status === 'active';
        });
        const pickFirstEmail = (list) => {
            for (const entry of list) {
                const candidate = entry?.email_address || entry?.email || entry?.address || '';
                if (candidate) return candidate;
            }
            return '';
        };
        const allowedSet = new Set(
            allowedEmails.map((entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address))
        );
        let fromEmail = requestedFromEmail || process.env.CC_FROM_EMAIL || '';
        if (fromEmail && allowedSet.size > 0 && !allowedSet.has(normalizeEmail(fromEmail))) {
            fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails) || fromEmail;
        }
        if (!fromEmail) {
            fromEmail = pickFirstEmail(confirmedEmails) || pickFirstEmail(allowedEmails);
        }
        const fromName = process.env.CC_FROM_NAME || 'St Edmunds';
        const replyTo = process.env.CC_REPLY_TO_EMAIL || fromEmail;
        if (!fromEmail) {
            return res.status(500).json({ error: 'CC_FROM_EMAIL not configured' });
        }
        const normalizeEntryEmail = (entry) => normalizeEmail(entry?.email_address || entry?.email || entry?.address);
        const fromEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(fromEmail));
        const replyEntry = allowedEmails.find((entry) => normalizeEntryEmail(entry) === normalizeEmail(replyTo));

        const baseActivity = {
            format_type: 'HTML',
            from_email: fromEmail,
            from_name: fromName,
            reply_to_email: replyTo,
            subject: testEmpty ? 'Test Email' : 'Sunday Livestream',
            html_content: html,
            contact_list_ids: [listId]
        };
        if (fromEntry?.email_id) {
            baseActivity.from_email_id = fromEntry.email_id;
        }
        if (replyEntry?.email_id) {
            baseActivity.reply_to_email_id = replyEntry.email_id;
        }
        const campaignPayload = {
            name: testEmpty ? `Test Email ${new Date().toISOString()}` : 'Sunday Bulletin',
            email_campaign_activities: [baseActivity]
        };
        console.log('Constant Contact email meta', { testEmpty: !!testEmpty, fromEmail, replyTo, listId });

        let campaign;
        try {
            campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
                method: 'POST',
                body: JSON.stringify(campaignPayload)
            });
        } catch {
            console.error('Constant Contact create payload:', campaignPayload);
            console.error('Constant Contact HTML length:', html.length);
            campaign = await fetchCcJson(`${CC_API_BASE}/emails`, tokens, {
                method: 'POST',
                body: JSON.stringify({
                    ...campaignPayload,
                    email_campaign_activities: [
                        {
                            ...baseActivity,
                            html_content: minimalHtml
                        }
                    ]
                })
            });
        }

        const activity = campaign?.email_campaign_activities?.[0];
        const activityId = activity?.activity_id;
        if (!activityId) {
            return res.status(500).json({ error: 'Failed to create Constant Contact email activity' });
        }

        const attachedLists = Array.isArray(activity?.contact_list_ids) ? activity.contact_list_ids : [];
        if (!attachedLists.includes(listId)) {
            try {
                await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/contact_lists`, tokens, {
                    method: 'POST',
                    body: JSON.stringify({ contact_list_ids: [listId] })
                });
            } catch (error) {
                console.error('Constant Contact list attach failed:', error?.message || error);
                throw error;
            }
        }

        const scheduledDate = getNextSaturdayAtSix().toISOString();
        await fetchCcJson(`${CC_API_BASE}/emails/activities/${activityId}/schedules`, tokens, {
            method: 'POST',
            body: JSON.stringify({ scheduled_date: scheduledDate })
        });

        return res.json({ success: true, activityId, scheduledDate });
    } catch (error) {
        console.error('Constant Contact email failed:', error?.message || error);
        if (error?.message?.includes('Constant Contact request failed')) {
            console.error('Constant Contact email error detail:', error.message);
        }
        return res.status(500).json({ error: 'Failed to create Constant Contact email' });
    }
});

export default router;
