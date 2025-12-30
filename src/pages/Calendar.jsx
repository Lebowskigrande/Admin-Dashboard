import { useState, useEffect } from 'react';
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
import './Calendar.css';



const Calendar = () => {
    const { events, loading, refreshEvents, setEvents } = useEvents();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [eventTypes, setEventTypes] = useState([]);
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
            <header className="calendar-header-controls">
                <div className="month-display">
                    <h2>{format(currentDate, 'MMMM yyyy')}</h2>
                </div>
                <div className="calendar-actions">
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
                                {events && events.filter(e => isSameDay(e.date, dayItem)).map(event => {
                                    const contrastColor = getContrastColor(event.color);
                                    const isLight = contrastColor !== event.color;

                                    return (
                                        <div
                                            key={event.id}
                                            className="event-chip"
                                            style={{
                                                backgroundColor: isLight ? '#f3f4f6' : `${event.color}25`,
                                                color: contrastColor,
                                                borderLeft: `3px solid ${event.color}`
                                            }}
                                            title={`${event.type_name || ''} - ${event.title}`}
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
