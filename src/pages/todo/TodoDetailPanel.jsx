import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FaCheck, FaCog, FaExternalLinkAlt, FaFolderOpen, FaMapMarkerAlt, FaPlus, FaRedoAlt, FaSave, FaTrash } from 'react-icons/fa';
import Card from '../../components/Card';
import { API_URL } from '../../services/apiConfig';
import { APP_ROUTES } from '../../config/appRoutes';
import { getSectionIconComponent } from './todoVisuals';
import { getTaskCycleChipText, getTaskCycleLabel, getTaskCycleState } from '../../../shared/taskStatus.js';
import OrdersPanel from './OrdersPanel';

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
const formatTimeOnly = (value, fallback = '') => {
    if (!value) return fallback;
    const parts = String(value).split(':');
    if (parts.length < 2) return value;
    const date = new Date();
    date.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    return format(date, 'h:mm a');
};
const buildDownloadUrl = (path) => (path ? `${API_URL}/files/download?path=${encodeURIComponent(path)}` : '');
const EVENT_PACKAGE_OPTIONS = [
    { key: 'people', label: 'People' },
    { key: 'bulletin', label: 'Bulletin' },
    { key: 'insert', label: 'Insert' },
    { key: 'clergy', label: 'Clergy' },
    { key: 'music', label: 'Music' },
    { key: 'setup', label: 'Setup' },
    { key: 'documents', label: 'Documents' },
    { key: 'contracts', label: 'Contracts' },
    { key: 'communications', label: 'Comms' }
];

const createEmptyPackageTask = () => ({
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    list_key: 'setup',
    title: 'Setup',
    due_offset_days: -1,
    priority_base: 50
});

