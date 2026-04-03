import { format } from 'date-fns';
import { FaExternalLinkAlt } from 'react-icons/fa';
import Card from '../../components/Card';
import { getSectionIconComponent } from './todoVisuals';
import { getTaskActionLabel } from '../../utils/taskProgress';

const CHECKLIST_LABELS = {
    done: 'Done',
    current: 'Current',
    open: 'Open',
    upcoming: 'Up next'
};

const TodoDetailPanel = ({
    selectedOrigin,
    selectedWorkPackage,
    selectedSection,
    selectedOriginTitle,
    selectedOriginSubtitle,
    selectedSectionKey,
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
    setSelectedSectionKey,
    setSelectedTaskId,
    formatTaskTitle,
    getDisplayClass,
    getDisplayLabel,
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
    const SectionIcon = getSectionIconComponent(selectedSection?.iconKey);
    const focusTask = selectedTask || selectedSection?.actionTask || selectedSection?.currentTask || null;

    return (
        <Card className={`tasks-detail-card ${selectedOrigin ? getOriginColorClass(selectedOrigin.origin_type) : ''}`}>
            <div className="tasks-list-header task-detail-header">
                <div>
                    <div className="task-detail-header-title">
                        <h2>{selectedOrigin ? selectedOriginTitle : 'Focus Tray'}</h2>
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
                            ? `${selectedOriginSubtitle ? `${selectedOriginSubtitle} - ` : ''}Focus one section at a time without leaving the workboard.`
                            : 'Select a work package to inspect the current section.'}
                    </p>
                </div>
            </div>

            {!selectedOrigin && <div className="empty-state">Select a work package to inspect it.</div>}

            {selectedOrigin && selectedWorkPackage && (
                <div className="task-detail-body">
                    <div className="todo-inspector-summary">
                        <div className="todo-inspector-stat">
                            <span>Open Items</span>
                            <strong>{selectedOriginOpenCount}</strong>
                        </div>
                        <div className="todo-inspector-stat">
                            <span>Closed Items</span>
                            <strong>{selectedOriginDoneCount}</strong>
                        </div>
                        <div className="todo-inspector-stat">
                            <span>Sections</span>
                            <strong>{selectedWorkPackage.sections.length}</strong>
                        </div>
                    </div>

                    <div className="focus-section-rail">
                        {selectedWorkPackage.sections.map((section) => {
                            const Icon = getSectionIconComponent(section.iconKey);
                            const isActive = section.key === selectedSectionKey;
                            return (
                                <button
                                    key={section.key}
                                    type="button"
                                    className={`focus-section-tab attention-${section.attention} ${isActive ? 'is-active' : ''}`}
                                    onClick={() => {
                                        setSelectedSectionKey(section.key);
                                        setSelectedTaskId(section.actionTask?.id || section.currentTask?.id || '');
                                    }}
                                >
                                    <span className={`focus-section-tab-icon state-${section.status}`}>
                                        <Icon />
                                    </span>
                                    <span className="focus-section-tab-copy">
                                        <strong>{section.shortLabel}</strong>
                                        <span>{section.completedCount}/{section.totalCount}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {selectedSection && (
                        <div className={`focus-tray attention-${selectedSection.attention}`}>
                            <div className="focus-tray-header">
                                <div className="focus-tray-titleblock">
                                    <div className={`focus-tray-icon state-${selectedSection.status}`}>
                                        <SectionIcon />
                                    </div>
                                    <div>
                                        <div className="focus-tray-title">{selectedSection.title}</div>
                                        <div className="focus-tray-meta">
                                            {selectedSection.completedCount}/{selectedSection.totalCount} complete
                                            {selectedSection.currentLabel ? ` - Current: ${selectedSection.currentLabel}` : ''}
                                        </div>
                                    </div>
                                </div>
                                <div className="focus-tray-actions">
                                    {focusTask ? (
                                        <span className={`priority-pill ${getDisplayClass(focusTask)}`}>
                                            {getDisplayLabel(focusTask)}
                                        </span>
                                    ) : null}
                                    {selectedSection.actionTask ? (
                                        <button
                                            type="button"
                                            className="btn-primary btn-compact"
                                            onClick={() => toggleTask(selectedSection.actionTask)}
                                        >
                                            {getTaskActionLabel(selectedSection.actionTask)}
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <div className="focus-tray-progress">
                                <div
                                    className="focus-tray-progress-fill"
                                    style={{ width: `${Math.round(selectedSection.progress * 100)}%` }}
                                />
                            </div>

                            <div className="focus-tray-checklist">
                                {selectedSection.checklist.items.map((item) => {
                                    const dueLabel = item.task?.due_at
                                        ? format(new Date(item.task.due_at), 'MMM d')
                                        : '';
                                    const isSelected = item.task?.id && item.task.id === selectedTaskKey;
                                    return (
                                        <div
                                            key={item.key}
                                            className={`focus-checklist-row status-${item.status} ${isSelected ? 'is-selected' : ''}`}
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
                                            <div className={`focus-checklist-marker state-${item.status}`}>
                                                {item.status === 'done' ? 'v' : ''}
                                            </div>
                                            <div className="focus-checklist-copy">
                                                <div className="focus-checklist-title">{item.label}</div>
                                                <div className="focus-checklist-meta">
                                                    {CHECKLIST_LABELS[item.status] || 'Pending'}
                                                    {dueLabel ? ` - Due ${dueLabel}` : ''}
                                                </div>
                                            </div>
                                            {item.task && selectedSection.checklist.mode !== 'progressive' ? (
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

                            {selectedSection.checklist.mode === 'progressive' && selectedSection.actionTask && (
                                <div className="checklist-section-actions">
                                    <button
                                        type="button"
                                        className="btn-secondary btn-compact"
                                        disabled={!selectedSection.checklist.canRewind}
                                        onClick={() => {
                                            const progressMeta = getTaskProgressMeta(selectedSection.actionTask);
                                            if (!progressMeta) return;
                                            if (progressMeta.prevStep) {
                                                updateTaskProgress(selectedSection.actionTask, progressMeta.prevStep.key);
                                                return;
                                            }
                                            updateTaskProgress(selectedSection.actionTask, '');
                                        }}
                                    >
                                        Move Back
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-primary btn-compact"
                                        disabled={!selectedSection.checklist.canAdvance}
                                        onClick={() => toggleTask(selectedSection.actionTask)}
                                    >
                                        {getTaskActionLabel(selectedSection.actionTask)}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {focusTask && (
                        <div className="task-notes-card">
                            <div className="task-notes-header">
                                <div>
                                    <div className="task-notes-title">{focusTask.text || formatTaskTitle(focusTask)}</div>
                                    <div className="task-notes-subtitle">
                                        Notes for the currently focused action.
                                    </div>
                                </div>
                                <span className={`priority-pill ${getDisplayClass(focusTask)}`}>
                                    {getDisplayLabel(focusTask)}
                                </span>
                            </div>
                            <textarea
                                className="task-notes-input"
                                rows={4}
                                placeholder="Add reminders, context, or follow-up notes."
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
                            <div className="task-origin-title">Related Packages</div>
                            <div className="origin-list-stack">
                                {originLinks.children.map((child) => {
                                    const childKey = `${child.origin_type || 'manual'}:${child.origin_id || 'manual'}`;
                                    const childGroup = originGroupMap.get(childKey);
                                    const childLabel = childGroup?.sample?.event_title
                                        ? childGroup.sample.event_title
                                        : (childGroup?.nextTask?.text || childGroup?.sample?.text || child.label || 'Origin');
                                    const expanded = !!nestedExpanded[childKey];
                                    const childTasks = nestedTasks[childKey] || [];
                                    const loading = nestedLoading[childKey];
                                    return (
                                        <div key={childKey} className="origin-list-card">
                                            <div className="origin-list-header">
                                                <div>
                                                    <div className="origin-list-title">{childLabel}</div>
                                                    <div className="origin-list-meta">{child.origin_type}:{child.origin_id}</div>
                                                </div>
                                                <div className="nested-actions">
                                                    <button
                                                        type="button"
                                                        className="btn-secondary btn-compact"
                                                        onClick={() => handleToggleNested(child)}
                                                    >
                                                        {expanded ? 'Hide' : 'Preview'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-secondary btn-compact"
                                                        onClick={() => {
                                                            setSelectedOriginKey(childKey);
                                                            setSelectedSectionKey('');
                                                            setSelectedTaskId('');
                                                        }}
                                                    >
                                                        Focus
                                                    </button>
                                                </div>
                                            </div>
                                            {expanded && (
                                                <>
                                                    {loading && <div className="empty-state">Loading related tasks...</div>}
                                                    {!loading && childTasks.length === 0 && (
                                                        <div className="empty-state">No tasks in this package.</div>
                                                    )}
                                                    {!loading && childTasks.length > 0 && (
                                                        <ul className="origin-task-list">
                                                            {sortTasksForDetails(childTasks).map((task) => (
                                                                <li
                                                                    key={task.id}
                                                                    className={`origin-task-row ${task.completed ? 'completed' : ''}`}
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    onClick={() => {
                                                                        setSelectedOriginKey(childKey);
                                                                        setSelectedSectionKey(task.list_key || '');
                                                                        setSelectedTaskId(task.id);
                                                                    }}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                                            event.preventDefault();
                                                                            setSelectedOriginKey(childKey);
                                                                            setSelectedSectionKey(task.list_key || '');
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
                                                                        aria-label="Toggle task"
                                                                    >
                                                                        {task.completed && <span aria-hidden="true">v</span>}
                                                                    </button>
                                                                    <div className="origin-task-text">
                                                                        <div className="origin-task-title">{formatTaskTitle(task)}</div>
                                                                        <div className="origin-task-meta">
                                                                            {task.due_at ? `Due ${format(new Date(task.due_at), 'MMM d')}` : 'Later'}
                                                                        </div>
                                                                    </div>
                                                                </li>
                                                            ))}
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
