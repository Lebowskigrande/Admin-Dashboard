import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { format, isSameDay, addDays, startOfDay } from 'date-fns';
import AtAGlance from '../components/AtAGlance';
import { useEvents } from '../context/EventsContext';
import { API_URL } from '../services/apiConfig';
import { MAP_AREAS } from '../data/areas';
import './Dashboard.css';

const WEATHER_CENTER = {
    zip: '91108',
    latitude: 34.122,
    longitude: -118.114
};

const WEATHER_CODE_MAP = [
    { codes: [0], label: 'Clear', kind: 'sun' },
    { codes: [1, 2], label: 'Partly Cloudy', kind: 'partly' },
    { codes: [3], label: 'Cloudy', kind: 'cloud' },
    { codes: [45, 48], label: 'Fog', kind: 'fog' },
    { codes: [51, 53, 55, 56, 57], label: 'Drizzle', kind: 'drizzle' },
    { codes: [61, 63, 65, 66, 67, 80, 81, 82], label: 'Rain', kind: 'rain' },
    { codes: [71, 73, 75, 77, 85, 86], label: 'Snow', kind: 'snow' },
    { codes: [95, 96, 99], label: 'Storm', kind: 'storm' }
];

const getWeatherMeta = (code) => {
    const match = WEATHER_CODE_MAP.find((entry) => entry.codes.includes(code));
    return match || { label: 'Cloudy', kind: 'cloud' };
};

const toLocalDate = (dateString) => new Date(`${dateString}T00:00:00`);

const getNextWeekday = (date, targetDay) => {
    const offset = (targetDay - date.getDay() + 7) % 7;
    return addDays(date, offset);
};

const getMode = (values) => {
    const counts = new Map();
    values.forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    let bestValue = values[0];
    let bestCount = 0;
    counts.forEach((count, value) => {
        if (count > bestCount) {
            bestCount = count;
            bestValue = value;
        }
    });
    return bestValue;
};

const formatTemp = (value) => (Number.isFinite(value) ? `${Math.round(value)}°` : '--');

const WEATHER_CACHE_KEY = 'dashboardWeatherCacheV1';

const getWeatherCacheKey = () => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now.getTime();
};

const readWeatherCache = () => {
    try {
        const raw = localStorage.getItem(WEATHER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.data?.daily) return parsed;
        const hydrated = parsed.data.daily.map((record) => ({
            ...record,
            date: record?.date ? new Date(record.date) : record?.date
        }));
        return {
            ...parsed,
            data: {
                ...parsed.data,
                daily: hydrated
            }
        };
    } catch {
        return null;
    }
};

const writeWeatherCache = (payload) => {
    try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore storage errors (private mode, quota, etc.)
    }
};

const WeatherIcon = ({ kind, size = 20 }) => {
    const props = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
    };

    switch (kind) {
        case 'sun':
            return (
                <svg {...props} aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <line x1="12" y1="2" x2="12" y2="5" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="2" y1="12" x2="5" y2="12" />
                    <line x1="19" y1="12" x2="22" y2="12" />
                    <line x1="4.5" y1="4.5" x2="6.5" y2="6.5" />
                    <line x1="17.5" y1="17.5" x2="19.5" y2="19.5" />
                    <line x1="17.5" y1="6.5" x2="19.5" y2="4.5" />
                    <line x1="4.5" y1="19.5" x2="6.5" y2="17.5" />
                </svg>
            );
        case 'partly':
            return (
                <svg {...props} aria-hidden="true">
                    <circle cx="8" cy="9" r="3" />
                    <path d="M5 16a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 16H5z" />
                </svg>
            );
        case 'fog':
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 14a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 14H5z" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                    <line x1="6" y1="21" x2="18" y2="21" />
                </svg>
            );
        case 'drizzle':
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 13a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 13H5z" />
                    <circle cx="8" cy="18" r="0.9" />
                    <circle cx="12" cy="19" r="0.9" />
                    <circle cx="16" cy="18" r="0.9" />
                </svg>
            );
        case 'rain':
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 13a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 13H5z" />
                    <line x1="8" y1="17" x2="8" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                    <line x1="16" y1="17" x2="16" y2="21" />
                </svg>
            );
        case 'snow':
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 13a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 13H5z" />
                    <line x1="8" y1="18" x2="8" y2="20.5" />
                    <line x1="12" y1="17.5" x2="12" y2="20" />
                    <line x1="16" y1="18" x2="16" y2="20.5" />
                    <line x1="7" y1="19.5" x2="9" y2="19.5" />
                    <line x1="11" y1="19" x2="13" y2="19" />
                    <line x1="15" y1="19.5" x2="17" y2="19.5" />
                </svg>
            );
        case 'storm':
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 13a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 13H5z" />
                    <path d="M12 16l-3 4h3l-1 4 4-6h-3l1-2z" />
                </svg>
            );
        default:
            return (
                <svg {...props} aria-hidden="true">
                    <path d="M5 16a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 1 1 18 16H5z" />
                </svg>
            );
    }
};

