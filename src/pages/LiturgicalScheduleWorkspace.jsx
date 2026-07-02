import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import { clearLiturgicalCache } from '../services/liturgicalService';
import './LiturgicalScheduleTest.css';
import './People.css';
import './Sunday.css';
import '../components/AtAGlance.css';

const parseLocalDay = (dateStr) => {
    if (!dateStr) return null;
    if (dateStr.includes('T')) return new Date(dateStr);
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const EIGHT_AM_LECTOR_ROLE_KEY = 'lector8';
const EIGHT_AM_ROLE_KEYS = ['celebrant', 'preacher', EIGHT_AM_LECTOR_ROLE_KEY, 'organist'];
const TEN_AM_ROLE_KEYS = ['celebrant', 'preacher', 'lector', 'organist', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare'];
const MULTI_ASSIGNMENT_ROLES = new Set(['lector', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour', 'childcare']);
const HAS_LOCATION_OVERRIDE = (overrides) => Object.prototype.hasOwnProperty.call(overrides, 'location');

const roleConfigs = [
    { key: 'celebrant', label: 'Celebrant' },
    { key: 'preacher', label: 'Preacher' },
    { key: 'organist', label: 'Organist' },
    { key: 'lector8', label: '8am Lector' },
    { key: 'lector', label: 'Lector' },
    { key: 'lem', label: 'LEM' },
    { key: 'acolyte', label: 'Acolyte' },
    { key: 'usher', label: 'Usher' },
    { key: 'sound', label: 'Sound' },
    { key: 'coffeeHour', label: 'Coffee Hour' },
    { key: 'childcare', label: 'Childcare' }
];

const tableColumns = [
    { key: 'service', label: '', kind: 'service', width: 230 },
    { key: 'celebrant', label: 'Celebrant', kind: 'role', width: 90 },
    { key: 'preacher', label: 'Preacher', kind: 'role', width: 90 },
    { key: 'organist', label: 'Organist', kind: 'role', width: 90 },
    { key: 'lector', label: 'Lector', kind: 'role', width: 92, resolveRoleKey: (service) => (isEightAmService(service.time) ? EIGHT_AM_LECTOR_ROLE_KEY : 'lector') },
    { key: 'lem', label: 'LEM', kind: 'role', width: 88 },
    { key: 'acolyte', label: 'Acolytes', kind: 'role', width: 92 },
    { key: 'usher', label: 'Ushers', kind: 'role', width: 92 },
    { key: 'sound', label: 'Sound/Stream', kind: 'role', width: 92 },
    { key: 'coffeeHour', label: 'Coffee Hour', kind: 'role', width: 92 },
    { key: 'childcare', label: 'Childcare', kind: 'role', width: 92 },
    { key: 'reading', label: 'Reading', kind: 'reading', width: 112 }
];

function isEightAmService(time = '') {
    return /^0?8:/.test(String(time || '').trim());
}

const getServiceRoleKeys = (serviceTime) => (isEightAmService(serviceTime) ? EIGHT_AM_ROLE_KEYS : TEN_AM_ROLE_KEYS);
const roleAllowsMultiple = (serviceTime, roleKey) => !isEightAmService(serviceTime) && MULTI_ASSIGNMENT_ROLES.has(roleKey);
const personMatchesRole = (person, roleKey) => {
    const roles = person?.roles || [];
    if (roles.includes(roleKey)) return true;
    if (roleKey === EIGHT_AM_LECTOR_ROLE_KEY) return roles.includes('lector');
    return false;
};

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

const normalizeIds = (value) => Array.from(new Set((Array.isArray(value) ? value : [value]).filter(Boolean)));
const getPrimaryPhone = (person) => person?.phonePrimary || person?.phoneAlternate || '';
const getPersonTeamNumbers = (person, roleKey) => {
    const teamList = Array.isArray(person?.teams?.[roleKey]) ? person.teams[roleKey] : [];
    return Array.from(new Set(teamList.map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
};
const getFirstName = (person) => {
    const raw = String(person?.displayName || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] || raw;
};

const parseReadings = (value) => String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

const classifyReading = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'unknown';
    if (/\bpsalm\b/i.test(raw)) return 'psalm';
    if (/\bgospel\b/i.test(raw)) return 'gospel';

    const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    const book = normalize(raw);
    const startsWith = (name) => new RegExp(`^${name}\\b`, 'i').test(book);

    const gospelBooks = ['matthew', 'mark', 'luke', 'john'];
    if (gospelBooks.some((name) => startsWith(name))) return 'gospel';

    const ntBooks = [
        'acts', 'romans', '1 corinthians', '2 corinthians', 'corinthians',
        'galatians', 'ephesians', 'philippians', 'colossians', '1 thessalonians',
        '2 thessalonians', 'thessalonians', '1 timothy', '2 timothy', 'timothy',
        'titus', 'philemon', 'hebrews', 'james', '1 peter', '2 peter', 'peter',
        '1 john', '2 john', '3 john', 'jude', 'revelation'
    ];
    if (ntBooks.some((name) => startsWith(name))) return 'nt';

    const otBooks = [
        'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy',
        'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', 'samuel',
        '1 kings', '2 kings', 'kings', '1 chronicles', '2 chronicles', 'chronicles',
        'ezra', 'nehemiah', 'esther', 'job', 'proverbs', 'ecclesiastes', 'song of solomon',
        'song of songs', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel',
        'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk',
        'zephaniah', 'haggai', 'zechariah', 'malachi'
    ];
    if (otBooks.some((name) => startsWith(name))) return 'ot';

    return 'unknown';
};

const mergeReadingFragments = (list) => {
    const merged = [];
    list.forEach((item) => {
        const trimmed = String(item || '').trim();
        if (!trimmed) return;
        const isContinuation = /^(?:\d+\s*(?::|\[)|\[\d|\(\d|or\b)/i.test(trimmed);
        if (isContinuation && merged.length > 0) {
            merged[merged.length - 1] = `${merged[merged.length - 1]}; ${trimmed}`;
            return;
        }
        merged.push(trimmed);
    });
    return merged;
};

const getReadingPair = (readings) => {
    const merged = mergeReadingFragments(Array.isArray(readings) ? readings : parseReadings(readings));
    const filtered = merged.filter((item) => {
        const type = classifyReading(item);
        return type !== 'psalm' && type !== 'gospel';
    });

    const oldTestament = filtered.find((item) => classifyReading(item) === 'ot') || '';
    const newTestament = filtered.find((item) => classifyReading(item) === 'nt') || '';

    return {
        oldTestament: oldTestament || filtered[0] || '',
        newTestament: newTestament || filtered[1] || ''
    };
};

const pickReadingForService = (readings, serviceTime) => {
    const { oldTestament, newTestament } = getReadingPair(readings);
    if (String(serviceTime || '').startsWith('08')) return oldTestament || newTestament || '';
    return newTestament || oldTestament || '';
};

const LiturgicalScheduleWorkspace = ({ mode = 'test' }) => {
    const isTestMode = mode === 'test';
    const [sundays, setSundays] = useState([]);
    const [people, setPeople] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState('');
    const [exportingMonths, setExportingMonths] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [exportSelection, setExportSelection] = useState([]);
    const [exportFormat, setExportFormat] = useState('pdf');
    const [monthSchedulingKey, setMonthSchedulingKey] = useState('');
    const [weekSchedulingKey, setWeekSchedulingKey] = useState('');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [showPast, setShowPast] = useState(false);
    const [error, setError] = useState('');
    const [editor, setEditor] = useState(null);
    const [editorSelection, setEditorSelection] = useState([]);
    const [editorSearch, setEditorSearch] = useState('');
    const [pillTooltip, setPillTooltip] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [sundaysRes, peopleRes] = await Promise.all([
                fetch(`${API_URL}/sunday/sundays?months=12`),
                fetch(`${API_URL}/people`)
            ]);

            if (!sundaysRes.ok) throw new Error('Failed to load liturgical schedule');
            if (!peopleRes.ok) throw new Error('Failed to load people');

            const [sundaysPayload, peoplePayload] = await Promise.all([
                sundaysRes.json(),
                peopleRes.json()
            ]);

            setSundays(Array.isArray(sundaysPayload) ? sundaysPayload : []);
            setPeople(Array.isArray(peoplePayload) ? peoplePayload : []);
        } catch (loadError) {
            console.error(loadError);
            setError('Unable to load liturgical schedule.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const normalizedSundays = useMemo(() => (
        sundays
            .map((day) => ({
                ...day,
                dateObj: parseLocalDay(day.date),
                services: Array.isArray(day.services) ? [...day.services].sort((a, b) => (a.time || '').localeCompare(b.time || '')) : []
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
    ), [sundays]);

    const monthOptions = useMemo(() => {
        const uniqueMonths = Array.from(new Set(normalizedSundays
            .filter((day) => day.dateObj)
            .map((day) => format(day.dateObj, 'yyyy-MM'))));
        return uniqueMonths.map((value) => ({
            value,
            label: format(new Date(`${value}-01T00:00:00`), 'MMMM yyyy')
        }));
    }, [normalizedSundays]);

    useEffect(() => {
        if (!monthOptions.length) {
            if (selectedMonth) setSelectedMonth('');
            return;
        }

        if (selectedMonth && (selectedMonth === 'all' || monthOptions.some((option) => option.value === selectedMonth))) {
            return;
        }

        const todayKey = format(new Date(), 'yyyy-MM');
        const defaultMonth = monthOptions.find((option) => option.value === todayKey)?.value || monthOptions[0].value;
        setSelectedMonth(defaultMonth);
    }, [monthOptions, selectedMonth]);

    const exportMonthOptions = useMemo(() => monthOptions, [monthOptions]);

    const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

    const monthGroups = useMemo(() => {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const groups = new Map();

        normalizedSundays.forEach((day) => {
            if (!showPast && day.dateObj && day.dateObj < todayStart) return;
            if (!showPast && day.dateObj && day.dateObj < currentMonthStart) return;

            const monthKey = day.dateObj ? format(day.dateObj, 'yyyy-MM') : '';
            if (selectedMonth && selectedMonth !== 'all' && monthKey !== selectedMonth) return;

            const label = day.dateObj ? format(day.dateObj, 'MMMM yyyy') : 'Unknown';
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(day);
        });

        return Array.from(groups.entries()).map(([monthLabel, days]) => ({
            monthLabel,
            days
        }));
    }, [normalizedSundays, selectedMonth, showPast]);

    const editorContext = useMemo(() => {
        if (!editor) return null;
        const day = normalizedSundays.find((item) => item.date === editor.date);
        const service = day?.services?.find((item) => (item.time || '10:00') === editor.time);
        if (!day || !service) return null;

        const eligiblePeople = people
            .filter((person) => personMatchesRole(person, editor.roleKey))
            .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

        const teamMap = new Map();
        eligiblePeople.forEach((person) => {
            const teamNumbers = person.teams?.[editor.roleKey] || [];
            teamNumbers.forEach((teamNumber) => {
                if (!teamMap.has(teamNumber)) teamMap.set(teamNumber, []);
                teamMap.get(teamNumber).push(person.id);
            });
        });

        const filteredPeople = eligiblePeople.filter((person) => {
            const search = editorSearch.trim().toLowerCase();
            if (!search) return true;
            return (person.displayName || '').toLowerCase().includes(search)
                || (person.email || '').toLowerCase().includes(search);
        });

        const filteredPersonIds = new Set(filteredPeople.map((person) => person.id));
        const groupedTeamEntries = Array.from(teamMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([teamNumber, memberIds]) => ({
                teamNumber,
                memberIds: memberIds.filter((id) => filteredPersonIds.has(id))
            }))
            .filter((entry) => entry.memberIds.length > 0);

        const filteredUngroupedPeople = filteredPeople.filter((person) => getPersonTeamNumbers(person, editor.roleKey).length === 0);

        return {
            day,
            service,
            eligiblePeople,
            filteredPeople,
            groupedTeamEntries,
            filteredUngroupedPeople,
            role: roleConfigs.find((config) => config.key === editor.roleKey)
        };
    }, [editor, editorSearch, normalizedSundays, people]);

    const setLocalServiceValue = (date, time, updater) => {
        setSundays((prev) => prev.map((day) => {
            if (day.date !== date) return day;
            return {
                ...day,
                services: (day.services || []).map((service) => {
                    const serviceTime = service.time || '10:00';
                    if (serviceTime !== time) return service;
                    return updater(service);
                })
            };
        }));
    };

    const buildServicePayload = (service, overrides = {}) => {
        const payload = {};
        if (HAS_LOCATION_OVERRIDE(overrides)) {
            payload.location = overrides.location ?? service.location ?? '';
        }

        getServiceRoleKeys(service.time).forEach((roleKey) => {
            const nextIds = roleKey === overrides.roleKey
                ? overrides.ids
                : service.roles?.[roleKey] || [];
            payload[roleKey] = normalizeIds(nextIds);
        });

        return payload;
    };

    const saveServicePayload = async ({ date, time, payload, savingToken, onSuccess }) => {
        setSavingKey(savingToken);
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/roles/${date}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [time]: payload
                })
            });

            if (!response.ok) throw new Error('Failed to save schedule');
            clearLiturgicalCache();
            onSuccess();
        } catch (saveError) {
            console.error(saveError);
            setError('Unable to save schedule changes.');
        } finally {
            setSavingKey('');
        }
    };

    const openEditor = (date, time, roleKey, currentIds) => {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        setEditor({ date, time, roleKey });
        setEditorSelection(normalizeIds(currentIds));
        setEditorSearch('');
    };

    const closeEditor = () => {
        setEditor(null);
        setEditorSelection([]);
        setEditorSearch('');
    };

    const getTooltipPosition = (clientX, clientY) => {
        const tooltipWidth = 280;
        const tooltipHeight = 120;
        const maxX = Math.max(12, window.innerWidth - tooltipWidth - 12);
        const maxY = Math.max(12, window.innerHeight - tooltipHeight - 12);
        return {
            x: Math.min(clientX + 14, maxX),
            y: Math.min(clientY + 14, maxY)
        };
    };

    const hidePillTooltip = () => setPillTooltip(null);

    const showPillTooltip = (event, person) => {
        if (!person) return;
        const { x, y } = getTooltipPosition(event.clientX, event.clientY);
        setPillTooltip({
            person,
            x,
            y
        });
    };

    const movePillTooltip = (event, person) => {
        if (!person) return;
        const { x, y } = getTooltipPosition(event.clientX, event.clientY);
        setPillTooltip({
            person,
            x,
            y
        });
    };

    const toggleEditorPerson = (personId) => {
        if (!editor) return;
        if (!roleAllowsMultiple(editor.time, editor.roleKey)) {
            setEditorSelection(personId ? [personId] : []);
            return;
        }

        setEditorSelection((prev) => {
            const next = new Set(prev);
            if (next.has(personId)) next.delete(personId);
            else next.add(personId);
            return Array.from(next);
        });
    };

    const toggleEditorTeam = (memberIds) => {
        if (!editor || !roleAllowsMultiple(editor.time, editor.roleKey)) return;
        setEditorSelection((prev) => {
            const next = new Set(prev);
            const everySelected = memberIds.every((id) => next.has(id));
            memberIds.forEach((id) => {
                if (everySelected) next.delete(id);
                else next.add(id);
            });
            return Array.from(next);
        });
    };

    const handleSaveEditor = async () => {
        if (!editor || !editorContext?.service) return;
        const normalizedIds = roleAllowsMultiple(editor.time, editor.roleKey)
            ? normalizeIds(editorSelection)
            : normalizeIds(editorSelection).slice(0, 1);
        const payload = buildServicePayload(editorContext.service, {
            roleKey: editor.roleKey,
            ids: normalizedIds
        });

        await saveServicePayload({
            date: editor.date,
            time: editor.time,
            payload,
            savingToken: `${editor.date}-${editor.time}-${editor.roleKey}`,
            onSuccess: () => {
                setLocalServiceValue(editor.date, editor.time, (service) => ({
                    ...service,
                    roles: {
                        ...(service.roles || {}),
                        [editor.roleKey]: normalizedIds
                    }
                }));
                closeEditor();
            }
        });
    };

    const handleApplyWeekRotation = async (date) => {
        if (weekSchedulingKey) return;
        const confirmed = window.confirm('Apply the saved team rotation to this Sunday?');
        if (!confirmed) return;
        setWeekSchedulingKey(date);
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/schedule-roles/auto-week`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date })
            });
            if (!response.ok) throw new Error('Failed to apply rotation');
            clearLiturgicalCache();
            await loadData();
        } catch (rotationError) {
            console.error(rotationError);
            setError('Unable to apply the team rotation for this Sunday.');
        } finally {
            setWeekSchedulingKey('');
        }
    };

    const handleApplyMonthRotation = async () => {
        if (!selectedMonth || selectedMonth === 'all' || monthSchedulingKey) return;
        const [yearText, monthText] = selectedMonth.split('-');
        const year = Number(yearText);
        const month = Number(monthText) - 1;
        if (!Number.isInteger(year) || !Number.isInteger(month)) return;

        const confirmed = window.confirm(`Apply the team rotation to every Sunday in ${format(new Date(`${selectedMonth}-01T00:00:00`), 'MMMM yyyy')}?`);
        if (!confirmed) return;

        setMonthSchedulingKey(selectedMonth);
        setError('');
        try {
            const response = await fetch(`${API_URL}/sunday/schedule-roles/auto-next-month`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month })
            });
            if (!response.ok) throw new Error('Failed to apply month rotation');
            clearLiturgicalCache();
            await loadData();
        } catch (rotationError) {
            console.error(rotationError);
            setError('Unable to apply the team rotation for this month.');
        } finally {
            setMonthSchedulingKey('');
        }
    };

    const openExportDialog = () => {
        const defaultSelection = selectedMonth && selectedMonth !== 'all'
            ? [selectedMonth]
            : exportMonthOptions.map((option) => option.value);
        setExportSelection(defaultSelection);
        setExportFormat('pdf');
        setExportDialogOpen(true);
    };

    const toggleExportMonth = (value) => {
        setExportSelection((prev) => (
            prev.includes(value)
                ? prev.filter((item) => item !== value)
                : [...prev, value].sort()
        ));
    };

    const handleExportMonths = async () => {
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
            if (!response.ok) throw new Error('Failed to export liturgical schedule');

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
            setExportDialogOpen(false);
        } catch (exportError) {
            console.error(exportError);
            setError(`Unable to export liturgical schedule ${exportFormat === 'xlsx' ? 'spreadsheet' : 'PDF'}.`);
        } finally {
            setExportingMonths(false);
        }
    };

    const renderPersonPills = (roleKey, ids) => (
        <span className="liturgical-test-pill-list">
            {ids.map((id) => {
                const person = peopleById.get(id);
                const category = person?.category || 'volunteer';
                return (
                    <span
                        key={`${roleKey}-${id}`}
                        className="liturgical-test-pill-wrapper"
                        onMouseEnter={(event) => showPillTooltip(event, person)}
                        onMouseMove={(event) => movePillTooltip(event, person)}
                        onMouseLeave={hidePillTooltip}
                    >
                        <span className={`person-chip person-chip-${category} ${person?.isPledger ? 'person-chip-pledger' : ''} liturgical-test-person-pill`}>
                            {getFirstName(person) || id}
                        </span>
                    </span>
                );
            })}
        </span>
    );

    const renderSelectablePersonPill = (person, checked) => (
        <button
            key={person.id}
            type="button"
            className={`liturgical-test-select-pill ${checked ? 'is-selected' : ''}`}
            onClick={() => toggleEditorPerson(person.id)}
            onMouseEnter={(event) => showPillTooltip(event, person)}
            onMouseMove={(event) => movePillTooltip(event, person)}
            onMouseLeave={hidePillTooltip}
        >
            <span className={`person-chip person-chip-${person.category || 'volunteer'} ${person.isPledger ? 'person-chip-pledger' : ''} liturgical-test-modal-pill ${checked ? 'chip-selected' : ''}`}>
                {person.displayName}
            </span>
        </button>
    );

    const getColumnRoleKey = (service, column) => (column.resolveRoleKey ? column.resolveRoleKey(service) : column.key);
    const getColumnRoleIds = (service, column) => normalizeIds(service.roles?.[getColumnRoleKey(service, column)] || []);

    const renderRoleCell = (day, service, column) => {
        const roleKey = getColumnRoleKey(service, column);
        const ids = getColumnRoleIds(service, column);
        const isSaving = savingKey === `${day.date}-${service.time || '10:00'}-${roleKey}`;

        return (
            <div className={`liturgical-test-role-content ${ids.length ? 'has-value' : 'is-empty'}`}>
                {ids.length ? (
                    renderPersonPills(roleKey, ids)
                ) : (
                    <span className="liturgical-test-empty">Assign</span>
                )}
                {isSaving ? <span className="liturgical-test-cell-meta">Saving...</span> : null}
            </div>
        );
    };

    const renderServiceCell = (day, service) => {
        const serviceTime = service.time || '10:00';
        const feastLine = service.location ? `${day.feast || 'Sunday'} (${service.location})` : (day.feast || 'Sunday');
        return (
            <div className="liturgical-test-service-copy">
                <div className="liturgical-test-service-date">Sunday, {day.dateObj ? format(day.dateObj, 'MMMM d') : day.date}</div>
                <div className="liturgical-test-service-time">{serviceTime.replace(/^0/, '')} {isEightAmService(serviceTime) ? 'AM' : 'AM'}</div>
                <div className="liturgical-test-service-feast">{feastLine}</div>
                <button
                    className="liturgical-test-inline-action"
                    type="button"
                    onClick={() => handleApplyWeekRotation(day.date)}
                    disabled={Boolean(savingKey) || weekSchedulingKey === day.date}
                >
                    {weekSchedulingKey === day.date ? 'Applying...' : 'Apply Rotation'}
                </button>
            </div>
        );
    };

    return (
        <div className="page-liturgical liturgical-test-page">
            <header className="page-header page-header-bar">
                <div className="page-header-title">
                    <h1>{isTestMode ? 'Liturgical Schedule Test' : 'Liturgical Schedule'}</h1>
                    <p className="page-header-subtitle">PDF-style month view with direct role editing on the live Sunday schedule data.</p>
                </div>
                <div className="page-header-actions">
                    <button
                        className="btn-secondary"
                        type="button"
                        onClick={openExportDialog}
                        disabled={loading || exportingMonths || exportMonthOptions.length === 0}
                    >
                        {exportingMonths ? 'Exporting...' : 'Export'}
                    </button>
                    <button className="btn-secondary" onClick={loadData} disabled={loading}>
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {error ? <div className="alert error">{error}</div> : null}

            <Card className="liturgical-test-toolbar-card">
                <div className="liturgical-test-toolbar">
                    <label className="liturgical-test-field">
                        <span>Month</span>
                        <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                            <option value="all">All upcoming months</option>
                            {monthOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="liturgical-test-checkbox">
                        <input
                            type="checkbox"
                            checked={showPast}
                            onChange={(event) => setShowPast(event.target.checked)}
                        />
                        <span>Show past Sundays</span>
                    </label>

                    <button
                        className="btn-secondary"
                        type="button"
                        onClick={handleApplyMonthRotation}
                        disabled={!selectedMonth || selectedMonth === 'all' || Boolean(monthSchedulingKey)}
                    >
                        {monthSchedulingKey ? 'Applying Rotation...' : 'Apply Rotation To Month'}
                    </button>
                </div>
            </Card>

            {loading ? (
                <Card className="loading-card">Loading schedule...</Card>
            ) : monthGroups.length === 0 ? (
                <Card className="empty-card">No Sunday schedule entries found for the selected range.</Card>
            ) : (
                monthGroups.map((group) => (
                    <section key={group.monthLabel} className="liturgical-test-month">
                        <div className="liturgical-test-month-header">
                            <div>
                                <h2>{group.monthLabel}</h2>
                                <p>{group.days.length} Sunday{group.days.length === 1 ? '' : 's'} - click any role cell to edit</p>
                            </div>
                        </div>

                        <Card className="liturgical-test-table-card">
                            <div className="liturgical-test-table-wrap">
                                <table className="liturgical-test-month-table">
                                    <colgroup>
                                        {tableColumns.map((column) => (
                                            <col key={column.key} style={{ width: `${column.width}px` }} />
                                        ))}
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            {tableColumns.map((column, index) => (
                                                <th key={column.key}>
                                                    {index === 0 ? group.monthLabel.toUpperCase() : column.label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.days.flatMap((day, dayIndex) => day.services.map((service, serviceIndex) => (
                                            <tr
                                                key={`${day.date}-${service.time || '10:00'}`}
                                                className={[
                                                    serviceIndex % 2 === 0 ? 'is-primary-row' : 'is-secondary-row',
                                                    dayIndex % 2 === 0 ? 'is-week-a' : 'is-week-b',
                                                    serviceIndex === 0 ? 'is-week-start' : 'is-week-follow'
                                                ].join(' ')}
                                            >
                                                <td className="liturgical-test-service-cell">
                                                    <div className="liturgical-test-day-badge-row">
                                                        <span className={`liturgical-badge badge-${day.color}`}>{getSeasonLabel(day.color, day.feast)}</span>
                                                    </div>
                                                    {renderServiceCell(day, service)}
                                                </td>
                                                {tableColumns.slice(1).map((column) => {
                                                    if (column.kind === 'reading') {
                                                        return (
                                                            <td key={column.key} className="liturgical-test-reading-cell">
                                                                <div className="liturgical-test-reading-text">{pickReadingForService(day.readings, service.time || '10:00') || '-'}</div>
                                                            </td>
                                                        );
                                                    }
                                                    const roleKey = getColumnRoleKey(service, column);
                                                    const ids = getColumnRoleIds(service, column);
                                                    return (
                                                        <td
                                                            key={column.key}
                                                            className={`liturgical-test-role-cell ${ids.length ? 'has-value' : 'is-empty'}`}
                                                            onClick={() => {
                                                                if (!savingKey) openEditor(day.date, service.time || '10:00', roleKey, ids);
                                                            }}
                                                            onKeyDown={(event) => {
                                                                if (savingKey) return;
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault();
                                                                    openEditor(day.date, service.time || '10:00', roleKey, ids);
                                                                }
                                                            }}
                                                            role="button"
                                                            tabIndex={savingKey ? -1 : 0}
                                                        >
                                                            {renderRoleCell(day, service, column)}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        )))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </section>
                ))
            )}

            <Modal
                isOpen={Boolean(editor && editorContext)}
                onClose={closeEditor}
                title={editorContext ? `${editorContext.role?.label || editor?.roleKey} - ${isEightAmService(editorContext.service.time) ? '8:00 AM' : '10:00 AM'}` : 'Edit assignment'}
                className="modal-large"
            >
                {editorContext ? (
                    <div className="liturgical-test-editor">
                        <div className="liturgical-test-editor-header">
                            <div>
                                <strong>{editorContext.day.dateObj ? format(editorContext.day.dateObj, 'EEEE, MMM d, yyyy') : editorContext.day.date}</strong>
                                <p>{editorContext.day.feast || 'Sunday'}</p>
                            </div>
                            <div className="liturgical-test-editor-meta">
                                <span>{editorContext.filteredPeople.length} people shown</span>
                                <span>{editorSelection.length} selected</span>
                            </div>
                        </div>

                        <label className="liturgical-test-field liturgical-test-search">
                            <span>Search people</span>
                            <input
                                type="text"
                                value={editorSearch}
                                onChange={(event) => setEditorSearch(event.target.value)}
                                placeholder="Search by name or email"
                            />
                        </label>

                        {editorContext.groupedTeamEntries.length > 0 ? (
                            <div className="liturgical-test-team-strip">
                                <span>Rotation teams</span>
                            </div>
                        ) : null}

                        <div className="liturgical-test-editor-grid">
                            {editorContext.filteredPeople.length === 0 ? (
                                <div className="liturgical-test-empty">No people match this search.</div>
                            ) : (
                                <>
                                    {editorContext.groupedTeamEntries.map(({ teamNumber, memberIds }) => {
                                        const fullySelected = memberIds.every((id) => editorSelection.includes(id));
                                        return (
                                            <section key={`team-${teamNumber}`} className="liturgical-test-team-card">
                                                <div className="liturgical-test-team-card-header">
                                                    <strong>Team {teamNumber}</strong>
                                                    {roleAllowsMultiple(editor.time, editor.roleKey) ? (
                                                        <button
                                                            type="button"
                                                            className={`btn-secondary liturgical-test-team-button ${fullySelected ? 'is-selected' : ''}`}
                                                            onClick={() => toggleEditorTeam(memberIds)}
                                                        >
                                                            {fullySelected ? 'Clear Team' : 'Select Team'}
                                                        </button>
                                                    ) : null}
                                                </div>
                                                <div className="liturgical-test-person-grid">
                                                    {memberIds.map((id) => {
                                                        const person = peopleById.get(id);
                                                        const checked = editorSelection.includes(id);
                                                        if (!person) return null;
                                                        return renderSelectablePersonPill(person, checked);
                                                    })}
                                                </div>
                                            </section>
                                        );
                                    })}
                                </>
                            )}
                        </div>

                        {editorContext.filteredUngroupedPeople.length > 0 ? (
                            <section className="liturgical-test-other-people">
                                <div className="liturgical-test-team-card-header">
                                    <strong>Other Eligible People</strong>
                                </div>
                                <div className="liturgical-test-person-grid">
                                    {editorContext.filteredUngroupedPeople.map((person) => {
                                        const checked = editorSelection.includes(person.id);
                                        return renderSelectablePersonPill(person, checked);
                                    })}
                                </div>
                            </section>
                        ) : null}

                        <div className="liturgical-test-editor-actions">
                            <button className="btn-secondary liturgical-test-clear-button" type="button" onClick={() => setEditorSelection([])}>
                                Clear
                            </button>
                            <button className="btn-secondary" type="button" onClick={closeEditor}>
                                Cancel
                            </button>
                            <button
                                className="btn-primary"
                                type="button"
                                onClick={handleSaveEditor}
                                disabled={savingKey === `${editor.date}-${editor.time}-${editor.roleKey}`}
                            >
                                {savingKey === `${editor.date}-${editor.time}-${editor.roleKey}` ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                isOpen={exportDialogOpen}
                onClose={() => setExportDialogOpen(false)}
                title="Export Liturgical Schedule"
                className="modal-large"
            >
                <div className="liturgical-test-export">
                    <div className="liturgical-test-export__intro">Select one or more months to include in the export.</div>
                    <div className="liturgical-test-export__format">
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
                    <div className="liturgical-test-export__grid">
                        {exportMonthOptions.map((option) => (
                            <label key={option.value} className="liturgical-test-export__item">
                                <input
                                    type="checkbox"
                                    checked={exportSelection.includes(option.value)}
                                    onChange={() => toggleExportMonth(option.value)}
                                />
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="liturgical-test-export__actions">
                        <button className="btn-secondary" type="button" onClick={() => setExportDialogOpen(false)}>
                            Cancel
                        </button>
                        <button
                            className="btn-primary"
                            type="button"
                            onClick={handleExportMonths}
                            disabled={exportingMonths || exportSelection.length === 0}
                        >
                            {exportingMonths ? 'Exporting...' : 'Export'}
                        </button>
                    </div>
                </div>
            </Modal>

            {pillTooltip?.person ? (
                <div
                    className="liturgical-test-floating-tooltip"
                    style={{ left: `${pillTooltip.x}px`, top: `${pillTooltip.y}px` }}
                >
                    <strong>{pillTooltip.person.displayName}</strong>
                    {pillTooltip.person.email ? <span>{pillTooltip.person.email}</span> : null}
                    {getPrimaryPhone(pillTooltip.person) ? <span>{getPrimaryPhone(pillTooltip.person)}</span> : null}
                </div>
            ) : null}
        </div>
    );
};

export default LiturgicalScheduleWorkspace;
export { LiturgicalScheduleWorkspace };
