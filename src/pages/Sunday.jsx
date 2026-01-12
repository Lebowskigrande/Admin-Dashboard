import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, isSameDay, parseISO } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { ROLE_DEFINITIONS } from '../models/roles';
import { clearLiturgicalCache, getFollowingSunday, getLiturgicalDay, getNextSunday, getPreviousSunday, getServicesByDate } from '../services/liturgicalService';
import { getSundayDetails, saveSundayDetails } from '../services/sundayDetails';
import { useEvents } from '../context/EventsContext';
import { FaFolderOpen, FaYoutube, FaUpload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import './Sunday.css';
import './People.css';

const serializeDate = (date) => date.toISOString().slice(0, 10);

const bulletinOptions = ['Not Started', 'draft', 'review', 'ready', 'printed'];
const insertOptions = ['Not Started', 'draft', 'review', 'ready', 'printed', 'stuffed'];

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
    const { events } = useEvents();
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
    const [livestreamUrl, setLivestreamUrl] = useState('');
    const [livestreamError, setLivestreamError] = useState('');
    const [ccFromEmails, setCcFromEmails] = useState([]);
    const [ccFromEmail, setCcFromEmail] = useState('office-saintedmunds.org@shared1.ccsend.com');
    const [ccFromEmailError, setCcFromEmailError] = useState('');
    const [docsLoading, setDocsLoading] = useState(false);
    const [uploadingBulletin, setUploadingBulletin] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [emailBusy, setEmailBusy] = useState(false);
    const [emailError, setEmailError] = useState('');
    const [bulletinDoc, setBulletinDoc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [bulletin8Doc, setBulletin8Doc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [insertDoc, setInsertDoc] = useState({ exists: false, preview: '', path: '', name: '' });
    const [statusDrafts, setStatusDrafts] = useState({});
    const [statusExpandedKey, setStatusExpandedKey] = useState(null);
    const [selectedEventId, setSelectedEventId] = useState(null);

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

    useEffect(() => {
        if (!currentDate) return;
        const loadLivestream = async () => {
            try {
                const dateStr = serializeDate(currentDate);
                const response = await fetch(`${API_URL}/sunday/livestream?date=${dateStr}`);
                if (!response.ok) throw new Error('Failed to load livestream');
                const data = await response.json();
                setLivestreamUrl(data?.url || '');
                setLivestreamError('');
            } catch (err) {
                console.error(err);
                setLivestreamUrl('');
                setLivestreamError('Unable to load livestream link.');
            }
        };
        loadLivestream();
    }, [currentDate]);

    const loadCcFromEmails = useCallback(async (keepCurrent = true) => {
        setCcFromEmailError('');
        try {
            const response = await fetch(`${API_URL}/constant-contact/from-emails`);
            if (!response.ok) {
                if (response.status === 401) return;
                throw new Error('Failed to load Constant Contact emails');
            }
            const data = await response.json().catch(() => ({}));
            const emails = Array.isArray(data?.emails)
                ? data.emails
                : Array.isArray(data?.email_addresses)
                    ? data.email_addresses
                    : Array.isArray(data?.results)
                        ? data.results
                        : [];
            const normalize = (value) => (value || '').toLowerCase().trim();
            const confirmed = emails.filter((entry) => {
                const status = (entry?.status || '').toLowerCase();
                return status === 'confirmed' || status === 'verified' || status === 'active';
            });
            const pickFirst = (list) => {
                for (const entry of list) {
                    const candidate = entry?.email_address || entry?.email || entry?.address || '';
                    if (candidate) return candidate;
                }
                return '';
            };
            setCcFromEmails(emails);
            setCcFromEmail((prev) => {
                const prevNormalized = normalize(prev);
                const hasPrev = prevNormalized && emails.some((entry) => {
                    const candidate = normalize(entry?.email_address || entry?.email || entry?.address);
                    return candidate === prevNormalized;
                });
                if (keepCurrent && hasPrev) return prev;
                return pickFirst(confirmed) || pickFirst(emails) || prev;
            });
        } catch (err) {
            console.error(err);
            setCcFromEmails([]);
            setCcFromEmailError('Unable to load sender emails.');
        }
    }, []);

    useEffect(() => {
        loadCcFromEmails(true);
    }, [loadCcFromEmails]);

    useEffect(() => {
        if (!currentDate) return;
        const loadDocs = async () => {
            setDocsLoading(true);
            try {
                const dateStr = serializeDate(currentDate);
                const name = liturgicalInfo?.name || liturgicalInfo?.feast || '';
                const response = await fetch(`${API_URL}/sunday/documents?date=${dateStr}&name=${encodeURIComponent(name)}`);
                if (!response.ok) throw new Error('Failed to load document status');
                const data = await response.json();
                setBulletinDoc(data?.bulletin10 || { exists: false, preview: '', path: '', name: '' });
                setBulletin8Doc(data?.bulletin8 || { exists: false, preview: '', path: '', name: '' });
                setInsertDoc(data?.insert || { exists: false, preview: '', path: '', name: '' });
            } catch (err) {
                console.error(err);
                setBulletinDoc({ exists: false, preview: '', path: '', name: '' });
                setBulletin8Doc({ exists: false, preview: '', path: '', name: '' });
                setInsertDoc({ exists: false, preview: '', path: '', name: '' });
            } finally {
                setDocsLoading(false);
            }
        };
        loadDocs();
    }, [currentDate, liturgicalInfo?.feast, liturgicalInfo?.name]);

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

    const openFileLocation = async (path) => {
        if (!path) return;
        try {
            await fetch(`${API_URL}/files/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const printFile = async (path) => {
        if (!path) return;
        try {
            await fetch(`${API_URL}/files/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const renderStatusStack = (key, options, selected, onSelect, disabled) => {
        const resolvedSelected = options.includes(selected) ? selected : options[0];
        const activeIndex = Math.max(0, options.indexOf(resolvedSelected));
        const draft = statusDrafts[key];
        const displaySelected = draft || resolvedSelected;
        const expanded = statusExpandedKey === key;
        return (
            <div
                className={`status-stack ${disabled ? 'disabled' : ''} ${expanded ? 'expanded' : ''}`}
                style={{ '--active-index': activeIndex, '--stack-count': options.length - 1 }}
                onMouseEnter={() => {
                    if (!disabled) setStatusExpandedKey(key);
                }}
                onMouseLeave={() => {
                    if (statusDrafts[key]) {
                        onSelect(statusDrafts[key]);
                        setStatusDrafts((prev) => ({ ...prev, [key]: null }));
                    }
                    setStatusExpandedKey(null);
                }}
            >
                <span className="status-anchor" aria-hidden="true">
                    {displaySelected}
                </span>
                {options.map((option, index) => (
                    <button
                        key={option}
                        type="button"
                        className={`status-option ${displaySelected === option ? 'active' : ''}`}
                        style={{ '--index': index }}
                        onClick={() => {
                            if (disabled) return;
                            setStatusDrafts((prev) => ({ ...prev, [key]: option }));
                        }}
                        disabled={disabled}
                    >
                        {option}
                    </button>
                ))}
            </div>
        );
    };

    const handleUploadBulletin = async () => {
        if (!bulletinDoc?.path || uploadingBulletin) return;
        setUploadingBulletin(true);
        setUploadError('');
        try {
            const response = await fetch(`${API_URL}/bulletins/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: bulletinDoc.path })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Upload failed');
            }
            const data = await response.json();
            updateDetailField('bulletinUploaded', true);
            updateDetailField('bulletinUploadUrl', data?.url || '');
            updateDetailField('bulletinImageUrl', data?.imageUrl || '');
        } catch (err) {
            console.error(err);
            setUploadError('Upload failed.');
        } finally {
            setUploadingBulletin(false);
        }
    };

    const handleCreateEmail = async () => {
        if (emailBusy) return;
        setEmailBusy(true);
        setEmailError('');
        try {
            if (!currentDate) throw new Error('Missing date');
            const payload = {
                date: format(currentDate, 'MMMM d, yyyy'),
                sundayName: liturgicalInfo?.name || liturgicalInfo?.feast || 'Sunday',
                youtubeLink: livestreamUrl,
                pdfUrl: details.bulletinUploadUrl,
                imageUrl: details.bulletinImageUrl,
                fromEmail: ccFromEmail || undefined
            };
            const response = await fetch(`${API_URL}/constant-contact/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.error || 'Email creation failed');
            }
            updateDetailField('emailCreated', true);
            updateDetailField('emailScheduled', true);
        } catch (err) {
            console.error(err);
            setEmailError('Unable to create Constant Contact email.');
        } finally {
            setEmailBusy(false);
        }
    };

    const handleTestEmail = async () => {
        if (emailBusy) return;
        setEmailBusy(true);
        setEmailError('');
        try {
            const response = await fetch(`${API_URL}/constant-contact/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ testEmpty: true, fromEmail: ccFromEmail || undefined })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.error || 'Test email failed');
            }
        } catch (err) {
            console.error(err);
            setEmailError('Unable to create test email.');
        } finally {
            setEmailBusy(false);
        }
    };

    const renderTooltipCard = (person) => {
        if (!person) return null;
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const phoneTag = tags.find((tag) => /^phone[:\-]/i.test(tag)) || tags.find((tag) => /^tel[:\-]/i.test(tag));
        const rawPhone = phoneTag ? phoneTag.replace(/^phone[:\-]\s*/i, '').replace(/^tel[:\-]\s*/i, '').trim() : '';
        const barePhoneTag = tags.find((tag) => !tag.startsWith('ext-') && /\d{3}[^0-9]?\d{3}[^0-9]?\d{4}/.test(tag || ''));
        const phoneLabel = rawPhone || barePhoneTag || (extensionTag ? `Ext ${extensionTag.replace(/^ext-/, '')}` : '');
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
                        {phoneLabel && (
                            <div className="person-phone">{phoneLabel}</div>
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

    const bulletin10Status = bulletinDoc?.exists ? (details.bulletinStatus10 || 'draft') : 'Not Started';
    const bulletin8Status = bulletin8Doc?.exists ? (details.bulletinStatus8 || 'draft') : 'Not Started';
    const insertStatus = insertDoc.exists ? (details.bulletinInsertStatus || 'Not Started') : 'Not Started';
    const bulletin10Display = bulletinDoc?.exists ? bulletin10Status : 'Not Started';
    const bulletin8Display = bulletin8Doc?.exists ? bulletin8Status : 'Not Started';
    const insertDisplay = insertDoc.exists ? insertStatus : 'Not Started';
    const isBulletin10Complete = (statusDrafts.bulletin10 || bulletin10Status) === 'printed';
    const isBulletin8Complete = (statusDrafts.bulletin8 || bulletin8Status) === 'printed';
    const isInsertComplete = (statusDrafts.insert || insertStatus) === 'stuffed';
    const sundayEvents = useMemo(() => {
        if (!currentDate) return [];
        return events
            .filter((event) => {
                if (!event?.date) return false;
                if (!isSameDay(event.date, currentDate)) return false;
                if (event.source === 'liturgical') return false;
                if (event.type_slug === 'weekly-service') return false;
                if (event.id === 'sunday-service') return false;
                return true;
            })
            .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }, [currentDate, events]);

    useEffect(() => {
        if (!sundayEvents.length) {
            setSelectedEventId(null);
            return;
        }
        if (!selectedEventId || !sundayEvents.some((event) => event.id === selectedEventId)) {
            setSelectedEventId(sundayEvents[0].id);
        }
    }, [selectedEventId, sundayEvents]);

    const selectedEvent = useMemo(() => (
        sundayEvents.find((event) => event.id === selectedEventId) || null
    ), [sundayEvents, selectedEventId]);

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
                <div className="sunday-title">
                    <h1>Sunday Planner: {currentDate ? format(currentDate, 'MMMM d, yyyy') : ''}</h1>
                    <div className="sunday-subtitle">{liturgicalInfo?.name || liturgicalInfo?.feast || 'Sunday'}</div>
                    <div className="sunday-nav">
                        <button className="nav-icon" onClick={() => handleNavigate('prev')} aria-label="Previous Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <button className="nav-icon" onClick={() => handleNavigate('next')} aria-label="Next Sunday">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>
                </div>
                <button className="btn-primary" onClick={saveSunday} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Updates'}
                </button>
            </header>

            {error && <div className="alert error">{error}</div>}

            <div className="top-panel-row">
                <Card
                    id="bulletin-10am"
                    className={`sunday-panel bulletin-card ${(statusDrafts.bulletin10 || bulletin10Status) === 'printed' ? 'panel-complete' : ''}`}
                >
                    {isBulletin10Complete && <span className="check-badge panel-check" aria-hidden="true">✓</span>}
                    <div className="panel-header">
                        <h3>10am Bulletin</h3>
                        <div className="panel-actions">
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => openFileLocation(bulletinDoc?.path)}
                                disabled={!bulletinDoc?.exists}
                                aria-label="Open 10am bulletin folder"
                                title="Open File Location"
                            >
                                <FaFolderOpen />
                            </button>
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => printFile(bulletinDoc?.path)}
                                disabled={!bulletinDoc?.exists}
                                aria-label="Print 10am bulletin"
                                title="Print"
                            >
                                <FaPrint />
                            </button>
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={handleUploadBulletin}
                                disabled={!bulletinDoc?.exists || uploadingBulletin}
                                aria-label="Upload 10am bulletin"
                                title="Upload to WordPress"
                            >
                                {uploadingBulletin ? <span className="btn-icon-loading" aria-hidden="true" /> : <FaUpload />}
                            </button>
                        </div>
                    </div>
                    <div className="doc-preview">
                        {docsLoading && <span className="doc-spinner" aria-hidden="true" />}
                        {bulletinDoc?.preview ? (
                            <img src={bulletinDoc.preview} alt="10am bulletin preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No bulletin preview</div>
                        )}
                    </div>
                    <div className="status-row">
                        <span className="status-label">Status</span>
                        {renderStatusStack(
                            'bulletin10',
                            bulletinOptions,
                            bulletin10Display,
                            (option) => updateDetailField('bulletinStatus10', option),
                            !bulletinDoc?.exists
                        )}
                    </div>
                    {uploadError && <div className="text-muted">{uploadError}</div>}
                </Card>
                <Card
                    id="bulletin-8am"
                    className={`sunday-panel bulletin-card ${(statusDrafts.bulletin8 || bulletin8Status) === 'printed' ? 'panel-complete' : ''}`}
                >
                    {isBulletin8Complete && <span className="check-badge panel-check" aria-hidden="true">✓</span>}
                    <div className="panel-header">
                        <h3>8am Bulletin</h3>
                        <div className="panel-actions">
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => openFileLocation(bulletin8Doc?.path)}
                                disabled={!bulletin8Doc?.exists}
                                aria-label="Open 8am bulletin folder"
                                title="Open File Location"
                            >
                                <FaFolderOpen />
                            </button>
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => printFile(bulletin8Doc?.path)}
                                disabled={!bulletin8Doc?.exists}
                                aria-label="Print 8am bulletin"
                                title="Print"
                            >
                                <FaPrint />
                            </button>
                        </div>
                    </div>
                    <div className="doc-preview">
                        {docsLoading && <span className="doc-spinner" aria-hidden="true" />}
                        {bulletin8Doc?.preview ? (
                            <img src={bulletin8Doc.preview} alt="8am bulletin preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No bulletin preview</div>
                        )}
                    </div>
                    <div className="status-row">
                        <span className="status-label">Status</span>
                        {renderStatusStack(
                            'bulletin8',
                            bulletinOptions,
                            bulletin8Display,
                            (option) => updateDetailField('bulletinStatus8', option),
                            !bulletin8Doc?.exists
                        )}
                    </div>
                </Card>
                <Card
                    className={`sunday-panel insert-card ${(statusDrafts.insert || insertStatus) === 'stuffed' ? 'panel-complete' : ''}`}
                >
                    {isInsertComplete && <span className="check-badge panel-check" aria-hidden="true">✓</span>}
                    <div className="panel-header">
                        <h3>Insert</h3>
                        <div className="panel-actions">
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => openFileLocation(insertDoc.path)}
                                disabled={!insertDoc.exists}
                                aria-label="Open insert folder"
                                title="Open File Location"
                            >
                                <FaFolderOpen />
                            </button>
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost"
                                onClick={() => printFile(insertDoc.path)}
                                disabled={!insertDoc.exists}
                                aria-label="Print insert"
                                title="Print"
                            >
                                <FaPrint />
                            </button>
                        </div>
                    </div>
                    <div className="doc-preview">
                        {docsLoading && <span className="doc-spinner" aria-hidden="true" />}
                        {insertDoc.preview ? (
                            <img src={insertDoc.preview} alt="Insert preview" />
                        ) : docsLoading ? null : (
                            <div className="doc-preview-empty">No insert preview</div>
                        )}
                    </div>
                    <div className="status-row">
                        <span className="status-label">Status</span>
                        {renderStatusStack(
                            'insert',
                            insertOptions,
                            insertDisplay,
                            (option) => updateDetailField('bulletinInsertStatus', option),
                            !insertDoc.exists
                        )}
                    </div>
                </Card>
                <Card className="sunday-panel livestream-card">
                    <div className="panel-header">
                        <h3>Livestream Email</h3>
                    </div>
                    <div className="email-checklist-wrapper">
                        <div className="email-checklist">
                            <div className={`check-item ${livestreamUrl ? 'done' : ''}`}>
                                <span className={`check-badge check-badge--sm ${livestreamUrl ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {livestreamUrl ? '✓' : ''}
                                </span>
                                <span>Livestream setup</span>
                                {livestreamUrl && (
                                    <a
                                        className="btn-icon btn-icon-ghost youtube-link"
                                        href={livestreamUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label="Open YouTube livestream"
                                        title="Open YouTube"
                                    >
                                        <FaYoutube />
                                    </a>
                                )}
                            </div>
                            <div className={`check-item ${details.bulletinUploaded || details.bulletinUploadUrl ? 'done' : ''}`}>
                                <span className={`check-badge check-badge--sm ${details.bulletinUploaded || details.bulletinUploadUrl ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.bulletinUploaded || details.bulletinUploadUrl ? '✓' : ''}
                                </span>
                                <span>Bulletin uploaded</span>
                            </div>
                        <button
                            type="button"
                            className={`check-item check-action ${details.emailCreated ? 'done' : ''}`}
                            disabled={
                                !livestreamUrl ||
                                !(details.bulletinUploaded || details.bulletinUploadUrl) ||
                                !details.bulletinImageUrl ||
                                emailBusy
                            }
                            onClick={handleCreateEmail}
                        >
                            <span className={`check-badge check-badge--sm ${details.emailCreated ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                {details.emailCreated ? '✓' : ''}
                            </span>
                            <span>{emailBusy ? 'Creating email...' : 'Create email'}</span>
                        </button>
                        <button
                            type="button"
                            className="check-item check-action"
                            disabled={emailBusy}
                            onClick={handleTestEmail}
                        >
                            <span className="check-badge check-badge--sm check-badge--empty" aria-hidden="true" />
                            <span>{emailBusy ? 'Testing email...' : 'Test empty email'}</span>
                        </button>
                            <div className={`check-item ${details.emailScheduled ? 'done' : ''}`}>
                                <span className={`check-badge check-badge--sm ${details.emailScheduled ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.emailScheduled ? '✓' : ''}
                                </span>
                                <span>Email scheduled</span>
                            </div>
                            <div className={`check-item ${details.emailSent ? 'done' : ''}`}>
                                <span className={`check-badge check-badge--sm ${details.emailSent ? '' : 'check-badge--empty'}`} aria-hidden="true">
                                    {details.emailSent ? '✓' : ''}
                                </span>
                                <span>Email sent</span>
                            </div>
                        </div>
                    </div>
                    <div className="email-sender-row">
                        <span className="email-sender-label">From</span>
                        <select
                            className="email-sender-select"
                            value={ccFromEmail}
                            onChange={(event) => setCcFromEmail(event.target.value)}
                        >
                            <option value="">Select sender</option>
                            {!ccFromEmails.some((entry) => {
                                const emailValue = entry?.email_address || entry?.email || entry?.address || '';
                                return emailValue === 'office@saintedmunds.org';
                            }) && (
                                <option value="office@saintedmunds.org">office@saintedmunds.org</option>
                            )}
                            {ccFromEmail && !ccFromEmails.some((entry) => {
                                const emailValue = entry?.email_address || entry?.email || entry?.address || '';
                                return emailValue === ccFromEmail;
                            }) && (
                                <option value={ccFromEmail}>{ccFromEmail}</option>
                            )}
                            {ccFromEmails.map((entry) => {
                                const emailValue = entry?.email_address || entry?.email || entry?.address || '';
                                if (!emailValue) return null;
                                const status = entry?.status ? ` (${entry.status})` : '';
                                return (
                                    <option key={emailValue} value={emailValue}>
                                        {emailValue}{status}
                                    </option>
                                );
                            })}
                        </select>
                        <button
                            type="button"
                            className="btn-icon btn-icon-ghost"
                            onClick={() => loadCcFromEmails(false)}
                            aria-label="Refresh senders"
                            title="Refresh senders"
                        >
                            <FaSyncAlt />
                        </button>
                    </div>
                    {livestreamError && <div className="text-muted">{livestreamError}</div>}
                    {ccFromEmailError && <div className="text-muted">{ccFromEmailError}</div>}
                    {emailError && <div className="text-muted">{emailError}</div>}
                </Card>
            </div>

            {sundayEvents.length > 0 && (
                <Card className="sunday-panel events-panel">
                    <div className="panel-header">
                        <h3>Additional Sunday Events</h3>
                    </div>
                    <div className="events-panel-body">
                        <div className="events-panel-list">
                            {sundayEvents.map((eventItem) => (
                                <button
                                    key={eventItem.id}
                                    type="button"
                                    className={`event-row ${eventItem.id === selectedEventId ? 'active' : ''}`}
                                    onClick={() => setSelectedEventId(eventItem.id)}
                                >
                                    <div className="event-row-main">
                                        <span className="event-row-title">{eventItem.title}</span>
                                        <span className="event-row-meta">
                                            {eventItem.type_name || eventItem.category_name || 'Event'}
                                        </span>
                                    </div>
                                    <span className="event-row-time">{eventItem.time || 'All day'}</span>
                                </button>
                            ))}
                        </div>
                        <div className="events-panel-detail">
                            {!selectedEvent ? (
                                <div className="empty-text">Select an event to see details.</div>
                            ) : (
                                <div className="event-details">
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Title</span>
                                        <span className="event-detail-value">{selectedEvent.title}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Time</span>
                                        <span className="event-detail-value">{selectedEvent.time || 'All day'}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Location</span>
                                        <span className="event-detail-value">{selectedEvent.location || 'TBD'}</span>
                                    </div>
                                    <div className="event-detail-row">
                                        <span className="event-detail-label">Type</span>
                                        <span className="event-detail-value">{selectedEvent.type_name || selectedEvent.category_name || 'Event'}</span>
                                    </div>
                                    {selectedEvent.description && (
                                        <div className="event-detail-row">
                                            <span className="event-detail-label">Notes</span>
                                            <span className="event-detail-value">{selectedEvent.description}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            )}

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
