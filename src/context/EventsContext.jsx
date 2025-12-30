import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getUnifiedEvents, getGoogleEvents } from '../services/eventService';
import { format } from 'date-fns';

const EventsContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useEvents = () => {
    const context = useContext(EventsContext);
    if (!context) throw new Error('useEvents must be used within an EventsProvider');
    return context;
};

// Helper to parse date strings (YYYY-MM-DD) as local midnight instead of UTC
const parseLocalDay = (dateStr) => {
    if (!dateStr) return null;
    if (dateStr.includes('T')) return new Date(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

export const EventsProvider = ({ children }) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);

    const refreshEvents = useCallback(async (forceSync = false) => {
        setLoading(true);
        try {
            if (forceSync) {
                await fetch('http://localhost:3001/api/google/sync', { method: 'POST' });
            }

            const [unifiedData, googleData] = await Promise.all([
                getUnifiedEvents(),
                getGoogleEvents()
            ]);

            const localEvents = unifiedData.map(e => ({
                ...e,
                date: parseLocalDay(e.date)
            }));

            const gEvents = Array.isArray(googleData) ? googleData.map((event, index) => ({
                id: event.id || `google-${index}`,
                title: event.summary || 'Untitled Event',
                date: event.start?.dateTime ? new Date(event.start.dateTime) : parseLocalDay(event.start?.date),
                time: event.start?.dateTime ? format(new Date(event.start.dateTime), 'h:mm a') : 'All Day',
                type_name: event.type_name,
                category_name: event.category_name,
                color: event.color,
                source: 'google',
                location: event.location || '',
                description: event.description || ''
            })) : [];

            setEvents([...localEvents, ...gEvents]);
            setLastSynced(new Date());
        } catch (error) {
            console.error('Error refreshing events:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshEvents();
    }, [refreshEvents]);

    return (
        <EventsContext.Provider value={{ events, loading, lastSynced, refreshEvents, setEvents }}>
            {children}
        </EventsContext.Provider>
    );
};
