import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import { ROLE_DEFINITIONS } from '../models/roles';
import { clearLiturgicalCache, getFollowingSunday, getLiturgicalDay, getNextSunday, getPreviousSunday, getServicesByDate } from '../services/liturgicalService';
import { getSundayDetails, mergeRoleOverride, saveSundayDetails } from '../services/sundayDetails';
import './Sunday.css';

const serializeDate = (date) => date.toISOString().slice(0, 10);

const bulletinOptions = ['draft', 'review', 'ready', 'printed'];

const apiRoleKeys = new Set(['lector', 'lem', 'acolyte', 'usher', 'sound', 'coffeeHour']);

const roleToApiField = {
    lector: 'lector',
    lem: 'lem',
    acolyte: 'acolyte',
    usher: 'usher',
    sound: 'sound',
    coffeeHour: 'coffeeHour'
};

const Sunday = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [details, setDetails] = useState(getSundayDetails(null));
    const [roleDrafts, setRoleDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

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
            svcData.forEach((service) => {
                const overrides = stored.roleOverrides?.[service.time] || {};
                const roleValues = {};
                ROLE_DEFINITIONS.forEach((role) => {
                    const overrideValue = overrides[role.key];
                    const rosterValue = service.assignments?.[role.key] || '';
                    roleValues[role.key] = overrideValue ?? rosterValue;
                });
                drafts[service.time] = roleValues;
            });

            setCurrentDate(date);
            setLiturgicalInfo(litInfo);
            setServices(svcData);
            setDetails(stored);
            setRoleDrafts(drafts);
        } catch (err) {
            console.error(err);
            setError('Unable to load Sunday details.');
        } finally {
            setLoading(false);
        }
    }, []);

    const updateDateParam = useCallback((date) => {
        navigate(`/sunday?date=${serializeDate(date)}`);
    }, [navigate]);

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
        setRoleDrafts((prev) => ({
            ...prev,
            [serviceTime]: {
                ...(prev[serviceTime] || {}),
                [roleKey]: value
            }
        }));
        setDetails((prev) => mergeRoleOverride(prev, serviceTime, roleKey, value));
    };

    const addStaffHour = () => {
        updateDetailField('staffHours', [...(details.staffHours || []), { name: '', hours: '' }]);
    };

    const updateStaffHour = (index, key, value) => {
        const updated = [...(details.staffHours || [])];
        updated[index] = { ...updated[index], [key]: value };
        updateDetailField('staffHours', updated);
    };

    const removeStaffHour = (index) => {
        const updated = [...(details.staffHours || [])];
        updated.splice(index, 1);
        updateDetailField('staffHours', updated);
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
                    service_time: service.time || '10:00'
                };
                ROLE_DEFINITIONS.forEach((role) => {
                    if (!apiRoleKeys.has(role.key)) return;
                    const value = roleDrafts?.[service.time]?.[role.key] || '';
                    payload[roleToApiField[role.key]] = value;
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

    const servicePanels = useMemo(() => {
        return services.map((service) => (
            <Card key={service.id} className="sunday-service-card">
                <header className="sunday-service-header">
                    <div>
                        <h3>{service.time || 'Service'}</h3>
                        <span className="service-meta">{service.rite || 'Sunday Service'}</span>
                    </div>
                    <span className="service-name">{service.name}</span>
                </header>
                <div className="service-roles-grid">
                    {ROLE_DEFINITIONS.map((role) => (
                        <label key={`${service.id}-${role.key}`} className="role-edit-row">
                            <span className="role-label">{role.label}</span>
                            <input
                                type="text"
                                value={roleDrafts?.[service.time]?.[role.key] || ''}
                                onChange={(event) => updateRoleDraft(service.time, role.key, event.target.value)}
                                placeholder="Unassigned"
                            />
                        </label>
                    ))}
                </div>
            </Card>
        ));
    }, [roleDrafts, services]);

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
                    <p>Track staffing, bulletin readiness, and notes for each Sunday.</p>
                </div>
                <div className="sunday-nav">
                    <button className="btn-secondary" onClick={() => handleNavigate('prev')}>Previous</button>
                    <button className="btn-secondary" onClick={() => handleNavigate('next')}>Next</button>
                </div>
            </header>

            {error && <div className="alert error">{error}</div>}

            <Card className="sunday-summary-card">
                <div>
                    <h2>{currentDate ? format(currentDate, 'MMMM d, yyyy') : ''}</h2>
                    <div className={`liturgical-badge badge-${liturgicalInfo?.color}`}>{liturgicalInfo?.name || liturgicalInfo?.feast || 'Sunday'}</div>
                </div>
                <div className="summary-meta">
                    <span>Readings: {liturgicalInfo?.readings || 'Not set'}</span>
                    <span>Theme: {services[0]?.theme || '—'}</span>
                </div>
                <button className="btn-primary" onClick={saveSunday} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Updates'}
                </button>
            </Card>

            <div className="sunday-grid">
                <Card id="bulletin" className="sunday-panel">
                    <h3>Bulletin Status</h3>
                    <div className="panel-row">
                        <select
                            value={details.bulletinStatus || 'draft'}
                            onChange={(event) => updateDetailField('bulletinStatus', event.target.value)}
                        >
                            {bulletinOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            value={details.bulletinNotes || ''}
                            onChange={(event) => updateDetailField('bulletinNotes', event.target.value)}
                            placeholder="Bulletin notes"
                        />
                    </div>
                </Card>

                <Card id="staff-hours" className="sunday-panel">
                    <div className="panel-header">
                        <h3>Part-Time Staff Hours</h3>
                        <button className="btn-secondary" onClick={addStaffHour}>Add</button>
                    </div>
                    <div className="staff-grid">
                        {(details.staffHours || []).length === 0 && (
                            <div className="text-muted">No hours logged yet.</div>
                        )}
                        {(details.staffHours || []).map((entry, index) => (
                            <div key={`staff-${index}`} className="staff-row">
                                <input
                                    type="text"
                                    placeholder="Name"
                                    value={entry.name}
                                    onChange={(event) => updateStaffHour(index, 'name', event.target.value)}
                                />
                                <input
                                    type="number"
                                    placeholder="Hours"
                                    min="0"
                                    step="0.25"
                                    value={entry.hours}
                                    onChange={(event) => updateStaffHour(index, 'hours', event.target.value)}
                                />
                                <button className="btn-link" onClick={() => removeStaffHour(index)}>Remove</button>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card id="notes" className="sunday-panel">
                    <h3>Special Notes</h3>
                    <textarea
                        value={details.notes || ''}
                        onChange={(event) => updateDetailField('notes', event.target.value)}
                        rows={4}
                        placeholder="Add any special notes for the Sunday..."
                    />
                </Card>
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
