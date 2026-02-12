import Card from '../../components/Card';

const BuildingsNeeds = ({
    needs,
    needsLoading,
    needsError,
    newNeed,
    setNewNeed,
    addNeed,
    toggleNeed
}) => (
    <Card>
        <div className="needs-list">
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <input
                    type="text"
                    placeholder="Add new long term need..."
                    style={{ flex: 1, padding: '8px' }}
                    value={newNeed}
                    onChange={e => setNewNeed(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && newNeed) {
                            addNeed();
                        }
                    }}
                />
                <button className="btn-primary" onClick={addNeed}>Add</button>
            </div>
            {needsError && <p className="empty-state">{needsError}</p>}
            {needsLoading ? (
                <p className="empty-state">Loading long term needs...</p>
            ) : needs.length === 0 ? (
                <p className="empty-state">No long term needs yet.</p>
            ) : (
                <ul>
                    {needs.map((task) => (
                        <li key={task.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input
                                    type="checkbox"
                                    checked={task.completed}
                                    onChange={() => toggleNeed(task)}
                                />
                                <span>{task.text}</span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    </Card>
);

export default BuildingsNeeds;
