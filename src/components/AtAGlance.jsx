import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import Card from './Card';
import { ROLE_DEFINITIONS } from '../models/roles';
import { getNextSunday, getServicesByDate, getLiturgicalDay } from '../services/liturgicalService';
import { getSundayDetails } from '../services/sundayDetails';
import './AtAGlance.css';

const AtAGlance = () => {
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [details, setDetails] = useState(getSundayDetails(null));
    const [loading, setLoading] = useState(true);

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

    const glanceItems = useMemo(() => {
        const bulletinStatus = details.bulletinStatus || liturgicalInfo?.bulletinStatus || 'draft';
        const bulletinReady = ['ready', 'printed', 'final'].includes(bulletinStatus);
        const staffEntries = details.staffHours || [];
        const missingHours = staffEntries.filter((entry) => !entry.hours || Number(entry.hours) <= 0).length;
        const staffStatus = staffEntries.length === 0
            ? 'No hours logged'
            : missingHours > 0
                ? `${missingHours} missing hours`
                : 'Hours logged';

        const countMissingByTag = (tag) => {
            return services.reduce((total, service) => {
                ROLE_DEFINITIONS.forEach((role) => {
                    if (!role.tags.includes(tag)) return;
                    const roster = service?.roster?.[role.key];
                    if (!roster || roster.status !== 'assigned') {
                        total += 1;
                    }
                });
                return total;
            }, 0);
        };

        const volunteerMissing = countMissingByTag('volunteer');
        const staffMissing = countMissingByTag('staff');

        return [
            {
                id: 'bulletin',
                label: 'Bulletin',
                status: bulletinReady ? 'Ready' : `Status: ${bulletinStatus}`,
                anchor: '#bulletin'
            },
            {
                id: 'volunteers',
                label: 'Volunteers',
                status: volunteerMissing === 0 ? 'Fully staffed' : `${volunteerMissing} unfilled roles`,
                anchor: '#volunteers'
            },
            {
                id: 'staff-hours',
                label: 'Part-Time Staff',
                status: staffMissing === 0 ? staffStatus : `${staffMissing} unfilled roles`,
                anchor: '#staff-hours'
            },
            {
                id: 'notes',
                label: 'Special Notes',
                status: details.notes ? 'Notes added' : 'None',
                anchor: '#notes'
            }
        ];
    }, [details, liturgicalInfo, services]);

    if (loading || !currentDate) {
        return (
            <Card className="at-a-glance-card">
                <p>Loading Schedule...</p>
            </Card>
        );
    }

    const sundayPath = `/sunday?date=${format(currentDate, 'yyyy-MM-dd')}`;

    return (
        <Card className="at-a-glance-card">
            <div className="at-a-glance-header">
                <div>
                    <h2 className="section-title">Upcoming Sunday</h2>
                    <h3 className="sunday-date">{format(currentDate, 'MMMM d, yyyy')}</h3>
                    <div className={`liturgical-badge badge-${liturgicalInfo?.color}`}>
                        {liturgicalInfo?.name || liturgicalInfo?.feast || 'Ordinary Time'}
                    </div>
                </div>
                <Link className="btn-secondary" to={sundayPath}>
                    Open Sunday Planner
                </Link>
            </div>
            <div className="glance-list">
                {glanceItems.map((item) => (
                    <Link key={item.id} to={`${sundayPath}${item.anchor}`} className="glance-item">
                        <span className="glance-label">{item.label}</span>
                        <span className="glance-status">{item.status}</span>
                    </Link>
                ))}
            </div>
        </Card>
    );
};

export default AtAGlance;
