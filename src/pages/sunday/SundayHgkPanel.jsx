import { HGK_STATUS_OPTIONS } from '../../utils/constants';

const HGK_STATUS_LABELS = {
    needed: 'Needed',
    ordered: 'Ordered',
    received: 'Received'
};

const SundayHgkPanel = ({
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
}) => (
    <div className="hgk-supply-panel">
        <div className="hgk-supply-header">
            <div>
                <h4>Holy Ghost Kitchen Supplies</h4>
                <span className="hgk-supply-month">{hgkSupplyMonthLabel}</span>
            </div>
            <span className="hgk-supply-status-label">
                {hgkSupplyRequest ? 'Saved request' : 'Ungenerated list'}
            </span>
        </div>
        <div className="hgk-supply-notes">
            <label htmlFor="hgk-supply-notes">Notes</label>
            <textarea
                id="hgk-supply-notes"
                className="hgk-supply-textarea"
                value={hgkNotes}
                onChange={(event) => setHgkNotes(event.target.value)}
                placeholder="Add ordering notes or reminders."
            />
        </div>
        <div className="hgk-supply-email">
            <label htmlFor="hgk-supply-email">Supply email</label>
            <div className="hgk-supply-email-row">
                <textarea
                    id="hgk-supply-email"
                    className="hgk-supply-textarea"
                    value={hgkEmailInput}
                    onChange={(event) => setHgkEmailInput(event.target.value)}
                    placeholder="Paste the monthly supply email text to populate quantities."
                />
                <div className="hgk-email-actions">
                    <button
                        type="button"
                        className="btn-secondary hgk-email-button"
                        onClick={handleSearchHgkEmail}
                        disabled={hgkSearchBusy}
                    >
                        {hgkSearchBusy ? 'Searching...' : 'Search for Supply Request'}
                    </button>
                    <button
                        type="button"
                        className="btn-primary hgk-email-button"
                        onClick={handleParseHgkEmail}
                        disabled={hgkEmailBusy || !hgkEmailInput.trim()}
                    >
                        {hgkEmailBusy ? 'Parsing...' : 'Use email'}
                    </button>
                </div>
            </div>
        </div>
        <div className="hgk-supply-grid">
            <div className="hgk-supply-row hgk-supply-row--header">
                <span>Item</span>
                <span>Qty</span>
                <span>Status</span>
                <span>Notes</span>
            </div>
            {hgkSupplyLoading ? (
                <div className="hgk-supply-loading">Loading supply list...</div>
            ) : hgkSupplies.length === 0 ? (
                <div className="hgk-supply-empty">No supply items configured yet.</div>
            ) : (
                hgkSupplies.map((item, index) => (
                    <div className="hgk-supply-row" key={`${item.item_name}-${index}`}>
                        <span className="hgk-supply-name">{item.item_name}</span>
                        <input
                            type="text"
                            className="hgk-supply-input"
                            value={item.quantity}
                            placeholder="Qty"
                            onChange={(event) => handleHgkItemQuantityChange(index, event.target.value)}
                        />
                        <select
                            className="hgk-supply-select"
                            value={item.status}
                            onChange={(event) => handleHgkItemStatusChange(index, event.target.value)}
                        >
                            {HGK_STATUS_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                    {HGK_STATUS_LABELS[value] || value}
                                </option>
                            ))}
                        </select>
                        <input
                            type="text"
                            className="hgk-supply-input"
                            value={item.notes}
                            onChange={(event) => handleHgkItemNotesChange(index, event.target.value)}
                            placeholder="Notes"
                        />
                    </div>
                ))
            )}
        </div>
        <div className="hgk-supply-actions">
            <button
                type="button"
                className="btn-secondary"
                onClick={handleOpenHgkInstacart}
                disabled={hgkInstacartBusy || hgkSupplyLoading}
            >
                {hgkInstacartBusy ? 'Opening...' : 'Open Instacart List'}
            </button>
            <button
                type="button"
                className="btn-primary"
                onClick={handleSaveHgkSupplies}
                disabled={hgkSupplySaving || hgkSupplyLoading}
            >
                {hgkSupplySaving ? 'Saving...' : 'Save supply list'}
            </button>
            {hgkSupplyError && <span className="hgk-supply-error">{hgkSupplyError}</span>}
        </div>
    </div>
);

export default SundayHgkPanel;
