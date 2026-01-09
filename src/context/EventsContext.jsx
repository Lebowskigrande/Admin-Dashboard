import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getUnifiedEvents } from '../services/eventService';
import { API_URL } from '../services/apiConfig';

const EventsContext = createContext();

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
                await fetch(`${API_URL}/google/sync`, { method: 'POST', credentials: 'include' });
            }

            const unifiedData = await getUnifiedEvents();
            const localEvents = unifiedData.map(e => ({
                ...e,
                date: parseLocalDay(e.date)
            }));

            setEvents(localEvents);
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
