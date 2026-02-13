import { FaPlus, FaClipboardCheck, FaTrash } from 'react-icons/fa';
import Card from '../../components/Card';

const BuildingsTickets = ({
    tickets,
    ticketsLoading,
    ticketsError,
    selectedTicketId,
    selectedTicket,
    archiveExpanded,
    ticketStatusExpandedKey,
    ticketsViewRef,
    areaById,
    newNote,
    newTaskText,
    setNewNote,
    setNewTaskText,
    setSelectedTicketId,
    setArchiveExpanded,
    setTicketStatusExpandedKey,
    openTicketModal,
    updateTicket,
    addTicketTask,
    toggleTicketTask,
    deleteTicketTask,
    addTicketNote
}) => {
    const terminalStatuses = new Set(['done', 'wont_do']);
    const activeTickets = tickets.filter((ticket) => !terminalStatuses.has(ticket.status));
    const archivedTickets = tickets
        .filter((ticket) => terminalStatuses.has(ticket.status))
        .sort((a, b) => {
            const aRaw = new Date(a.updated_at || a.created_at || 0).getTime();
            const bRaw = new Date(b.updated_at || b.created_at || 0).getTime();
            const aTime = Number.isNaN(aRaw) ? 0 : aRaw;
            const bTime = Number.isNaN(bRaw) ? 0 : bRaw;
            return bTime - aTime;
        });

    const statusOptions = [
        { value: 'new', label: 'New' },
        { value: 'open', label: 'Open' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'done', label: 'Done' },
        { value: 'wont_do', label: "Won't Do" }
    ];

    const renderTicketStatusStack = (key, selected, onSelect) => {
        const activeIndex = Math.max(
            0,
            statusOptions.findIndex((option) => option.value === selected)
        );
        const expanded = ticketStatusExpandedKey === key;
        return (
            <div
                className={`ticket-status-stack ${expanded ? 'expanded' : ''}`}
                style={{ '--stack-count': statusOptions.length, '--active-index': activeIndex }}
                onMouseEnter={() => setTicketStatusExpandedKey(key)}
                onMouseLeave={() => setTicketStatusExpandedKey(null)}
            >
                <span className="ticket-status-anchor" aria-hidden="true">
                    {statusOptions[activeIndex]?.label || 'Status'}
                </span>
                {statusOptions.map((option, index) => {
                    const isActive = option.value === selected;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            className={`ticket-status-option ${isActive ? 'active' : ''} status-${option.value}`}
                            style={{ '--index': index }}
                            onClick={() => {
                                if (option.value !== selected) {
                                    onSelect(option.value);
                                }
                            }}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="tickets-view" ref={ticketsViewRef}>
            <div className="tickets-header">
                <div>
                    <h2>Support Tickets</h2>
                    <p>Track maintenance problems across campus areas.</p>
                </div>
                <button className="btn-primary" onClick={openTicketModal}>
                    <FaPlus /> Open New Ticket
                </button>
            </div>

            {ticketsError && <div className="ticket-error">{ticketsError}</div>}

            <div className="tickets-layout">
                <Card className="tickets-list">
                    {ticketsLoading && <p className="empty-state">Loading tickets...</p>}
                    {!ticketsLoading && activeTickets.length === 0 && (
                        <p className="empty-state">No tickets yet.</p>
                    )}
                    {!ticketsLoading && activeTickets.map((ticket) => (
                        <button
                            key={ticket.id}
                            type="button"
                            className={`ticket-row ${ticket.id === selectedTicketId ? 'active' : ''}`}
                            onClick={() => setSelectedTicketId(ticket.id)}
                        >
                            <div className="ticket-row-header">
                                <h4>{ticket.title}</h4>
                                <span className={`ticket-status status-${ticket.status}`}>{ticket.status.replace('_', ' ')}</span>
                            </div>
                            <p>{ticket.description || 'No description'}</p>
                            <div className="ticket-area-chips">
                                {(ticket.areas || []).map((areaId) => (
                                    <span key={areaId} className="ticket-area-chip">
                                        {areaById[areaId]?.name || areaId}
                                    </span>
                                ))}
                            </div>
                        </button>
                    ))}
                </Card>

                <Card className="ticket-detail">
                    {!selectedTicket && <p className="empty-state">Select a ticket to view details.</p>}
                    {selectedTicket && (
                        <>
                            <div className="ticket-detail-header">
                                <div>
                                    <h3>{selectedTicket.title}</h3>
                                    {selectedTicket.description ? <p>{selectedTicket.description}</p> : null}
                                </div>
                                {renderTicketStatusStack(
                                    `ticket-${selectedTicket.id}`,
                                    selectedTicket.status,
                                    (value) => updateTicket(selectedTicket.id, { status: value })
                                )}
                            </div>

                            <div className="ticket-section">
                                <h4>Areas</h4>
                                <div className="ticket-area-chips">
                                    {(selectedTicket.areas || []).map((areaId) => (
                                        <span key={areaId} className="ticket-area-chip">
                                            {areaById[areaId]?.name || areaId}
                                        </span>
                                    ))}
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
                                    <button className="btn-secondary" onClick={() => addTicketTask(selectedTicket.id)}>
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
                                                const aTime = Number.isNaN(aRaw) ? 0 : aRaw;
                                                const bTime = Number.isNaN(bRaw) ? 0 : bRaw;
                                                return bTime - aTime;
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
                                    <button className="btn-secondary" onClick={() => addTicketNote(selectedTicket)}>
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
                                            const aTime = Number.isNaN(aRaw) ? 0 : aRaw;
                                            const bTime = Number.isNaN(bRaw) ? 0 : bRaw;
                                            return bTime - aTime;
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
                                        {renderTicketStatusStack(
                                            `archive-${ticket.id}`,
                                            ticket.status,
                                            (value) => updateTicket(ticket.id, { status: value })
                                        )}
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
