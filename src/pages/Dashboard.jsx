import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { FaArrowRight, FaBuilding, FaCalendarAlt, FaChurch, FaCog, FaExclamationTriangle, FaFileInvoiceDollar, FaSyncAlt, FaTasks, FaUsers } from 'react-icons/fa';
import Card from '../components/Card';
import { useEvents } from '../context/EventsContext';
import { API_URL } from '../services/apiConfig';
import { APP_ROUTES, getOriginRoute } from '../config/appRoutes';
import { buildOriginGroups } from '../../shared/taskRollups.js';
import {
    getOriginColorClass,
    getWorkPackageSubtitle,
    getWorkPackageSummary,
    getWorkPackageTitle,
    sortTasksByPriority
} from './todo/todoHelpers';
import { getSectionIconComponent } from './todo/todoVisuals';
import { isTicketClosedStatus, summarizeTickets } from '../../shared/tickets.js';
import './Dashboard.css';

const REGULAR_SUNDAY_SERVICE_SLUGS = new Set(['weekly-service', 'rite-i-service', 'rite-ii-service']);

const EMPTY = {
    tasks: [],
    origins: [],
    people: [],
    buildings: [],
    vendors: [],
    tickets: [],
    records: null,
    engine: null,
    google: { connected: false },
    sharefile: { connected: false, accounts: [] },
    cc: { connected: false },
    ap: { entries: [] },
    ar: { entries: [] },
    warnings: []
};

const readJson = async (path) => {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error || path);
    }
    return payload;
};

const toDateKey = (date) => format(date, 'yyyy-MM-dd');

const parseDateValue = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
};

const getNextSundayDate = (date) => {
    const base = startOfDay(date);
    const offset = (7 - base.getDay()) % 7;
    return addDays(base, offset === 0 ? 7 : offset);
};

const originLabel = (type) => ({
    sunday: 'Sunday Planner',
    event: 'Calendar',
    operations: 'Operations',
    ticket: 'Buildings',
    vestry: 'Vestry'
}[String(type || '').trim().toLowerCase()] || 'Origin');

const priorityClass = (task) => {
    const tier = String(task?.priority_tier || '').toLowerCase();
    if (tier === 'critical') return 'priority-critical';
    if (tier === 'high') return 'priority-high';
    if (tier === 'low') return 'priority-low';
    if (tier === 'someday') return 'priority-someday';
    return 'priority-normal';
};

const dueMeta = (task, today) => {
    const due = parseDateValue(task?.due_at);
    if (!due) return { label: 'No due date', className: 'due-pill-neutral', rank: 5 };
    const delta = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (delta < 0) return { label: 'Overdue', className: 'due-pill-overdue', rank: 0 };
    if (delta === 0) return { label: 'Today', className: 'due-pill-today', rank: 1 };
    if (delta === 1) return { label: 'Tomorrow', className: 'due-pill-tomorrow', rank: 2 };
    return { label: format(due, 'MMM d'), className: 'due-pill-future', rank: 3 };
};

const compareTasks = (a, b, today) => {
    const dueA = dueMeta(a, today);
    const dueB = dueMeta(b, today);
    if (dueA.rank !== dueB.rank) return dueA.rank - dueB.rank;
    if (Number(a?.blocked) !== Number(b?.blocked)) return Number(b?.blocked) - Number(a?.blocked);
    if (Number(a?.priority_effective || 0) !== Number(b?.priority_effective || 0)) {
        return Number(b?.priority_effective || 0) - Number(a?.priority_effective || 0);
    }
    return (parseDateValue(a?.due_at)?.getTime() ?? Number.POSITIVE_INFINITY)
        - (parseDateValue(b?.due_at)?.getTime() ?? Number.POSITIVE_INFINITY);
};

const trimTaskText = (value) => String(value || '').trim().replace(/[\s.,;:!?]+$/, '');

