import { useState } from 'react';
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
import './Calendar.css';

const Calendar = () => {
    const [currentDate, setCurrentDate] = useState(new Date());

    // Mock Data
    const [events, setEvents] = useState([
        { id: 1, title: 'Sunday Service', date: new Date(2025, 11, 21), time: '10:00', type: 'service', location: 'Church', contractSigned: false, depositPaid: false, finalPaymentPaid: false, setupNeeds: 'Altar, Pews', staffingNeeds: 'Ushers, Acolytes' },
        { id: 2, title: 'Christmas Eve', date: new Date(2025, 11, 24), time: '18:00', type: 'special', location: 'Church', contractSigned: true, depositPaid: true, finalPaymentPaid: true, setupNeeds: 'Trees, Candles', staffingNeeds: 'Full Staff' },
    ]);

    const [showModal, setShowModal] = useState(false);
    const [newEvent, setNewEvent] = useState({
        title: '',
        date: '',
        time: '',
        type: 'service',
        location: 'Church',
        contractSigned: false,
        depositPaid: false,
        finalPaymentPaid: false,
        setupNeeds: '',
        staffingNeeds: ''
    });

    const handleDayClick = (dayItem) => {
        setNewEvent({ ...newEvent, date: format(dayItem, 'yyyy-MM-dd') });
        setShowModal(true);
    };

    const calculateNewDate = (dateString) => {
        const [y, m, d] = dateString.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!newEvent.title || !newEvent.date) return;

        setEvents([...events, {
            id: Date.now(),
            title: newEvent.title,
            date: calculateNewDate(newEvent.date),
            time: newEvent.time,
            type: newEvent.type,
            location: newEvent.location,
            contractSigned: newEvent.contractSigned,
            depositPaid: newEvent.depositPaid,
            finalPaymentPaid: newEvent.finalPaymentPaid,
            setupNeeds: newEvent.setupNeeds,
            staffingNeeds: newEvent.staffingNeeds
        }]);

        setShowModal(false);
        setNewEvent({
            title: '', date: '', time: '', type: 'service',
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
                    const dayEvents = events.filter(e => isSameDay(e.date, dayItem));
                    return (
                        <div
                            className={`calendar-cell ${!isSameMonth(dayItem, monthStart) ? "disabled" : ""}`}
                            key={dayItem.toString()}
                            onClick={() => handleDayClick(dayItem)}
                        >
                            <div className="cell-header">
                                <span className="day-number">{format(dayItem, dateFormat)}</span>
                            </div>
                            <div className="cell-events">
                                {dayEvents.map(event => (
                                    <div key={event.id} className={`event-chip event-${event.type}`}>
                                        {event.time} {event.title}
                                    </div>
                                ))}
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
                            <label>Type</label>
                            <select
                                value={newEvent.type}
                                onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
                            >
                                <option value="service">Service</option>
                                <option value="special">Special Event</option>
                                <option value="meeting">Meeting</option>
                                <option value="rental">Rental</option>
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
