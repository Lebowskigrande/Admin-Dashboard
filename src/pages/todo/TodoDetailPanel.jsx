import { format } from 'date-fns';
import { FaExternalLinkAlt } from 'react-icons/fa';
import Card from '../../components/Card';

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
    getListProgressDisplay,
    getTopLevelTaskTitle,
    getListRepresentativeTask,
    sortTasksForDetails,
    getTaskProgressMeta,
    getOriginColorClass,
    getOriginLink,
    onOpenOrigin
}) => (
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
                        ? `${selectedOriginSubtitle ? `${selectedOriginSubtitle} \u00b7 ` : ''}All tasks in this origin.`
                        : 'Select a task to see details.'}
                </p>
            </div>
        </div>
        {!selectedOrigin && <div className="empty-state">Select a task or origin to see details.</div>}
        {selectedOrigin && (
            <div className="task-detail-body">
                <div className="task-detail-list">
                    {selectedOrigin.lists.length === 0 && (
                        <div className="empty-state">No tasks found.</div>
                    )}
                    {selectedOrigin.lists.length > 0 && (
                        <div className="task-detail-task-list">
                            {selectedOrigin.lists.map((list) => {
                                const task = getListRepresentativeTask(list);
                                if (!task) return null;
                                const isSelected = task.id === selectedTaskKey;
                                const dueLabel = task.due_at ? format(new Date(task.due_at), 'MMM d') : 'Later';
                                const progressMeta = getTaskProgressMeta(task);
                                const title = getTopLevelTaskTitle(list, task);
                                const progressDisplay = getListProgressDisplay(list, task);
                                return (
                                    <div key={task.id} className={`task-detail-task ${isSelected ? 'selected' : ''} ${task.completed ? 'completed' : ''}`}>
                                        <div
                                            className="task-detail-task-row"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedTaskId(task.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    setSelectedTaskId(task.id);
                                                }
                                            }}
                                        >
                                            <div className="task-detail-task-main">
                                                <div className="task-detail-task-title">{title}</div>
                                                <div className="task-detail-task-meta">
                                                    Due {dueLabel}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="milestone-inline">
                                            <div className="milestone-inline-actions">
                                                <div className="milestone-inline-next">
                                                    {progressDisplay.label}
                                                </div>
                                                <div className="milestone-inline-buttons">
                                                    <button
                                                        type="button"
                                                        className="milestone-back-btn"
                                                        title="Go Back"
                                                        aria-label="Go Back"
                                                        disabled={!progressMeta?.prevStep}
                                                        onClick={() => {
                                                            if (!progressMeta) return;
                                                            if (progressMeta.prevStep) {
                                                                updateTaskProgress(task, progressMeta.prevStep.key);
                                                                return;
                                                            }
                                                            updateTaskProgress(task, '');
                                                        }}
                                                    >
                                                        &lt;
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="milestone-complete-btn"
                                                        title="Mark Complete"
                                                        aria-label="Mark Complete"
                                                        disabled={!progressMeta?.nextStep}
                                                        onClick={() => {
                                                            if (!progressMeta?.nextStep) return;
                                                            updateTaskProgress(task, progressMeta.nextStep.key);
                                                        }}
                                                    >
                                                        &#10003;
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="milestone-bar">
                                                <div
                                                    className="milestone-bar-fill"
                                                    style={{ width: `${Math.round(progressDisplay.progress * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <div className="task-detail-task-expanded">
                                                <div className="task-detail-notes">
                                                    <div className="task-detail-notes-title">Notes</div>
                                                    {selectedTask?.notes ? (
                                                        <div className="task-detail-notes-body">{selectedTask.notes}</div>
                                                    ) : (
                                                        <div className="task-detail-notes-body empty">No notes yet.</div>
                                                    )}
                                                </div>
                                                <div className="task-detail-notes-editor">
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
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

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
                                                                    className={`origin-task-row ${task.completed ? 'completed' : ''} ${selectedOrigin?.nextTask?.id === task.id ? 'next-step' : ''}`}
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
                                                                            {progressMeta ? `${progressMeta.currentLabel} | ` : ''}
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

export default TodoDetailPanel;
