import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: './server/.env' });

export const GOOGLE_SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly'
];

export const createOAuthClient = () => new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Generate auth URL
export const getAuthUrl = () => {
    return createOAuthClient().generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'consent'
    });
};

// Exchange code for tokens
export const getTokensFromCode = async (code) => {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    return tokens;
};

// Set credentials on a specific client
export const setStoredCredentials = (client, tokens) => {
    client.setCredentials(tokens);
    return client;
};

export default createOAuthClient;
