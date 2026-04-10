import { useMemo, useState } from 'react';
import { FaClipboardCheck, FaEdit, FaPlus, FaTrash } from 'react-icons/fa';
import Card from '../../components/Card';
import {
    TICKET_FOCUS_OPTIONS,
    TICKET_STATUS_OPTIONS,
    getTicketCategoryLabel,
    getTicketDueMeta,
    getTicketPriorityLabel,
    getTicketStatusLabel,
    isTicketClosedStatus,
    matchesTicketFocus,
    sortTicketsForQueue,
    summarizeTickets
} from '../../../shared/tickets.js';

const BuildingsTickets = ({
    tickets,
    ticketsLoading,
    ticketsError,
    ticketFocus,
    selectedTicketId,
    selectedTicket,
    archiveExpanded,
    ticketsViewRef,
    areaById,
    vendors,
    newNote,
    newTaskText,
    setNewNote,
    setNewTaskText,
    setActiveTab,
    setSelectedTicketId,
    setArchiveExpanded,
    setTicketFocus,
    openTicketModal,
    updateTicket,
    addTicketTask,
    toggleTicketTask,
    deleteTicketTask,
    addTicketNote
}) => {
    const [ticketSearch, setTicketSearch] = useState('');
    const summary = useMemo(() => summarizeTickets(tickets), [tickets]);
    const vendorById = useMemo(() => (
        vendors.reduce((acc, vendor) => {
            acc[vendor.id] = vendor;
            return acc;
        }, {})
    ), [vendors]);

    const activeTickets = useMemo(() => {
        const query = ticketSearch.trim().toLowerCase();
        return sortTicketsForQueue(
            tickets.filter((ticket) => {
                if (isTicketClosedStatus(ticket.status)) return false;
                if (!matchesTicketFocus(ticket, ticketFocus)) return false;
                if (!query) return true;

                const searchIndex = [
                    ticket.title,
                    ticket.description,
                    getTicketStatusLabel(ticket.status),
                    getTicketPriorityLabel(ticket.priority),
                    getTicketCategoryLabel(ticket.category),
                    ticket.requested_by,
                    ticket.assigned_to,
                    vendorById[ticket.vendor_id]?.vendor,
                    ...(ticket.areas || []).map((areaId) => areaById[areaId]?.name || areaId)
                ]
                    .map((value) => String(value || '').toLowerCase())
                    .join(' ');

                return searchIndex.includes(query);
            })
        );
    }, [areaById, ticketFocus, ticketSearch, tickets, vendorById]);

    const archivedTickets = useMemo(() => (
        sortTicketsForQueue(tickets.filter((ticket) => isTicketClosedStatus(ticket.status)))
    ), [tickets]);

    const focusCountByKey = {
        active: summary.active,
        triage: summary.triage,
        blocked: summary.blocked,
        urgent: summary.urgent,
        due_soon: summary.due_soon,
        no_vendor: summary.no_vendor
    };

    const renderTicketStatusControl = (ticket) => (
        <div className="ticket-status-control" role="group" aria-label={`Update status for ${ticket.title}`}>
            {TICKET_STATUS_OPTIONS.map((option) => {
                const isActive = option.value === ticket.status;
                return (
                    <button
                        key={option.value}
                        type="button"
                        className={`ticket-status-control-btn ${isActive ? 'active' : ''} status-${option.value}`}
                        onClick={() => {
                            if (!isActive) {
                                updateTicket(ticket.id, { status: option.value });
                            }
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="tickets-view" ref={ticketsViewRef}>
            <div className="tickets-header">
                <div>
                    <h2>Facilities Ticket Studio</h2>
                    <p>Intake, triage, vendor routing, and follow-through in the same Buildings workspace.</p>
                </div>
                <button className="btn-primary" type="button" onClick={() => openTicketModal()}>
                    <FaPlus /> Open New Ticket
                </button>
            </div>

            <div className="ticket-summary-strip" aria-label="Ticket summary">
                <Card className="ticket-summary-card tone-active">
                    <span>Active</span>
                    <strong>{summary.active}</strong>
                    <p>Open facilities issues still in play.</p>
                </Card>
                <Card className="ticket-summary-card tone-risk">
                    <span>Blocked</span>
                    <strong>{summary.blocked}</strong>
                    <p>Waiting on dependency, approval, or outside party.</p>
                </Card>
                <Card className="ticket-summary-card tone-alert">
                    <span>Urgent</span>
                    <strong>{summary.urgent}</strong>
                    <p>High or critical priority tickets needing closer watch.</p>
                </Card>
                <Card className="ticket-summary-card tone-muted">
                    <span>No Vendor</span>
                    <strong>{summary.no_vendor}</strong>
                    <p>Active tickets without a preferred vendor assigned yet.</p>
                </Card>
            </div>

            {ticketsError && <div className="ticket-error">{ticketsError}</div>}

            <div className="tickets-layout tickets-layout--studio">
                <Card className="ticket-focus-rail">
                    <div className="ticket-panel-header">
                        <div>
                            <h3>Focus Views</h3>
                            <p>Real operational slices instead of one undifferentiated queue.</p>
                        </div>
                    </div>
                    <div className="ticket-focus-list">
                        {TICKET_FOCUS_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                className={`ticket-focus-item ${ticketFocus === option.value ? 'active' : ''}`}
                                onClick={() => setTicketFocus(option.value)}
                            >
                                <span>{option.label}</span>
                                <strong>{focusCountByKey[option.value] || 0}</strong>
                            </button>
                        ))}
                    </div>
                    <div className="ticket-rail-note">
                        <span>Design rule</span>
                        <strong>Facilities risk should surface by urgency, deadline, and vendor readiness.</strong>
                        <p>The queue is filtered around those three signals so the dashboard and Buildings page tell the same story.</p>
                    </div>
                </Card>

                <Card className="tickets-list">
                    <div className="ticket-panel-header">
                        <div>
                            <h3>Queue</h3>
                            <p>{activeTickets.length} ticket{activeTickets.length === 1 ? '' : 's'} in the current slice.</p>
                        </div>
                    </div>
                    <div className="ticket-queue-toolbar">
                        <input
                            type="search"
                            value={ticketSearch}
                            onChange={(event) => setTicketSearch(event.target.value)}
                            placeholder="Search title, area, vendor, owner, or category"
                        />
                    </div>
                    {ticketsLoading && <p className="empty-state">Loading tickets...</p>}
                    {!ticketsLoading && activeTickets.length === 0 && (
                        <div className="ticket-empty-stack">
                            <strong>No tickets in this slice.</strong>
                            <span>Try another focus view or open a new facilities ticket.</span>
                        </div>
                    )}
                    {!ticketsLoading && activeTickets.map((ticket) => {
                        const due = getTicketDueMeta(ticket);
                        const vendor = vendorById[ticket.vendor_id];
                        return (
                            <button
                                key={ticket.id}
                                type="button"
                                className={`ticket-row ${ticket.id === selectedTicketId ? 'active' : ''}`}
                                onClick={() => setSelectedTicketId(ticket.id)}
                            >
                                <div className="ticket-row-header">
                                    <h4>{ticket.title}</h4>
                                    <span className={`ticket-status status-${ticket.status}`}>{getTicketStatusLabel(ticket.status)}</span>
                                </div>
                                <p>{ticket.description || 'No description yet.'}</p>
                                <div className="ticket-meta-row">
                                    <span className={`ticket-priority priority-${ticket.priority}`}>{getTicketPriorityLabel(ticket.priority)}</span>
                                    <span className="ticket-meta-chip">{getTicketCategoryLabel(ticket.category)}</span>
                                    <span className={`ticket-meta-chip due-${due.key}`}>{due.label}</span>
                                </div>
                                <div className="ticket-meta-row">
                                    <span className="ticket-meta-inline">
                                        Owner: {ticket.assigned_to || 'Unassigned'}
                                    </span>
                                    <span className="ticket-meta-inline">
                                        Vendor: {vendor?.vendor || 'Not assigned'}
                                    </span>
                                </div>
                                <div className="ticket-area-chips">
                                    {(ticket.areas || []).map((areaId) => (
                                        <span key={areaId} className="ticket-area-chip">
                                            {areaById[areaId]?.name || areaId}
                                        </span>
                                    ))}
                                </div>
                            </button>
                        );
                    })}
                </Card>

                <Card className="ticket-detail allow-overflow">
                    {!selectedTicket && <p className="empty-state">Select a ticket to inspect the full operational detail.</p>}
                    {selectedTicket && (
                        <>
                            <div className="ticket-detail-header">
                                <div>
                                    <h3>{selectedTicket.title}</h3>
                                    {selectedTicket.description ? <p>{selectedTicket.description}</p> : null}
                                </div>
                                <div className="ticket-detail-actions">
                                    <button type="button" className="btn-secondary" onClick={() => openTicketModal(selectedTicket)}>
                                        <FaEdit /> Edit Intake
                                    </button>
                                    <button type="button" className="btn-secondary" onClick={() => setActiveTab('vendors')}>
                                        Open Vendors
                                    </button>
                                </div>
                            </div>

                            {renderTicketStatusControl(selectedTicket)}

                            <div className="ticket-detail-grid">
                                <div className="ticket-detail-card">
                                    <span>Priority</span>
                                    <strong>{getTicketPriorityLabel(selectedTicket.priority)}</strong>
                                </div>
                                <div className="ticket-detail-card">
                                    <span>Category</span>
                                    <strong>{getTicketCategoryLabel(selectedTicket.category)}</strong>
                                </div>
                                <div className="ticket-detail-card">
                                    <span>Target</span>
                                    <strong>{getTicketDueMeta(selectedTicket).label}</strong>
                                </div>
                                <div className="ticket-detail-card">
                                    <span>Vendor</span>
                                    <strong>{vendorById[selectedTicket.vendor_id]?.vendor || 'Not assigned'}</strong>
                                </div>
                                <div className="ticket-detail-card">
                                    <span>Requested By</span>
                                    <strong>{selectedTicket.requested_by || 'Not captured'}</strong>
                                </div>
                                <div className="ticket-detail-card">
                                    <span>Assigned To</span>
                                    <strong>{selectedTicket.assigned_to || 'Unassigned'}</strong>
                                </div>
                            </div>

                            <div className="ticket-section">
                                <h4>Areas</h4>
                                <div className="ticket-area-chips">
                                    {(selectedTicket.areas || []).length > 0 ? (selectedTicket.areas || []).map((areaId) => (
                                        <span key={areaId} className="ticket-area-chip">
                                            {areaById[areaId]?.name || areaId}
                                        </span>
                                    )) : (
                                        <span className="ticket-inline-hint">No campus area linked yet.</span>
                                    )}
                                </div>
                            </div>

                            <div className="ticket-section" id="ticket-tasks">
                                <h4>Tasks</h4>
                                <div className="ticket-task-form">
                                    <input
                                        type="text"
                                        placeholder="Add task linked to this ticket..."
                                        value={newTaskText}
                                        onChange={(event) => setNewTaskText(event.target.value)}
                                    />
                                    <button type="button" className="btn-secondary" onClick={() => addTicketTask(selectedTicket.id)}>
                                        Add Task
                                    </button>
                                </div>
                                <ul className="ticket-task-list">
                                    {(() => {
                                        const allTasks = selectedTicket.tasks || [];
                                        if (allTasks.length === 0) {
                                            return <li className="empty-state">No tasks added.</li>;
                                        }
                                        const openTasks = allTasks.filter((task) => !task.completed);
                                        const completedTasks = allTasks
                                            .filter((task) => task.completed)
                                            .sort((a, b) => {
                                                const aRaw = new Date(a.completed_at || a.created_at || 0).getTime();
                                                const bRaw = new Date(b.completed_at || b.created_at || 0).getTime();
                                                return (Number.isNaN(bRaw) ? 0 : bRaw) - (Number.isNaN(aRaw) ? 0 : aRaw);
                                            });
                                        return [...openTasks, ...completedTasks].map((task) => (
                                            <li key={task.id} className={`ticket-task ${task.completed ? 'completed' : ''}`}>
                                                <button
                                                    type="button"
                                                    className="task-toggle"
                                                    onClick={() => toggleTicketTask(task)}
                                                >
                                                    {task.completed ? <FaClipboardCheck /> : <span />}
                                                </button>
                                                <span>{task.text}</span>
                                                {task.completed && task.completed_at ? (
                                                    <em className="task-completed-at">
                                                        Completed {new Date(task.completed_at).toLocaleString()}
                                                    </em>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="btn-delete"
                                                    onClick={() => deleteTicketTask(task)}
                                                >
                                                    <FaTrash />
                                                </button>
                                            </li>
                                        ));
                                    })()}
                                </ul>
                            </div>

                            <div className="ticket-section">
                                <h4>Notes</h4>
                                <div className="ticket-note-form">
                                    <textarea
                                        rows="2"
                                        placeholder="Add note with status updates or details..."
                                        value={newNote}
                                        onChange={(event) => setNewNote(event.target.value)}
                                    />
                                    <button type="button" className="btn-secondary" onClick={() => addTicketNote(selectedTicket)}>
                                        Add Note
                                    </button>
                                </div>
                                <ul className="ticket-note-list">
                                    {(selectedTicket.notes || []).length === 0 && (
                                        <li className="empty-state">No notes yet.</li>
                                    )}
                                    {[...(selectedTicket.notes || [])]
                                        .sort((a, b) => {
                                            const aRaw = new Date(a.created_at || 0).getTime();
                                            const bRaw = new Date(b.created_at || 0).getTime();
                                            return (Number.isNaN(bRaw) ? 0 : bRaw) - (Number.isNaN(aRaw) ? 0 : aRaw);
                                        })
                                        .map((note) => (
                                            <li key={note.id}>
                                                <span>{note.text}</span>
                                                <em>{new Date(note.created_at).toLocaleString()}</em>
                                            </li>
                                        ))}
                                </ul>
                            </div>
                        </>
                    )}
                </Card>
            </div>

            <div className="ticket-archive">
                <button
                    type="button"
                    className="ticket-archive-toggle"
                    onClick={() => setArchiveExpanded((prev) => !prev)}
                    aria-expanded={archiveExpanded}
                >
                    <h3>Archive</h3>
                    <span className={`archive-caret ${archiveExpanded ? 'open' : ''}`} aria-hidden="true" />
                </button>
                <div className={`ticket-archive-panel ${archiveExpanded ? 'expanded' : ''}`}>
                    {archivedTickets.length === 0 ? (
                        <p className="empty-state">No archived tickets.</p>
                    ) : (
                        <div className="ticket-archive-list">
                            {archivedTickets.map((ticket) => (
                                <div key={ticket.id} className="ticket-archive-item">
                                    <div className="ticket-archive-main">
                                        <div className="ticket-archive-text">
                                            <span className="ticket-archive-title">{ticket.title}</span>
                                            {ticket.description ? (
                                                <span className="ticket-archive-description">{ticket.description}</span>
                                            ) : null}
                                            {(ticket.areas || []).length > 0 && (
                                                <span className="ticket-archive-chips">
                                                    {(ticket.areas || []).map((areaId) => (
                                                        <span key={areaId} className="ticket-area-chip">
                                                            {areaById[areaId]?.name || areaId}
                                                        </span>
                                                    ))}
                                                </span>
                                            )}
                                        </div>
                                        <span className={`ticket-status status-${ticket.status}`}>{getTicketStatusLabel(ticket.status)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BuildingsTickets;
