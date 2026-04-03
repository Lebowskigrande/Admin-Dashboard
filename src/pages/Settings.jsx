import { useState, useEffect } from 'react';
import Card from '../components/Card';
import { FaGoogle, FaCheck, FaTimes, FaSync, FaEnvelope } from 'react-icons/fa';
import { API_BASE, API_URL } from '../services/apiConfig';
import './Settings.css';

const Settings = () => {
    const [googleConnected, setGoogleConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [calendars, setCalendars] = useState([]);
    const [loadingCalendars, setLoadingCalendars] = useState(false);
    const [sharefileConnected, setSharefileConnected] = useState(false);
    const [sharefileAccount, setSharefileAccount] = useState(null);
    const [sharefileLoading, setSharefileLoading] = useState(true);
    const [sharefileAccounts, setSharefileAccounts] = useState([]);
    const [sharefileActionBusy, setSharefileActionBusy] = useState('');
    const [ccConnected, setCcConnected] = useState(false);
    const [ccLoading, setCcLoading] = useState(true);
    const [ccFromEmails, setCcFromEmails] = useState([]);
    const [ccBusy, setCcBusy] = useState(false);

    useEffect(() => {
        checkGoogleStatus();
        checkSharefileStatus();
        checkConstantContactStatus();

        // Check if returning from OAuth
        const returnPath = sessionStorage.getItem('oauthReturnPath');
        if (returnPath) {
            sessionStorage.removeItem('oauthReturnPath');
            // Refresh status after OAuth redirect
            setTimeout(() => {
                checkGoogleStatus();
                checkSharefileStatus();
                checkConstantContactStatus();
            }, 1000);
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

    const checkSharefileStatus = async () => {
        try {
            const response = await fetch(`${API_URL}/sharefile/google/status`, { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                setSharefileConnected(!!data.connected);
                setSharefileAccount(data.account || null);
                setSharefileAccounts(Array.isArray(data.accounts) ? data.accounts : []);
            } else {
                setSharefileConnected(false);
                setSharefileAccount(null);
                setSharefileAccounts([]);
            }
        } catch (error) {
            console.error('Error checking ShareFile Gmail status:', error);
            setSharefileConnected(false);
            setSharefileAccount(null);
            setSharefileAccounts([]);
        } finally {
            setSharefileLoading(false);
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

    const checkConstantContactStatus = async () => {
        setCcLoading(true);
        try {
            const response = await fetch(`${API_URL}/constant-contact/status`, { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to check Constant Contact status');
            const data = await response.json();
            const connected = !!data.connected;
            setCcConnected(connected);
            if (connected) {
                const emailsResponse = await fetch(`${API_URL}/constant-contact/from-emails`, { credentials: 'include' });
                if (emailsResponse.ok) {
                    const emailsData = await emailsResponse.json();
                    setCcFromEmails(Array.isArray(emailsData?.emails) ? emailsData.emails : []);
                } else {
                    setCcFromEmails([]);
                }
            } else {
                setCcFromEmails([]);
            }
        } catch (error) {
            console.error('Error checking Constant Contact status:', error);
            setCcConnected(false);
            setCcFromEmails([]);
        } finally {
            setCcLoading(false);
        }
    };

    const connectSharefileGmail = async () => {
        sessionStorage.setItem('oauthReturnPath', window.location.pathname);
        try {
            const response = await fetch(`${API_URL}/sharefile/google/auth-url`, { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to load ShareFile Gmail auth URL');
            const data = await response.json();
            if (!data?.url) throw new Error('Missing auth URL');
            window.location.href = data.url;
        } catch (error) {
            console.error('ShareFile Gmail connect error:', error);
        }
    };

    const connectConstantContact = () => {
        sessionStorage.setItem('oauthReturnPath', window.location.pathname);
        window.location.href = `${API_BASE}/auth/constant-contact`;
    };

    const disconnectConstantContact = async () => {
        if (!confirm('Disconnect Constant Contact? Sunday email scheduling will be disabled.')) return;
        setCcBusy(true);
        try {
            const response = await fetch(`${API_URL}/constant-contact/disconnect`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to disconnect Constant Contact');
            await checkConstantContactStatus();
        } catch (error) {
            console.error('Disconnect Constant Contact error:', error);
        } finally {
            setCcBusy(false);
        }
    };

    const setSharefileDefault = async (userId) => {
        const id = String(userId || '').trim();
        if (!id) return;
        setSharefileActionBusy(`default:${id}`);
        try {
            const response = await fetch(`${API_URL}/sharefile/google/accounts/default`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId: id })
            });
            if (!response.ok) throw new Error('Failed to set default ShareFile account');
            await checkSharefileStatus();
        } catch (error) {
            console.error('Set default ShareFile account error:', error);
        } finally {
            setSharefileActionBusy('');
        }
    };

    const disconnectSharefileAccount = async (userId) => {
        const id = String(userId || '').trim();
        if (!id) return;
        if (!confirm('Disconnect this ShareFile routing account?')) return;
        setSharefileActionBusy(`disconnect:${id}`);
        try {
            const response = await fetch(`${API_URL}/sharefile/google/accounts/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId: id })
            });
            if (!response.ok) throw new Error('Failed to disconnect ShareFile account');
            await checkSharefileStatus();
        } catch (error) {
            console.error('Disconnect ShareFile account error:', error);
        } finally {
            setSharefileActionBusy('');
        }
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
                    <p className="page-header-subtitle">Manage integrations, routing accounts, and the external services that power the dashboard.</p>
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

            <Card title="ShareFile Gmail Routing">
                <div className="settings-section">
                    <div className="integration-status">
                        <div className="status-icon">
                            <FaGoogle size={48} color={sharefileConnected ? '#4285f4' : '#ccc'} />
                        </div>
                        <div className="status-info">
                            <h3>ShareFile Gmail Inbox</h3>
                            {sharefileLoading ? (
                                <p className="status-text">Checking connection...</p>
                            ) : sharefileConnected ? (
                                <>
                                    <p className="status-text status-connected">
                                        <FaCheck /> Connected
                                    </p>
                                    <p className="status-detail">
                                        {sharefileAccount?.email || 'ShareFile Gmail is connected'}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="status-text status-disconnected">
                                        <FaTimes /> Not Connected
                                    </p>
                                    <p className="status-detail">Connect the dashboard Gmail inbox for ShareFile routing</p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="integration-actions">
                        <button className="btn-primary" onClick={connectSharefileGmail}>
                            <FaGoogle /> Link ShareFile Gmail Account
                        </button>
                    </div>

                    <div className="calendar-selector">
                        <h4>Linked ShareFile Routing Accounts</h4>
                        {sharefileLoading ? (
                            <p className="loading-text">Loading linked accounts...</p>
                        ) : sharefileAccounts.length === 0 ? (
                            <p className="no-calendars">No ShareFile routing accounts linked.</p>
                        ) : (
                            <div className="calendar-list">
                                {sharefileAccounts.map((account) => {
                                    const id = account.userId;
                                    const defaultBusy = sharefileActionBusy === `default:${id}`;
                                    const disconnectBusy = sharefileActionBusy === `disconnect:${id}`;
                                    return (
                                        <div key={id} className="calendar-item">
                                            <span className="calendar-name">
                                                {account.email || account.displayName || id}
                                            </span>
                                            <button
                                                className="btn-secondary"
                                                type="button"
                                                disabled={account.isDefault || defaultBusy}
                                                onClick={() => setSharefileDefault(id)}
                                            >
                                                {account.isDefault ? 'Default' : (defaultBusy ? 'Saving...' : 'Set default')}
                                            </button>
                                            <button
                                                className="btn-secondary"
                                                type="button"
                                                disabled={disconnectBusy}
                                                onClick={() => disconnectSharefileAccount(id)}
                                            >
                                                {disconnectBusy ? 'Disconnecting...' : 'Disconnect'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            <Card title="Constant Contact Integration">
                <div className="settings-section">
                    <div className="integration-status">
                        <div className="status-icon">
                            <FaEnvelope size={48} color={ccConnected ? '#2563eb' : '#ccc'} />
                        </div>
                        <div className="status-info">
                            <h3>Sunday Livestream Emails</h3>
                            {ccLoading ? (
                                <p className="status-text">Checking connection...</p>
                            ) : ccConnected ? (
                                <>
                                    <p className="status-text status-connected">
                                        <FaCheck /> Connected
                                    </p>
                                    <p className="status-detail">Constant Contact is ready for Sunday email create/schedule.</p>
                                </>
                            ) : (
                                <>
                                    <p className="status-text status-disconnected">
                                        <FaTimes /> Not Connected
                                    </p>
                                    <p className="status-detail">Connect Constant Contact to enable Sunday email automation.</p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="integration-actions">
                        {ccConnected ? (
                            <>
                                <button className="btn-secondary" onClick={disconnectConstantContact} disabled={ccBusy}>
                                    {ccBusy ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                                <button className="btn-primary" onClick={checkConstantContactStatus} disabled={ccBusy}>
                                    <FaSync /> Refresh
                                </button>
                            </>
                        ) : (
                            <button className="btn-primary" onClick={connectConstantContact}>
                                <FaEnvelope /> Connect Constant Contact
                            </button>
                        )}
                    </div>

                    {ccConnected && (
                        <div className="calendar-selector">
                            <h4>Verified Sender Emails</h4>
                            {ccFromEmails.length === 0 ? (
                                <p className="no-calendars">No sender emails returned by Constant Contact.</p>
                            ) : (
                                <div className="calendar-list">
                                    {ccFromEmails.map((entry, index) => {
                                        const email = entry?.email_address || entry?.email || entry?.address || '';
                                        const status = String(entry?.status || '').trim() || 'unknown';
                                        return (
                                            <div key={`${email}-${index}`} className="calendar-item">
                                                <span className="calendar-name">{email || '(missing email)'}</span>
                                                <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>
                                            </div>
                                        );
                                    })}
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
