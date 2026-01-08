import { useEffect, useMemo, useState } from 'react';
import { format, isSunday, parseISO } from 'date-fns';
import Card from '../components/Card';
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

const apiFieldByRole = {
    celebrant: 'celebrant',
    preacher: 'preacher',
    lector: 'lector',
    organist: 'organist',
    lem: 'lem',
    acolyte: 'acolyte',
    usher: 'usher',
    sound: 'sound',
    coffeeHour: 'coffeeHour',
    childcare: 'childcare'
};

const roleLabel = (key) => roleConfigs.find((role) => role.key === key)?.label || key;
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

const SEASON_BY_COLOR = {
    Green: 'Ordinary Time',
    Purple: 'Advent/Lent',
    White: 'Easter/Christmas',
    Red: 'Pentecost'
};

const getSeasonLabel = (color) => SEASON_BY_COLOR[color] || 'Season';



const LiturgicalSchedule = () => {
    const [liturgicalDays, setLiturgicalDays] = useState([]);
    const [scheduleRows, setScheduleRows] = useState([]);
    const [people, setPeople] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [openMenu, setOpenMenu] = useState(null);
    const [menuDirection, setMenuDirection] = useState('up');
    const [openTooltipKey, setOpenTooltipKey] = useState(null);

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [daysRes, scheduleRes, peopleRes, buildingsRes] = await Promise.all([
                fetch(`${API_URL}/liturgical-days`),
                fetch(`${API_URL}/schedule-roles`),
                fetch(`${API_URL}/people`),
                fetch(`${API_URL}/buildings`)
            ]);

            if (!daysRes.ok) throw new Error('Failed to load liturgical days');
            if (!scheduleRes.ok) throw new Error('Failed to load schedule roles');
            if (!peopleRes.ok) throw new Error('Failed to load people');
            if (!buildingsRes.ok) throw new Error('Failed to load buildings');

            const days = await daysRes.json();
            const schedule = await scheduleRes.json();
            const peopleList = await peopleRes.json();
            const buildingList = await buildingsRes.json();

            setLiturgicalDays(Array.isArray(days) ? days : []);
            setScheduleRows(Array.isArray(schedule) ? schedule : []);
            setPeople(Array.isArray(peopleList) ? peopleList : []);
            setBuildings(Array.isArray(buildingList) ? buildingList : []);
        } catch (err) {
            console.error(err);
            setError('Unable to load liturgical schedule.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        const handleClick = (event) => {
            const target = event.target;
            if (target.closest('.person-tooltip') || target.closest('.person-chip-wrapper')) return;
            setOpenTooltipKey(null);
        };
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('mousedown', handleClick);
        };
    }, []);

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
                const liturgical = liturgicalByDate.get(row.date);
                return {
                    ...row,
                    dateObj: parseLocalDay(row.date),
                    feast: liturgical?.feast || 'Sunday',
                    color: liturgical?.color || 'Green'
                };
            })
            .sort((a, b) => a.date.localeCompare(b.date));

        return rows;
    }, [scheduleRows, liturgicalByDate]);

    const groupedEntries = useMemo(() => {
        const today = new Date();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const grouped = new Map();
        sundayEntries.forEach((entry) => {
            if (entry.dateObj && entry.dateObj < monthStart) return;
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
    }, [sundayEntries]);

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

    const serializeAssignments = (ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return '';
        return ids.join(', ');
    };

    const formatAssignments = (value) => {
        if (!value) return '-';
        return value
            .split(',')
            .map((token) => token.trim())
            .filter(Boolean)
            .map((token) => {
                const person = peopleById.get(token) || peopleByName.get(token.toLowerCase());
                return person?.displayName || token;
            })
            .filter(Boolean)
            .join(', ');
    };

    const renderTooltipCard = (person) => {
        if (!person) return null;
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const titleTags = tags.filter((tag) => tag && tag !== extensionTag);
        const metaChips = [...titleTags, ...(extensionTag ? [extensionTag] : [])];

        return (
            <Card className="person-card tooltip-person-card">
                <div className="person-card__header">
                    <div className="person-main">
                        <div className="person-name">{person.displayName}</div>
                        {person.email && (
                            <a className="person-email" href={`mailto:${person.email}`}>
                                {person.email}
                            </a>
                        )}
                        {metaChips.length > 0 && (
                            <div className="meta-chip-row">
                                {metaChips.map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                        {tags.length > metaChips.length && (
                            <div className="tag-row">
                                {tags.filter((tag) => !metaChips.includes(tag)).map((tag) => (
                                    <span key={tag} className="tag-chip">{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="roles">
                    <span className="roles-label">Eligible roles</span>
                    <div className="role-chip-row">
                        {(person.roles || []).map((roleKey) => (
                            <span key={roleKey} className="role-chip">{roleLabel(roleKey)}</span>
                        ))}
                    </div>
                </div>
            </Card>
        );
    };

    const buildAssignmentChips = (value, entryKey, roleKey) => {
        const ids = parseAssignments(value);
        if (ids.length === 0) return null;
        return (
            <div className="role-chip-list">
                {ids.map((id) => {
                    const person = peopleById.get(id) || peopleByName.get(id.toLowerCase());
                    const displayName = person?.displayName || id;
                    const category = person?.category || 'volunteer';
                    const tooltipKey = `${entryKey}-${roleKey}-${id}`;
                    return (
                        <span
                            key={id}
                            className={`person-chip-wrapper ${openTooltipKey === tooltipKey ? 'tooltip-open' : ''}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenTooltipKey((prev) => (prev === tooltipKey ? null : tooltipKey));
                            }}
                        >
                            <span className={`person-chip person-chip-${category}`}>{displayName}</span>
                            {person && (
                                <span className={`person-tooltip ${openTooltipKey === tooltipKey ? 'open' : ''}`}>
                                    {renderTooltipCard(person)}
                                </span>
                            )}
                        </span>
                    );
                })}
            </div>
        );
    };
    const filterEligibleIds = (roleKey, ids) => {
        return ids.filter((id) => {
            const person = peopleById.get(id);
            return person && (person.roles || []).includes(roleKey);
        });
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
                date: entry.date,
                service_time: entry.service_time || '10:00'
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
                payload[apiFieldByRole[role.key]] = serializeAssignments(normalizedNext);
            });

            const response = await fetch(`${API_URL}/schedule-roles`, {
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
                    [entryField]: serializeAssignments(normalizeRoleIds(roleKey, nextIds))
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

    return (
        <div className="page-liturgical">
            <header className="page-header">
                <div>
                    <h1>Liturgical Schedule</h1>
                    <p>Sunday service assignments by team and role.</p>
                </div>
                <button className="btn-secondary" onClick={loadData} disabled={loading}>
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
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
                                        <div className="schedule-feast">
                                            <span className={`liturgical-badge badge-${group.color}`}>{getSeasonLabel(group.color)}</span>
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
                                                                                        <span className={`person-chip person-chip-${category} ${isSelected ? 'chip-selected' : ''}`}>
                                                                                            {person.displayName}
                                                                                        </span>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {buildAssignmentChips(entry[entryField], entryKey, roleKey)}
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

        </div>
    );
};

export default LiturgicalSchedule;
