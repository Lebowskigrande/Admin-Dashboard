import Modal from '../../components/Modal';

const BuildingsTicketModal = ({
    isOpen,
    onClose,
    newTicket,
    setNewTicket,
    mapAreas,
    toggleTicketArea,
    createTicket
}) => (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Create New Ticket"
    >
        <form className="ticket-form" onSubmit={createTicket}>
            <div className="form-group">
                <label>Title</label>
                <input
                    type="text"
                    required
                    value={newTicket.title}
                    onChange={(event) => setNewTicket({ ...newTicket, title: event.target.value })}
                    placeholder="e.g. Flooding near Fellowship Hall"
                />
            </div>
            <div className="form-group">
                <label>Description</label>
                <textarea
                    rows="3"
                    value={newTicket.description}
                    onChange={(event) => setNewTicket({ ...newTicket, description: event.target.value })}
                    placeholder="Describe the issue and impact."
                />
            </div>
            <div className="form-group">
                <label>Status</label>
                <select
                    value={newTicket.status}
                    onChange={(event) => setNewTicket({ ...newTicket, status: event.target.value })}
                >
                    <option value="new">New</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                    <option value="wont_do">Won&apos;t Do</option>
                </select>
            </div>
            <div className="form-group">
                <label>Areas</label>
                <div className="ticket-area-grid">
                    {mapAreas.map((area) => (
                        <label key={area.id} className="ticket-area-option">
                            <input
                                type="checkbox"
                                checked={newTicket.areaIds.includes(area.id)}
                                onChange={() => toggleTicketArea(area.id)}
                            />
                            <span>{area.name}</span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary">Create Ticket</button>
            </div>
        </form>
    </Modal>
);

export default BuildingsTicketModal;
