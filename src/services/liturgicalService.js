import { isSameDay, isAfter, startOfDay, addWeeks, subWeeks, endOfDay, isWithinInterval } from 'date-fns';
import { createSundayFromApiDay } from '../models/sunday';
import liturgicalCalendar from '../data/liturgical_calendar_2026.json';
import serviceSchedule from '../data/service_schedule.json';
import { PEOPLE } from '../data/people';

let cachedEvents = null;
let cachedPeople = null;

const SERVICE_TIME_SLOTS = ['08:00', '10:00'];
const API_BASE = 'http://localhost:3001/api';

const buildServiceEntries = (entries = []) => {
    if (!entries.length) return [];

    return entries.map((entry, index) => {
        const time = entries.length === 1
            ? SERVICE_TIME_SLOTS[1]
            : (SERVICE_TIME_SLOTS[index] || SERVICE_TIME_SLOTS[1]);
        const rite = time === SERVICE_TIME_SLOTS[0] ? 'Rite I' : 'Rite II';

        return {
            name: 'Sunday Service',
            time,
            rite,
            roles: entry.roles || {}
        };
    });
};

const buildSundayCache = (peopleList) => {
    const scheduleByDate = serviceSchedule.reduce((acc, entry) => {
        if (!acc[entry.date]) acc[entry.date] = [];
        acc[entry.date].push(entry);
        return acc;
    }, {});

    return liturgicalCalendar.map((day) => {
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
        const response = await fetch(`${API_BASE}/people`);
        if (!response.ok) throw new Error('Failed to fetch people');
        const data = await response.json();
        cachedPeople = Array.isArray(data) ? data : PEOPLE;
    } catch (error) {
        console.error('Error fetching people:', error);
        cachedPeople = PEOPLE;
    }
    return cachedPeople;
};

export const getAllEventsFromAPI = async () => {
    if (cachedEvents) return cachedEvents;
    const peopleList = await fetchPeople();
    cachedEvents = buildSundayCache(peopleList);
    return cachedEvents;
};

export const getAllSundays = async () => getAllEventsFromAPI();

export const clearLiturgicalCache = () => {
    cachedEvents = null;
    cachedPeople = null;
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
