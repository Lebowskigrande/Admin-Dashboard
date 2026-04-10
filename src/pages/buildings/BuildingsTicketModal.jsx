import Modal from '../../components/Modal';
import {
    TICKET_CATEGORY_OPTIONS,
    TICKET_PRIORITY_OPTIONS,
    TICKET_STATUS_OPTIONS
} from '../../../shared/tickets.js';

const BuildingsTicketModal = ({
    isOpen,
    onClose,
    editingTicketId,
    ticketDraft,
    setTicketDraft,
    mapAreas,
    vendors,
    toggleTicketArea,
    saveTicket
}) => (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={editingTicketId ? 'Edit Facilities Ticket' : 'Open Facilities Ticket'}
        className="modal-large"
    >
        <form className="ticket-form ticket-form--intake" onSubmit={saveTicket}>
            <div className="ticket-intake-shell">
                <section className="ticket-intake-main">
                    <div className="ticket-intake-grid">
                        <div className="form-group ticket-form-group--span-2">
                            <label>Title</label>
                            <input
                                type="text"
                                required
                                value={ticketDraft.title}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, title: event.target.value })}
                                placeholder="e.g. Fellowship Hall HVAC not cooling"
                            />
                        </div>
                        <div className="form-group ticket-form-group--span-2">
                            <label>Description</label>
                            <textarea
                                rows="4"
                                value={ticketDraft.description}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, description: event.target.value })}
                                placeholder="Describe the issue, operational impact, and what has already been tried."
                            />
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <select
                                value={ticketDraft.status}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, status: event.target.value })}
                            >
                                {TICKET_STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Priority</label>
                            <select
                                value={ticketDraft.priority}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, priority: event.target.value })}
                            >
                                {TICKET_PRIORITY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Category</label>
                            <select
                                value={ticketDraft.category}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, category: event.target.value })}
                            >
                                {TICKET_CATEGORY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Target Date</label>
                            <input
                                type="date"
                                value={ticketDraft.targetDate}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, targetDate: event.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Requested By</label>
                            <input
                                type="text"
                                value={ticketDraft.requestedBy}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, requestedBy: event.target.value })}
                                placeholder="Who reported the issue?"
                            />
                        </div>
                        <div className="form-group">
                            <label>Assigned To</label>
                            <input
                                type="text"
                                value={ticketDraft.assignedTo}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, assignedTo: event.target.value })}
                                placeholder="Internal owner or point person"
                            />
                        </div>
                        <div className="form-group ticket-form-group--span-2">
                            <label>Preferred Vendor</label>
                            <select
                                value={ticketDraft.vendorId}
                                onChange={(event) => setTicketDraft({ ...ticketDraft, vendorId: event.target.value })}
                            >
                                <option value="">No vendor selected</option>
                                {vendors.map((vendor) => (
                                    <option key={vendor.id} value={vendor.id}>
                                        {vendor.vendor}{vendor.service ? ` - ${vendor.service}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Areas</label>
                        <div className="ticket-area-grid">
                            {mapAreas.map((area) => (
                                <label key={area.id} className="ticket-area-option">
                                    <input
                                        type="checkbox"
                                        checked={ticketDraft.areaIds.includes(area.id)}
                                        onChange={() => toggleTicketArea(area.id)}
                                    />
                                    <span>{area.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </section>

                <aside className="ticket-intake-sidebar">
                    <div className="ticket-intake-note">
                        <span>Intake standard</span>
                        <strong>Capture location, owner, urgency, and target date up front.</strong>
                        <p>That gives the dashboard enough information to surface real facilities risk instead of a flat note list.</p>
                    </div>
                    <div className="ticket-intake-note">
                        <span>Operational cues</span>
                        <strong>Use higher priority only when the issue affects safety, worship, school, or active events.</strong>
                        <p>Routine maintenance can stay normal priority even if it still needs follow-up.</p>
                    </div>
                </aside>
            </div>

            <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary">
                    {editingTicketId ? 'Save Ticket' : 'Create Ticket'}
                </button>
            </div>
        </form>
    </Modal>
);

export default BuildingsTicketModal;