const formatStamp = (value) => {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unavailable';
    return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const eventSourceLabel = (event) => {
    if (event?.source === 'liturgical') return 'Liturgical';
    if (event?.source === 'google') return 'Google';
    if (REGULAR_SUNDAY_SERVICE_SLUGS.has(event?.type_slug)) return 'Sunday';
    return event?.category_name || 'Event';
};

const buildBuildingsRoute = (focus = '') => {
    const params = new URLSearchParams({ tab: 'tickets' });
    if (focus) params.set('focus', focus);
    return `${APP_ROUTES.buildings}?${params.toString()}`;
};

const Dashboard = () => {
    const navigate = useNavigate();
    const { events, loading: eventsLoading, lastSynced, refreshEvents } = useEvents();
    const [snapshot, setSnapshot] = useState(EMPTY);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [updatedAt, setUpdatedAt] = useState(null);
    const today = useMemo(() => startOfDay(new Date()), []);
    const todayKey = useMemo(() => toDateKey(today), [today]);

    const loadSnapshot = useCallback(async () => {
        setLoading(true);
        const defs = [
            ['tasks', 'task queue', '/tasks', []],
            ['origins', 'origin rollups', '/task-origins', []],
            ['people', 'people', '/people', []],
            ['buildings', 'buildings', '/buildings', []],
            ['vendors', 'preferred vendors', '/vendors', []],
            ['tickets', 'building tickets', '/tickets', []],
            ['records', 'architectural records', '/buildings/records/overview', null],
            ['engine', 'task engine', '/tasks/engine/health', null],
            ['google', 'Google Calendar', '/google/status', { connected: false }],
            ['sharefile', 'ShareFile Gmail', '/sharefile/google/status', { connected: false, accounts: [] }],
            ['cc', 'Constant Contact', '/constant-contact/status', { connected: false }],
            ['ap', 'AP routing', `/deposit-slip/routing-log?type=ap&date=${todayKey}`, { entries: [] }],
            ['ar', 'AR routing', `/deposit-slip/routing-log?type=ar&date=${todayKey}`, { entries: [] }]
        ];
        const settled = await Promise.allSettled(defs.map(([, , path]) => readJson(path)));
        const next = { ...EMPTY };
        const warnings = [];
        defs.forEach(([key, label, , fallback], index) => {
            const result = settled[index];
            if (result.status === 'fulfilled') next[key] = result.value;
            else {
                next[key] = fallback;
                warnings.push(label);
                console.error(`Dashboard snapshot failed for ${key}:`, result.reason);
            }
        });
        next.warnings = warnings;
        setSnapshot(next);
        setUpdatedAt(new Date());
        setLoading(false);
    }, [todayKey]);

    useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

    const runAction = useCallback(async (mode, action) => {
        setBusy(mode);
        try {
            await action();
            await loadSnapshot();
        } finally {
            setBusy('');
        }
    }, [loadSnapshot]);

    const visibleEvents = useMemo(() => (
        events.filter((event) => event?.date instanceof Date && !Number.isNaN(event.date.getTime()))
    ), [events]);

    const todayEvents = useMemo(() => (
        visibleEvents.filter((event) => isSameDay(event.date, today))
    ), [today, visibleEvents]);

    const week = useMemo(() => Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index);
        const items = visibleEvents
            .filter((event) => isSameDay(event.date, date))
            .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
        return { date, items };
    }), [today, visibleEvents]);

    const openTasks = useMemo(() => snapshot.tasks
        .filter((task) => !task?.completed && !task?.archived_at)
        .slice()
        .sort((a, b) => compareTasks(a, b, today)), [snapshot.tasks, today]);

    const overdue = useMemo(() => openTasks.filter((task) => dueMeta(task, today).rank === 0), [openTasks, today]);
    const dueToday = useMemo(() => openTasks.filter((task) => dueMeta(task, today).rank === 1), [openTasks, today]);
    const blocked = useMemo(() => openTasks.filter((task) => Number(task?.blocked) || String(task?.instance_state || '').toLowerCase() === 'blocked'), [openTasks]);
    const routing = useMemo(() => ([...(snapshot.ap?.entries || []), ...(snapshot.ar?.entries || [])]), [snapshot.ap?.entries, snapshot.ar?.entries]);
    const routingFailures = useMemo(() => routing.filter((entry) => entry?.status === 'failure'), [routing]);
    const ticketSummary = useMemo(() => summarizeTickets(snapshot.tickets), [snapshot.tickets]);
    const openTickets = useMemo(() => snapshot.tickets.filter((ticket) => !isTicketClosedStatus(ticket?.status)), [snapshot.tickets]);
    const blockedTickets = useMemo(() => openTickets.filter((ticket) => String(ticket?.status || '').toLowerCase() === 'blocked'), [openTickets]);

    const nextSundayOrigin = useMemo(() => {
        const rows = snapshot.origins
            .filter((origin) => origin?.origin_type === 'sunday' && /^\d{4}-\d{2}-\d{2}$/.test(String(origin?.origin_id || '')))
            .slice()
            .sort((a, b) => String(a.origin_id).localeCompare(String(b.origin_id)));
        return rows.find((row) => String(row.origin_id) >= todayKey) || rows[0] || null;
    }, [snapshot.origins, todayKey]);

    const nextSundayId = nextSundayOrigin?.origin_id || toDateKey(getNextSundayDate(today));
    const nextSundayDate = parseDateValue(nextSundayId) || getNextSundayDate(today);
    const sundayEvents = useMemo(() => visibleEvents.filter((event) => isSameDay(event.date, nextSundayDate)), [nextSundayDate, visibleEvents]);
    const sundayServices = useMemo(() => sundayEvents.filter((event) => event?.source === 'liturgical' || REGULAR_SUNDAY_SERVICE_SLUGS.has(event?.type_slug)).length, [sundayEvents]);
    const sundayOverdue = openTasks.filter((task) => task?.origin_type === 'sunday' && task?.origin_id === nextSundayId && dueMeta(task, today).rank === 0).length;

    const systems = [
        ['google', 'Google Calendar', snapshot.google?.connected, snapshot.google?.connected ? 'Calendar sync is available.' : 'Calendar sync needs attention.', APP_ROUTES.settings],
        ['sharefile', 'ShareFile Gmail', snapshot.sharefile?.connected, snapshot.sharefile?.connected ? `${Number(snapshot.sharefile?.accounts?.length || 0)} routing account${Number(snapshot.sharefile?.accounts?.length || 0) === 1 ? '' : 's'} linked.` : 'Routing inbox is disconnected.', APP_ROUTES.settings],
        ['cc', 'Constant Contact', snapshot.cc?.connected, snapshot.cc?.connected ? 'Sunday email automation is ready.' : 'Livestream email scheduling is offline.', APP_ROUTES.settings],
        ['engine', 'Task Engine', !!snapshot.engine, snapshot.engine?.runtime?.lastSeedAt ? `Last seeded ${formatStamp(snapshot.engine.runtime.lastSeedAt)}.` : 'No recent task engine activity recorded.', APP_ROUTES.taskOrigins]
    ];
    const disconnected = systems.filter(([, , connected]) => !connected).length;
    const sourceRows = Array.isArray(snapshot.engine?.byOriginType)
        ? snapshot.engine.byOriginType.filter((row) => Number(row?.active || 0) > 0).slice().sort((a, b) => Number(b?.active || 0) - Number(a?.active || 0)).slice(0, 5)
        : [];

    const openOrigin = useCallback((task) => {
        const href = getOriginRoute({ originType: task?.origin_type, originId: task?.origin_id, taskId: task?.id });
        if (href) navigate(href);
    }, [navigate]);

    const nextSundayRoute = useMemo(() => {
        const params = new URLSearchParams();
        if (nextSundayId) params.set('date', nextSundayId);
        const query = params.toString();
        return `${APP_ROUTES.sunday}${query ? `?${query}` : ''}`;
    }, [nextSundayId]);

    const sundayTasks = useMemo(() => (
        openTasks.filter((task) => task?.origin_type === 'sunday' && task?.origin_id === nextSundayId)
    ), [nextSundayId, openTasks]);

    const sundayBlocked = useMemo(() => (
        sundayTasks.filter((task) => Number(task?.blocked) || String(task?.instance_state || '').toLowerCase() === 'blocked').length
    ), [sundayTasks]);

    const workstreams = useMemo(() => ([
        {
            key: 'sunday',
            label: 'Sunday Planner',
            icon: <FaChurch />,
            route: nextSundayRoute,
            accent: 'accent-sunday',
            value: `${sundayTasks.length} open`,
            detail: `${sundayServices} services · ${sundayEvents.length} events`,
            note: `Next service ${format(nextSundayDate, 'MMM d')}`
        },
        {
            key: 'calendar',
            label: 'Calendar',
            icon: <FaCalendarAlt />,
            route: APP_ROUTES.calendar,
            accent: 'accent-calendar',
            value: `${visibleEvents.length} live`,
            detail: `${todayEvents.length} today · ${week.reduce((sum, day) => sum + day.items.length, 0)} this week`,
            note: lastSynced ? `Synced ${formatStamp(lastSynced)}` : 'Waiting for first sync'
        },
        {
            key: 'finance',
            label: 'Finance',
            icon: <FaFileInvoiceDollar />,
            route: APP_ROUTES.finance,
            accent: 'accent-finance',
            value: `${routingFailures.length} failures`,
            detail: `${routing.length} routing entr${routing.length === 1 ? 'y' : 'ies'} today`,
            note: routingFailures.length ? 'Review AP and AR routing log' : 'Routing queue is clean'
        },
        {
            key: 'buildings',
            label: 'Buildings',
            icon: <FaBuilding />,
            route: ticketSummary.blocked ? buildBuildingsRoute('blocked') : buildBuildingsRoute(ticketSummary.triage ? 'triage' : ''),
            accent: 'accent-buildings',
            value: `${openTickets.length} open`,
            detail: `${blockedTickets.length} blocked · ${snapshot.buildings.length} mapped areas`,
            note: `${ticketSummary.overdue} past target · ${ticketSummary.no_vendor} without vendor`
        },
        {
            key: 'people',
            label: 'People',
            icon: <FaUsers />,
            route: APP_ROUTES.people,
            accent: 'accent-people',
            value: `${snapshot.people.length} people`,
            detail: `${snapshot.vendors.length} vendors in network`,
            note: 'Directory and contact data are available'
        },
        {
            key: 'tasks',
            label: 'Task Engine',
            icon: <FaTasks />,
            route: APP_ROUTES.todo,
            accent: 'accent-tasks',
            value: `${openTasks.length} open`,
            detail: `${overdue.length} overdue · ${blocked.length} blocked`,
            note: snapshot.engine?.runtime?.lastSeedAt ? `Last seeded ${formatStamp(snapshot.engine.runtime.lastSeedAt)}` : 'No seed telemetry yet'
        }
    ]), [
        blocked,
        blockedTickets.length,
        lastSynced,
        nextSundayDate,
        nextSundayRoute,
        openTasks.length,
        openTickets.length,
        overdue.length,
        routing.length,
        routingFailures.length,
        snapshot.engine?.runtime?.lastSeedAt,
        snapshot.people.length,
        snapshot.vendors.length,
        sundayEvents.length,
        sundayServices,
        sundayTasks.length,
        ticketSummary.blocked,
        ticketSummary.no_vendor,
        ticketSummary.overdue,
        ticketSummary.triage,
        ticketSummary.urgent,
        todayEvents.length,
        visibleEvents.length,
        week
    ]);

    const issues = useMemo(() => {
        const rows = [];
        if (snapshot.warnings.length) {
            rows.push({
                key: 'warnings',
                title: 'Partial snapshot',
                detail: `${snapshot.warnings.length} data source${snapshot.warnings.length === 1 ? '' : 's'} failed during refresh.`,
                route: APP_ROUTES.settings,
                tone: 'warning'
            });
        }
        if (routingFailures.length) {
            rows.push({
                key: 'routing',
                title: 'Finance routing failures',
                detail: `${routingFailures.length} AP or AR entr${routingFailures.length === 1 ? 'y is' : 'ies are'} failing today.`,
                route: APP_ROUTES.finance,
                tone: 'danger'
            });
        }
        if (disconnected) {
            rows.push({
                key: 'systems',
                title: 'Integration attention required',
                detail: `${disconnected} service${disconnected === 1 ? '' : 's'} disconnected or stale.`,
                route: APP_ROUTES.settings,
                tone: 'warning'
            });
        }
        if (blocked.length) {
            rows.push({
                key: 'blocked-tasks',
                title: 'Blocked tasks',
                detail: `${blocked.length} task${blocked.length === 1 ? '' : 's'} cannot move forward yet.`,
                route: APP_ROUTES.todo,
                tone: 'warning'
            });
        }
        if (overdue.length) {
            rows.push({
                key: 'overdue',
                title: 'Overdue task load',
                detail: `${overdue.length} task${overdue.length === 1 ? '' : 's'} slipped past due date.`,
                route: APP_ROUTES.todo,
                tone: 'danger'
            });
        }
        if (blockedTickets.length) {
            rows.push({
                key: 'blocked-tickets',
                title: 'Blocked building tickets',
                detail: `${blockedTickets.length} facilities ticket${blockedTickets.length === 1 ? '' : 's'} waiting on a dependency.`,
                route: buildBuildingsRoute('blocked'),
                tone: 'warning'
            });
        }
        if (ticketSummary.overdue) {
            rows.push({
                key: 'ticket-overdue',
                title: 'Facilities past target date',
                detail: `${ticketSummary.overdue} building ticket${ticketSummary.overdue === 1 ? ' is' : 's are'} past target date.`,
                route: buildBuildingsRoute('due_soon'),
                tone: 'danger'
            });
        }
        return rows.slice(0, 6);
    }, [
        blocked.length,
        blockedTickets.length,
        disconnected,
        overdue.length,
        routingFailures.length,
        snapshot.warnings.length,
        APP_ROUTES.finance,
        APP_ROUTES.settings,
        APP_ROUTES.todo,
        ticketSummary.overdue
    ]);

    const focusQueue = useMemo(() => (
        buildOriginGroups(snapshot.tasks, { sortTasks: sortTasksByPriority }).slice(0, 4)
    ), [snapshot.tasks]);
    const issueCount = issues.length;
    const weeklyEventTotal = week.reduce((sum, day) => sum + day.items.length, 0);
    const kpis = [
        { label: 'Open Tasks', value: openTasks.length, tone: 'neutral' },
        { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'danger' : 'good' },
        { label: 'Blocked', value: blocked.length + blockedTickets.length, tone: blocked.length + blockedTickets.length ? 'warning' : 'good' },
        { label: 'Today', value: dueToday.length, tone: dueToday.length ? 'warning' : 'neutral' },
        { label: 'Week Events', value: weeklyEventTotal, tone: 'neutral' },
        { label: 'Exceptions', value: issueCount, tone: issueCount ? 'danger' : 'good' }
    ];

    return (
        <div className="page-dashboard">
            <header className="dashboard-hero">
                <div className="dashboard-hero-copy">
                    <span className="dashboard-eyebrow">Operations Cockpit</span>
                    <h1>Command Deck</h1>
                    <p>
                        One surface for platform status, upcoming Sunday pressure, workstream load, and the exceptions
                        that actually need intervention.
                    </p>
                    <div className="dashboard-hero-meta">
                        <span>{format(today, 'EEEE, MMMM d')}</span>
                        <span>{loading ? 'Refreshing snapshot...' : `Snapshot ${formatStamp(updatedAt)}`}</span>
                        <span>{lastSynced ? `Calendar ${formatStamp(lastSynced)}` : 'Calendar sync pending'}</span>
                    </div>
                </div>
                <div className="dashboard-hero-actions">
                    <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy === 'snapshot'}
                        onClick={() => runAction('snapshot', loadSnapshot)}
                    >
                        <FaSyncAlt />
                        {busy === 'snapshot' ? 'Refreshing...' : 'Refresh cockpit'}
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        disabled={busy === 'calendar' || eventsLoading}
                        onClick={() => runAction('calendar', refreshEvents)}
                    >
                        <FaCalendarAlt />
                        {busy === 'calendar' || eventsLoading ? 'Syncing...' : 'Sync calendar'}
                    </button>
                    <button
                        type="button"
                        className="dashboard-settings-link"
                        onClick={() => navigate(APP_ROUTES.settings)}
                    >
                        <FaCog />
                        Settings
                    </button>
                </div>
            </header>

            <section className="dashboard-kpi-strip" aria-label="Operational highlights">
                {kpis.map((item) => (
                    <Card key={item.label} className={`dashboard-kpi-card tone-${item.tone}`}>
                        <span className="dashboard-kpi-label">{item.label}</span>
                        <strong className="dashboard-kpi-value">{item.value}</strong>
                    </Card>
                ))}
            </section>

            <div className="dashboard-grid">
                <div className="dashboard-main-column">
                    <Card className="dashboard-panel dashboard-workstreams-card">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Workstreams</h2>
                                <p>Jump directly into the places where the platform is carrying real load.</p>
                            </div>
                        </div>
                        <div className="dashboard-workstream-grid">
                            {workstreams.map((stream) => (
                                <button
                                    key={stream.key}
                                    type="button"
                                    className={`dashboard-workstream ${stream.accent}`}
                                    onClick={() => navigate(stream.route)}
                                >
                                    <div className="dashboard-workstream-icon">{stream.icon}</div>
                                    <div className="dashboard-workstream-body">
                                        <div className="dashboard-workstream-topline">
                                            <span>{stream.label}</span>
                                            <FaArrowRight />
                                        </div>
                                        <strong>{stream.value}</strong>
                                        <p>{stream.detail}</p>
                                        <span className="dashboard-workstream-note">{stream.note}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </Card>

                    <Card className="dashboard-panel">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Focus Queue</h2>
                                <p>The next work packages worth pulling forward across the whole platform.</p>
                            </div>
                            <button type="button" className="dashboard-inline-link" onClick={() => navigate(APP_ROUTES.todo)}>
                                Open to-do list
                            </button>
                        </div>
                        {focusQueue.length ? (
                            <div className="dashboard-focus-board">
                                {focusQueue.map((origin) => {
                                    const workPackage = getWorkPackageSummary(origin);
                                    const primarySection = workPackage.primarySection;
                                    const primaryTask = primarySection?.actionTask || origin.nextTask || origin.sample;
                                    const due = dueMeta(primaryTask, today);
                                    return (
                                        <button
                                            key={origin.key}
                                            type="button"
                                            className={`dashboard-focus-card ${getOriginColorClass(origin.origin_type)}`}
                                            onClick={() => openOrigin(primaryTask)}
                                        >
                                            <div className="dashboard-focus-card-topline">
                                                <span className="dashboard-focus-origin-label">{originLabel(origin.origin_type)}</span>
                                                <span className={`priority-pill ${due.className}`}>{due.label}</span>
                                            </div>
                                            <div className="dashboard-focus-card-title">{getWorkPackageTitle(origin)}</div>
                                            <div className="dashboard-focus-card-subtitle">{getWorkPackageSubtitle(origin)}</div>
                                            <div className="dashboard-focus-card-current">
                                                <span className="dashboard-focus-current-label">Current friction</span>
                                                <strong>
                                                    {primarySection
                                                        ? `${primarySection.title}: ${primarySection.currentLabel}`
                                                        : 'Checklist complete'}
                                                </strong>
                                            </div>
                                            <div className="dashboard-focus-section-strip">
                                                {workPackage.sections.slice(0, 5).map((section) => {
                                                    const Icon = getSectionIconComponent(section.iconKey);
                                                    return (
                                                        <span
                                                            key={section.key}
                                                            className={`dashboard-focus-node attention-${section.attention}`}
                                                        >
                                                            <span className={`dashboard-focus-node-icon state-${section.status}`}>
                                                                <Icon />
                                                            </span>
                                                            <span className="dashboard-focus-node-label">{section.shortLabel}</span>
                                                            <span className="dashboard-focus-node-meta">{section.completedCount}/{section.totalCount}</span>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                            <div className="dashboard-focus-card-footer">
                                                <span>{workPackage.doneSectionCount}/{workPackage.sections.length} sections closed</span>
                                                <span className={`priority-pill ${priorityClass(primaryTask)}`}>
                                                    {String(primaryTask?.priority_tier || 'normal')}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="dashboard-empty">No open work packages are waiting in the queue.</p>
                        )}
                    </Card>

                    <Card className="dashboard-panel">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Week Runway</h2>
                                <p>Everything scheduled over the next seven days, grouped by day.</p>
                            </div>
                            <button type="button" className="dashboard-inline-link" onClick={() => navigate(APP_ROUTES.calendar)}>
                                Open calendar
                            </button>
                        </div>
                        <div className="week-grid">
                            {week.map((day) => (
                                <div key={toDateKey(day.date)} className="week-day">
                                    <div className="week-date">{format(day.date, 'EEE, MMM d')}</div>
                                    {day.items.length ? (
                                        day.items.slice(0, 3).map((event) => (
                                            <div key={event.id || `${event.title}-${event.time}`} className="week-event">
                                                <span className="week-time">{event.time || 'All day'}</span>
                                                <span className="week-title">{event.title || 'Untitled event'}</span>
                                                <span className="week-tag">{eventSourceLabel(event)}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <span className="week-empty">No scheduled events</span>
                                    )}
                                    {day.items.length > 3 && (
                                        <button
                                            type="button"
                                            className="dashboard-inline-link week-more-link"
                                            onClick={() => navigate(APP_ROUTES.calendar)}
                                        >
                                            +{day.items.length - 3} more
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>

                <div className="dashboard-side-column">
                    <Card className="dashboard-panel">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Platform Status</h2>
                                <p>Critical integrations and task engine telemetry.</p>
                            </div>
                            <button type="button" className="dashboard-inline-link" onClick={() => navigate(APP_ROUTES.settings)}>
                                Manage integrations
                            </button>
                        </div>
                        <div className="dashboard-status-list">
                            {systems.map(([key, label, connected, detail, route]) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`dashboard-status-row ${connected ? 'is-healthy' : 'is-warning'}`}
                                    onClick={() => navigate(route)}
                                >
                                    <div className="dashboard-status-pill">
                                        {connected ? 'Ready' : 'Attention'}
                                    </div>
                                    <div className="dashboard-status-copy">
                                        <strong>{label}</strong>
                                        <span>{detail}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                        {sourceRows.length ? (
                            <div className="dashboard-engine-panel">
                                <div className="dashboard-subsection-label">Most active task sources</div>
                                <div className="dashboard-engine-list">
                                    {sourceRows.map((row) => (
                                        <div key={`${row.origin_type}-${row.active}`} className="dashboard-engine-row">
                                            <span>{originLabel(row.origin_type)}</span>
                                            <strong>{Number(row.active || 0)} active</strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </Card>

                    <Card className="dashboard-panel">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Exception Center</h2>
                                <p>Anything that deserves executive attention before the rest of the queue.</p>
                            </div>
                        </div>
                        {issues.length ? (
                            <div className="dashboard-issue-list">
                                {issues.map((issue) => (
                                    <button
                                        key={issue.key}
                                        type="button"
                                        className={`dashboard-issue-row tone-${issue.tone}`}
                                        onClick={() => navigate(issue.route)}
                                    >
                                        <FaExclamationTriangle />
                                        <div>
                                            <strong>{issue.title}</strong>
                                            <span>{issue.detail}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="dashboard-empty-block">
                                <strong>No critical exceptions</strong>
                                <span>Integrations, routing, and blocking queues are currently stable.</span>
                            </div>
                        )}
                    </Card>

                    <Card className="dashboard-panel">
                        <div className="dashboard-panel-header">
                            <div>
                                <h2>Sunday Flight Deck</h2>
                                <p>Readiness for the next service cycle and the tasks anchored to it.</p>
                            </div>
                            <button type="button" className="dashboard-inline-link" onClick={() => navigate(nextSundayRoute)}>
                                Open Sunday planner
                            </button>
                        </div>
                        <div className="dashboard-sunday-hero">
                            <strong>{format(nextSundayDate, 'MMMM d')}</strong>
                            <span>{nextSundayOrigin ? `${nextSundayOrigin.open_count} open tasks in origin` : 'Sunday origin not seeded yet'}</span>
                        </div>
                        <div className="dashboard-sunday-metrics">
                            <div>
                                <span className="dashboard-subsection-label">Services</span>
                                <strong>{sundayServices}</strong>
                            </div>
                            <div>
                                <span className="dashboard-subsection-label">Open tasks</span>
                                <strong>{sundayTasks.length}</strong>
                            </div>
                            <div>
                                <span className="dashboard-subsection-label">Overdue</span>
                                <strong>{sundayOverdue}</strong>
                            </div>
                            <div>
                                <span className="dashboard-subsection-label">Blocked</span>
                                <strong>{sundayBlocked}</strong>
                            </div>
                        </div>
                        <div className="dashboard-sunday-list">
                            {sundayEvents.length ? (
                                sundayEvents.slice(0, 4).map((event) => (
                                    <div key={event.id || `${event.title}-${event.time}`} className="dashboard-sunday-event">
                                        <span>{event.time || 'All day'}</span>
                                        <strong>{event.title || 'Untitled event'}</strong>
                                    </div>
                                ))
                            ) : (
                                <span className="dashboard-empty">No Sunday events are loaded yet.</span>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
