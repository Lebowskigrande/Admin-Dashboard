import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import Card from './Card';
import { ROLE_DEFINITIONS } from '../models/roles';
import { getNextSunday, getServicesByDate, getLiturgicalDay } from '../services/liturgicalService';
import { getSundayDetails } from '../services/sundayDetails';
import { useEvents } from '../context/EventsContext';
import { API_URL } from '../services/apiConfig';
import './AtAGlance.css';

const AtAGlance = () => {
    const navigate = useNavigate();
    const { events } = useEvents();
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [details, setDetails] = useState(getSundayDetails(null));
    const [loading, setLoading] = useState(true);
    const [livestreamUrl, setLivestreamUrl] = useState('');

    const updateView = useCallback(async (date) => {
        setLoading(true);
        setCurrentDate(date);
        const litInfo = await getLiturgicalDay(date);
        const svcData = await getServicesByDate(date);
        setLiturgicalInfo(litInfo);
        setServices(svcData);
        setDetails(getSundayDetails(date));
        setLoading(false);
    }, []);

    const loadNextSunday = useCallback(async () => {
        const date = await getNextSunday();
        if (date) {
            updateView(date);
        }
    }, [updateView]);

    // Initial Load
    useEffect(() => {
        loadNextSunday();
    }, [loadNextSunday]);

    useEffect(() => {
        if (!currentDate) return;
        const loadLivestream = async () => {
            try {
                const dateStr = format(currentDate, 'yyyy-MM-dd');
                const response = await fetch(`${API_URL}/sunday/livestream?date=${dateStr}`);
                if (!response.ok) throw new Error('Failed to load livestream');
                const data = await response.json();
                setLivestreamUrl(data?.url || '');
            } catch (error) {
                console.error(error);
                setLivestreamUrl('');
            }
        };
        loadLivestream();
    }, [currentDate]);

    const missingRoles = useMemo(() => {
        const labels = new Set();
        services.forEach((service) => {
            const time = (service?.time || '').trim();
            const isEightAm = /^0?8:/.test(time);
            const requiredKeys = isEightAm
                ? ['lector', 'preacher', 'celebrant', 'organist']
                : ['lector', 'lem', 'acolyte', 'preacher', 'celebrant', 'usher', 'sound', 'organist'];
            requiredKeys.forEach((roleKey) => {
                const roster = service?.roster?.[roleKey];
                if (roster?.status === 'assigned') return;
                const roleLabel = ROLE_DEFINITIONS.find((role) => role.key === roleKey)?.label || roleKey;
                const serviceLabel = time ? `${time} ${roleLabel}` : roleLabel;
                labels.add(serviceLabel);
            });
        });
        return Array.from(labels);
    }, [services]);

    const sundayEvents = useMemo(() => {
        if (!currentDate) return [];
        return events.filter((event) => {
            if (!event?.date) return false;
            if (!isSameDay(event.date, currentDate)) return false;
            if (event.source === 'liturgical') return false;
            if (event.type_slug === 'weekly-service') return false;
            if (event.id === 'sunday-service') return false;
            return true;
        });
    }, [currentDate, events]);

    const livestreamSummary = useMemo(() => {
        if (details.emailSent) return 'Email sent';
        if (details.emailScheduled) return 'Email scheduled';
        if (details.emailCreated) return 'Email created';
        if (details.bulletinUploaded || details.bulletinUploadUrl) return 'Bulletin uploaded';
        if (livestreamUrl) return 'Livestream setup';
        return 'Not started';
    }, [details, livestreamUrl]);

    const getStatusClass = useCallback((label, value) => {
        const normalized = (value || '').toLowerCase();
        if (label === 'Livestream Email') {
            if (normalized === 'email sent') return 'status-closed';
            if (normalized === 'email scheduled') return 'status-in_process';
            if (normalized === 'email created') return 'status-reviewed';
            if (normalized === 'bulletin uploaded') return 'status-reviewed';
            if (normalized === 'livestream setup') return 'status-new';
            return 'status-new';
        }

        if (normalized === 'printed' || normalized === 'stuffed') return 'status-closed';
        if (normalized === 'ready') return 'status-in_process';
        if (normalized === 'review') return 'status-reviewed';
        if (normalized === 'draft') return 'status-reviewed';
        return 'status-new';
    }, []);

    const statusItems = useMemo(() => {
        const bulletin10 = details.bulletinStatus10 || 'Not Started';
        const bulletin8 = details.bulletinStatus8 || 'Not Started';
        const insert = details.bulletinInsertStatus || 'Not Started';
        const isPrinted = (value) => value?.toLowerCase?.() === 'printed';
        return [
            {
                label: '10am Bulletin',
                value: bulletin10,
                complete: isPrinted(bulletin10),
                statusClass: getStatusClass('10am Bulletin', bulletin10)
            },
            {
                label: '8am Bulletin',
                value: bulletin8,
                complete: isPrinted(bulletin8),
                statusClass: getStatusClass('8am Bulletin', bulletin8)
            },
            {
                label: 'Insert',
                value: insert,
                complete: insert?.toLowerCase?.() === 'stuffed',
                statusClass: getStatusClass('Insert', insert)
            },
            {
                label: 'Livestream Email',
                value: livestreamSummary,
                complete: livestreamSummary === 'Email sent',
                statusClass: getStatusClass('Livestream Email', livestreamSummary)
            }
        ];
    }, [details, getStatusClass, livestreamSummary]);

    if (loading || !currentDate) {
        return (
            <Card className="at-a-glance-card">
                <p>Loading Schedule...</p>
            </Card>
        );
    }

    const sundayPath = `/sunday?date=${format(currentDate, 'yyyy-MM-dd')}`;

    return (
        <div
            className="at-a-glance-wrapper"
            onClick={() => navigate(sundayPath)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(sundayPath);
                }
            }}
            role="button"
            tabIndex={0}
        >
            <Card className="at-a-glance-card">
                <div className="at-a-glance-header">
                    <div>
                        <h2 className="section-title">Sunday at a Glance</h2>
                        <h3 className="sunday-date">{format(currentDate, 'MMMM d, yyyy')}</h3>
                        <div className={`liturgical-badge badge-${liturgicalInfo?.color}`}>
                            {liturgicalInfo?.name || liturgicalInfo?.feast || 'Ordinary Time'}
                        </div>
                    </div>
                </div>
                <div className="glance-section">
                    <h4>Status Summary</h4>
                    <div className="glance-list">
                        {statusItems.map((item) => (
                            <div key={item.label} className={`glance-item ${item.complete ? 'complete' : ''}`}>
                                {item.complete && <span className="check-badge glance-check" aria-hidden="true">✓</span>}
                                <span className="glance-label">{item.label}</span>
                                <span className={`glance-status pill ${item.statusClass}`}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="glance-section">
                    <h4>Unfilled Roles</h4>
                    {missingRoles.length === 0 ? (
                        <div className="glance-empty">All roles filled.</div>
                    ) : (
                        <div className="glance-chips">
                            {missingRoles.map((role) => (
                                <span key={role} className="glance-chip">{role}</span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="glance-section">
                    <h4>Additional Events</h4>
                    {sundayEvents.length === 0 ? (
                        <div className="glance-empty">No additional events.</div>
                    ) : (
                        <div className="glance-list">
                            {sundayEvents.map((event) => (
                                <div key={event.id} className="glance-item">
                                    <span className="glance-label">{event.title}</span>
                                    <span className="glance-status">{event.time || 'All day'}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default AtAGlance;
