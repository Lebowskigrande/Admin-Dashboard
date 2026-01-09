import { google } from 'googleapis';
import { createOAuthClient, setStoredCredentials } from './googleAuth.js';

const getCalendarClient = (tokens) => {
    const client = createOAuthClient();
    if (tokens) setStoredCredentials(client, tokens);
    return google.calendar({ version: 'v3', auth: client });
};

// Fetch events from Google Calendar
export const fetchGoogleCalendarEvents = async (tokens, calendarId = 'primary', timeMin = null) => {
    try {
        const calendar = getCalendarClient(tokens);
        const date = timeMin || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: date.toISOString(),
            maxResults: 250,
            singleEvents: true,
            orderBy: 'startTime',
        });

        return response.data.items || [];
    } catch (error) {
        console.error('Error fetching Google Calendar events:', error.message);
        throw error;
    }
};

// Fetch user's calendar list
export const fetchCalendarList = async (tokens) => {
    try {
        const calendar = getCalendarClient(tokens);
        const response = await calendar.calendarList.list();
        return response.data.items || [];
    } catch (error) {
        console.error('Error fetching calendar list:', error.message);
        throw error;
    }
};

// Create event in Google Calendar
export const createGoogleCalendarEvent = async (tokens, calendarId = 'primary', eventData) => {
    try {
        const calendar = getCalendarClient(tokens);
        const response = await calendar.events.insert({
            calendarId: calendarId,
            resource: eventData,
        });

        return response.data;
    } catch (error) {
        console.error('Error creating Google Calendar event:', error.message);
        throw error;
    }
};

export { getCalendarClient };
