import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FaExternalLinkAlt, FaFolderOpen } from 'react-icons/fa';

import Card from '../../components/Card';
import { API_URL } from '../../services/apiConfig';
import { APP_ROUTES } from '../../config/appRoutes';
import { getSectionIconComponent } from './todoVisuals';
import {
    getTaskCycleChipText,
    getTaskCycleLabel,
    getTaskCycleState
} from '../../../shared/taskStatus.js';

const formatDateTime = (value, fallback = 'Not available') => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return format(parsed, 'MMM d, yyyy h:mm a');
};

const formatDateOnly = (value, fallback = 'Not available') => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return format(parsed, 'MMM d, yyyy');
};

const buildDownloadUrl = (path) => (
    path ? `${API_URL}/files/download?path=${encodeURIComponent(path)}` : ''
);

const openFileLocation = async (path) => {
    if (!path) return;
    try {
        await fetch(`${API_URL}/files/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
    } catch (error) {
        console.error('Open file location failed:', error);
    }
};

const DataList = ({ files = [], emptyLabel = 'Nothing to show yet.' }) => {
    if (!files.length) {
        return <div className="task-panel-empty">{emptyLabel}</div>;
    }
    return (
        <div className="task-history-list">
            {files.map((file) => (
                <div key={file.path} className="task-history-row">
                    <div className="task-history-copy">
                        <strong>{file.name}</strong>
                        <span>{formatDateTime(file.modifiedAt)}</span>
                        {file.amount != null ? <span>${file.amount.toFixed(2)}</span> : null}
                    </div>
                    <div className="task-history-actions">
                        {file.path ? (
                            <a className="btn-secondary btn-compact" href={buildDownloadUrl(file.path)} target="_blank" rel="noreferrer">
                                Open
                            </a>
                        ) : null}
                        {file.path ? (
                            <button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(file.path)}>
                                Folder
                            </button>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

const SundayDocumentCard = ({ title, document }) => (
    <div className="task-doc-card">
        <div className="task-doc-head">
            <strong>{title}</strong>
            <div className="task-doc-actions">
                {document?.path ? (
                    <a className="btn-secondary btn-compact" href={buildDownloadUrl(document.path)} target="_blank" rel="noreferrer">
                        Open File
                    </a>
                ) : null}
                {document?.path ? (
                    <button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(document.path)}>
                        <FaFolderOpen />
                    </button>
                ) : null}
            </div>
        </div>
        {document?.preview ? (
            <img className="task-doc-preview" src={document.preview} alt={title} />
        ) : (
            <div className="task-panel-empty">No preview available.</div>
        )}
        {document?.name ? <div className="task-doc-meta">{document.name}</div> : null}
    </div>
);

const SundayRosterCard = ({ roster = [] }) => {
    if (!roster.length) {
        return <div className="task-panel-empty">No roster data is available for this Sunday yet.</div>;
    }
    return (
        <div className="task-roster-list">
            {roster.map((service) => (
                <div key={service.time} className="task-roster-service">
                    <div className="task-roster-head">
                        <strong>{service.rite || 'Service'}</strong>
                        <span>{service.time || ''}</span>
                    </div>
                    {service.roles.length > 0 ? (
                        <div className="task-roster-roles">
                            {service.roles.map((role) => (
                                <div key={`${service.time}-${role.roleKey}`} className="task-roster-role">
                                    <span>{role.roleKey.replace(/_/g, ' ')}</span>
                                    <strong>{role.people.join(', ')}</strong>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="task-panel-empty">No one is assigned yet.</div>
                    )}
                </div>
            ))}
        </div>
    );
};

const MailPackageTracker = ({ pkg }) => (
    <details className="mail-package-card">
        <summary className="mail-package-summary">
            <div className="mail-package-titleblock">
                <strong>{pkg.packageName || 'Package'}</strong>
                <div className="mail-package-subline">
                    {pkg.carrier ? <span>{pkg.carrier}</span> : null}
                    {pkg.trackingNumberDisplay ? <span>{`Tracking ${pkg.trackingNumberDisplay}`}</span> : null}
                    {!pkg.trackingNumberDisplay && pkg.orderNumber ? <span>{`Order ${pkg.orderNumber}`}</span> : null}
                </div>
            </div>
            <div className="mail-package-status">
                <span className={`mail-status-pill status-${pkg.latestStatus || 'ordered'}`}>{pkg.latestStatusLabel || 'Package update'}</span>
                <strong>{formatDateTime(pkg.latestAt, 'Unknown')}</strong>
            </div>
            <div className="mail-package-progress">
                {Array.isArray(pkg.progress) ? pkg.progress.map((step) => (
                    <span
                        key={step.key}
                        className={`mail-progress-chip${step.reached ? ' is-reached' : ''}${step.isCurrent ? ' is-current' : ''}`}
                    >
                        {step.label}
                    </span>
                )) : null}
            </div>
            <div className="mail-package-toggle">
                {`${Array.isArray(pkg.updates) ? pkg.updates.length : 0} update${Array.isArray(pkg.updates) && pkg.updates.length === 1 ? '' : 's'}`}
            </div>
        </summary>
        <div className="mail-package-history">
            {Array.isArray(pkg.updates) ? pkg.updates
                .slice()
                .reverse()
                .map((update) => (
                    <div key={update.id} className="mail-package-update">
                        <span className={`mail-status-pill status-${update.status || 'ordered'}`}>{update.statusLabel}</span>
                        <strong>{formatDateTime(update.at, 'Unknown')}</strong>
                        {update.trackingNumber ? <span>{`Tracking ${update.trackingNumber}`}</span> : null}
                        {!update.trackingNumber && update.orderNumber ? <span>{`Order ${update.orderNumber}`}</span> : null}
                    </div>
                )) : null}
        </div>
    </details>
);

const renderPanelContent = ({ panelData, selectedSectionKey, originRoute }) => {
    if (!panelData || panelData.kind === 'empty') {
        return <div className="task-panel-empty">Select a task section to see its data.</div>;
    }

    if (panelData.kind === 'mail') {
        const packages = panelData.expectedPackages?.packages || [];
        return (
            <div className="task-panel-stack">
                <div className="task-data-card">
                    <h3>Mail Status</h3>
                    <div className="mail-status-grid">
                        <div className="task-data-metric">
                            <span>Last checked</span>
                            <strong>{formatDateTime(panelData.lastCheckedAt, 'Not checked yet')}</strong>
                        </div>
                        <div className="task-data-metric">
                            <span>Tracked packages</span>
                            <strong>{packages.length}</strong>
                        </div>
                        <div className="task-data-metric">
                            <span>Mailbox</span>
                            <strong>{panelData.expectedPackages?.mailbox || 'Not connected'}</strong>
                        </div>
                        <div className="task-data-metric">
                            <span>Refreshed</span>
                            <strong>{formatDateTime(panelData.expectedPackages?.refreshedAt, 'Unknown')}</strong>
                        </div>
                    </div>
                </div>
                <div className="task-data-card">
                    <div className="task-panel-titlebar">
                        <h3>Package Tracker</h3>
                        <span className="task-data-note">Email-derived shipping timeline</span>
                    </div>
                    {packages.length === 0 ? (
                        <div className="task-panel-empty">{panelData.expectedPackages?.note || 'No package updates matched yet.'}</div>
                    ) : (
                        <div className="mail-package-list">
                            {packages.map((pkg) => (
                                <MailPackageTracker key={pkg.id} pkg={pkg} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (panelData.kind === 'deposits') {
        return (
            <div className="task-panel-stack">
                <div className="task-data-card">
                    <h3>Bank Branch</h3>
                    <div className="task-data-metric">
                        <span>{panelData.branch.address}</span>
                        <strong>{panelData.branch.statusLabel}</strong>
                    </div>
                    <div className="task-panel-links">
                        <a href={panelData.branch.directionsUrl} target="_blank" rel="noreferrer">Open Directions</a>
                        <a href={panelData.branch.sourceUrl} target="_blank" rel="noreferrer">Branch Details</a>
                    </div>
                    <div className="task-data-note">{panelData.branch.trafficLabel}</div>
                </div>
                <div className="task-data-card">
                    <h3>Deposit History</h3>
                    <DataList files={panelData.history?.files || []} emptyLabel="No deposit files found." />
                </div>
            </div>
        );
    }

    if (panelData.kind === 'receivables' || panelData.kind === 'payables') {
        return (
            <div className="task-data-card">
                <h3>{panelData.title} History</h3>
                <div className="task-data-note">{panelData.history?.root || 'Folder unavailable'}</div>
                <DataList files={panelData.history?.files || []} emptyLabel="No files found in this folder." />
            </div>
        );
    }

    if (panelData.kind === 'birthdays') {
        const items = panelData.upcoming?.items || [];
        return (
            <div className="task-data-card">
                <h3>Upcoming Birthdays</h3>
                <div className="task-data-note">
                    {`${formatDateOnly(panelData.upcoming?.startDate)} to ${formatDateOnly(panelData.upcoming?.endDate)}`}
                </div>
                {items.length === 0 ? (
                    <div className="task-panel-empty">No birthdays in the coming Sunday-Saturday window.</div>
                ) : (
                    <div className="task-package-list">
                        {items.map((entry) => (
                            <div key={`${entry.name}-${entry.monthDay}`} className="task-package-row">
                                <strong>{entry.name}</strong>
                                <span>{entry.weekday}</span>
                                <span>{entry.monthDay}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (panelData.kind === 'payroll') {
        return (
            <div className="task-panel-stack">
                <div className="task-data-card">
                    <h3>Pay Period</h3>
                    <div className="task-data-metric">
                        <span>{panelData.period?.label || 'Current occurrence'}</span>
                        <strong>{`${formatDateOnly(panelData.period?.payPeriodStart)} to ${formatDateOnly(panelData.period?.payPeriodEnd)}`}</strong>
                    </div>
                    {panelData.period?.dueAt ? <div className="task-data-note">Due {formatDateOnly(panelData.period.dueAt)}</div> : null}
                    {panelData.repoDocument?.path ? (
                        <div className="task-panel-links">
                            <a href={buildDownloadUrl(panelData.repoDocument.path)} target="_blank" rel="noreferrer">Open Timesheet Doc</a>
                            <button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(panelData.repoDocument.path)}>
                                Show in Folder
                            </button>
                        </div>
                    ) : null}
                </div>
                <div className="task-data-card">
                    <h3>Payroll Files</h3>
                    <DataList files={panelData.history?.files || []} emptyLabel="No payroll files found." />
                </div>
            </div>
        );
    }

    if (panelData.kind === 'sunday') {
        const documents = panelData.documents || {};
        const selectedView = selectedSectionKey || panelData.selectedView || 'bulletin10';
        const showRoster = ['roles', 'roster', 'clergy', 'music'].includes(selectedView);
        const selectedDocument = selectedView === 'bulletin8'
            ? documents.bulletin8
            : selectedView === 'insert'
                ? documents.insert
                : documents.bulletin10;
        const selectedTitle = selectedView === 'bulletin8'
            ? 'Rite I Bulletin'
            : selectedView === 'insert'
                ? 'Insert'
                : 'Rite II Bulletin';

        return (
            <div className="task-panel-stack">
                <div className="task-data-card">
                    <h3>{panelData.context?.name || 'Sunday'}</h3>
                    {panelData.context?.readings ? <div className="task-data-note">{panelData.context.readings}</div> : null}
                </div>
                {showRoster ? (
                    <div className="task-data-card">
                        <div className="task-panel-titlebar">
                            <h3>Liturgical Roster</h3>
                            {originRoute ? <a href={originRoute}>Open Sunday Planner</a> : null}
                        </div>
                        <SundayRosterCard roster={panelData.roster || []} />
                    </div>
                ) : (
                    <SundayDocumentCard title={selectedTitle} document={selectedDocument} />
                )}
            </div>
        );
    }

    return <div className="task-panel-empty">No panel renderer is available for this task.</div>;
};

const TodoDetailPanel = ({
    selectedOrigin,
    selectedWorkPackage,
    selectedSection,
    selectedOriginTitle,
    selectedOriginSubtitle,
    selectedSectionKey,
    focusTask,
    setSelectedSectionKey,
    setSelectedTaskId,
    toggleTask,
    getOriginColorClass,
    getOriginLink
}) => {
    const [panelData, setPanelData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const originRoute = useMemo(() => (
        selectedOrigin ? getOriginLink(selectedOrigin) : APP_ROUTES.todo
    ), [getOriginLink, selectedOrigin]);

    useEffect(() => {
        if (!selectedOrigin) {
            setPanelData(null);
            setError('');
            return undefined;
        }

        let cancelled = false;
        const controller = new AbortController();
        const loadPanel = async () => {
            setLoading(true);
            setError('');
            try {
                const params = new URLSearchParams({
                    origin_type: selectedOrigin.origin_type || '',
                    origin_id: selectedOrigin.origin_id || '',
                    section_key: selectedSection?.key || '',
                    task_id: focusTask?.id || ''
                });
                const response = await fetch(`${API_URL}/tasks/panel-data?${params.toString()}`, {
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Failed to load task data');
                const payload = await response.json();
                if (!cancelled) setPanelData(payload);
            } catch (loadError) {
                if (!cancelled && loadError?.name !== 'AbortError') {
                    console.error('Task panel load failed:', loadError);
                    setError('Unable to load task data.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadPanel();
        const shouldPoll = (selectedSection?.key || '') === 'mail';
        const timer = shouldPoll ? window.setInterval(loadPanel, 5 * 60 * 1000) : null;
        return () => {
            cancelled = true;
            controller.abort();
            if (timer) window.clearInterval(timer);
        };
    }, [focusTask?.id, selectedOrigin, selectedSection?.key]);

    return (
        <Card className={`tasks-detail-card ${selectedOrigin ? getOriginColorClass(selectedOrigin.origin_type) : ''}`}>
            <div className="tasks-list-header task-detail-header">
                <div>
                    <div className="task-detail-header-title">
                        <h2>{selectedOrigin ? selectedOriginTitle : 'Task Data'}</h2>
                        {selectedOrigin && originRoute ? (
                            <a className="btn-icon btn-icon-ghost origin-open-link" href={originRoute} aria-label="Open module" title="Open module">
                                <FaExternalLinkAlt />
                            </a>
                        ) : null}
                    </div>
                    <p className="muted">{selectedOrigin ? selectedOriginSubtitle : 'Select a package to restore the task data panel.'}</p>
                </div>
            </div>

            {!selectedOrigin ? <div className="task-panel-empty">Select a package to show task-specific data.</div> : null}

            {selectedOrigin && selectedWorkPackage ? (
                <div className="task-detail-body task-data-body">
                    <div className="focus-section-rail task-data-section-rail">
                        {selectedWorkPackage.sections.map((section) => {
                            const Icon = getSectionIconComponent(section.iconKey);
                            const activeTask = section.actionTask || section.currentTask;
                            const chipText = getTaskCycleChipText(activeTask);
                            const chipState = getTaskCycleState(activeTask);
                            const isActive = selectedSectionKey === section.key;
                            return (
                                <div key={section.key} className={`focus-section-tab ${isActive ? 'is-active' : ''}`}>
                                    <button
                                        type="button"
                                        className="focus-section-tab-icon-button"
                                        onClick={() => activeTask && toggleTask(activeTask)}
                                        disabled={!activeTask}
                                        aria-label={activeTask ? `${section.title}: ${getTaskCycleLabel(activeTask)}` : section.title}
                                        title={activeTask ? `${section.title}: click to cycle status` : section.title}
                                    >
                                        <span className={`focus-section-tab-icon state-${section.status}`}>
                                            <Icon />
                                            {chipText ? <span className={`section-state-chip status-${chipState}`}>{chipText}</span> : null}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="focus-section-tab-copy"
                                        onClick={() => {
                                            setSelectedSectionKey(section.key);
                                            setSelectedTaskId(activeTask?.id || '');
                                        }}
                                    >
                                        <strong>{section.shortLabel}</strong>
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {loading ? <div className="task-panel-empty">Loading task data...</div> : null}
                    {error && !loading ? <div className="task-panel-empty">{error}</div> : null}
                    {!loading && !error ? renderPanelContent({ panelData, selectedSectionKey, originRoute }) : null}
                </div>
            ) : null}
        </Card>
    );
};

export default TodoDetailPanel;
