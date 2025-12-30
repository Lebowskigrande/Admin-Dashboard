import { isSameDay, isAfter, startOfDay, addWeeks, subWeeks } from 'date-fns';
import { createSundayFromApiDay } from '../models/sunday';

const API_BASE = 'http://localhost:3001/api';

let cachedEvents = null;

// Fetch all events from API
export const getAllEventsFromAPI = async () => {
    if (cachedEvents) return cachedEvents;

    try {
        const response = await fetch(`${API_BASE}/events`);
        const data = await response.json();
        cachedEvents = data.map(createSundayFromApiDay);
        return cachedEvents;
    } catch (error) {
        console.error('Error fetching events:', error);
        return [];
    }
};

export const getLiturgicalDay = async (date) => {
    const events = await getAllEventsFromAPI();
    return events.find(day => isSameDay(day.date, date));
};

export const getServicesByDate = async (date) => {
    const events = await getAllEventsFromAPI();
    const day = events.find(d => isSameDay(d.date, date));
    return day?.services || [];
};

export const getNextSunday = async (fromDate = new Date()) => {
    const events = await getAllEventsFromAPI();
    const today = startOfDay(fromDate);

    const sortedDays = [...events].sort((a, b) => a.date - b.date);

    const nextSunday = sortedDays.find(day => {
        return (day.date.getDay() === 0) && (isSameDay(day.date, today) || isAfter(day.date, today));
    });

    return nextSunday ? nextSunday.date : null;
};

export const getPreviousSunday = async (currentDate) => {
    return subWeeks(currentDate, 1);
};

export const getFollowingSunday = async (currentDate) => {
    return addWeeks(currentDate, 1);
};

// For backward compatibility with Calendar component
export const getAllEvents = () => {
    // This is sync but Calendar expects it, we'll handle async in Calendar
    return [];
};
