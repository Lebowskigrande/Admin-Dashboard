import { API_URL } from './apiConfig';

export const getEventCategories = async () => {
    const response = await fetch(`${API_URL}/event-categories`);
    if (!response.ok) throw new Error('Failed to fetch event categories');
    return response.json();
};

export const getEventTypes = async () => {
    const response = await fetch(`${API_URL}/event-types`);
    if (!response.ok) throw new Error('Failed to fetch event types');
    return response.json();
};

export const getUnifiedEvents = async () => {
    const response = await fetch(`${API_URL}/events`);
    if (!response.ok) throw new Error('Failed to fetch unified events');
    return response.json();
};

export const getGoogleEvents = async () => {
    const response = await fetch(`${API_URL}/google/events`);
    if (!response.ok) throw new Error('Failed to fetch Google events');
    return response.json();
};

export const createEvent = async (eventData) => {
    const response = await fetch(`${API_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    });
    if (!response.ok) throw new Error('Failed to create event');
    return response.json();
};
