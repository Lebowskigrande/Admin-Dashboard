import { useState } from 'react';
import { FaExternalLinkAlt, FaRedoAlt, FaSave } from 'react-icons/fa';

import { API_URL } from '../../services/apiConfig';

const formatDate = (value, fallback = 'No date') => {
    if (!value) return fallback;
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTime = (value, fallback = 'Unknown') => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const emptyDraft = () => ({
    title: '',
    requested_by: '',
    needed_by: '',
    order_url: '',
    status: 'needed',
    notes: ''
});

const parseError = async (response) => {
    try {
        const payload = await response.json();
        return String(payload?.error || '');
    } catch {
        return '';
    }
};

const SummaryMetric = ({ label, value, tone = 'default' }) => (
    <div className={`orders-metric-card tone-${tone}`}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

const StatusPill = ({ value }) => (
    <span className={`orders-status-pill status-${value || 'default'}`}>
        {String(value || '').replace(/_/g, ' ') || 'Unknown'}
    </span>
);

const OrderRequestForm = ({ draft, setDraft, submitLabel, busy, onSubmit, onCancel = null, showStatus = false, options = [] }) => (
    <form className="orders-simple-form" onSubmit={onSubmit}>
        <label>
            <span>Product</span>
            <input type="text" value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Printer toner, Paschal candle oil, folding tables..." />
        </label>
        <label>
            <span>Requested By</span>
            <input type="text" value={draft.requested_by} onChange={(event) => setDraft((prev) => ({ ...prev, requested_by: event.target.value }))} placeholder="Who needs it" />
        </label>
        <label>
            <span>Date</span>
            <input type="date" value={draft.needed_by} onChange={(event) => setDraft((prev) => ({ ...prev, needed_by: event.target.value }))} />
        </label>
        <label>
            <span>Product Link</span>
            <input type="url" value={draft.order_url} onChange={(event) => setDraft((prev) => ({ ...prev, order_url: event.target.value }))} placeholder="Optional product page" />
        </label>
        {showStatus ? (
            <label>
                <span>Status</span>
                <select value={draft.status} onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </label>
        ) : null}
        {showStatus ? (
            <label className="orders-simple-form-span-2">
                <span>Notes</span>
                <textarea rows="2" value={draft.notes} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Optional follow-up note" />
            </label>
        ) : null}
        <div className={`orders-form-actions ${showStatus ? 'orders-simple-form-span-2' : ''}`}>
            <button type="submit" className="btn-primary btn-compact" disabled={busy}><FaSave /> {busy ? 'Saving...' : submitLabel}</button>
            {onCancel ? <button type="button" className="btn-secondary btn-compact" onClick={onCancel}><FaRedoAlt /> Cancel</button> : null}
        </div>
    </form>
);

const ManualOrderCard = ({ entry, editing, onEdit, children }) => {
    const item = entry.item;
    const tracking = entry.tracking;
    return (
        <div className="orders-record-card">
            <div className="orders-record-head">
                <div>
                    <strong>{item.title}</strong>
                    <div className="orders-record-meta">
                        <span>{item.requested_by || 'Requester not set'}</span>
                        <span>{formatDate(item.needed_by)}</span>
                        {tracking ? <span>{`Matched from ${tracking.carrier || 'email'}`}</span> : null}
                    </div>
                </div>
                <div className="orders-record-actions">
                    <StatusPill value={tracking?.latestStatus || item.status} />
                    <button type="button" className="btn-secondary btn-compact" onClick={onEdit}>{editing ? 'Close' : 'Edit'}</button>
                </div>
            </div>
            <div className="orders-record-grid">
                <div><span>Requested By</span><strong>{item.requested_by || '--'}</strong></div>
                <div><span>Date</span><strong>{formatDate(item.needed_by, '--')}</strong></div>
                <div><span>Tracking</span><strong>{tracking?.latestStatusLabel || 'Not matched yet'}</strong></div>
                <div><span>Last Update</span><strong>{tracking ? formatDateTime(tracking.latestAt, '--') : '--'}</strong></div>
            </div>
            {item.order_url ? <a className="orders-record-link" href={item.order_url} target="_blank" rel="noreferrer">Open product page <FaExternalLinkAlt /></a> : null}
            {item.notes ? <p className="orders-record-note">{item.notes}</p> : null}
            {tracking ? <EmailTimeline tracking={tracking} compact /> : null}
            {editing ? children : null}
        </div>
    );
};

const EmailTimeline = ({ tracking, compact = false }) => (
    <details className={`mail-package-card dense ${compact ? 'orders-mail-card' : ''}`}>
        <summary className="mail-package-summary dense">
            <div className="mail-package-titleblock">
                <strong>{tracking.packageName || 'Order update'}</strong>
                <div className="mail-package-subline">
                    {tracking.carrier ? <span>{tracking.carrier}</span> : null}
                    {tracking.trackingNumberDisplay ? <span>{`Tracking ${tracking.trackingNumberDisplay}`}</span> : null}
                    {!tracking.trackingNumberDisplay && tracking.orderNumber ? <span>{`Order ${tracking.orderNumber}`}</span> : null}
                </div>
            </div>
            <StatusPill value={tracking.latestStatus} />
            <span>{formatDateTime(tracking.latestAt, 'Unknown')}</span>
            <span>{`${Array.isArray(tracking.updates) ? tracking.updates.length : 0} updates`}</span>
        </summary>
        <div className="mail-package-history">
            {Array.isArray(tracking.updates)
                ? tracking.updates.slice().reverse().map((update) => (
                    <div key={update.id} className="task-dense-row task-mail-update-row">
                        <StatusPill value={update.status} />
                        <span>{formatDateTime(update.at, 'Unknown')}</span>
                        <span>{update.trackingNumber ? `Tracking ${update.trackingNumber}` : (update.orderNumber ? `Order ${update.orderNumber}` : '--')}</span>
                    </div>
                ))
                : null}
        </div>
    </details>
);

const EmailOnlyCard = ({ entry }) => {
    const tracking = entry.tracking;
    return (
        <div className="orders-record-card emphasis-delivery">
            <div className="orders-record-head">
                <div>
                    <strong>{tracking.packageName || 'Order update'}</strong>
                    <div className="orders-record-meta">
                        <span>{tracking.carrier || 'Email tracked order'}</span>
                        {tracking.orderNumber ? <span>{`Order ${tracking.orderNumber}`}</span> : null}
                        {tracking.trackingNumberDisplay ? <span>{`Tracking ${tracking.trackingNumberDisplay}`}</span> : null}
                    </div>
                </div>
                <div className="orders-record-actions">
                    <StatusPill value={tracking.latestStatus} />
                </div>
            </div>
            <div className="orders-record-grid">
                <div><span>Source</span><strong>Email-discovered</strong></div>
                <div><span>Status</span><strong>{tracking.latestStatusLabel || tracking.latestStatus}</strong></div>
                <div><span>Last Update</span><strong>{formatDateTime(tracking.latestAt, '--')}</strong></div>
                <div><span>Linked Record</span><strong>No manual order matched</strong></div>
            </div>
            <EmailTimeline tracking={tracking} compact />
        </div>
    );
};

const OrdersSection = ({ title, note, entries, renderEntry, emptyLabel }) => (
    <div className="task-data-card">
        <div className="task-panel-titlebar compact">
            <h3>{title}</h3>
            <span className="task-data-note">{note}</span>
        </div>
        <div className="orders-record-list">
            {!entries.length ? <div className="task-panel-empty compact">{emptyLabel}</div> : null}
            {entries.map(renderEntry)}
        </div>
    </div>
);

const OrdersPanel = ({ panelData, onRefresh, onActivity }) => {
    const [draft, setDraft] = useState(emptyDraft);
    const [editingId, setEditingId] = useState('');
    const [editingDraft, setEditingDraft] = useState(null);
    const [busyKey, setBusyKey] = useState('');
    const [error, setError] = useState('');

    const itemStatusOptions = panelData?.options?.itemStatuses || [];

    const submit = async ({ path, method, body, success }) => {
        setBusyKey(success);
        setError('');
        try {
            const response = await fetch(`${API_URL}${path}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) throw new Error(await parseError(response) || 'Request failed');
            if (typeof onActivity === 'function') onActivity();
            if (typeof onRefresh === 'function') onRefresh();
            return true;
        } catch (submitError) {
            console.error('Orders panel request failed:', submitError);
            setError(String(submitError?.message || 'Unable to save order.'));
            return false;
        } finally {
            setBusyKey('');
        }
    };

    const handleCreate = async (event) => {
        event.preventDefault();
        const ok = await submit({
            path: '/orders/items',
            method: 'POST',
            body: draft,
            success: 'create'
        });
        if (ok) setDraft(emptyDraft());
    };

    const handleUpdate = async (event) => {
        event.preventDefault();
        if (!editingId || !editingDraft) return;
        const ok = await submit({
            path: `/orders/items/${encodeURIComponent(editingId)}`,
            method: 'PUT',
            body: editingDraft,
            success: `edit:${editingId}`
        });
        if (ok) {
            setEditingId('');
            setEditingDraft(null);
        }
    };

    const openEditor = (entry) => {
        const item = entry.item;
        if (editingId === item.id) {
            setEditingId('');
            setEditingDraft(null);
            return;
        }
        setEditingId(item.id);
        setEditingDraft({
            title: item.title || '',
            requested_by: item.requested_by || '',
            needed_by: item.needed_by || '',
            order_url: item.order_url || '',
            status: item.status || 'needed',
            notes: item.notes || ''
        });
    };

    return (
        <div className="task-panel-stack orders-panel-stack">
            <div className="task-data-card">
                <div className="task-panel-titlebar">
                    <h3>Orders</h3>
                    <span className="task-data-note">Manual order requests plus email-discovered confirmations, shipments, and deliveries.</span>
                </div>
                <div className="orders-metric-grid">
                    <SummaryMetric label="Need to Order" value={panelData?.summary?.requested || 0} tone="backlog" />
                    <SummaryMetric label="Orders" value={panelData?.summary?.orders || 0} tone="ordered" />
                    <SummaryMetric label="Deliveries" value={panelData?.summary?.deliveries || 0} tone="incoming" />
                    <SummaryMetric label="Returns" value={panelData?.summary?.returns || 0} tone="returns" />
                </div>
                <div className="orders-toolbar-note">
                    <strong>{panelData?.trackingConnected ? (panelData.mailbox || 'Office mailbox connected') : 'Mailbox unavailable'}</strong>
                    <span>{panelData?.refreshedAt ? `Last polled ${formatDateTime(panelData.refreshedAt)}` : 'No mailbox refresh yet.'}</span>
                    {panelData?.trackingNote ? <span>{panelData.trackingNote}</span> : null}
                </div>
                {error ? <div className="task-panel-empty compact orders-error">{error}</div> : null}
            </div>

            <div className="task-data-card">
                <div className="task-panel-titlebar compact">
                    <h3>New Order Request</h3>
                    <span className="task-data-note">Keep intake minimal. Email matching will pick up the order lifecycle if a confirmation arrives later.</span>
                </div>
                <OrderRequestForm
                    draft={draft}
                    setDraft={setDraft}
                    submitLabel="Add Request"
                    busy={busyKey === 'create'}
                    onSubmit={handleCreate}
                />
            </div>

            <div className="orders-section-grid">
                <OrdersSection
                    title="Need to Order"
                    note={`${panelData?.sections?.requests?.length || 0} open requests`}
                    entries={panelData?.sections?.requests || []}
                    emptyLabel="No open order requests."
                    renderEntry={(entry) => (
                        <ManualOrderCard key={entry.id} entry={entry} editing={editingId === entry.item.id} onEdit={() => openEditor(entry)}>
                            <OrderRequestForm
                                draft={editingDraft}
                                setDraft={setEditingDraft}
                                submitLabel="Save Request"
                                busy={busyKey === `edit:${entry.item.id}`}
                                onSubmit={handleUpdate}
                                onCancel={() => {
                                    setEditingId('');
                                    setEditingDraft(null);
                                }}
                                showStatus
                                options={itemStatusOptions}
                            />
                        </ManualOrderCard>
                    )}
                />

                <OrdersSection
                    title="Orders"
                    note="Confirmed orders from email, plus manual items already marked as ordered."
                    entries={panelData?.sections?.orders || []}
                    emptyLabel="No active orders being tracked."
                    renderEntry={(entry) => (
                        entry.source === 'manual'
                            ? (
                                <ManualOrderCard key={entry.id} entry={entry} editing={editingId === entry.item.id} onEdit={() => openEditor(entry)}>
                                    <OrderRequestForm
                                        draft={editingDraft}
                                        setDraft={setEditingDraft}
                                        submitLabel="Save Request"
                                        busy={busyKey === `edit:${entry.item.id}`}
                                        onSubmit={handleUpdate}
                                        onCancel={() => {
                                            setEditingId('');
                                            setEditingDraft(null);
                                        }}
                                        showStatus
                                        options={itemStatusOptions}
                                    />
                                </ManualOrderCard>
                            )
                            : <EmailOnlyCard key={entry.id} entry={entry} />
                    )}
                />

                <OrdersSection
                    title="Deliveries"
                    note="Shipments and delivered packages now live here instead of the Mail task."
                    entries={panelData?.sections?.deliveries || []}
                    emptyLabel="No delivery activity is being tracked."
                    renderEntry={(entry) => (
                        entry.source === 'manual'
                            ? (
                                <ManualOrderCard key={entry.id} entry={entry} editing={editingId === entry.item.id} onEdit={() => openEditor(entry)}>
                                    <OrderRequestForm
                                        draft={editingDraft}
                                        setDraft={setEditingDraft}
                                        submitLabel="Save Request"
                                        busy={busyKey === `edit:${entry.item.id}`}
                                        onSubmit={handleUpdate}
                                        onCancel={() => {
                                            setEditingId('');
                                            setEditingDraft(null);
                                        }}
                                        showStatus
                                        options={itemStatusOptions}
                                    />
                                </ManualOrderCard>
                            )
                            : <EmailOnlyCard key={entry.id} entry={entry} />
                    )}
                />

                <OrdersSection
                    title="Returns"
                    note="Manual follow-up for anything going back or waiting on a refund."
                    entries={panelData?.sections?.returns || []}
                    emptyLabel="No active returns."
                    renderEntry={(entry) => (
                        <ManualOrderCard key={entry.id} entry={entry} editing={editingId === entry.item.id} onEdit={() => openEditor(entry)}>
                            <OrderRequestForm
                                draft={editingDraft}
                                setDraft={setEditingDraft}
                                submitLabel="Save Request"
                                busy={busyKey === `edit:${entry.item.id}`}
                                onSubmit={handleUpdate}
                                onCancel={() => {
                                    setEditingId('');
                                    setEditingDraft(null);
                                }}
                                showStatus
                                options={itemStatusOptions}
                            />
                        </ManualOrderCard>
                    )}
                />
            </div>
        </div>
    );
};

export default OrdersPanel;
