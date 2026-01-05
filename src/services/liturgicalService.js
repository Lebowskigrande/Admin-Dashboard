import { isSameDay, isAfter, startOfDay, addWeeks, subWeeks, endOfDay, isWithinInterval } from 'date-fns';
import { createSundayFromApiDay } from '../models/sunday';
import { PEOPLE } from '../data/people';
import { API_URL } from './apiConfig';

let cachedEvents = null;
let cachedPeople = null;
let cachedLiturgicalDays = null;
let cachedScheduleRoles = null;

const SERVICE_TIME_SLOTS = ['08:00', '10:00'];
const buildServiceEntries = (entries = []) => {
    if (!entries.length) return [];

    const sorted = [...entries].sort((a, b) => (a.service_time || '').localeCompare(b.service_time || ''));

    return sorted.map((entry, index) => {
        const time = entry.service_time
            || (sorted.length === 1
                ? SERVICE_TIME_SLOTS[1]
                : (SERVICE_TIME_SLOTS[index] || SERVICE_TIME_SLOTS[1]));
        const rite = time === SERVICE_TIME_SLOTS[0] ? 'Rite I' : 'Rite II';

        return {
            name: 'Sunday Service',
            time,
            rite,
            roles: {
                lector: entry.lector || '',
                usher: entry.usher || '',
                acolyte: entry.acolyte || '',
                lem: entry.chalice_bearer || '',
                sound: entry.sound_engineer || ''
            }
        };
    });
};

const buildSundayCache = (peopleList, liturgicalDays = [], scheduleRoles = []) => {
    const scheduleByDate = scheduleRoles.reduce((acc, entry) => {
        if (!acc[entry.date]) acc[entry.date] = [];
        acc[entry.date].push(entry);
        return acc;
    }, {});

    return liturgicalDays.map((day) => {
        const services = buildServiceEntries(scheduleByDate[day.date]);
        return createSundayFromApiDay({
            ...day,
            bulletin_status: day.bulletin_status || 'draft',
            services
        }, peopleList);
    });
};

const fetchPeople = async () => {
    if (cachedPeople) return cachedPeople;
    try {
        const response = await fetch(`${API_URL}/people`);
        if (!response.ok) throw new Error('Failed to fetch people');
        const data = await response.json();
        cachedPeople = Array.isArray(data) ? data : PEOPLE;
    } catch (error) {
        console.error('Error fetching people:', error);
        cachedPeople = PEOPLE;
    }
    return cachedPeople;
};

const fetchLiturgicalDays = async () => {
    if (cachedLiturgicalDays) return cachedLiturgicalDays;
    try {
        const response = await fetch(`${API_URL}/liturgical-days`);
        if (!response.ok) throw new Error('Failed to fetch liturgical days');
        const data = await response.json();
        cachedLiturgicalDays = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Error fetching liturgical days:', error);
        cachedLiturgicalDays = [];
    }
    return cachedLiturgicalDays;
};

const fetchScheduleRoles = async () => {
    if (cachedScheduleRoles) return cachedScheduleRoles;
    try {
        const response = await fetch(`${API_URL}/schedule-roles`);
        if (!response.ok) throw new Error('Failed to fetch schedule roles');
        const data = await response.json();
        cachedScheduleRoles = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Error fetching schedule roles:', error);
        cachedScheduleRoles = [];
    }
    return cachedScheduleRoles;
};

export const getAllEventsFromAPI = async () => {
    if (cachedEvents) return cachedEvents;
    const peopleList = await fetchPeople();
    const [liturgicalDays, scheduleRoles] = await Promise.all([
        fetchLiturgicalDays(),
        fetchScheduleRoles()
    ]);
    cachedEvents = buildSundayCache(peopleList, liturgicalDays, scheduleRoles);
    return cachedEvents;
};

export const getAllSundays = async () => getAllEventsFromAPI();

export const clearLiturgicalCache = () => {
    cachedEvents = null;
    cachedPeople = null;
    cachedLiturgicalDays = null;
    cachedScheduleRoles = null;
};

export const getSundaysInRange = async (startDate, endDate) => {
    const events = await getAllEventsFromAPI();
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    return events.filter(day => (
        day.date.getDay() === 0 && isWithinInterval(day.date, { start, end })
    ));
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
