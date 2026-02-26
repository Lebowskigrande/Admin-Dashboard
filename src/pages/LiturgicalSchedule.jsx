import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, isSunday, parseISO } from 'date-fns';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import { clearLiturgicalCache } from '../services/liturgicalService';
import './LiturgicalSchedule.css';
import './People.css';
import './Sunday.css';
import '../components/AtAGlance.css';

const parseLocalDay = (dateStr) => {
    if (!dateStr) return null;
    if (dateStr.includes('T')) return new Date(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist'];
const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];
const SERVICE_TIME_SET = new Set(['08:00', '10:00']);
const isEightAmService = (time = '') => /^0?8:/.test(time.trim());
const getServiceRoleKeys = (serviceTime) => (isEightAmService(serviceTime || '') ? EIGHT_AM_ROLE_KEYS : TEN_AM_ROLE_KEYS);
const MULTI_ASSIGNMENT_ROLES = new Set(['lector', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare']);

const entryFieldByRole = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    lector: 'lector',
    organist: 'organist',
    lem: 'chalice_bearer',
    acolyte: 'acolyte',
    usher: 'usher',
    sound: 'sound_engineer',
    coffeeHour: 'coffee_hour',
    childcare: 'childcare'
};

const roleConfigs = [
    { key: 'celebrant', label: 'Celebrant' },
    { key: 'preacher', label: 'Preacher' },
    { key: 'lector', label: 'Lector' },
    { key: 'organist', label: 'Organist' },
    { key: 'lem', label: 'LEM' },
    { key: 'acolyte', label: 'Acolyte' },
    { key: 'usher', label: 'Usher' },
    { key: 'sound', label: 'Sound' },
    { key: 'coffeeHour', label: 'Coffee Hour' },
    { key: 'childcare', label: 'Childcare' }
];

const getSeasonLabel = (color, feast = '') => {
    const normalized = (feast || '').toLowerCase();
    if (normalized.includes('advent')) return 'Advent';
    if (normalized.includes('lent')) return 'Lent';
    if (normalized.includes('holy week') || normalized.includes('palm sunday')) return 'Holy Week';
    if (normalized.includes('easter')) return 'Easter';
    if (normalized.includes('pentecost')) return 'Pentecost';
    if (normalized.includes('christmas')) return 'Christmas';
    if (normalized.includes('epiphany') || normalized.includes('baptism of our lord')) return 'Epiphany';

    if (color === 'Green') return 'Ordinary Time';
    if (color === 'Purple') return 'Advent/Lent';
    if (color === 'White') return 'Easter/Christmas';
    if (color === 'Red') return 'Pentecost';
    return 'Season';
};



const LiturgicalSchedule = () => {
    const [liturgicalDays, setLiturgicalDays] = useState([]);
    const [scheduleRows, setScheduleRows] = useState([]);
    const [people, setPeople] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [schedulingWeek, setSchedulingWeek] = useState('');
    const [exportingMonths, setExportingMonths] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [exportSelection, setExportSelection] = useState([]);
    const [exportFormat, setExportFormat] = useState('pdf');
    const [scheduling, setScheduling] = useState(false);
    const [error, setError] = useState('');
    const [openMenu, setOpenMenu] = useState(null);
    const [menuDirection, setMenuDirection] = useState('up');
    const [showPast, setShowPast] = useState(false);

    const serializeAssignments = (value) => {
        if (!value) return '';
        if (Array.isArray(value)) return value.filter(Boolean).join(', ');
        return String(value);
    };

    const buildScheduleRowsFromSundays = useCallback((sundays = []) => {
        const rows = [];
        sundays.forEach((day) => {
            const services = Array.isArray(day?.services) ? day.services : [];
            services.forEach((service) => {
                const entry = {
                    id: `${day.date}-${service.time || '10:00'}`,
                    date: day.date,
                    service_time: service.time || '10:00',
                    location: service.location || ''
                };
                Object.entries(entryFieldByRole).forEach(([roleKey, fieldKey]) => {
                    const value = service?.roles?.[roleKey] ?? service?.[roleKey];
                    entry[fieldKey] = serializeAssignments(value);
                });
                rows.push(entry);
            });
        });
        return rows;
    }, []);

    const refreshScheduleRows = async () => {
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/sundays?months=12`);
            if (!response.ok) throw new Error('Failed to load schedule');
            const sundays = await response.json();
            const list = Array.isArray(sundays) ? sundays : [];
            setLiturgicalDays(list.map((day) => ({
                date: day.date,
                feast: day.feast,
                color: day.color,
                readings: day.readings
            })));
            setScheduleRows(buildScheduleRowsFromSundays(list));
        } catch (err) {
            console.error(err);
            setError('Unable to load schedule.');
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [sundaysRes, peopleRes, buildingsRes] = await Promise.all([
                fetch(`${API_URL}/sunday/sundays?months=12`),
                fetch(`${API_URL}/people`),
                fetch(`${API_URL}/buildings`)
            ]);

            if (!sundaysRes.ok) throw new Error('Failed to load liturgical schedule');
            if (!peopleRes.ok) throw new Error('Failed to load people');
            if (!buildingsRes.ok) throw new Error('Failed to load buildings');

            const sundays = await sundaysRes.json();
            const peopleList = await peopleRes.json();
            const buildingList = await buildingsRes.json();

            const list = Array.isArray(sundays) ? sundays : [];
            setLiturgicalDays(list.map((day) => ({
                date: day.date,
                feast: day.feast,
                color: day.color,
                readings: day.readings
            })));
            setScheduleRows(buildScheduleRowsFromSundays(list));
            setPeople(Array.isArray(peopleList) ? peopleList : []);
            setBuildings(Array.isArray(buildingList) ? buildingList : []);
        } catch (err) {
            console.error(err);
            setError('Unable to load liturgical schedule.');
        } finally {
            setLoading(false);
        }
    }, [buildScheduleRowsFromSundays]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!openMenu) return;
        const timer = setTimeout(() => {
            const key = `${openMenu.entryKey}-${openMenu.roleKey}`;
            const menu = document.querySelector(`[data-menu-key="${key}"]`);
            if (!menu) return;
            const rect = menu.getBoundingClientRect();
            const menuHeight = rect.height;
            const trigger = menu.parentElement?.getBoundingClientRect();
            if (!trigger) return;
            const spaceAbove = trigger.top;
            const spaceBelow = window.innerHeight - trigger.bottom;
            if (spaceAbove >= menuHeight) {
                setMenuDirection('up');
            } else if (spaceBelow >= menuHeight) {
                setMenuDirection('down');
            } else {
                setMenuDirection('up');
            }
        }, 0);

        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-menu') || target.closest('.role-menu-trigger')) return;
            setOpenMenu(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [openMenu]);

    const liturgicalByDate = useMemo(() => {
        const map = new Map();
        liturgicalDays.forEach((day) => {
            if (day?.date) map.set(day.date, day);
        });
        return map;
    }, [liturgicalDays]);

    const sundayEntries = useMemo(() => {
        const rows = scheduleRows
            .filter((row) => {
                const date = parseISO(row.date);
                return isSunday(date);
            })
            .map((row) => {
                if (row.service_time && !SERVICE_TIME_SET.has(row.service_time)) {
                    return null;
                }
                const liturgical = liturgicalByDate.get(row.date);
                return {
                    ...row,
                    dateObj: parseLocalDay(row.date),
                    feast: liturgical?.feast || 'Sunday',
                    color: liturgical?.color || 'Green'
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.date.localeCompare(b.date));

        return rows;
    }, [scheduleRows, liturgicalByDate]);

    const groupedEntries = useMemo(() => {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const grouped = new Map();
        sundayEntries.forEach((entry) => {
            if (entry.dateObj && entry.dateObj < monthStart) return;
            if (!showPast && entry.dateObj && entry.dateObj < todayStart) return;
            const monthKey = entry.dateObj ? format(entry.dateObj, 'MMMM yyyy') : 'Unknown';
            if (!grouped.has(monthKey)) grouped.set(monthKey, []);
            grouped.get(monthKey).push(entry);
        });
        return Array.from(grouped.entries()).map(([month, entries]) => {
            const dateMap = new Map();
            entries.forEach((entry) => {
                if (!dateMap.has(entry.date)) {
                    dateMap.set(entry.date, {
                        date: entry.date,
                        dateObj: entry.dateObj,
                        feast: entry.feast,
                        color: entry.color,
                        isPast: entry.dateObj ? entry.dateObj < today : false,
                        services: []
                    });
                }
                dateMap.get(entry.date).services.push(entry);
            });
            const dateGroups = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            dateGroups.forEach((group) => {
                group.services.sort((a, b) => (a.service_time || '').localeCompare(b.service_time || ''));
            });
            return [month, dateGroups];
        });
    }, [sundayEntries, showPast]);

    const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
    const buildingsById = useMemo(() => new Map(buildings.map((building) => [building.id, building])), [buildings]);
    const peopleByName = useMemo(() => {
        const map = new Map();
        people.forEach((person) => {
            if (person?.displayName) {
                map.set(person.displayName.toLowerCase(), person);
            }
        });
        return map;
    }, [people]);

    const parseAssignments = (value) => {
        if (!value) return [];
        return value
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => {
                if (peopleById.has(name)) return name;
                const match = peopleByName.get(name.toLowerCase());
                return match ? match.id : name;
            })
            .filter(Boolean);
    };

    const buildAssignmentChips = (entry, value, roleKey) => {
        const ids = parseAssignments(value);
        if (ids.length === 0) return null;
        return (
            <div className="role-chip-list">
                {ids.map((id) => {
                    const person = peopleById.get(id) || peopleByName.get(id.toLowerCase());
                    const displayName = person?.displayName || id;
                    const category = person?.category || 'volunteer';
                    return (
                        <span
                            key={id}
                            className="person-chip-wrapper"
                            onClick={(event) => {
                                event.stopPropagation();
                                const nextIds = ids.filter((personId) => personId !== id);
                                updateEntryAssignments(entry, roleKey, nextIds);
                            }}
                        >
                            <span className={`person-chip person-chip-${category} ${person?.isPledger ? 'person-chip-pledger' : ''}`}>{displayName}</span>
                        </span>
                    );
                })}
            </div>
        );
    };
    const getEntryKey = (entry) => `${entry.date}-${entry.service_time || '10:00'}`;

    const toggleRoleMenu = (entry, roleKey) => {
        const entryKey = getEntryKey(entry);
        setOpenMenu((prev) => {
            if (prev?.entryKey === entryKey && prev?.roleKey === roleKey) {
                return null;
            }
            return { entryKey, roleKey };
        });
    };

    const normalizeRoleIds = (roleKey, ids) => {
        const list = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : []);
        return MULTI_ASSIGNMENT_ROLES.has(roleKey) ? list : list.slice(0, 1);
    };

    const getTeamMap = (roleKey, eligiblePeople) => {
        const teamMap = new Map();
        eligiblePeople.forEach((person) => {
            const teamList = person.teams?.[roleKey] || [];
            teamList.forEach((teamNumber) => {
                if (!teamMap.has(teamNumber)) teamMap.set(teamNumber, []);
                teamMap.get(teamNumber).push(person.id);
            });
        });
        return teamMap;
    };

    const updateEntryAssignments = async (entry, roleKey, nextIds) => {
        if (!entry?.date) return;
        setSaving(true);
        try {
            const serviceRoleKeys = getServiceRoleKeys(entry.service_time);
            const payload = {
                [entry.service_time || '10:00']: {
                    location: entry.location || ''
                }
            };

            roleConfigs.forEach((role) => {
                const entryField = entryFieldByRole[role.key];
                const currentIds = serviceRoleKeys.includes(role.key)
                    ? parseAssignments(entry[entryField])
                    : [];
                const normalizedCurrent = normalizeRoleIds(role.key, currentIds);
                const normalizedNext = role.key === roleKey
                    ? normalizeRoleIds(role.key, nextIds)
                    : normalizedCurrent;
                payload[entry.service_time || '10:00'][role.key] = normalizedNext;
            });

            const response = await fetch(`${API_URL}/sunday/roles/${entry.date}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Failed to save schedule');
            clearLiturgicalCache();
            setScheduleRows((prev) => prev.map((row) => {
                if (row.id !== entry.id) return row;
                const entryField = entryFieldByRole[roleKey];
                return {
                    ...row,
                    [entryField]: normalizeRoleIds(roleKey, nextIds).join(', ')
                };
            }));
        } catch (err) {
            console.error(err);
            setError('Unable to save schedule changes.');
        } finally {
            setSaving(false);
        }
    };

    const toggleTeamSelection = (entry, roleKey, teamMemberIds) => {
        const entryField = entryFieldByRole[roleKey];
        const currentIds = normalizeRoleIds(roleKey, parseAssignments(entry[entryField]));
        const current = new Set(currentIds);
        const allSelected = teamMemberIds.every((id) => current.has(id));
        if (allSelected) {
            teamMemberIds.forEach((id) => current.delete(id));
        } else {
            teamMemberIds.forEach((id) => current.add(id));
        }
        updateEntryAssignments(entry, roleKey, Array.from(current));
    };

    const togglePersonSelection = (entry, roleKey, personId) => {
        const isMulti = MULTI_ASSIGNMENT_ROLES.has(roleKey);
        const entryField = entryFieldByRole[roleKey];
        const currentIds = normalizeRoleIds(roleKey, parseAssignments(entry[entryField]));
        if (isMulti) {
            const current = new Set(currentIds);
            if (current.has(personId)) {
                current.delete(personId);
            } else {
                current.add(personId);
            }
            updateEntryAssignments(entry, roleKey, Array.from(current));
            return;
        }
        updateEntryAssignments(entry, roleKey, [personId]);
        setOpenMenu(null);
    };

    const handleExportMonthsPdf = async () => {
        if (exportingMonths) return;
        const months = exportSelection.filter((value) => /^\d{4}-\d{2}$/.test(value));
        if (months.length === 0) {
            window.alert('Please select at least one month to export.');
            return;
        }
        setExportingMonths(true);
        setError('');
        try {
            const endpoint = exportFormat === 'xlsx'
                ? `${API_URL}/liturgical-schedule/xlsx-months`
                : `${API_URL}/liturgical-schedule/pdf-months`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ months })
            });
            if (!response.ok) throw new Error('Failed to build PDF');
            const blob = await response.blob();
            const fileName = exportFormat === 'xlsx'
                ? `liturgical-schedule-${months.join('-')}.xlsx`
                : `liturgical-schedule-table-${months.join('-')}.pdf`;
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            setError('Unable to export schedule PDF.');
        } finally {
            setExportingMonths(false);
            setExportDialogOpen(false);
        }
    };

    const exportMonthOptions = useMemo(() => {
        const months = Array.from(new Set(sundayEntries
            .filter((entry) => entry?.dateObj)
            .map((entry) => format(entry.dateObj, 'yyyy-MM'))));
        months.sort();
        return months.map((value) => ({
            value,
            label: format(new Date(`${value}-01T00:00:00`), 'MMMM yyyy')
        }));
    }, [sundayEntries]);

    const toggleExportMonth = (value) => {
        setExportSelection((prev) => (
            prev.includes(value)
                ? prev.filter((item) => item !== value)
                : [...prev, value]
        ));
    };

    const handleScheduleNextMonth = async () => {
        if (scheduling) return;
        const confirmed = window.confirm('Schedule the next month using rotation teams? This will overwrite assignments for team-based roles.');
        if (!confirmed) return;
        setScheduling(true);
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/schedule-roles/auto-next-month`, { method: 'POST' });
            if (!response.ok) throw new Error('Failed to schedule next month');
            clearLiturgicalCache();
            await loadData();
        } catch (err) {
            console.error(err);
            setError('Unable to schedule next month.');
        } finally {
            setScheduling(false);
        }
    };

    const handleScheduleWeek = async (date) => {
        if (schedulingWeek) return;
        const confirmed = window.confirm('Populate this Sunday with the rotation for its week? This will overwrite assignments for team-based roles.');
        if (!confirmed) return;
        setSchedulingWeek(date);
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/schedule-roles/auto-week`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date })
            });
            if (!response.ok) throw new Error('Failed to schedule week');
            clearLiturgicalCache();
            await refreshScheduleRows();
        } catch (err) {
            console.error(err);
            setError('Unable to schedule week.');
        } finally {
            setSchedulingWeek('');
        }
    };

    return (
        <div className="page-liturgical">
            <header className="page-header page-header-bar">
                <div className="page-header-title">
                    <h1>Liturgical Schedule</h1>
                    <p className="page-header-subtitle">Sunday service assignments by team and role.</p>
                </div>
                <div className="page-header-actions">
                    <button
                        className="btn-secondary"
                        onClick={() => setShowPast((prev) => !prev)}
                    >
                        {showPast ? 'Hide Past Sundays' : 'Show Past Sundays'}
                    </button>
                    <button
                        className="btn-secondary"
                        onClick={() => setExportDialogOpen(true)}
                        disabled={loading || exportingMonths}
                    >
                        {exportingMonths ? 'Exporting...' : 'Export'}
                    </button>
                    <button className="btn-secondary" onClick={handleScheduleNextMonth} disabled={loading || scheduling}>
                        {scheduling ? 'Scheduling...' : 'Schedule Next Month'}
                    </button>
                    <button className="btn-secondary" onClick={loadData} disabled={loading}>
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {error && <div className="alert error">{error}</div>}

            {loading ? (
                <Card className="loading-card">Loading schedule...</Card>
            ) : groupedEntries.length === 0 ? (
                <Card className="empty-card">No Sunday schedule entries found.</Card>
            ) : (
                groupedEntries.map(([month, dateGroups]) => (
                    <Card key={month} className="schedule-card">
                        <div className="schedule-card__header">
                            <h2>{month}</h2>
                            <span className="schedule-count">{dateGroups.length} Sundays</span>
                        </div>
                        <div className="schedule-table">
                            {dateGroups.map((group, groupIndex) => (
                                <div
                                    key={group.date}
                                    className={`schedule-date-group ${groupIndex % 2 === 1 ? 'alt' : ''} ${group.isPast ? 'past' : ''}`}
                                >
                                    <div className="schedule-date-header">
                                        <div className="schedule-date">
                                            <div className="schedule-date-title">
                                                <span>{group.dateObj ? format(group.dateObj, 'MMM d') : group.date}</span>
                                                <span className="schedule-date-separator">—</span>
                                                <span>{group.feast}</span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-secondary btn-compact"
                                            onClick={() => handleScheduleWeek(group.date)}
                                            disabled={saving || schedulingWeek === group.date}
                                        >
                                            {schedulingWeek === group.date ? 'Scheduling...' : 'Apply Rotation'}
                                        </button>
                                        <div className="schedule-feast">
                                            <span className={`liturgical-badge badge-${group.color}`}>{getSeasonLabel(group.color, group.feast)}</span>
                                        </div>
                                    </div>
                                    {group.services.map((entry) => (
                                        <div key={`${entry.date}-${entry.service_time}`} className="schedule-row schedule-service-row">
                                            <div className="schedule-service-time">
                                                <span className="time-label">{entry.service_time || '10:00'}</span>
                                                <span className="service-location-label">
                                                    {buildingsById.get(entry.location)?.name || entry.location || ''}
                                                </span>
                                            </div>
                                            <div className="schedule-roles">
                                                {getServiceRoleKeys(entry.service_time).map((roleKey) => {
                                                    const role = roleConfigs.find((config) => config.key === roleKey);
                                                    const entryField = entryFieldByRole[roleKey];
                                                    const selectedIds = normalizeRoleIds(roleKey, parseAssignments(entry[entryField]));
                                                    const eligiblePeople = people.filter((person) => (person.roles || []).includes(roleKey));
                                                    const teamMap = getTeamMap(roleKey, eligiblePeople);
                                                    const teamEntries = Array.from(teamMap.entries()).sort((a, b) => a[0] - b[0]);
                                                    const entryKey = getEntryKey(entry);
                                                    const menuOpen = openMenu?.entryKey === entryKey && openMenu?.roleKey === roleKey;
                                                    return (
                                                        <div key={`${entry.date}-${entry.service_time}-${roleKey}`}>
                                                            <div className="role-menu-anchor">
                                                                <button
                                                                    type="button"
                                                                    className="role-menu-trigger role-label-trigger"
                                                                    onClick={(event) => {
                                                                        event.preventDefault();
                                                                        event.stopPropagation();
                                                                        toggleRoleMenu(entry, roleKey);
                                                                    }}
                                                                    disabled={eligiblePeople.length === 0}
                                                                    aria-expanded={menuOpen ? 'true' : 'false'}
                                                                >
                                                                    <span className="role-label">{role?.label}</span>
                                                                    <span className={`caret-icon ${menuOpen ? 'open' : ''}`}>▸</span>
                                                                </button>
                                                                {menuOpen && (
                                                                    <div
                                                                        className={`person-menu ${menuDirection === 'down' ? 'open-down' : 'open-up'}`}
                                                                        data-menu-key={`${entryKey}-${roleKey}`}
                                                                    >
                                                                        {MULTI_ASSIGNMENT_ROLES.has(roleKey) && teamEntries.length > 0 && (
                                                                            <div className="person-menu-section">
                                                                                <div className="person-menu-title">Teams</div>
                                                                                {teamEntries.map(([teamNumber, memberIds]) => {
                                                                                    const teamSelected = memberIds.every((id) => selectedIds.includes(id));
                                                                                    return (
                                                                                        <button
                                                                                            key={`${entryKey}-${roleKey}-team-${teamNumber}`}
                                                                                            type="button"
                                                                                            className="person-menu-item"
                                                                                            onClick={() => toggleTeamSelection(entry, roleKey, memberIds)}
                                                                                        >
                                                                                            <span className={`person-chip person-chip-volunteer ${teamSelected ? 'chip-selected' : ''}`}>
                                                                                                Team {teamNumber}
                                                                                            </span>
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                                <div className="person-menu-divider" />
                                                                            </div>
                                                                        )}
                                                                        <div className="person-menu-section">
                                                                            <div className="person-menu-title">People</div>
                                                                            {eligiblePeople.map((person) => {
                                                                                const isSelected = selectedIds.includes(person.id);
                                                                                const category = person.category || 'volunteer';
                                                                                return (
                                                                                    <button
                                                                                        key={`${entryKey}-${roleKey}-${person.id}`}
                                                                                        type="button"
                                                                                        className="person-menu-item"
                                                                                        onClick={() => togglePersonSelection(entry, roleKey, person.id)}
                                                                                    >
                                                                                        <span className={`person-chip person-chip-${category} ${person.isPledger ? 'person-chip-pledger' : ''} ${isSelected ? 'chip-selected' : ''}`}>
                                                                                            {person.displayName}
                                                                                        </span>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {buildAssignmentChips(entry, entry[entryField], roleKey)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </Card>
                ))
            )}

            <Modal
                isOpen={exportDialogOpen}
                onClose={() => setExportDialogOpen(false)}
                title="Export Liturgical Schedule"
                className="modal-large"
            >
                <div className="export-months">
                    <div className="export-months__intro">Select months to include in the export.</div>
                    <div className="export-months__format">
                        <label>
                            <input
                                type="radio"
                                name="exportFormat"
                                value="pdf"
                                checked={exportFormat === 'pdf'}
                                onChange={() => setExportFormat('pdf')}
                            />
                            <span>PDF</span>
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="exportFormat"
                                value="xlsx"
                                checked={exportFormat === 'xlsx'}
                                onChange={() => setExportFormat('xlsx')}
                            />
                            <span>Spreadsheet</span>
                        </label>
                    </div>
                    <div className="export-months__grid">
                        {exportMonthOptions.map((option) => (
                            <label key={option.value} className="export-months__item">
                                <input
                                    type="checkbox"
                                    checked={exportSelection.includes(option.value)}
                                    onChange={() => toggleExportMonth(option.value)}
                                />
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="export-months__actions">
                        <button className="btn-secondary" onClick={() => setExportDialogOpen(false)}>
                            Cancel
                        </button>
                        <button
                            className="btn-primary"
                            onClick={handleExportMonthsPdf}
                            disabled={exportingMonths || exportSelection.length === 0}
                        >
                            {exportingMonths ? 'Exporting...' : 'Export'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default LiturgicalSchedule;
