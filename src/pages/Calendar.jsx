import { useState, useEffect, useMemo } from 'react';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths
} from 'date-fns';
import { FaChevronLeft, FaChevronRight, FaPlus } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { getEventTypes } from '../services/eventService';
import { useEvents } from '../context/EventsContext';
import { getSundaysInRange } from '../services/liturgicalService';
import './Calendar.css';



const Calendar = () => {
    const { events, loading, refreshEvents, setEvents } = useEvents();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [eventTypes, setEventTypes] = useState([]);
    const [sundayServices, setSundayServices] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [newEvent, setNewEvent] = useState({
        title: '',
        date: '',
        time: '',
        location: '',
        type_id: '',
        setupNeeds: '',
        staffingNeeds: '',
        contractSigned: false,
        depositPaid: false,
        finalPaymentPaid: false
    });

    useEffect(() => {
        loadTypes();
    }, []);

    useEffect(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        let active = true;
        const loadSundayServices = async () => {
            const data = await getSundaysInRange(startDate, endDate);
            if (active) setSundayServices(data);
        };

        loadSundayServices();
        return () => {
            active = false;
        };
    }, [currentDate]);

    const loadTypes = async () => {
        try {
            const types = await getEventTypes();
            setEventTypes(types);
            if (types.length > 0 && !newEvent.type_id) {
                setNewEvent(prev => ({ ...prev, type_id: types[0].id }));
            }
        } catch (error) {
            console.error('Error loading types:', error);
        }
    };

    const handleDayClick = (dayItem) => {
        setNewEvent({ ...newEvent, date: format(dayItem, 'yyyy-MM-dd') });
        setShowModal(true);
    };

    const calculateNewDate = (dateString) => {
        const [y, m, d] = dateString.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!newEvent.title || !newEvent.date) return;

        // In a real app, we'd call createEvent(newEvent)
        // For now, update local state to show it works
        const selectedType = eventTypes.find(t => t.id === parseInt(newEvent.type_id));

        setEvents([...events, {
            id: `temp-${Date.now()}`,
            title: newEvent.title,
            date: calculateNewDate(newEvent.date),
            time: newEvent.time,
            location: newEvent.location,
            type_name: selectedType?.name || 'Event',
            category_name: selectedType?.category_name || 'General',
            color: selectedType?.color || selectedType?.category_color || '#3B82F6',
            source: 'manual',
            ...newEvent
        }]);

        setShowModal(false);
        setNewEvent({
            title: '', date: '', time: '', type_id: eventTypes[0]?.id || '',
            location: 'Church', contractSigned: false, depositPaid: false,
            finalPaymentPaid: false, setupNeeds: '', staffingNeeds: ''
        });
    };

    const header = () => {
        return (
            <header className="calendar-header-controls page-header-bar">
                <div className="page-header-title">
                    <h1>Calendar</h1>
                    <p className="page-header-subtitle">{format(currentDate, 'MMMM yyyy')}</p>
                </div>
                <div className="calendar-actions page-header-actions">
                    <button className="btn-icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
                        <FaChevronLeft />
                    </button>
                    <button className="btn-icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
                        <FaChevronRight />
                    </button>
                    <button className="btn-secondary" onClick={() => refreshEvents(true)} disabled={loading}>
                        {loading ? 'Syncing...' : 'Sync Google'}
                    </button>
                    <button className="btn-primary" onClick={() => {
                        setNewEvent({ ...newEvent, date: format(new Date(), 'yyyy-MM-dd') });
                        setShowModal(true);
                    }}>
                        <FaPlus /> New Event
                    </button>
                </div>
            </header>
        );
    };

    const daysOfWeek = () => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return (
            <div className="days-row">
                {days.map((day) => (
                    <div className="day-name" key={day}>{day}</div>
                ))}
            </div>
        );
    };

    const getContrastColor = (hexcolor) => {
        if (!hexcolor) return '#3B82F6';
        if (hexcolor.toLowerCase() === '#ffffff' || hexcolor.toLowerCase() === 'white') return '#1f2937';
        if (hexcolor.toLowerCase() === '#ffd700' || hexcolor.toLowerCase() === 'gold') return '#b45309';

        // Simple heuristic: if it's very light, use dark text
        const hex = hexcolor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 180 ? '#1f2937' : hexcolor;
    };

    const getLiturgicalColor = (colorName) => {
        const colorMap = {
            green: '#dcfce7',
            white: '#f3f4f6',
            purple: '#f3e8ff',
            red: '#fee2e2'
        };

        const normalized = (colorName || '').toLowerCase();
        return colorMap[normalized] || '#15803d';
    };

    const getRosterSummary = (roster) => {
        if (!roster) return '';

        const roleLabels = [
            { key: 'lector', label: 'Lector' },
            { key: 'lem', label: 'LEM' },
            { key: 'acolyte', label: 'Acolyte' },
            { key: 'usher', label: 'Usher' },
            { key: 'sound', label: 'Sound' }
        ];

        const entries = roleLabels
            .map(({ key, label }) => {
                const assignment = roster[key];
                if (!assignment?.people?.length) return null;
                const names = assignment.people.map(person => person.displayName).join(', ');
                return `${label}: ${names}`;
            })
            .filter(Boolean);

        return entries.join(' | ');
    };

    const sundayServiceEvents = useMemo(() => {
        if (!sundayServices.length) return [];

        return sundayServices.flatMap((day) => (
            (day.services || []).map((service) => ({
                id: `sunday-${day.date.toISOString()}-${service.time}`,
                title: service.rite ? `${service.rite} Service` : (service.name || 'Sunday Service'),
                date: day.date,
                time: service.time,
                color: getLiturgicalColor(day.color),
                type_name: day.name,
                source: 'sunday',
                roster: service.roster,
                rite: service.rite,
                dayName: day.name
            }))
        ));
    }, [sundayServices]);

    const filteredEvents = useMemo(() => (
        events.filter(event => !(event.source === 'liturgical' && event.date?.getDay?.() === 0))
    ), [events]);

    const mergedEvents = useMemo(() => (
        [...filteredEvents, ...sundayServiceEvents]
    ), [filteredEvents, sundayServiceEvents]);

    const cells = () => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        const dateFormat = "d";
        const dayList = eachDayOfInterval({ start: startDate, end: endDate });

        return (
            <div className="calendar-grid">
                {dayList.map((dayItem) => {
                    return (
                        <div
                            className={`calendar-cell ${!isSameMonth(dayItem, monthStart) ? "disabled" : ""} ${isSameDay(dayItem, new Date()) ? "today" : ""}`}
                            key={dayItem.toString()}
                            onClick={() => handleDayClick(dayItem)}
                        >
                            <div className="cell-header">
                                <span className="day-number">{format(dayItem, dateFormat)}</span>
                            </div>
                            <div className="cell-events">
                                {mergedEvents && mergedEvents.filter(e => isSameDay(e.date, dayItem)).map(event => {
                                    const contrastColor = getContrastColor(event.color);
                                    const isLight = contrastColor !== event.color;
                                    const rosterSummary = event.source === 'sunday' ? getRosterSummary(event.roster) : '';
                                    const tooltip = event.source === 'sunday'
                                        ? `${event.dayName || event.title}${event.rite ? ` (${event.rite})` : ''}${rosterSummary ? `\n${rosterSummary}` : ''}`
                                        : (event.type_name ? `${event.type_name} - ${event.title}` : event.title);

                                    return (
                                        <div
                                            key={event.id}
                                            className="event-chip"
                                            style={{
                                                backgroundColor: isLight ? '#f3f4f6' : `${event.color}25`,
                                                color: contrastColor,
                                                borderLeft: `3px solid ${event.color}`
                                            }}
                                            title={tooltip}
                                        >
                                            <div className="event-chip-content">
                                                {event.time && <span className="event-chip-time">{event.time}</span>}
                                                <span className="event-chip-title">{event.title}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="page-calendar">
            {header()}
            <Card className="calendar-card">
                {daysOfWeek()}
                {cells()}
            </Card>

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Add New Event"
            >
                <form className="event-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Event Title</label>
                        <input
                            type="text"
                            required
                            value={newEvent.title}
                            onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                            placeholder="e.g. Sunday Service"
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Date</label>
                            <input
                                type="date"
                                required
                                value={newEvent.date}
                                onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Time</label>
                            <input
                                type="time"
                                value={newEvent.time}
                                onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Event Type</label>
                            <select
                                value={newEvent.type_id}
                                onChange={(e) => setNewEvent({ ...newEvent, type_id: e.target.value })}
                            >
                                {eventTypes.map(type => (
                                    <option key={type.id} value={type.id}>
                                        {type.name} ({type.category_name})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Location</label>
                            <input
                                type="text"
                                value={newEvent.location}
                                onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                                placeholder="e.g. Church, Parish Hall"
                            />
                        </div>
                    </div>

                    <fieldset className="form-section">
                        <legend>Logistics</legend>
                        <div className="form-group">
                            <label>Setup Needs</label>
                            <textarea
                                value={newEvent.setupNeeds}
                                onChange={(e) => setNewEvent({ ...newEvent, setupNeeds: e.target.value })}
                                placeholder="e.g. 50 chairs, projector"
                                rows="2"
                            />
                        </div>
                        <div className="form-group">
                            <label>Staffing Needs</label>
                            <textarea
                                value={newEvent.staffingNeeds}
                                onChange={(e) => setNewEvent({ ...newEvent, staffingNeeds: e.target.value })}
                                placeholder="e.g. Sexton, AV Tech"
                                rows="2"
                            />
                        </div>
                    </fieldset>

                    <fieldset className="form-section">
                        <legend>Admin</legend>
                        <div className="checkbox-group">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={newEvent.contractSigned}
                                    onChange={(e) => setNewEvent({ ...newEvent, contractSigned: e.target.checked })}
                                />
                                Contract Signed
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={newEvent.depositPaid}
                                    onChange={(e) => setNewEvent({ ...newEvent, depositPaid: e.target.checked })}
                                />
                                Deposit Paid
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={newEvent.finalPaymentPaid}
                                    onChange={(e) => setNewEvent({ ...newEvent, finalPaymentPaid: e.target.checked })}
                                />
                                Final Payment
                            </label>
                        </div>
                    </fieldset>

                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Save Event</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Calendar;
