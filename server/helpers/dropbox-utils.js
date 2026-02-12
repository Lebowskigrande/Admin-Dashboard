import { sqlite as db } from '../db.js';

const DROPBOX_USER_ID = 'dropbox-local';

export const saveDropboxTokens = (tokens) => {
    const now = new Date().toISOString();
    // Use user_tokens with fixed ID to mimic singleton behavior
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
        `token-${DROPBOX_USER_ID}`,
        DROPBOX_USER_ID,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date,
        tokens.scope,
        tokens.token_type,
        now
    );
};

export const refreshDropboxToken = async (refreshToken) => {
    const clientId = process.env.DROPBOX_APP_KEY;
    const clientSecret = process.env.DROPBOX_APP_SECRET;
    if (!clientId || !clientSecret) return null;

    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
    });

    try {
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        if (!response.ok) return null;

        const data = await response.json();
        const tokens = {
            access_token: data.access_token,
            refresh_token: refreshToken, // Usually reused
            token_type: data.token_type,
            scope: data.scope,
            expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null
        };
        saveDropboxTokens(tokens);
        return tokens.access_token;
    } catch (error) {
        console.error('Failed to refresh Dropbox token:', error);
        return null;
    }
};

export const getDropboxAccessToken = async () => {
    const row = db.prepare('SELECT access_token, refresh_token, expiry_date FROM user_tokens WHERE user_id = ?').get(DROPBOX_USER_ID);
    if (!row) return null;

    if (row.expiry_date && row.expiry_date < Date.now() + 60000) {
        if (row.refresh_token) {
            return await refreshDropboxToken(row.refresh_token);
        }
        return null;
    }
    return row.access_token;
};
