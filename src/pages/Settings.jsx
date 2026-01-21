import { useState, useEffect } from 'react';
import Card from '../components/Card';
import { FaGoogle, FaCheck, FaTimes, FaSync } from 'react-icons/fa';
import { API_BASE, API_URL } from '../services/apiConfig';
import './Settings.css';

const Settings = () => {
    const [googleConnected, setGoogleConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [calendars, setCalendars] = useState([]);
    const [loadingCalendars, setLoadingCalendars] = useState(false);

    useEffect(() => {
        checkGoogleStatus();

        // Check if returning from OAuth
        const returnPath = sessionStorage.getItem('oauthReturnPath');
        if (returnPath) {
            sessionStorage.removeItem('oauthReturnPath');
            // Refresh status after OAuth redirect
            setTimeout(() => checkGoogleStatus(), 1000);
        }
    }, []);

    useEffect(() => {
        if (googleConnected) {
            fetchCalendars();
        }
    }, [googleConnected]);

    const checkGoogleStatus = async () => {
        try {
            const response = await fetch(`${API_URL}/google/status`, { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                setGoogleConnected(data.connected);
            } else {
                setGoogleConnected(false);
            }
        } catch (error) {
            console.error('Error checking Google status:', error);
            setGoogleConnected(false);
        } finally {
            setLoading(false);
        }
    };

    const fetchCalendars = async () => {
        setLoadingCalendars(true);
        try {
            const response = await fetch(`${API_URL}/google/calendars`, { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                // Ensure data is an array
                setCalendars(Array.isArray(data) ? data : []);
            } else {
                console.error('Failed to fetch calendars');
                setCalendars([]);
            }
        } catch (error) {
            console.error('Error fetching calendars:', error);
            setCalendars([]);
        } finally {
            setLoadingCalendars(false);
        }
    };

    const toggleCalendar = async (calendar) => {
        try {
            await fetch(`${API_URL}/google/calendars/select`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    calendarId: calendar.id,
                    summary: calendar.summary,
                    backgroundColor: calendar.backgroundColor,
                    selected: !calendar.selected
                })
            });

            setCalendars(calendars.map(cal =>
                cal.id === calendar.id ? { ...cal, selected: !cal.selected } : cal
            ));
        } catch (error) {
            console.error('Error toggling calendar:', error);
        }
    };

    const connectGoogle = () => {
        // Save current page to return after OAuth
        sessionStorage.setItem('oauthReturnPath', window.location.pathname);
        // Direct redirect - more reliable than popup
        window.location.href = `${API_BASE}/auth/google`;
    };

    const disconnectGoogle = async () => {
        if (!confirm('Disconnect Google Calendar? Events will no longer sync.')) return;

        try {
            await fetch(`${API_URL}/google/disconnect`, { method: 'POST', credentials: 'include' });
            setGoogleConnected(false);
            setCalendars([]);
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    };

    return (
        <div className="page-settings">
            <header className="page-header-bar">
                <div className="page-header-title">
                    <h1>Settings</h1>
                    <p className="page-header-subtitle is-empty" aria-hidden="true">Spacer</p>
                </div>
            </header>

            <Card title="Google Calendar Integration">
                <div className="settings-section">
                    <div className="integration-status">
                        <div className="status-icon">
                            <FaGoogle size={48} color={googleConnected ? '#4285f4' : '#ccc'} />
                        </div>
                        <div className="status-info">
                            <h3>Google Workspace Calendar</h3>
                            {loading ? (
                                <p className="status-text">Checking connection...</p>
                            ) : googleConnected ? (
                                <>
                                    <p className="status-text status-connected">
                                        <FaCheck /> Connected
                                    </p>
                                    <p className="status-detail">Syncing calendar events automatically</p>
                                </>
                            ) : (
                                <>
                                    <p className="status-text status-disconnected">
                                        <FaTimes /> Not Connected
                                    </p>
                                    <p className="status-detail">Connect to import Google Calendar events</p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="integration-actions">
                        {googleConnected ? (
                            <>
                                <button className="btn-secondary" onClick={disconnectGoogle}>
                                    Disconnect
                                </button>
                                <button className="btn-primary" onClick={fetchCalendars}>
                                    <FaSync /> Refresh Calendars
                                </button>
                            </>
                        ) : (
                            <button className="btn-primary" onClick={connectGoogle}>
                                <FaGoogle /> Connect Google Calendar
                            </button>
                        )}
                    </div>

                    {googleConnected && (
                        <div className="calendar-selector">
                            <h4>Select Calendars to Sync</h4>
                            {loadingCalendars ? (
                                <p className="loading-text">Loading calendars...</p>
                            ) : calendars.length === 0 ? (
                                <p className="no-calendars">No calendars found</p>
                            ) : (
                                <div className="calendar-list">
                                    {calendars.map(calendar => (
                                        <label key={calendar.id} className="calendar-item">
                                            <input
                                                type="checkbox"
                                                checked={calendar.selected}
                                                onChange={() => toggleCalendar(calendar)}
                                            />
                                            <div
                                                className="calendar-color"
                                                style={{ backgroundColor: calendar.backgroundColor }}
                                            ></div>
                                            <span className="calendar-name">{calendar.summary}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Card>

            <Card title="Application Settings">
                <p className="coming-soon">Additional settings coming soon...</p>
            </Card>
        </div>
    );
};

export default Settings;
