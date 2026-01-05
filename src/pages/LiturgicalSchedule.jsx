import { useEffect, useMemo, useState } from 'react';
import { format, isSunday, parseISO } from 'date-fns';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import './LiturgicalSchedule.css';

const parseLocalDay = (dateStr) => {
    if (!dateStr) return null;
    if (dateStr.includes('T')) return new Date(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const emptyEditState = {
    date: '',
    service_time: '10:00',
    lector: [],
    lem: [],
    acolyte: [],
    usher: [],
    sound: [],
    coffeeHour: []
};

const LiturgicalSchedule = () => {
    const [liturgicalDays, setLiturgicalDays] = useState([]);
    const [scheduleRows, setScheduleRows] = useState([]);
    const [people, setPeople] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(null);
    const [formState, setFormState] = useState(emptyEditState);
    const [searchTerm, setSearchTerm] = useState('');

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [daysRes, scheduleRes, peopleRes] = await Promise.all([
                fetch(`${API_URL}/liturgical-days`),
                fetch(`${API_URL}/schedule-roles`),
                fetch(`${API_URL}/people`)
            ]);

            if (!daysRes.ok) throw new Error('Failed to load liturgical days');
            if (!scheduleRes.ok) throw new Error('Failed to load schedule roles');
            if (!peopleRes.ok) throw new Error('Failed to load people');

            const days = await daysRes.json();
            const schedule = await scheduleRes.json();
            const peopleList = await peopleRes.json();

            setLiturgicalDays(Array.isArray(days) ? days : []);
            setScheduleRows(Array.isArray(schedule) ? schedule : []);
            setPeople(Array.isArray(peopleList) ? peopleList : []);
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
        const grouped = new Map();
        sundayEntries.forEach((entry) => {
            const monthKey = entry.dateObj ? format(entry.dateObj, 'MMMM yyyy') : 'Unknown';
            if (!grouped.has(monthKey)) grouped.set(monthKey, []);
            grouped.get(monthKey).push(entry);
        });
        return Array.from(grouped.entries());
    }, [sundayEntries]);

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
                const match = peopleByName.get(name.toLowerCase());
                return match ? match.id : null;
            })
            .filter(Boolean);
    };

    const serializeAssignments = (ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return '';
        const names = ids
            .map((id) => people.find((person) => person.id === id)?.displayName)
            .filter(Boolean);
        return names.join(', ');
    };

    const openEdit = (entry) => {
        setEditing(entry);
        setFormState({
            date: entry.date,
            service_time: entry.service_time || '10:00',
            lector: parseAssignments(entry.lector),
            lem: parseAssignments(entry.chalice_bearer),
            acolyte: parseAssignments(entry.acolyte),
            usher: parseAssignments(entry.usher),
            sound: parseAssignments(entry.sound_engineer),
            coffeeHour: parseAssignments(entry.coffee_hour)
        });
        setSearchTerm('');
    };

    const closeEdit = () => {
        setEditing(null);
        setFormState(emptyEditState);
    };

    const saveChanges = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const response = await fetch(`${API_URL}/schedule-roles`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: formState.date,
                    service_time: formState.service_time,
                    lector: serializeAssignments(formState.lector),
                    lem: serializeAssignments(formState.lem),
                    acolyte: serializeAssignments(formState.acolyte),
                    usher: serializeAssignments(formState.usher),
                    sound: serializeAssignments(formState.sound),
                    coffeeHour: serializeAssignments(formState.coffeeHour)
                })
            });

            if (!response.ok) throw new Error('Failed to save schedule');
            await loadData();
            closeEdit();
        } catch (err) {
            console.error(err);
            setError('Unable to save schedule changes.');
        } finally {
            setSaving(false);
        }
    };

    const filteredPeople = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return people;
        return people.filter((person) => {
            const name = person.displayName?.toLowerCase() || '';
            const email = person.email?.toLowerCase() || '';
            return name.includes(term) || email.includes(term);
        });
    }, [people, searchTerm]);

    const togglePerson = (roleKey, personId) => {
        setFormState((prev) => {
            const current = new Set(prev[roleKey] || []);
            if (current.has(personId)) {
                current.delete(personId);
            } else {
                current.add(personId);
            }
            return { ...prev, [roleKey]: Array.from(current) };
        });
    };

    const roleConfigs = [
        { key: 'lector', label: 'Lector' },
        { key: 'lem', label: 'LEM' },
        { key: 'acolyte', label: 'Acolyte' },
        { key: 'usher', label: 'Usher' },
        { key: 'sound', label: 'Sound' },
        { key: 'coffeeHour', label: 'Coffee Hour' }
    ];

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
                groupedEntries.map(([month, entries]) => (
                    <Card key={month} className="schedule-card">
                        <div className="schedule-card__header">
                            <h2>{month}</h2>
                            <span className="schedule-count">{entries.length} Sundays</span>
                        </div>
                        <div className="schedule-table">
                            {entries.map((entry) => (
                                <div key={`${entry.date}-${entry.service_time}`} className="schedule-row">
                                    <div className="schedule-main">
                                        <div className="schedule-date">
                                            <div className="date-label">{entry.dateObj ? format(entry.dateObj, 'MMM d') : entry.date}</div>
                                            <div className="time-label">{entry.service_time || '10:00'}</div>
                                        </div>
                                        <div className="schedule-feast">
                                            <span className="feast-name">{entry.feast}</span>
                                            <span className="feast-color">{entry.color}</span>
                                        </div>
                                    </div>
                                    <div className="schedule-roles">
                                        <div><span className="role-label">Lector</span>{entry.lector || '—'}</div>
                                        <div><span className="role-label">LEM</span>{entry.chalice_bearer || '—'}</div>
                                        <div><span className="role-label">Acolyte</span>{entry.acolyte || '—'}</div>
                                        <div><span className="role-label">Usher</span>{entry.usher || '—'}</div>
                                        <div><span className="role-label">Sound</span>{entry.sound_engineer || '—'}</div>
                                        <div><span className="role-label">Coffee Hour</span>{entry.coffee_hour || '—'}</div>
                                    </div>
                                    <div className="schedule-actions">
                                        <button className="btn-secondary" onClick={() => openEdit(entry)}>Edit</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                ))
            )}

            <Modal
                isOpen={!!editing}
                onClose={closeEdit}
                title="Edit Sunday Assignments"
            >
                <form className="schedule-form" onSubmit={saveChanges}>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Date</label>
                            <input type="text" value={formState.date} readOnly />
                        </div>
                        <div className="form-group">
                            <label>Service Time</label>
                            <input type="text" value={formState.service_time} readOnly />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Search people</label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Type a name or email"
                        />
                    </div>
                    <div className="role-grid">
                        {roleConfigs.map((role) => (
                            <div key={role.key} className="role-panel">
                                <div className="role-panel__header">
                                    <span>{role.label}</span>
                                    <span className="role-count">{formState[role.key]?.length || 0} selected</span>
                                </div>
                                <div className="role-people">
                                    {filteredPeople.length === 0 ? (
                                        <div className="empty-people">No people match the search.</div>
                                    ) : (
                                        filteredPeople.map((person) => {
                                            const checked = formState[role.key]?.includes(person.id);
                                            return (
                                                <label key={`${role.key}-${person.id}`} className="person-option">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => togglePerson(role.key, person.id)}
                                                    />
                                                    <span className="person-name">{person.displayName}</span>
                                                    {person.email && <span className="person-email">{person.email}</span>}
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={closeEdit} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn-primary" disabled={saving}>
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default LiturgicalSchedule;
