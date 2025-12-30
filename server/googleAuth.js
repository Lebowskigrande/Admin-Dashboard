import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: './server/.env' });

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Generate auth URL
export const getAuthUrl = () => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
};

// Exchange code for tokens
export const getTokensFromCode = async (code) => {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    return tokens;
};

// Set credentials from stored tokens
export const setStoredCredentials = (tokens) => {
    oauth2Client.setCredentials(tokens);
};

export default oauth2Client;
