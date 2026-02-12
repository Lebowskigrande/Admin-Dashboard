import express from 'express';
import { saveDropboxTokens } from '../helpers/dropbox-utils.js';

const router = express.Router();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

router.get('/auth/dropbox', (req, res) => {
    const clientId = process.env.DROPBOX_APP_KEY;
    const redirectUri = process.env.DROPBOX_REDIRECT_URI;
    if (!clientId || !redirectUri) {
        return res.status(400).send('Dropbox OAuth is not configured.');
    }
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        token_access_type: 'offline'
    });
    res.redirect(`https://www.dropbox.com/oauth2/authorize?${params.toString()}`);
});

router.get('/auth/dropbox/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('No authorization code provided');
    }
    try {
        const clientId = process.env.DROPBOX_APP_KEY;
        const clientSecret = process.env.DROPBOX_APP_SECRET;
        const redirectUri = process.env.DROPBOX_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(400).send('Dropbox OAuth is not configured.');
        }
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: String(code),
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri
        });
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Dropbox token exchange failed');
        }
        const data = await response.json();
        saveDropboxTokens({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            token_type: data.token_type,
            scope: data.scope,
            expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null
        });
        res.redirect(`${CLIENT_ORIGIN}/settings`);
    } catch (error) {
        console.error('Dropbox OAuth error:', error);
        res.status(500).send('Dropbox authentication failed');
    }
});

export default router;