const Dashboard = () => {
    const navigate = useNavigate();
    const { events } = useEvents();
    const [tickets, setTickets] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [ticketsLoading, setTicketsLoading] = useState(true);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [weatherState, setWeatherState] = useState({ loading: true, data: null, error: null });

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

    useEffect(() => {
        const controller = new AbortController();
        const loadWeather = async () => {
            const cacheKey = getWeatherCacheKey();
            const cached = readWeatherCache();
            if (cached?.cacheKey === cacheKey && cached?.data) {
                setWeatherState({ loading: false, data: cached.data, error: null });
                return;
            }

            setWeatherState({ loading: true, data: null, error: null });
            try {
                const url = new URL('https://api.open-meteo.com/v1/forecast');
                url.searchParams.set('latitude', WEATHER_CENTER.latitude);
                url.searchParams.set('longitude', WEATHER_CENTER.longitude);
                url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min');
                url.searchParams.set('current', 'temperature_2m,weathercode');
                url.searchParams.set('temperature_unit', 'fahrenheit');
                url.searchParams.set('timezone', 'America/Los_Angeles');
                url.searchParams.set('forecast_days', '16');
                const response = await fetch(url.toString(), { signal: controller.signal });
                if (!response.ok) throw new Error('Failed to load weather');
                const payload = await response.json();
                if (!payload?.daily?.time?.length) throw new Error('Weather data unavailable');

                const daily = payload.daily;
                const dailyRecords = daily.time.map((dateString, index) => ({
                    date: toLocalDate(dateString),
                    weatherCode: daily.weathercode?.[index],
                    tempMax: daily.temperature_2m_max?.[index],
                    tempMin: daily.temperature_2m_min?.[index]
                }));

                setWeatherState({
                    loading: false,
                    error: null,
                    data: {
                        current: payload.current || null,
                        daily: dailyRecords
                    }
                });
                writeWeatherCache({
                    cacheKey,
                    data: {
                        current: payload.current || null,
                        daily: dailyRecords
                    }
                });
            } catch (error) {
                if (error.name === 'AbortError') return;
                console.error('Failed to load weather:', error);
                setWeatherState({ loading: false, data: null, error });
            }
        };

        loadWeather();
        return () => controller.abort();
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

    const weatherDisplay = useMemo(() => {
        if (!weatherState.data?.daily?.length) return null;

        const daily = weatherState.data.daily;
        const todayRecord = daily.find((record) => isSameDay(record.date, today)) || daily[0];
        const nextSaturday = getNextWeekday(today, 6);
        const upcomingSunday = addDays(nextSaturday, 1);
        const upcomingStart = addDays(today, 1);
        let upcomingDays = daily.filter((record) => record.date >= upcomingStart && record.date <= upcomingSunday);

        if (!upcomingDays.length) {
            upcomingDays = daily.filter((record) => record.date >= nextSaturday && record.date <= upcomingSunday);
        }

        const nextWeekStart = addDays(upcomingSunday, 1);
        const nextWeekEnd = addDays(nextWeekStart, 6);
        const nextWeek = daily.filter((record) => record.date >= nextWeekStart && record.date <= nextWeekEnd);

        const nextWeekCode = nextWeek.length
            ? getMode(nextWeek.map((record) => record.weatherCode).filter((code) => Number.isFinite(code)))
            : null;

        const todayMeta = getWeatherMeta(todayRecord?.weatherCode);
        const nextWeekMeta = Number.isFinite(nextWeekCode) ? getWeatherMeta(nextWeekCode) : null;
        const currentTemp = weatherState.data.current?.temperature_2m;

        return {
            today: todayRecord,
            todayMeta,
            upcomingDays,
            nextWeekMeta,
            currentTemp
        };
    }, [weatherState.data, today]);

    return (
        <div className="page-dashboard">
            <header className="dashboard-header page-header-bar">
                <div className="dashboard-header-main page-header-title">
                    <h1>Dashboard Overview</h1>
                    <p className="welcome-text page-header-subtitle">Welcome back, Administrator. Here's what's happening today.</p>
                </div>
                <div className="dashboard-weather" aria-live="polite">
                    {weatherState.loading && (
                        <div className="weather-status">Loading 91108 weather...</div>
                    )}
                    {!weatherState.loading && weatherState.error && (
                        <div className="weather-status">Weather unavailable</div>
                    )}
                    {!weatherState.loading && !weatherState.error && weatherDisplay && (
                        <>
                                                        <div className="weather-row">
                                <div className="weather-today">
                                    <div className="weather-section-label">Today in San Marino</div>
                                    <div className="weather-today-body">
                                    <div
                                        className="weather-icon weather-icon-lg"
                                        aria-hidden="true"
                                        title={weatherDisplay.todayMeta.label}
                                    >
                                        <WeatherIcon kind={weatherDisplay.todayMeta.kind} size={36} />
                                    </div>
                                    <div className="weather-today-main">
                                        <div className="weather-temp">
                                            {Number.isFinite(weatherDisplay.currentTemp)
                                                ? `${Math.round(weatherDisplay.currentTemp)}°`
                                                : `${formatTemp(weatherDisplay.today.tempMax)}`}
                                        </div>
                                        <div className="weather-range">
                                            <span>H {formatTemp(weatherDisplay.today.tempMax)}</span>
                                            <span>L {formatTemp(weatherDisplay.today.tempMin)}</span>
                                        </div>
                                    </div>
                                </div>
                                </div>
                                <div className="weather-upcoming">
                                    <div className="weather-upcoming-header">
                                        {weatherDisplay.upcomingDays.map((day) => (
                                            <div key={day.date.toISOString()} className="weather-upcoming-day-label">
                                                {format(day.date, 'EEE')}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="weather-upcoming-body">
                                        <div className="weather-days">
                                            {weatherDisplay.upcomingDays.map((day) => {
                                                const meta = getWeatherMeta(day.weatherCode);
                                                return (
                                                    <div key={day.date.toISOString()} className="weather-day">
                                                        <div
                                                            className="weather-icon"
                                                            aria-hidden="true"
                                                            title={`${format(day.date, 'EEE')}: ${meta.label}`}
                                                        >
                                                            <WeatherIcon kind={meta.kind} size={22} />
                                                        </div>
                                                        <div className="weather-day-temp">
                                                            {formatTemp(day.tempMax)} / {formatTemp(day.tempMin)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                <div className="weather-next-week">
                                    <div className="weather-section-label">Next Week</div>
                                    <div className="weather-next-week-body">
                                        {weatherDisplay.nextWeekMeta ? (
                                            <div
                                                className="weather-next-week-icon"
                                                aria-hidden="true"
                                                title={`Next week: ${weatherDisplay.nextWeekMeta.label}`}
                                            >
                                                <WeatherIcon kind={weatherDisplay.nextWeekMeta.kind} size={28} />
                                            </div>
                                        ) : (
                                            <div className="weather-next-week-icon weather-next-week-empty">--</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <div className="date-display page-header-meta">
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