const buildEventEditorDraft = (details) => ({
    title: details?.event?.title || '',
    description: details?.event?.description || '',
    eventTypeId: details?.event?.event_type_id ?? '',
    buildingId: details?.occurrence?.building_id || '',
    contactPerson: details?.contact?.person || '',
    contactEmail: details?.contact?.email || '',
    contactPhone: details?.contact?.phone || '',
    contactAddress: details?.contact?.address || '',
    internalNotes: details?.notes?.internal || '',
    packageTasks: Array.isArray(details?.package?.tasks)
        ? details.package.tasks.map((task, index) => ({
            id: task.id || `pkg-${index}`,
            list_key: task.list_key || '',
            title: task.title || task.list_title || '',
            due_offset_days: task.due_offset_days ?? '',
            priority_base: task.priority_base ?? 50
        }))
        : []
});
const openRemoteFile = async (path) => {
    const url = buildDownloadUrl(path);
    if (!url) return;
    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`Open failed: ${response.status}`);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
        console.error('Open file failed:', error);
    }
};
const openFileLocation = async (path) => {
    if (!path) return;
    try {
        const response = await fetch(`${API_URL}/files/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ path })
        });
        if (!response.ok) throw new Error(`Open location failed: ${response.status}`);
    } catch (error) {
        console.error('Open file location failed:', error);
    }
};

const DenseFileList = ({ files = [], emptyLabel = 'Nothing to show yet.' }) => {
    if (!files.length) return <div className="task-panel-empty">{emptyLabel}</div>;
    return (
        <div className="task-dense-list task-dense-list-files">
            <div className="task-dense-header task-dense-row task-dense-file-row"><span>Name</span><span>Modified</span><span>Meta</span><span>Actions</span></div>
            {files.map((file) => (
                <div key={file.path} className="task-dense-row task-dense-file-row">
                    <div className="task-dense-primary"><strong>{file.name}</strong>{file.relativePath ? <span>{file.relativePath}</span> : null}</div>
                    <span>{formatDateTime(file.modifiedAt)}</span>
                    <span>{[file.fileDate, file.amount != null ? `$${file.amount.toFixed(2)}` : '', file.sizeLabel].filter(Boolean).join(' | ') || '--'}</span>
                    <div className="task-dense-actions">
                        {file.path ? <button type="button" className="btn-secondary btn-compact task-inline-action" onClick={() => openRemoteFile(file.path)}>Open</button> : null}
                        {file.path ? <button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(file.path)}><FaFolderOpen /></button> : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

const DenseDocumentList = ({ documents = [], emptyLabel = 'No documents are available for this task.' }) => {
    if (!documents.length) return <div className="task-panel-empty">{emptyLabel}</div>;
    return (
        <div className="task-doc-grid">
            {documents.map((document) => (
                <div key={document.id || document.path || document.name} className="task-doc-card dense">
                    <div className="task-doc-head">
                        <div className="task-doc-titleblock"><strong>{document.label || document.name || 'Document'}</strong><span>{document.name || ''}</span></div>
                        <div className="task-doc-actions">
                            {document.path ? <button type="button" className="btn-secondary btn-compact task-inline-action" onClick={() => openRemoteFile(document.path)}>Open</button> : null}
                            {document.path ? <button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(document.path)}><FaFolderOpen /></button> : null}
                        </div>
                    </div>
                    {document.preview ? <img className="task-doc-preview" src={document.preview} alt={document.label || document.name || 'Document preview'} /> : <div className="task-panel-empty compact">No preview available.</div>}
                </div>
            ))}
        </div>
    );
};

const BirthdayPeopleList = ({ items = [] }) => {
    if (!items.length) return <div className="task-panel-empty">No birthdays in the coming Sunday-Saturday window.</div>;
    return (
        <div className="task-dense-list task-dense-list-birthdays">
            <div className="task-dense-header task-dense-row"><span>Person</span><span>Birthday</span><span>Address</span></div>
            {items.map((entry) => (
                <div key={`${entry.displayName}-${entry.monthDay}`} className="task-dense-row task-birthday-row">
                    <div className="task-dense-primary"><span className={`person-chip person-chip-${entry.personCategory || 'parishioner'}`}>{entry.displayName}</span></div>
                    <span>{`${entry.weekday}, ${entry.monthDay}`}</span>
                    <span>{entry.address || 'No address in People'}</span>
                </div>
            ))}
        </div>
    );
};

const SundayRosterCard = ({ roster = [] }) => {
    if (!roster.length) return <div className="task-panel-empty">No roster data is available for this Sunday yet.</div>;
    return (
        <div className="task-dense-list task-dense-list-roster">
            {roster.map((service) => (
                <div key={service.time} className="task-dense-group">
                    <div className="task-dense-group-title"><strong>{service.rite || 'Service'}</strong><span>{service.time || ''}</span></div>
                    {service.roles.length > 0 ? service.roles.map((role) => <div key={`${service.time}-${role.roleKey}`} className="task-dense-row task-roster-row"><strong>{role.roleKey.replace(/_/g, ' ')}</strong><span>{role.people.join(', ')}</span></div>) : <div className="task-panel-empty compact">No one is assigned yet.</div>}
                </div>
            ))}
        </div>
    );
};

const EventPeopleList = ({ roleGroups = [], contactPerson = '' }) => {
    if (!roleGroups.length && !contactPerson) return <div className="task-panel-empty">No role or contact data is available for this event yet.</div>;
    return (
        <div className="task-dense-list task-dense-list-roster">
            {contactPerson ? <div className="task-dense-row task-event-contact-row"><strong>Primary contact</strong><span>{contactPerson}</span></div> : null}
            {roleGroups.map((group) => <div key={group.roleKey} className="task-dense-row task-roster-row"><strong>{group.roleKey.replace(/_/g, ' ')}</strong><span>{group.people.map((person) => person.displayName).join(', ') || '--'}</span></div>)}
        </div>
    );
};

const EventPackageEditor = ({ tasks = [], recurringCompletion = {}, onChange }) => (
    <div className="task-dense-list event-package-editor">
        <div className="task-dense-header task-event-package-row"><span>Task</span><span>Key</span><span>Due</span><span>Actions</span></div>
        {tasks.map((task) => (
            <div key={task.id} className="task-dense-row task-event-package-row">
                <input
                    type="text"
                    value={task.title || ''}
                    onChange={(event) => onChange(tasks.map((entry) => (
                        entry.id === task.id ? { ...entry, title: event.target.value } : entry
                    )))}
                    placeholder="Task title"
                />
                <select
                    value={task.list_key || 'setup'}
                    onChange={(event) => {
                        const nextKey = event.target.value;
                        const nextLabel = EVENT_PACKAGE_OPTIONS.find((option) => option.key === nextKey)?.label || nextKey;
                        onChange(tasks.map((entry) => (
                            entry.id === task.id ? { ...entry, list_key: nextKey, title: entry.title || nextLabel } : entry
                        )));
                    }}
                >
                    {EVENT_PACKAGE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <div className="task-event-package-due">
                    <input
                        type="number"
                        value={task.due_offset_days ?? ''}
                        onChange={(event) => onChange(tasks.map((entry) => (
                            entry.id === task.id ? { ...entry, due_offset_days: event.target.value } : entry
                        )))}
                    />
                    <span>{recurringCompletion?.[task.list_key] ? 'Future-complete' : 'days from event'}</span>
                </div>
                <div className="task-dense-actions">
                    <button type="button" className="btn-secondary btn-compact" onClick={() => onChange(tasks.filter((entry) => entry.id !== task.id))} title="Remove task"><FaTrash /></button>
                </div>
            </div>
        ))}
        <div className="task-dense-row task-event-package-addrow">
            <button type="button" className="btn-secondary btn-compact" onClick={() => onChange([...tasks, createEmptyPackageTask()])}><FaPlus /> Add package task</button>
        </div>
    </div>
);

const EventEditorPanel = ({
    panelData,
    selectedSectionKey,
    originRoute,
    details,
    draft,
    saving,
    saveError,
    packageEditorOpen,
    setPackageEditorOpen,
    onDraftChange,
    onSave,
    onPackageStatus
}) => {
    if (!details || !draft) {
        return <div className="task-panel-empty">Loading event details...</div>;
    }
    const selectedView = selectedSectionKey || panelData.selectedView || 'people';
    const isDocumentView = ['bulletin', 'bulletin8', 'bulletin10', 'insert', 'documents', 'contracts'].includes(selectedView);
    const isPeopleView = ['people', 'roles', 'clergy', 'music'].includes(selectedView);
    const currentListKey = String(selectedSectionKey || '').trim().toLowerCase();
    const canMarkFuture = currentListKey
        && (details.package?.futureOccurrenceCount || 0) > 1
        && draft.packageTasks.some((task) => task.list_key === currentListKey);
    const recurringEntry = details.package?.recurringCompletion?.[currentListKey] || null;

    return (
        <div className="task-panel-stack">
            <div className="task-data-card">
                <div className="task-panel-titlebar">
                    <h3>{draft.title || panelData.context?.title || 'Event'}</h3>
                    <div className="task-panel-title-actions">
                        <button type="button" className="btn-icon btn-icon-ghost task-mini-icon" onClick={() => setPackageEditorOpen((prev) => !prev)} title="Edit package">
                            <FaCog />
                        </button>
                        {originRoute ? <a href={originRoute}>Open Event Module</a> : null}
                    </div>
                </div>
                <div className="task-event-editor-grid">
                    <label className="task-event-field">
                        <span>Title</span>
                        <input type="text" value={draft.title} onChange={(event) => onDraftChange({ title: event.target.value })} />
                    </label>
                    <label className="task-event-field">
                        <span>Type</span>
                        <select value={draft.eventTypeId || ''} onChange={(event) => onDraftChange({ eventTypeId: event.target.value })}>
                            <option value="">Auto from tags</option>
                            {(details.lookups?.eventTypes || []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                        </select>
                    </label>
                    <label className="task-event-field">
                        <span>Location</span>
                        <select value={draft.buildingId || ''} onChange={(event) => onDraftChange({ buildingId: event.target.value })}>
                            <option value="">Auto from tags / none</option>
                            {(details.lookups?.buildings || []).map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                        </select>
                    </label>
                    <label className="task-event-field">
                        <span>Date</span>
                        <input type="text" value={formatDateOnly(details.occurrence?.date)} disabled />
                    </label>
                    <label className="task-event-field">
                        <span>Contact Person</span>
                        <input type="text" value={draft.contactPerson} onChange={(event) => onDraftChange({ contactPerson: event.target.value })} />
                    </label>
                    <label className="task-event-field">
                        <span>Contact Email</span>
                        <input type="email" value={draft.contactEmail} onChange={(event) => onDraftChange({ contactEmail: event.target.value })} />
                    </label>
                    <label className="task-event-field">
                        <span>Contact Phone</span>
                        <input type="text" value={draft.contactPhone} onChange={(event) => onDraftChange({ contactPhone: event.target.value })} />
                    </label>
                    <label className="task-event-field">
                        <span>Time</span>
                        <input type="text" value={[formatTimeOnly(details.occurrence?.start_time), formatTimeOnly(details.occurrence?.end_time)].filter(Boolean).join(' - ') || 'TBD'} disabled />
                    </label>
                    <label className="task-event-field task-event-field-wide">
                        <span>Description</span>
                        <textarea value={draft.description} onChange={(event) => onDraftChange({ description: event.target.value })} rows="3" />
                    </label>
                    <label className="task-event-field task-event-field-wide">
                        <span>Address / Notes for Contact</span>
                        <textarea value={draft.contactAddress} onChange={(event) => onDraftChange({ contactAddress: event.target.value })} rows="2" />
                    </label>
                    <label className="task-event-field task-event-field-wide">
                        <span>Internal Notes</span>
                        <textarea value={draft.internalNotes} onChange={(event) => onDraftChange({ internalNotes: event.target.value })} rows="2" />
                    </label>
                </div>
                {packageEditorOpen ? (
                    <div className="task-event-package-block">
                        <div className="task-panel-titlebar compact">
                            <h3>Package</h3>
                            <span className="task-data-note">Edit package tasks and due offsets.</span>
                        </div>
                        <EventPackageEditor
                            tasks={draft.packageTasks}
                            recurringCompletion={details.package?.recurringCompletion || {}}
                            onChange={(packageTasks) => onDraftChange({ packageTasks })}
                        />
                    </div>
                ) : null}
                <div className="task-event-editor-actions">
                    <button type="button" className="btn-primary btn-compact" onClick={onSave} disabled={saving}><FaSave /> {saving ? 'Saving...' : 'Save Event'}</button>
                    {canMarkFuture ? (
                        <>
                            <button type="button" className="btn-secondary btn-compact" onClick={() => onPackageStatus(currentListKey, recurringEntry ? 'reset_future' : 'complete_future')}>
                                {recurringEntry ? 'Reset Future' : 'Mark Future Complete'}
                            </button>
                            {recurringEntry ? <span className="task-data-note">{`Future occurrences complete since ${formatDateOnly(recurringEntry.fromDate)}`}</span> : null}
                        </>
                    ) : null}
                    {saveError ? <span className="task-save-error">{saveError}</span> : null}
                </div>
            </div>
            {isDocumentView ? <div className="task-data-card"><h3>Documents</h3><DenseDocumentList documents={panelData.documents || []} /></div> : null}
            {isPeopleView ? <div className="task-data-card"><h3>People &amp; Roles</h3><EventPeopleList roleGroups={panelData.roleGroups || []} contactPerson={draft.contactPerson || ''} /></div> : null}
            {!isDocumentView && !isPeopleView ? (
                <div className="task-data-card">
                    <h3>Event Logistics</h3>
                    <div className="task-dense-list">
                        <div className="task-dense-row task-metric-row"><strong><FaMapMarkerAlt /> Location</strong><span>{draft.buildingId || 'Not assigned'}</span></div>
                        <div className="task-dense-row task-metric-row"><strong>Occurrence</strong><span>{panelData.context?.occurrenceId || 'Unknown'}</span></div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const MailPackageTracker = ({ pkg }) => (
    <details className="mail-package-card dense">
        <summary className="mail-package-summary dense">
            <div className="mail-package-titleblock"><strong>{pkg.packageName || 'Package'}</strong><div className="mail-package-subline">{pkg.carrier ? <span>{pkg.carrier}</span> : null}{pkg.trackingNumberDisplay ? <span>{`Tracking ${pkg.trackingNumberDisplay}`}</span> : null}{!pkg.trackingNumberDisplay && pkg.orderNumber ? <span>{`Order ${pkg.orderNumber}`}</span> : null}</div></div>
            <span className={`mail-status-pill status-${pkg.latestStatus || 'ordered'}`}>{pkg.latestStatusLabel || 'Package update'}</span>
            <span>{formatDateTime(pkg.latestAt, 'Unknown')}</span>
            <span>{`${Array.isArray(pkg.updates) ? pkg.updates.length : 0} updates`}</span>
        </summary>
        <div className="mail-package-history">
            {Array.isArray(pkg.updates) ? pkg.updates.slice().reverse().map((update) => <div key={update.id} className="task-dense-row task-mail-update-row"><span className={`mail-status-pill status-${update.status || 'ordered'}`}>{update.statusLabel}</span><span>{formatDateTime(update.at, 'Unknown')}</span><span>{update.trackingNumber ? `Tracking ${update.trackingNumber}` : (update.orderNumber ? `Order ${update.orderNumber}` : '--')}</span></div>) : null}
        </div>
    </details>
);

const renderPanelContent = ({ panelData, selectedSectionKey, originRoute, eventEditorProps, ordersPanelProps }) => {
    if (!panelData || panelData.kind === 'empty') return <div className="task-panel-empty">Select a task section to see its data.</div>;
    if (panelData.kind === 'mail') {
        return <div className="task-panel-stack"><div className="task-data-card"><div className="task-panel-titlebar"><h3>Mail Status</h3><span className="task-data-note">Package tracking moved to Orders</span></div><div className="task-dense-list"><div className="task-dense-row task-metric-row"><strong>Last checked</strong><span>{formatDateTime(panelData.lastCheckedAt, 'Not checked yet')}</span></div><div className="task-dense-row task-metric-row"><strong>Task focus</strong><span>Mailbox processing only</span></div></div></div></div>;
    }
    if (panelData.kind === 'deposits') {
        return <div className="task-panel-stack"><div className="task-data-card"><div className="task-panel-titlebar"><h3>Bank Branch</h3><span className="task-data-note">{panelData.branch.statusLabel}</span></div><div className="task-dense-list"><div className="task-dense-row task-metric-row"><strong>Branch</strong><span>{panelData.branch.name}</span></div><div className="task-dense-row task-metric-row"><strong>Address</strong><span>{panelData.branch.address}</span></div><div className="task-dense-row task-metric-row"><strong>Traffic</strong><span>{panelData.branch.trafficLabel}</span></div></div><div className="task-panel-links"><a href={panelData.branch.directionsUrl} target="_blank" rel="noreferrer">Directions</a><a href={panelData.branch.sourceUrl} target="_blank" rel="noreferrer">Branch Details</a></div></div><div className="task-data-card"><h3>Deposit History</h3><DenseFileList files={panelData.history?.files || []} emptyLabel="No deposit files found." /></div></div>;
    }
    if (panelData.kind === 'receivables' || panelData.kind === 'payables') return <div className="task-data-card"><div className="task-panel-titlebar"><h3>{panelData.title} History</h3><span className="task-data-note">{panelData.history?.root || 'Folder unavailable'}</span></div><DenseFileList files={panelData.history?.files || []} emptyLabel="No files found in this folder." /></div>;
    if (panelData.kind === 'birthdays') return <div className="task-data-card"><div className="task-panel-titlebar"><h3>Upcoming Birthdays</h3><span className="task-data-note">{`${formatDateOnly(panelData.upcoming?.startDate)} to ${formatDateOnly(panelData.upcoming?.endDate)}`}</span></div><BirthdayPeopleList items={panelData.upcoming?.items || []} /></div>;
    if (panelData.kind === 'payroll') {
        return <div className="task-panel-stack"><div className="task-data-card"><div className="task-panel-titlebar"><h3>Pay Period</h3><span className="task-data-note">{panelData.period?.label || 'Current occurrence'}</span></div><div className="task-dense-list"><div className="task-dense-row task-metric-row"><strong>Period</strong><span>{`${formatDateOnly(panelData.period?.payPeriodStart)} to ${formatDateOnly(panelData.period?.payPeriodEnd)}`}</span></div>{panelData.period?.dueAt ? <div className="task-dense-row task-metric-row"><strong>Due</strong><span>{formatDateOnly(panelData.period.dueAt)}</span></div> : null}</div>{panelData.repoDocument?.path ? <div className="task-panel-links"><button type="button" className="btn-secondary btn-compact task-inline-action" onClick={() => openRemoteFile(panelData.repoDocument.path)}>Open Timesheet Doc</button><button type="button" className="btn-secondary btn-compact" onClick={() => openFileLocation(panelData.repoDocument.path)}><FaFolderOpen /></button></div> : null}</div><div className="task-data-card"><h3>Payroll Files</h3><DenseFileList files={panelData.history?.files || []} emptyLabel="No payroll files found." /></div></div>;
    }
    if (panelData.kind === 'sunday') {
        const documents = panelData.documents || {};
        const selectedView = selectedSectionKey || panelData.selectedView || 'bulletin10';
        const showRoster = ['roles', 'roster', 'clergy', 'music'].includes(selectedView);
        const selectedDocuments = showRoster ? [] : [selectedView === 'bulletin8' ? { ...documents.bulletin8, label: 'Rite I Bulletin' } : selectedView === 'insert' ? { ...documents.insert, label: 'Insert' } : { ...documents.bulletin10, label: 'Rite II Bulletin' }].filter((document) => document?.path || document?.preview);
        return <div className="task-panel-stack"><div className="task-data-card"><div className="task-panel-titlebar"><h3>{panelData.context?.name || 'Sunday'}</h3>{originRoute ? <a href={originRoute}>Open Sunday Planner</a> : null}</div><div className="task-dense-list"><div className="task-dense-row task-metric-row"><strong>Date</strong><span>{formatDateOnly(panelData.context?.date)}</span></div>{panelData.context?.readings ? <div className="task-dense-row task-metric-row"><strong>Readings</strong><span>{panelData.context.readings}</span></div> : null}</div></div>{showRoster ? <div className="task-data-card"><h3>Liturgical Roster</h3><SundayRosterCard roster={panelData.roster || []} /></div> : <div className="task-data-card"><h3>Document Preview</h3><DenseDocumentList documents={selectedDocuments} emptyLabel="No preview is available for this document yet." /></div>}</div>;
    }
    if (panelData.kind === 'event') {
        return <EventEditorPanel panelData={panelData} selectedSectionKey={selectedSectionKey} originRoute={originRoute} {...eventEditorProps} />;
    }
    if (panelData.kind === 'orders') {
        return <OrdersPanel panelData={panelData} {...ordersPanelProps} />;
    }
    return <div className="task-panel-empty">No panel renderer is available for this task.</div>;
};

const TodoDetailPanel = ({ selectedOrigin, selectedWorkPackage, selectedSection, selectedOriginTitle, selectedOriginSubtitle, selectedSectionKey, focusTask, setSelectedSectionKey, setSelectedTaskId, ensureTaskInProgress, markTaskDone, resetTaskState, getOriginColorClass, getOriginLink, refreshEvents, reloadTasks }) => {
    const [panelData, setPanelData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [panelRefreshTick, setPanelRefreshTick] = useState(0);
    const [eventDetails, setEventDetails] = useState(null);
    const [eventDraft, setEventDraft] = useState(null);
    const [eventDraftBaseline, setEventDraftBaseline] = useState('');
    const [eventSaving, setEventSaving] = useState(false);
    const [eventSaveError, setEventSaveError] = useState('');
    const [packageEditorOpen, setPackageEditorOpen] = useState(false);
    const originRoute = useMemo(() => (selectedOrigin ? getOriginLink(selectedOrigin) : APP_ROUTES.todo), [getOriginLink, selectedOrigin]);
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
                const response = await fetch(`${API_URL}/tasks/panel-data?${params.toString()}`, { signal: controller.signal });
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
        const shouldPoll = (selectedSection?.key || '') === 'orders';
        const timer = shouldPoll ? window.setInterval(loadPanel, 5 * 60 * 1000) : null;
        return () => {
            cancelled = true;
            controller.abort();
            if (timer) window.clearInterval(timer);
        };
    }, [focusTask?.id, panelRefreshTick, selectedOrigin, selectedSection?.key]);

    useEffect(() => {
        if (selectedOrigin?.origin_type !== 'event' || !selectedOrigin?.origin_id) {
            setEventDetails(null);
            setEventDraft(null);
            setEventDraftBaseline('');
            setEventSaveError('');
            setPackageEditorOpen(false);
            return undefined;
        }
        let cancelled = false;
        const controller = new AbortController();
        const loadEventEditor = async () => {
            try {
                const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}`, {
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Failed to load event details');
                const payload = await response.json();
                if (cancelled) return;
                const nextDraft = buildEventEditorDraft(payload);
                setEventDetails(payload);
                setEventDraft(nextDraft);
                setEventDraftBaseline(JSON.stringify(nextDraft));
                setEventSaveError('');
            } catch (loadError) {
                if (loadError?.name === 'AbortError' || cancelled) return;
                console.error('Failed to load todo event editor:', loadError);
                setEventDetails(null);
                setEventDraft(null);
            }
        };
        loadEventEditor();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [panelRefreshTick, selectedOrigin?.origin_id, selectedOrigin?.origin_type]);

    const handleEventDraftChange = (patch) => {
        setEventDraft((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    const eventDraftDirty = useMemo(() => (
        eventDraft && eventDraftBaseline && JSON.stringify(eventDraft) !== eventDraftBaseline
    ), [eventDraft, eventDraftBaseline]);

    useEffect(() => {
        if (!focusTask?.id || !panelData?.autoProgress || loading || error) return;
        if (getTaskCycleState(focusTask) === 'done') return;
        ensureTaskInProgress(focusTask);
    }, [ensureTaskInProgress, error, focusTask, loading, panelData]);

    useEffect(() => {
        if (!focusTask?.id || !eventDraftDirty || selectedOrigin?.origin_type !== 'event') return;
        ensureTaskInProgress(focusTask);
    }, [ensureTaskInProgress, eventDraftDirty, focusTask, selectedOrigin?.origin_type]);

    const handleSaveEvent = async () => {
        if (!selectedOrigin?.origin_id || !eventDraft) return;
        setEventSaving(true);
        setEventSaveError('');
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: eventDraft.title,
                    description: eventDraft.description,
                    event_type_id: eventDraft.eventTypeId ? Number(eventDraft.eventTypeId) : null,
                    building_id: eventDraft.buildingId || '',
                    contact_person: eventDraft.contactPerson,
                    contact_email: eventDraft.contactEmail,
                    contact_phone: eventDraft.contactPhone,
                    contact_address: eventDraft.contactAddress,
                    internal_notes: eventDraft.internalNotes,
                    package_tasks: eventDraft.packageTasks.map((task, index) => ({
                        ...task,
                        sort_order: index
                    }))
                })
            });
            if (!response.ok) throw new Error('Failed to save event');
            await response.json();
            await Promise.allSettled([
                typeof reloadTasks === 'function' ? reloadTasks() : Promise.resolve(),
                typeof refreshEvents === 'function' ? refreshEvents() : Promise.resolve()
            ]);
            setPanelRefreshTick((prev) => prev + 1);
        } catch (saveError) {
            console.error('Failed to save event from todo panel:', saveError);
            setEventSaveError('Unable to save event changes.');
        } finally {
            setEventSaving(false);
        }
    };

    const handlePackageStatus = async (listKey, action) => {
        if (!selectedOrigin?.origin_id || !listKey) return;
        try {
            const response = await fetch(`${API_URL}/event-occurrences/${encodeURIComponent(selectedOrigin.origin_id)}/package-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    list_key: listKey,
                    action
                })
            });
            if (!response.ok) throw new Error('Failed to update future package status');
            await Promise.allSettled([
                typeof reloadTasks === 'function' ? reloadTasks() : Promise.resolve(),
                typeof refreshEvents === 'function' ? refreshEvents() : Promise.resolve()
            ]);
            setPanelRefreshTick((prev) => prev + 1);
        } catch (statusError) {
            console.error('Failed to update future package status:', statusError);
            setEventSaveError('Unable to update future package status.');
        }
    };

    return (
        <Card className={`tasks-detail-card ${selectedOrigin ? getOriginColorClass(selectedOrigin.origin_type) : ''}`}>
            <div className="tasks-list-header task-detail-header">
                <div>
                    <div className="task-detail-header-title">
                        <h2>{selectedOrigin ? selectedOriginTitle : 'Task Data'}</h2>
                        {selectedOrigin && originRoute ? <a className="btn-icon btn-icon-ghost origin-open-link" href={originRoute} aria-label="Open module" title="Open module"><FaExternalLinkAlt /></a> : null}
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
                                <button
                                    key={section.key}
                                    type="button"
                                    className={`focus-section-tab focus-section-tab-button attention-${section.attention} ${isActive ? 'is-active' : ''}`}
                                    onClick={() => {
                                        setSelectedSectionKey(section.key);
                                        setSelectedTaskId(activeTask?.id || '');
                                    }}
                                    title={activeTask ? `${section.title}: ${getTaskCycleLabel(activeTask)}` : section.title}
                                >
                                    <span className={`focus-section-tab-icon state-${section.status}`}>
                                        <Icon />
                                        {section.dueIndicator ? <span className={`section-due-chip is-${section.dueIndicator}`}>{section.dueIndicator === 'overdue' ? '!' : ''}</span> : null}
                                        {chipText ? <span className={`section-state-chip status-${chipState}`}>{chipText}</span> : null}
                                    </span>
                                    <span className="focus-section-tab-copy"><strong>{section.title}</strong></span>
                                </button>
                            );
                        })}
                    </div>
                    {focusTask ? <div className="task-panel-commandbar"><div className="task-panel-commandcopy"><strong>{selectedSection?.title || focusTask?.list_title || focusTask?.text || 'Task'}</strong><span>{getTaskCycleLabel(focusTask)}</span></div><div className="task-panel-commandactions"><button type="button" className={`btn-compact task-panel-complete-btn ${getTaskCycleState(focusTask) === 'done' ? 'is-done' : 'is-open'}`} onClick={() => markTaskDone(focusTask)} disabled={getTaskCycleState(focusTask) === 'done'}>{getTaskCycleState(focusTask) === 'done' ? <FaCheck /> : null}{getTaskCycleState(focusTask) === 'done' ? 'Completed' : 'Mark Complete'}</button><button type="button" className="btn-secondary btn-compact" onClick={() => resetTaskState(focusTask)} title="Reset task status"><FaRedoAlt /></button></div></div> : null}
                    {loading ? <div className="task-panel-empty">Loading task data...</div> : null}
                    {error && !loading ? <div className="task-panel-empty">{error}</div> : null}
                    {!loading && !error ? renderPanelContent({
                        panelData,
                        selectedSectionKey,
                        originRoute,
                        eventEditorProps: {
                            details: eventDetails,
                            draft: eventDraft,
                            saving: eventSaving,
                            saveError: eventSaveError,
                            packageEditorOpen,
                            setPackageEditorOpen,
                            onDraftChange: handleEventDraftChange,
                            onSave: handleSaveEvent,
                            onPackageStatus: handlePackageStatus
                        },
                        ordersPanelProps: {
                            onRefresh: () => setPanelRefreshTick((prev) => prev + 1),
                            onActivity: () => {
                                if (focusTask) ensureTaskInProgress(focusTask);
                            }
                        }
                    }) : null}
                </div>
            ) : null}
        </Card>
    );
};

export default TodoDetailPanel;
