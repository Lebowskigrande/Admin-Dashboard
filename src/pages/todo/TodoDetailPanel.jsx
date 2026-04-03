import { format } from 'date-fns';
import { FaExternalLinkAlt } from 'react-icons/fa';
import Card from '../../components/Card';

const CHECKLIST_LABELS = {
    done: 'Done',
    current: 'Current',
    open: 'Open',
    upcoming: 'Up Next'
};

const TodoDetailPanel = ({
    selectedOrigin,
    selectedOriginTitle,
    selectedOriginSubtitle,
    selectedTaskKey,
    selectedTask,
    taskNotesDraft,
    setTaskNotesDraft,
    saveTaskNotes,
    updateTaskProgress,
    toggleTask,
    originLinks,
    nestedExpanded,
    nestedTasks,
    nestedLoading,
    originGroupMap,
    handleToggleNested,
    setSelectedOriginKey,
    setSelectedTaskId,
    formatOriginSubtitle,
    formatTaskTitle,
    getDisplayClass,
    getDisplayLabel,
    getListChecklist,
    getListRepresentativeTask,
    sortTasksForDetails,
    getTaskProgressMeta,
    getOriginColorClass,
    getOriginLink,
    onOpenOrigin
}) => {
    const selectedOriginOpenCount = selectedOrigin
        ? selectedOrigin.tasks.filter((task) => !task.completed).length
        : 0;
    const selectedOriginDoneCount = selectedOrigin
        ? selectedOrigin.tasks.filter((task) => task.completed).length
        : 0;

    return (
        <Card className={`tasks-detail-card ${selectedOrigin ? getOriginColorClass(selectedOrigin.origin_type) : ''}`}>
            <div className="tasks-list-header task-detail-header">
                <div>
                    <div className="task-detail-header-title">
                        <h2>{selectedOrigin ? selectedOriginTitle : 'Task Details'}</h2>
                        {selectedOrigin && (
                            <button
                                type="button"
                                className="btn-icon btn-icon-ghost origin-open-link"
                                onClick={() => {
                                    const link = getOriginLink(selectedOrigin);
                                    if (link) onOpenOrigin(link);
                                }}
                                aria-label="Open task origin"
                                title="Open task origin"
                            >
                                <FaExternalLinkAlt />
                            </button>
                        )}
                    </div>
                    <p className="muted">
                        {selectedOrigin
                            ? `${selectedOriginSubtitle ? `${selectedOriginSubtitle} · ` : ''}Checklist view of the full work package.`
                            : 'Select a checklist from the queue to inspect it.'}
                    </p>
                </div>
            </div>
            {!selectedOrigin && <div className="empty-state">Select a task group to inspect the full checklist.</div>}
            {selectedOrigin && (
                <div className="task-detail-body">
                    <div className="todo-inspector-summary">
                        <div className="todo-inspector-stat">
                            <span>Open</span>
                            <strong>{selectedOriginOpenCount}</strong>
                        </div>
                        <div className="todo-inspector-stat">
                            <span>Done</span>
                            <strong>{selectedOriginDoneCount}</strong>
                        </div>
                        <div className="todo-inspector-stat">
                            <span>Sections</span>
                            <strong>{selectedOrigin.lists.length}</strong>
                        </div>
                    </div>

                    <div className="checklist-section-list">
                        {selectedOrigin.lists.length === 0 && (
                            <div className="empty-state">No tasks found for this origin.</div>
                        )}
                        {selectedOrigin.lists.map((list) => {
                            const representativeTask = getListRepresentativeTask(list);
                            const checklist = getListChecklist(list);
                            const isFocused = checklist.items.some((item) => item.task?.id === selectedTaskKey)
                                || representativeTask?.id === selectedTaskKey;
                            const currentTask = checklist.currentItem?.task || representativeTask;
                            const progressPercent = Math.round(checklist.progress * 100);
                            return (
                                <div key={list.key} className={`checklist-section-card ${isFocused ? 'is-focused' : ''}`}>
                                    <div className="checklist-section-header">
                                        <div>
                                            <div className="checklist-section-title">{list.title || 'Checklist'}</div>
                                            <div className="checklist-section-meta">
                                                {checklist.completedCount}/{checklist.totalCount} complete
                                                {checklist.currentItem ? ` · Current: ${checklist.currentItem.label}` : ' · Complete'}
                                            </div>
                                        </div>
                                        <div className="checklist-section-pills">
                                            {currentTask ? (
                                                <span className={`priority-pill ${getDisplayClass(currentTask)}`}>
                                                    {getDisplayLabel(currentTask)}
                                                </span>
                                            ) : null}
                                            <span className="queue-progress-pill">{progressPercent}%</span>
                                        </div>
                                    </div>

                                    <div className="queue-progress-bar" aria-hidden="true">
                                        <div
                                            className="queue-progress-fill"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>

                                    <div className="checklist-section-items">
                                        {checklist.items.map((item) => {
                                            const dueLabel = item.task?.due_at
                                                ? format(new Date(item.task.due_at), 'MMM d')
                                                : '';
                                            const isSelected = item.task?.id && item.task.id === selectedTaskKey;
                                            return (
                                                <div
                                                    key={item.key}
                                                    className={`checklist-item-row status-${item.status} ${isSelected ? 'is-selected' : ''}`}
                                                    role={item.task ? 'button' : undefined}
                                                    tabIndex={item.task ? 0 : undefined}
                                                    onClick={item.task ? () => setSelectedTaskId(item.task.id) : undefined}
                                                    onKeyDown={item.task ? (event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            setSelectedTaskId(item.task.id);
                                                        }
                                                    } : undefined}
                                                >
                                                    <div className={`queue-checklist-marker status-${item.status}`}>
                                                        {item.status === 'done' ? '\u2713' : ''}
                                                    </div>
                                                    <div className="queue-checklist-copy">
                                                        <div className="queue-checklist-title">{item.label}</div>
                                                        <div className="queue-checklist-meta">
                                                            {CHECKLIST_LABELS[item.status] || 'Pending'}
                                                            {dueLabel ? ` · Due ${dueLabel}` : ''}
                                                        </div>
                                                    </div>
                                                    {item.task && checklist.mode !== 'progressive' ? (
                                                        <button
                                                            type="button"
                                                            className="queue-checklist-action"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleTask(item.task);
                                                            }}
                                                        >
                                                            {item.task.completed ? 'Undo' : 'Done'}
                                                        </button>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {checklist.mode === 'progressive' && representativeTask && (
                                        <div className="checklist-section-actions">
                                            <button
                                                type="button"
                                                className="btn-secondary btn-compact"
                                                disabled={!checklist.canRewind}
                                                onClick={() => {
                                                    const progressMeta = getTaskProgressMeta(representativeTask);
                                                    if (!progressMeta) return;
                                                    if (progressMeta.prevStep) {
                                                        updateTaskProgress(representativeTask, progressMeta.prevStep.key);
                                                        return;
                                                    }
                                                    updateTaskProgress(representativeTask, '');
                                                }}
                                            >
                                                Move Back
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-primary btn-compact"
                                                disabled={!checklist.canAdvance}
                                                onClick={() => toggleTask(representativeTask)}
                                            >
                                                Complete Current Step
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {selectedTask && (
                        <div className="task-notes-card">
                            <div className="task-notes-header">
                                <div>
                                    <div className="task-notes-title">{selectedTask.text || formatTaskTitle(selectedTask)}</div>
                                    <div className="task-notes-subtitle">
                                        Focused task notes and context.
                                    </div>
                                </div>
                                <span className={`priority-pill ${getDisplayClass(selectedTask)}`}>
                                    {getDisplayLabel(selectedTask)}
                                </span>
                            </div>
                            <textarea
                                className="task-notes-input"
                                rows={4}
                                placeholder="Add any extra details, reminders, or context."
                                value={taskNotesDraft}
                                onChange={(event) => setTaskNotesDraft(event.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-secondary btn-compact"
                                onClick={saveTaskNotes}
                            >
                                Save Notes
                            </button>
                        </div>
                    )}

                    {originLinks.children.length > 0 && (
                        <div className="task-origin-list">
                            <div className="task-origin-title">Nested lists</div>
                            <div className="origin-list-stack">
                                {originLinks.children.map((child) => {
                                    const childKey = `${child.origin_type || 'manual'}:${child.origin_id || 'manual'}`;
                                    const childGroup = originGroupMap.get(childKey);
                                    const childLabel = childGroup?.sample?.event_title
                                        ? childGroup.sample.event_title
                                        : (childGroup?.nextTask?.text || childGroup?.sample?.text || child.label || 'Origin');
                                    const childSubtitle = childGroup?.sample ? formatOriginSubtitle(childGroup.sample) : '';
                                    const expanded = !!nestedExpanded[childKey];
                                    const childTasks = nestedTasks[childKey] || [];
                                    const loading = nestedLoading[childKey];
                                    return (
                                        <div key={childKey} className="origin-list-card">
                                            <div className="origin-list-header">
                                                <div>
                                                    <div className="origin-list-title">{childLabel}</div>
                                                    <div className="origin-list-meta">
                                                        {childSubtitle || `${child.origin_type}:${child.origin_id}`}
                                                    </div>
                                                </div>
                                                <div className="nested-actions">
                                                    <button
                                                        type="button"
                                                        className="btn-secondary btn-compact"
                                                        onClick={() => handleToggleNested(child)}
                                                    >
                                                        {expanded ? 'Hide' : 'Show'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-secondary btn-compact"
                                                        onClick={() => {
                                                            setSelectedOriginKey(childKey);
                                                            setSelectedTaskId('');
                                                        }}
                                                    >
                                                        Focus
                                                    </button>
                                                </div>
                                            </div>
                                            {expanded && (
                                                <>
                                                    {loading && <div className="empty-state">Loading nested tasks...</div>}
                                                    {!loading && childTasks.length === 0 && (
                                                        <div className="empty-state">No tasks in this list.</div>
                                                    )}
                                                    {!loading && childTasks.length > 0 && (
                                                        <ul className="origin-task-list">
                                                            {sortTasksForDetails(childTasks).map((task) => {
                                                                const progressMeta = getTaskProgressMeta(task);
                                                                const dueLabel = task.due_at ? format(new Date(task.due_at), 'MMM d') : 'Later';
                                                                return (
                                                                    <li
                                                                        key={task.id}
                                                                        className={`origin-task-row ${task.completed ? 'completed' : ''}`}
                                                                        role="button"
                                                                        tabIndex={0}
                                                                        onClick={() => {
                                                                            setSelectedOriginKey(childKey);
                                                                            setSelectedTaskId(task.id);
                                                                        }}
                                                                        onKeyDown={(event) => {
                                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                                event.preventDefault();
                                                                                setSelectedOriginKey(childKey);
                                                                                setSelectedTaskId(task.id);
                                                                            }
                                                                        }}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            className="origin-task-check"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                toggleTask(task);
                                                                            }}
                                                                            disabled={progressMeta ? !progressMeta.nextStep : false}
                                                                            aria-label="Toggle task"
                                                                        >
                                                                            {task.completed && <span aria-hidden="true">&#10003;</span>}
                                                                        </button>
                                                                        <div className="origin-task-text">
                                                                            <div className="origin-task-title">{formatTaskTitle(task)}</div>
                                                                            <div className="origin-task-meta">
                                                                                {progressMeta ? `${progressMeta.currentLabel} · ` : ''}
                                                                                Due {dueLabel}
                                                                            </div>
                                                                        </div>
                                                                        <span className={`priority-pill ${getDisplayClass(task)}`}>
                                                                            {getDisplayLabel(task)}
                                                                        </span>
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
};

export default TodoDetailPanel;
