import { useState, useEffect } from 'react';
import Card from '../components/Card';
import { FaGoogle, FaCheck, FaTimes, FaSync, FaServer } from 'react-icons/fa';
import { API_BASE, API_URL } from '../services/apiConfig';
import './Settings.css';

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString();
};

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
    const [opsLoading, setOpsLoading] = useState(true);
    const [opsError, setOpsError] = useState('');
    const [opsStatus, setOpsStatus] = useState(null);
    const [opsActionBusy, setOpsActionBusy] = useState('');

    useEffect(() => {
        checkGoogleStatus();
        checkSharefileStatus();
        checkOpsStatus();

        // Check if returning from OAuth
        const returnPath = sessionStorage.getItem('oauthReturnPath');
        if (returnPath) {
            sessionStorage.removeItem('oauthReturnPath');
            // Refresh status after OAuth redirect
            setTimeout(() => {
                checkGoogleStatus();
                checkSharefileStatus();
                checkOpsStatus();
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

    const checkOpsStatus = async () => {
        setOpsLoading(true);
        setOpsError('');
        try {
            const response = await fetch(`${API_URL}/ops/status`, { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to load operations status');
            const data = await response.json();
            setOpsStatus(data || null);
        } catch (error) {
            console.error('Error checking operations status:', error);
            setOpsStatus(null);
            setOpsError(error?.message || 'Unable to load operations status');
        } finally {
            setOpsLoading(false);
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
            await checkOpsStatus();
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
            await checkOpsStatus();
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
            await checkOpsStatus();
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    };

    const runSharefileRouterNow = async () => {
        const acknowledged = window.confirm('Route all pending ShareFile inbox emails now?');
        if (!acknowledged) return;
        const confirmPhrase = window.prompt('Type ROUTE SHAREFILE NOW to continue:');
        if (!confirmPhrase || confirmPhrase.trim().toUpperCase() !== 'ROUTE SHAREFILE NOW') return;

        setOpsActionBusy('route-sharefile');
        try {
            const response = await fetch(`${API_URL}/sharefile/route-emails`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ confirmPhrase })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Failed to route ShareFile emails');
            }
            await checkOpsStatus();
        } catch (error) {
            console.error('Route ShareFile emails error:', error);
            window.alert(error?.message || 'Failed to route ShareFile emails');
        } finally {
            setOpsActionBusy('');
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

            <Card title="Application Settings">
                <div className="settings-section">
                    <div className="integration-status">
                        <div className="status-icon">
                            <FaServer size={48} color={opsStatus?.ok ? '#16a34a' : '#d97706'} />
                        </div>
                        <div className="status-info">
                            <h3>Operations Readiness</h3>
                            {opsLoading ? (
                                <p className="status-text">Loading operations telemetry...</p>
                            ) : opsError ? (
                                <p className="status-text status-disconnected">
                                    <FaTimes /> {opsError}
                                </p>
                            ) : (
                                <>
                                    <p className={`status-text ${opsStatus?.ok ? 'status-connected' : 'status-disconnected'}`}>
                                        {opsStatus?.ok ? <FaCheck /> : <FaTimes />}
                                        {opsStatus?.ok ? 'Ready' : 'Needs attention'}
                                    </p>
                                    <p className="status-detail">
                                        Uptime: {Number(opsStatus?.uptimeSeconds || 0)}s
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="integration-actions">
                        <button className="btn-primary" type="button" onClick={checkOpsStatus} disabled={opsLoading}>
                            <FaSync /> Refresh Ops Status
                        </button>
                        <button
                            className="btn-secondary"
                            type="button"
                            onClick={runSharefileRouterNow}
                            disabled={opsActionBusy === 'route-sharefile'}
                        >
                            {opsActionBusy === 'route-sharefile' ? 'Routing...' : 'Run ShareFile Routing Now'}
                        </button>
                    </div>

                    {opsStatus && (
                        <div className="calendar-selector">
                            <h4>Service Readiness</h4>
                            <div className="calendar-list">
                                <div className="calendar-item">
                                    <span className="calendar-name">Google OAuth</span>
                                    <span>{opsStatus.services?.google?.ready ? 'Ready' : 'Not ready'}</span>
                                </div>
                                <div className="calendar-item">
                                    <span className="calendar-name">ShareFile Routing</span>
                                    <span>{opsStatus.services?.sharefile?.ready ? 'Ready' : 'Not ready'}</span>
                                </div>
                                <div className="calendar-item">
                                    <span className="calendar-name">Constant Contact</span>
                                    <span>{opsStatus.services?.constantContact?.ready ? 'Ready' : 'Not ready'}</span>
                                </div>
                            </div>

                            <h4>Sync Status</h4>
                            <div className="calendar-list">
                                <div className="calendar-item">
                                    <span className="calendar-name">Google events</span>
                                    <span>
                                        {opsStatus.sync?.googleEvents?.count || 0} items, last update {formatDateTime(opsStatus.sync?.googleEvents?.lastUpdatedAt)}
                                    </span>
                                </div>
                                <div className="calendar-item">
                                    <span className="calendar-name">ShareFile router</span>
                                    <span>
                                        Last success {formatDateTime(opsStatus.sync?.sharefileRouting?.lastSuccessAt)}
                                    </span>
                                </div>
                            </div>

                            <h4>Configuration Validation</h4>
                            <div className="calendar-list">
                                {(opsStatus.config?.errors || []).map((error) => (
                                    <div key={error} className="calendar-item">
                                        <span className="calendar-name status-disconnected">{error}</span>
                                    </div>
                                ))}
                                {(opsStatus.config?.warnings || []).map((warning) => (
                                    <div key={warning} className="calendar-item">
                                        <span className="calendar-name">{warning}</span>
                                    </div>
                                ))}
                                {(opsStatus.config?.errors || []).length === 0 && (opsStatus.config?.warnings || []).length === 0 && (
                                    <div className="calendar-item">
                                        <span className="calendar-name status-connected">No config issues detected.</span>
                                    </div>
                                )}
                            </div>

                            <h4>Recent Admin Actions</h4>
                            <div className="calendar-list">
                                {(opsStatus.adminActions || []).slice(0, 8).map((action) => (
                                    <div key={action.id} className="calendar-item">
                                        <span className="calendar-name">
                                            {action.action} ({action.status})
                                        </span>
                                        <span>{formatDateTime(action.createdAt)}</span>
                                    </div>
                                ))}
                                {(opsStatus.adminActions || []).length === 0 && (
                                    <p className="no-calendars">No admin actions logged yet.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default Settings;
