import Card from '../components/Card';
import { FaCalendarCheck, FaClipboardList, FaMoneyBillAlt, FaTasks } from 'react-icons/fa';
import { format } from 'date-fns';
import AtAGlance from '../components/AtAGlance';
import { useEvents } from '../context/EventsContext';
import './Dashboard.css';

const Dashboard = () => {
    const { events, loading: eventsLoading } = useEvents();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingEvents = events
        .filter(event => new Date(event.date) >= today)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 5);

    const getContrastColor = (hexcolor) => {
        if (!hexcolor) return '#3B82F6';
        if (hexcolor.toLowerCase() === '#ffffff' || hexcolor.toLowerCase() === 'white') return '#1f2937';
        if (hexcolor.toLowerCase() === '#ffd700' || hexcolor.toLowerCase() === 'gold') return '#b45309';

        const hex = hexcolor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 180 ? '#1f2937' : hexcolor;
    };

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

            <div className="dashboard-stats">
                <div className="stat-card">
                    <div className="stat-icon icon-events"><FaCalendarCheck /></div>
                    <div className="stat-info">
                        <span className="stat-value">{upcomingEvents.length}</span>
                        <span className="stat-label">Upcoming Events</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon icon-tasks"><FaTasks /></div>
                    <div className="stat-info">
                        <span className="stat-value">5</span>
                        <span className="stat-label">Pending Tasks</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid">
                <div style={{ gridColumn: 'span 2' }}>
                    <AtAGlance />
                </div>

                <Card title="Upcoming Events" className="dashboard-card">
                    {eventsLoading && upcomingEvents.length === 0 ? (
                        <p className="loading-text">Loading events...</p>
                    ) : upcomingEvents.length === 0 ? (
                        <p className="no-events">No upcoming events this week</p>
                    ) : (
                        <ul className="events-list">
                            {upcomingEvents.map(event => {
                                const contrastColor = getContrastColor(event.color);
                                const isLight = contrastColor !== event.color;

                                return (
                                    <li key={event.id} className="event-item" style={{ borderLeftColor: event.color }}>
                                        <div className="event-date">
                                            <span className="event-day">{format(new Date(event.date), 'd')}</span>
                                            <span className="event-month">{format(new Date(event.date), 'MMM')}</span>
                                        </div>
                                        <div className="event-details">
                                            <div className="event-header-row">
                                                <span className="event-title">{event.title}</span>
                                                {event.type_name && (
                                                    <span
                                                        className="event-type-badge"
                                                        style={{
                                                            color: contrastColor,
                                                            backgroundColor: isLight ? '#f3f4f6' : `${event.color}25`
                                                        }}
                                                    >
                                                        {event.type_name}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="event-time">{event.time}</span>
                                            {event.location && <span className="event-location">{event.location}</span>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>

                <Card title="Finance Snapshot" className="dashboard-card">
                    <div className="finance-row">
                        <span>Collections (Dec)</span>
                        <span className="amount positive">+$12,450.00</span>
                    </div>
                    <div className="finance-row">
                        <span>Expenses (Dec)</span>
                        <span className="amount negative">-$4,200.00</span>
                    </div>
                </Card>

                <Card title="Quick Tasks" className="dashboard-card">
                    <ul className="task-list">
                        <li className="task-item">
                            <input type="checkbox" id="t1" />
                            <label htmlFor="t1">Print Bulletins</label>
                        </li>
                        <li className="task-item">
                            <input type="checkbox" id="t2" />
                            <label htmlFor="t2">Email Choir Director</label>
                        </li>
                    </ul>
                </Card>
            </div>
        </div>
    );
};

export default Dashboard;
