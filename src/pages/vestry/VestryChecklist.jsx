import { format } from 'date-fns';

import Card from '../../components/Card';

const VestryChecklist = ({
    checklistItems,
    checklistGroups,
    checklistProgress,
    setChecklistProgress,
    selectedMeeting,
    completedCount
}) => (
    <Card className="vestry-panel vestry-checklist-card vestry-row-card">
        <div className="panel-header compact badge-corner">
            <h2>{`Checklist${selectedMeeting ? `: ${format(selectedMeeting, 'MMMM')}` : ''}`}</h2>
            <span className="count-badge" aria-label={`${completedCount} of ${checklistItems.length} complete`}>
                {completedCount}/{checklistItems.length}
            </span>
        </div>
        <div className="vestry-checklist-panel">
            {checklistItems.length === 0 ? (
                <span className="text-muted">No checklist items found for this meeting.</span>
            ) : (
                checklistGroups.map((group) => (
                    <div key={group.phase} className="vestry-checklist-group">
                        <div className="vestry-checklist-title">{group.phase}</div>
                        {group.items.map((item) => {
                            const isComplete = !!checklistProgress[item.id];
                            return (
                                <label key={item.id} className={`vestry-checklist-item ${isComplete ? 'completed' : ''}`}>
                                    <span className="vestry-checklist-check">
                                        <input
                                            className="vestry-checklist-input"
                                            type="checkbox"
                                            checked={isComplete}
                                            onChange={() => setChecklistProgress((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                        />
                                        <span
                                            className={`check-badge check-badge--sm vestry-check-badge ${isComplete ? '' : 'check-badge--empty'}`}
                                            aria-hidden="true"
                                        >
                                            {isComplete ? '\u2713' : ''}
                                        </span>
                                    </span>
                                    <span className="vestry-checklist-text">
                                        <span className="vestry-checklist-task">{item.task}</span>
                                        {item.notes && <span className="vestry-checklist-notes">{item.notes}</span>}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                ))
            )}
        </div>
    </Card>
);

export default VestryChecklist;
