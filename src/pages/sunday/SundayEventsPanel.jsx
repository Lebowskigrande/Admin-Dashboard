import Card from '../../components/Card';
import SundayHgkPanel from './SundayHgkPanel';

const SundayEventsPanel = ({
    sundayEvents,
    selectedEventId,
    setSelectedEventId,
    selectedEvent,
    isHgkEvent,
    hgkSupplyMonthLabel,
    hgkSupplyRequest,
    hgkNotes,
    setHgkNotes,
    hgkEmailInput,
    setHgkEmailInput,
    handleSearchHgkEmail,
    hgkSearchBusy,
    handleParseHgkEmail,
    hgkEmailBusy,
    hgkSupplies,
    hgkSupplyLoading,
    handleHgkItemQuantityChange,
    handleHgkItemStatusChange,
    handleHgkItemNotesChange,
    handleOpenHgkInstacart,
    hgkInstacartBusy,
    handleSaveHgkSupplies,
    hgkSupplySaving,
    hgkSupplyError
}) => {
    if (sundayEvents.length === 0) return null;

    return (
        <Card className="sunday-panel events-panel">
            <div className="panel-header">
                <h3>Additional Sunday Events</h3>
            </div>
            <div className="events-panel-body">
                <div className="events-panel-list">
                    {sundayEvents.map((eventItem) => (
                        <button
                            key={eventItem.id}
                            type="button"
                            className={`event-row ${eventItem.id === selectedEventId ? 'active' : ''}`}
                            onClick={() => setSelectedEventId(eventItem.id)}
                        >
                            <div className="event-row-main">
                                <span className="event-row-title">{eventItem.title}</span>
                                <span className="event-row-meta">
                                    {eventItem.type_name || eventItem.category_name || 'Event'}
                                </span>
                            </div>
                            <span className="event-row-time">{eventItem.time || 'All day'}</span>
                        </button>
                    ))}
                </div>
                <div className="events-panel-detail">
                    {!selectedEvent ? (
                        <div className="empty-text">Select an event to see details.</div>
                    ) : (
                        <div className="event-details">
                            <div className="event-detail-row">
                                <span className="event-detail-label">Title</span>
                                <span className="event-detail-value">{selectedEvent.title}</span>
                            </div>
                            <div className="event-detail-row">
                                <span className="event-detail-label">Time</span>
                                <span className="event-detail-value">{selectedEvent.time || 'All day'}</span>
                            </div>
                            <div className="event-detail-row">
                                <span className="event-detail-label">Location</span>
                                <span className="event-detail-value">{selectedEvent.location || 'TBD'}</span>
                            </div>
                            <div className="event-detail-row">
                                <span className="event-detail-label">Type</span>
                                <span className="event-detail-value">{selectedEvent.type_name || selectedEvent.category_name || 'Event'}</span>
                            </div>
                            {selectedEvent.description && (
                                <div className="event-detail-row">
                                    <span className="event-detail-label">Notes</span>
                                    <span className="event-detail-value">{selectedEvent.description}</span>
                                </div>
                            )}
                            {isHgkEvent && (
                                <SundayHgkPanel
                                    hgkSupplyMonthLabel={hgkSupplyMonthLabel}
                                    hgkSupplyRequest={hgkSupplyRequest}
                                    hgkNotes={hgkNotes}
                                    setHgkNotes={setHgkNotes}
                                    hgkEmailInput={hgkEmailInput}
                                    setHgkEmailInput={setHgkEmailInput}
                                    handleSearchHgkEmail={handleSearchHgkEmail}
                                    hgkSearchBusy={hgkSearchBusy}
                                    handleParseHgkEmail={handleParseHgkEmail}
                                    hgkEmailBusy={hgkEmailBusy}
                                    hgkSupplies={hgkSupplies}
                                    hgkSupplyLoading={hgkSupplyLoading}
                                    handleHgkItemQuantityChange={handleHgkItemQuantityChange}
                                    handleHgkItemStatusChange={handleHgkItemStatusChange}
                                    handleHgkItemNotesChange={handleHgkItemNotesChange}
                                    handleOpenHgkInstacart={handleOpenHgkInstacart}
                                    hgkInstacartBusy={hgkInstacartBusy}
                                    handleSaveHgkSupplies={handleSaveHgkSupplies}
                                    hgkSupplySaving={hgkSupplySaving}
                                    hgkSupplyError={hgkSupplyError}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default SundayEventsPanel;
