import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { ROLE_DEFINITIONS } from '../models/roles';
import { clearLiturgicalCache, getFollowingSunday, getLiturgicalDay, getNextSunday, getPreviousSunday, getServicesByDate } from '../services/liturgicalService';
import { getSundayDetails, saveSundayDetails } from '../services/sundayDetails';
import './Sunday.css';
import './People.css';

const serializeDate = (date) => date.toISOString().slice(0, 10);

const bulletinOptions = ['draft', 'review', 'ready', 'printed'];

const apiRoleKeys = new Set([
    'celebrant',
    'preacher',
    'lector',
    'organist',
    'lem',
    'acolyte',
    'usher',
    'sound',
    'coffeeHour',
    'childcare'
]);

const roleToApiField = {
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

const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist'];
const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];
const MULTI_ASSIGNMENT_ROLES = new Set(['lector', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare']);
const isEightAmService = (time = '') => /^0?8:/.test(time.trim());
const getServiceRoleKeys = (service) => (isEightAmService(service?.time || '') ? EIGHT_AM_ROLE_KEYS : TEN_AM_ROLE_KEYS);
const formatServiceTime = (time) => {
    const trimmed = (time || '').trim();
    if (trimmed.startsWith('08')) return '8:00 AM';
    if (trimmed.startsWith('10')) return '10 AM';
    return trimmed || 'Service';
};

const defaultLocationForTime = (time) => (isEightAmService(time) ? 'chapel' : 'sanctuary');

const roleLabel = (key) => ROLE_DEFINITIONS.find((role) => role.key === key)?.label || key;

const Sunday = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [details, setDetails] = useState(getSundayDetails(null));
    const [roleDrafts, setRoleDrafts] = useState({});
    const [locationDrafts, setLocationDrafts] = useState({});
    const [people, setPeople] = useState([]);
    const [buildings, setBuildings] = useState([]);
    const [openMenu, setOpenMenu] = useState(null);
    const [openTooltipKey, setOpenTooltipKey] = useState(null);
    const [menuDirection, setMenuDirection] = useState('up');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
    const peopleByName = useMemo(() => {
        const map = new Map();
        people.forEach((person) => {
            if (person?.displayName) map.set(person.displayName.toLowerCase(), person);
        });
        return map;
    }, [people]);

    const loadSunday = useCallback(async (date) => {
        if (!date) return;
        setLoading(true);
        setError('');
        try {
            const [litInfo, svcData] = await Promise.all([
                getLiturgicalDay(date),
                getServicesByDate(date)
            ]);
            const stored = getSundayDetails(date);
            const drafts = {};
            const locationMap = {};
            svcData.forEach((service) => {
                const roleValues = {};
                const serviceRoleKeys = getServiceRoleKeys(service);
                serviceRoleKeys.forEach((roleKey) => {
                    const rosterPeople = service.roster?.[roleKey]?.people || [];
                    const resolvedIds = rosterPeople
                        .map((person) => {
                            if (!person) return '';
                            if (peopleById.has(person.id)) return person.id;
                            const byName = peopleByName.get((person.displayName || '').toLowerCase());
                            return byName?.id || '';
                        })
                        .filter(Boolean);
                    const eligibleIds = resolvedIds.filter((id) => {
                        const person = peopleById.get(id);
                        return person && (person.roles || []).includes(roleKey);
                    });

                    roleValues[roleKey] = MULTI_ASSIGNMENT_ROLES.has(roleKey)
                        ? eligibleIds
                        : (eligibleIds[0] || '');
                });
                drafts[service.time] = roleValues;
                locationMap[service.time] = service.location || defaultLocationForTime(service.time);
            });

            setCurrentDate(date);
            setLiturgicalInfo(litInfo);
            setServices(svcData);
            setDetails(stored);
            setRoleDrafts(drafts);
            setLocationDrafts(locationMap);
        } catch (err) {
            console.error(err);
            setError('Unable to load Sunday details.');
        } finally {
            setLoading(false);
        }
    }, [peopleById, peopleByName]);

    const updateDateParam = useCallback((date) => {
        navigate(`/sunday?date=${serializeDate(date)}`);
    }, [navigate]);

    useEffect(() => {
        let active = true;
        const loadPeople = async () => {
            try {
                const response = await fetch(`${API_URL}/people`);
                if (!response.ok) throw new Error('Failed to load people');
                const data = await response.json();
                if (active) {
                    setPeople(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                console.error(err);
                if (active) setPeople([]);
            }
        };
        loadPeople();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const loadBuildings = async () => {
            try {
                const response = await fetch(`${API_URL}/buildings`);
                if (!response.ok) throw new Error('Failed to load buildings');
                const data = await response.json();
                if (active) {
                    setBuildings(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                console.error(err);
                if (active) setBuildings([]);
            }
        };
        loadBuildings();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!openMenu) return;
        const timer = setTimeout(() => {
            const key = `${openMenu.serviceTime}-${openMenu.roleKey}`;
            const menu = document.querySelector(`[data-menu-key="${key}"]`);
            if (!menu) return;
            const rect = menu.getBoundingClientRect();
            const menuHeight = rect.height;
            const trigger = menu.parentElement?.getBoundingClientRect();
            if (!trigger) return;
            const spaceBelow = window.innerHeight - trigger.bottom;
            const spaceAbove = trigger.top;
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
        const paramDate = searchParams.get('date');
        if (paramDate) {
            loadSunday(parseISO(paramDate));
            return;
        }
        getNextSunday().then((nextDate) => {
            if (nextDate) {
                updateDateParam(nextDate);
            }
        });
    }, [loadSunday, searchParams, updateDateParam]);

    useEffect(() => {
        if (!currentDate || people.length === 0) return;
        loadSunday(currentDate);
    }, [currentDate, loadSunday, people.length]);

    const handleNavigate = async (direction) => {
        if (!currentDate) return;
        const newDate = direction === 'prev'
            ? await getPreviousSunday(currentDate)
            : await getFollowingSunday(currentDate);
        updateDateParam(newDate);
    };

    const updateDetailField = (field, value) => {
        setDetails((prev) => ({ ...prev, [field]: value }));
    };

    const updateRoleDraft = (serviceTime, roleKey, value) => {
        setRoleDrafts((prev) => {
            const nextValue = typeof value === 'function'
                ? value(prev[serviceTime]?.[roleKey])
                : value;
            return {
                ...prev,
                [serviceTime]: {
                    ...(prev[serviceTime] || {}),
                    [roleKey]: nextValue
                }
            };
        });
    };

    const updateLocationDraft = (serviceTime, value) => {
        setLocationDrafts((prev) => ({
            ...prev,
            [serviceTime]: value
        }));
    };

    const toggleRoleMenu = (serviceTime, roleKey) => {
        setOpenMenu((prev) => {
            if (prev?.serviceTime === serviceTime && prev?.roleKey === roleKey) {
                return null;
            }
            return { serviceTime, roleKey };
        });
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

    const toggleTeamSelection = (serviceTime, roleKey, teamMemberIds) => {
        updateRoleDraft(serviceTime, roleKey, (prevValue) => {
            const current = new Set(Array.isArray(prevValue) ? prevValue : (prevValue ? [prevValue] : []));
            const allSelected = teamMemberIds.every((id) => current.has(id));
            if (allSelected) {
                teamMemberIds.forEach((id) => current.delete(id));
            } else {
                teamMemberIds.forEach((id) => current.add(id));
            }
            return Array.from(current);
        });
    };

    const togglePersonSelection = (serviceTime, roleKey, personId, isMulti) => {
        if (isMulti) {
            updateRoleDraft(serviceTime, roleKey, (prevValue) => {
                const current = new Set(Array.isArray(prevValue) ? prevValue : (prevValue ? [prevValue] : []));
                if (current.has(personId)) {
                    current.delete(personId);
                } else {
                    current.add(personId);
                }
                return Array.from(current);
            });
            return;
        }
        updateRoleDraft(serviceTime, roleKey, personId);
        setOpenMenu(null);
    };

    const saveSunday = async () => {
        if (!currentDate) return;
        setSaving(true);
        setError('');
        try {
            const dateStr = serializeDate(currentDate);
            const requests = services.map((service) => {
                const payload = {
                    date: dateStr,
                    service_time: service.time || '10:00',
                    location: locationDrafts?.[service.time] || service.location || defaultLocationForTime(service.time)
                };
                const serviceRoleKeys = getServiceRoleKeys(service);
                serviceRoleKeys.forEach((roleKey) => {
                    if (!apiRoleKeys.has(roleKey)) return;
                    const draftValue = roleDrafts?.[service.time]?.[roleKey];
                    const selectedIds = Array.isArray(draftValue)
                        ? draftValue
                        : (draftValue ? [draftValue] : []);
                    payload[roleToApiField[roleKey]] = selectedIds.join(', ');
                });
                return fetch(`${API_URL}/schedule-roles`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            });

            const results = await Promise.all(requests);
            if (results.some((res) => !res.ok)) {
                throw new Error('Failed to save schedule updates');
            }
            saveSundayDetails(currentDate, details);
            clearLiturgicalCache();
        } catch (err) {
            console.error(err);
            setError('Unable to save Sunday updates.');
        } finally {
            setSaving(false);
        }
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

    const servicePanels = useMemo(() => {
        return services.map((service) => (
            <Card key={service.id} className="sunday-service-card">
                <header className="sunday-service-header">
                    <div>
                        <h3>{formatServiceTime(service.time)} Sunday Service - {service.rite || 'Rite II'}</h3>
                        <div className="service-location">
                            <span>Location</span>
                            <select
                                value={locationDrafts?.[service.time] || service.location || defaultLocationForTime(service.time)}
                                onChange={(event) => updateLocationDraft(service.time, event.target.value)}
                            >
                                {buildings.length === 0 ? (
                                    <option value={defaultLocationForTime(service.time)}>
                                        {defaultLocationForTime(service.time)}
                                    </option>
                                ) : (
                                    buildings.map((building) => (
                                        <option key={building.id} value={building.id}>
                                            {building.name}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                    </div>
                </header>
                <div className="service-roles-grid">
                    {ROLE_DEFINITIONS.filter((role) => getServiceRoleKeys(service).includes(role.key)).map((role) => {
                        const isMulti = MULTI_ASSIGNMENT_ROLES.has(role.key);
                        const selectedValue = roleDrafts?.[service.time]?.[role.key];
                        const selectValue = isMulti
                            ? (Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : []))
                            : (Array.isArray(selectedValue) ? (selectedValue[0] || '') : (selectedValue || ''));
                        const eligiblePeople = people.filter((person) => (person.roles || []).includes(role.key));
                        const teamMap = getTeamMap(role.key, eligiblePeople);
                        const teamEntries = Array.from(teamMap.entries()).sort((a, b) => a[0] - b[0]);
                        const selectedPeople = (Array.isArray(selectValue) ? selectValue : [selectValue])
                            .map((id) => peopleById.get(id))
                            .filter(Boolean);
                        const menuOpen = openMenu?.serviceTime === service.time && openMenu?.roleKey === role.key;

                        return (
                            <div key={`${service.id}-${role.key}`} className="role-edit-row">
                                <div className="role-menu-anchor">
                                    <button
                                        type="button"
                                        className="role-menu-trigger"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            toggleRoleMenu(service.time, role.key);
                                        }}
                                        disabled={eligiblePeople.length === 0}
                                        aria-expanded={menuOpen ? 'true' : 'false'}
                                    >
                                        <span>{role.label}</span>
                                        <span className={`caret-icon ${menuOpen ? 'open' : ''}`}>▸</span>
                                    </button>
                                    {menuOpen && (
                                        <div
                                            className={`person-menu ${menuDirection === 'down' ? 'open-down' : 'open-up'}`}
                                            data-menu-key={`${service.time}-${role.key}`}
                                        >
                                            {isMulti && teamEntries.length > 0 && (
                                                <div className="person-menu-section">
                                                    <div className="person-menu-title">Teams</div>
                                                    {teamEntries.map(([teamNumber, memberIds]) => {
                                                        const teamSelected = memberIds.every((id) => selectValue.includes(id));
                                                        return (
                                                            <button
                                                                key={`${service.id}-${role.key}-team-${teamNumber}`}
                                                                type="button"
                                                                className="person-menu-item"
                                                                onClick={() => toggleTeamSelection(service.time, role.key, memberIds)}
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
                                                    const isSelected = isMulti
                                                        ? selectValue.includes(person.id)
                                                        : selectValue === person.id;
                                                    const category = person.category || 'volunteer';
                                                    return (
                                                        <button
                                                            key={`${service.id}-${role.key}-${person.id}`}
                                                            type="button"
                                                            className="person-menu-item"
                                                            onClick={() => togglePersonSelection(service.time, role.key, person.id, isMulti)}
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
                                {selectedPeople.length > 0 ? (
                                    <div className="role-chip-list">
                                        {selectedPeople.map((person) => (
                                            <span
                                                key={person.id}
                                                className={`person-chip-wrapper ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'tooltip-open' : ''}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    const tooltipKey = `${service.time}-${role.key}-${person.id}`;
                                                    setOpenTooltipKey((prev) => (prev === tooltipKey ? null : tooltipKey));
                                                }}
                                            >
                                                <span className={`person-chip person-chip-${person.category || 'volunteer'}`}>{person.displayName}</span>
                                                <span className={`person-tooltip ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'open' : ''}`}>
                                                    {renderTooltipCard(person)}
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </Card>
        ));
    }, [buildings, locationDrafts, menuDirection, openMenu, openTooltipKey, people, peopleById, roleDrafts, services]);

    if (loading) {
        return (
            <div className="page-sunday">
                <Card className="loading-card">Loading Sunday details...</Card>
            </div>
        );
    }

    return (
        <div className="page-sunday">
            <header className="sunday-header">
                <div>
                    <h1>Sunday Planner</h1>
                </div>
                <button className="btn-primary" onClick={saveSunday} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Updates'}
                </button>
            </header>

            {error && <div className="alert error">{error}</div>}

            <div className="sunday-summary-row">
                <Card className="sunday-summary-card">
                    <div className="summary-header">
                        <button className="nav-icon" onClick={() => handleNavigate('prev')} aria-label="Previous Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <div className="summary-date">
                            <h2>{currentDate ? format(currentDate, 'MMMM d, yyyy') : ''}</h2>
                            <div className={`liturgical-badge badge-${liturgicalInfo?.color}`}>{liturgicalInfo?.name || liturgicalInfo?.feast || 'Sunday'}</div>
                            <div className="summary-notes">
                                <span className="summary-notes-label">Notes</span>
                                <textarea
                                    value={details.notes || ''}
                                    onChange={(event) => updateDetailField('notes', event.target.value)}
                                    rows={2}
                                    placeholder="Add notes for the Sunday..."
                                />
                            </div>
                        </div>
                        <button className="nav-icon" onClick={() => handleNavigate('next')} aria-label="Next Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </Card>
                <div className="summary-secondary">
                    <Card className="readings-card">
                        <h3>Readings</h3>
                        <div className="readings-text">
                            {(liturgicalInfo?.readings || 'Not set')
                                .split(';')
                                .map((reading) => reading.trim())
                                .filter(Boolean)
                                .map((reading, index) => (
                                    <div key={`${reading}-${index}`}>{reading}</div>
                                ))}
                        </div>
                    </Card>
                    <Card id="bulletin" className="sunday-panel bulletin-card">
                        <h3>Bulletin Status</h3>
                        <div
                            className="bulletin-status"
                            style={{ '--active-index': Math.max(0, bulletinOptions.indexOf(details.bulletinStatus || 'draft')) }}
                        >
                            <span className="bulletin-indicator" aria-hidden="true" />
                            {bulletinOptions.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    className={`bulletin-pill ${details.bulletinStatus === option ? 'active' : ''}`}
                                    onClick={() => updateDetailField('bulletinStatus', option)}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            <section id="volunteers" className="sunday-services">
                <div className="section-header">
                    <h2>Service Roles</h2>
                    <span className="text-muted">Every role for each service is listed below.</span>
                </div>
                {servicePanels.length > 0 ? servicePanels : (
                    <Card className="empty-card">No service assignments available for this Sunday.</Card>
                )}
            </section>
        </div>
    );
};

export default Sunday;
