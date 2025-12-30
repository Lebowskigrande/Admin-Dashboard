import { useState, useEffect } from 'react';
import Card from './Card';
import { getNextSunday, getServicesByDate, getLiturgicalDay, getFollowingSunday, getPreviousSunday } from '../services/liturgicalService';
import { format } from 'date-fns';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import './AtAGlance.css';

const AtAGlance = () => {
    const [currentDate, setCurrentDate] = useState(null);
    const [liturgicalInfo, setLiturgicalInfo] = useState(null);
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);

    // Initial Load
    useEffect(() => {
        loadNextSunday();
    }, []);

    const loadNextSunday = async () => {
        const date = await getNextSunday();
        if (date) {
            updateView(date);
        }
    };

    const updateView = async (date) => {
        setLoading(true);
        setCurrentDate(date);
        const litInfo = await getLiturgicalDay(date);
        const svcData = await getServicesByDate(date);
        setLiturgicalInfo(litInfo);
        setServices(svcData);
        setLoading(false);
    };

    const handlePrevWeek = async () => {
        if (currentDate) {
            const prev = await getPreviousSunday(currentDate);
            updateView(prev);
        }
    };

    const handleNextWeek = async () => {
        if (currentDate) {
            const next = await getFollowingSunday(currentDate);
            updateView(next);
        }
    };

    if (loading || !currentDate) return <Card className="at-a-glance-card"><p>Loading Schedule...</p></Card>;

    // Separate services
    const service8am = services.find(s => s.time === '08:00');
    const service10am = services.find(s => s.time === '10:00');

    return (
        <Card className="at-a-glance-card">
            <div className="at-a-glance-header">
                <div className="header-left">
                    <button className="nav-btn" onClick={handlePrevWeek} title="Previous Sunday"><FaChevronLeft /></button>
                    <div>
                        <h2 className="section-title">Sunday Service</h2>
                        <h3 className="sunday-date">{format(currentDate, 'MMMM d, yyyy')}</h3>
                        <div className={`liturgical-badge badge-${liturgicalInfo?.color}`}>
                            {liturgicalInfo?.feast || 'Ordinary Time'}
                        </div>
                    </div>
                    <button className="nav-btn" onClick={handleNextWeek} title="Next Sunday"><FaChevronRight /></button>
                </div>
                <div className="readings-box">
                    <h4>Readings</h4>
                    <p className="readings-text">{liturgicalInfo?.readings || 'No readings available'}</p>
                </div>
            </div>

            <div className="services-table">
                <div className="service-column">
                    <h3 className="service-title">8:00 AM - Rite I</h3>
                    <div className="role-row">
                        <span className="role-label-compact">Lector:</span>
                        <span className="role-value">{service8am?.lector || 'Unassigned'}</span>
                    </div>
                </div>

                <div className="service-column">
                    <h3 className="service-title">10:00 AM - Rite II</h3>
                    <div className="role-row">
                        <span className="role-label-compact">Lector:</span>
                        <span className="role-value">{service10am?.lector || 'Unassigned'}</span>
                    </div>
                    <div className="role-row">
                        <span className="role-label-compact">LEM:</span>
                        <span className="role-value">{service10am?.chaliceBearer || 'Unassigned'}</span>
                    </div>
                    <div className="role-row">
                        <span className="role-label-compact">Acolyte:</span>
                        <span className="role-value">{service10am?.acolyte || 'Unassigned'}</span>
                    </div>
                    <div className="role-row">
                        <span className="role-label-compact">Usher:</span>
                        <span className="role-value">{service10am?.usher || 'Unassigned'}</span>
                    </div>
                    <div className="role-row">
                        <span className="role-label-compact">Sound:</span>
                        <span className="role-value">{service10am?.sound || 'Unassigned'}</span>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default AtAGlance;
