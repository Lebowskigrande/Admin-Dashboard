import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { format, isSameDay, addDays, startOfDay } from 'date-fns';
import AtAGlance from '../components/AtAGlance';
import { useEvents } from '../context/EventsContext';
import { API_URL } from '../services/apiConfig';
import { MAP_AREAS } from '../data/areas';
import './Dashboard.css';

const Dashboard = () => {
    const navigate = useNavigate();
    const { events } = useEvents();
    const [tickets, setTickets] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [tasksLoading, setTasksLoading] = useState(true);

    const today = useMemo(() => startOfDay(new Date()), []);
    const areaById = useMemo(() => (
        MAP_AREAS.reduce((acc, area) => {
            acc[area.id] = area;
            return acc;
        }, {})
    ), []);

    useEffect(() => {
        let active = true;
        const loadTickets = async () => {
            setTicketsLoading(true);
            try {
                const response = await fetch(`${API_URL}/tickets`);
                if (!response.ok) throw new Error('Failed to load tickets');
                const data = await response.json();
                if (active) setTickets(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load tickets:', error);
                if (active) setTickets([]);
            } finally {
                if (active) setTicketsLoading(false);
            }
        };
        const loadTasks = async () => {
            setTasksLoading(true);
            try {
                const response = await fetch(`${API_URL}/tasks`);
                if (!response.ok) throw new Error('Failed to load tasks');
                const data = await response.json();
                if (active) setTasks(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load tasks:', error);
                if (active) setTasks([]);
            } finally {
                if (active) setTasksLoading(false);
            }
        };
        loadTickets();
        loadTasks();
        return () => {
            active = false;
        };
    }, []);

    const todayEvents = useMemo(() => (
        events.filter((event) => {
            if (!event?.date) return false;
            return isSameDay(event.date, today);
        })
    ), [events, today]);

    const openTickets = useMemo(() => (
        tickets.filter((ticket) => ticket.status !== 'closed')
    ), [tickets]);

    const currentTasks = useMemo(() => (
        tasks.filter((task) => !task.completed).slice(0, 8)
    ), [tasks]);

    const getTicketStatusClass = useCallback((status) => {
        const normalized = (status || '').toLowerCase().replace(/\s+/g, '_');
        if (normalized === 'reviewed') return 'status-reviewed';
        if (normalized === 'in_process') return 'status-in_process';
        if (normalized === 'closed') return 'status-closed';
        return 'status-new';
    }, []);

    const formatTaskText = useCallback((text) => {
        const raw = (text || '').trim();
        const cleaned = raw.replace(/[\s.,;:!?]+$/, '');
        return cleaned || raw;
    }, []);

    const weekSchedule = useMemo(() => {
        const days = Array.from({ length: 7 }, (_, idx) => addDays(today, idx));
        return days.map((date) => {
            const items = events.filter((event) => {
                if (!event?.date) return false;
                if (event.source === 'liturgical') return false;
                if (event.type_slug === 'weekly-service') return false;
                return isSameDay(event.date, date);
            }).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
            return { date, items };
        });
    }, [events, today]);

    return (
        <div className="page-dashboard">
            <header className="dashboard-header">
                <div>
                    <h1>Dashboard Overview</h1>
                    <p className="welcome-text">Welcome back, Administrator. Here's what's happening today.</p>
                </div>
                <div className="date-display">
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </header>

            <div className="dashboard-columns">
                <div className="dashboard-column">
                    <Card className="dashboard-card today-card">
                        <div className="dashboard-card-header">
                            <h2>Today at a Glance</h2>
                            <span className="muted">{format(today, 'EEEE, MMMM d')}</span>
                        </div>
                        {todayEvents.length === 0 ? (
                            <p className="no-events">No events scheduled for today.</p>
                        ) : (
                            <ul className="today-list">
                                {todayEvents.map((event) => (
                                    <li key={event.id} className="today-item">
                                        <span className="today-time">{event.time || 'All day'}</span>
                                        <span className="today-title">{event.title}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                    <Card className="dashboard-card">
                    <div className="dashboard-card-header badge-corner">
                        <h2>Open Tickets</h2>
                        <span className="count-badge" aria-label={`${openTickets.length} open tickets`}>
                            {openTickets.length}
                        </span>
                    </div>
                    {ticketsLoading ? (
                        <p className="loading-text">Loading tickets...</p>
                    ) : openTickets.length === 0 ? (
                        <p className="no-events">No open tickets.</p>
                    ) : (
                        <div className="dashboard-ticket-list">
                            {openTickets.map((ticket) => {
                                const areaId = (ticket.areas || [])[0];
                                const areaLabel = areaById[areaId]?.name || areaId || 'General';
                                return (
                                    <button
                                        key={ticket.id}
                                        type="button"
                                        className="ticket-row"
                                        onClick={() => navigate(`/buildings?ticket=${ticket.id}`)}
                                    >
                                        <div className="ticket-row-header">
                                            <div className="ticket-row-main">
                                                <h4>{ticket.title}</h4>
                                                <span className="ticket-area-chip pill pill-neutral">{areaLabel}</span>
                                            </div>
                                            <span className={`ticket-status pill ${getTicketStatusClass(ticket.status)}`}>
                                                {ticket.status.replace('_', ' ')}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </Card>

                    <Card className="dashboard-card">
                    <div className="dashboard-card-header badge-corner">
                        <h2>Current Tasks</h2>
                        <span className="count-badge" aria-label={`${currentTasks.length} current tasks`}>
                            {currentTasks.length}
                        </span>
                    </div>
                    {tasksLoading ? (
                        <p className="loading-text">Loading tasks...</p>
                    ) : currentTasks.length === 0 ? (
                        <p className="no-events">No active tasks.</p>
                    ) : (
                        <div className="dashboard-ticket-list dashboard-task-list">
                            {currentTasks.map((task) => (
                                <button
                                    key={task.id}
                                    type="button"
                                    className="ticket-row"
                                    onClick={() => {
                                        if (task.ticket_id) {
                                            navigate(`/buildings?ticket=${task.ticket_id}#ticket-tasks`);
                                        }
                                    }}
                                    disabled={!task.ticket_id}
                                >
                                    <div className="task-row-main">
                                        <h4>{formatTaskText(task.text)}</h4>
                                        {task.ticket_title && (
                                            <span className="ticket-area-chip pill pill-neutral">{task.ticket_title}</span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </Card>
                </div>

                <div className="dashboard-column">
                    <div className="dashboard-right-card">
                        <AtAGlance />
                    </div>
                    <Card className="dashboard-card">
                    <div className="dashboard-card-header">
                        <h2>Schedule This Week</h2>
                    </div>
                    <div className="week-grid">
                        {weekSchedule.map((day) => (
                            <div key={day.date.toISOString()} className="week-day">
                                <div className="week-date">{format(day.date, 'EEE MMM d')}</div>
                                {day.items.length === 0 ? (
                                    <div className="week-empty">No events</div>
                                ) : (
                                    day.items.map((event) => (
                                        <div key={event.id} className="week-event">
                                            <span className="week-time">{event.time || 'All day'}</span>
                                            <span className="week-title">{event.title}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        ))}
                    </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
