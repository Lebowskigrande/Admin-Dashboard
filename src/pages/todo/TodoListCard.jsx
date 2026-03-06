import Card from '../../components/Card';

const TodoListCard = ({
    title,
    subtitle,
    rows,
    tasksLoading,
    error,
    emptyLabel,
    countLabel,
    renderCountBadge,
    selectedOriginKey,
    selectedTaskId,
    onSelectRow,
    formatOriginLabel,
    formatOriginSubtitle,
    getTopLevelTaskTitle,
    getTaskProgressMeta,
    getTaskNextStepLabel,
    getOriginColorClass,
    getDisplayClass,
    getDisplayLabel,
    toggleTask,
    useWrapper = false
}) => (
    <Card className="tasks-list-card allow-overflow">
        <div className="tasks-list-header">
            <div>
                <h2>{title}</h2>
                {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            {renderCountBadge(
                rows.length,
                rows.length === 0 ? emptyLabel : countLabel
            )}
        </div>

        <div className={useWrapper ? 'task-list-wrapper' : undefined}>
            {tasksLoading && <div className="empty-state">Loading tasks...</div>}
            {error && !tasksLoading && <div className="empty-state">{error}</div>}
            {!tasksLoading && !error && rows.length === 0 && (
                <div className="empty-state">{emptyLabel}</div>
            )}
            {!tasksLoading && !error && rows.length > 0 && (
                <div className="origin-summary-table">
                    <div className="origin-summary-header" role="row">
                        <span>Task</span>
                        <span>Next step</span>
                        <span>Due Date</span>
                    </div>
                    <div className="origin-summary-body">
                        {rows.map((row) => {
                            const task = row.task;
                            const list = row.list;
                            const origin = row.origin;
                            const originLabel = formatOriginLabel(origin.sample);
                            const originSubtitle = formatOriginSubtitle(origin.sample);
                            const taskTitle = getTopLevelTaskTitle(list, task);
                            const progressMeta = getTaskProgressMeta(task);
                            const colorClass = getOriginColorClass(origin.sample?.origin_type);
                            const isActive = row.originKey === selectedOriginKey && task?.id === selectedTaskId;
                            const bucketLabel = row.bucket === 'this_week'
                                ? 'This Week'
                                : row.bucket === 'next_week'
                                    ? 'Next Week'
                                    : row.bucket === 'later'
                                        ? 'Later'
                                        : '';
                            return (
                                <div
                                    key={`${row.originKey}:${task?.id || list.key}`}
                                    role="button"
                                    tabIndex={0}
                                    className={`origin-summary-row ${colorClass} ${isActive ? 'active' : ''}`}
                                    onClick={() => onSelectRow(row.originKey, task?.id || '')}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            onSelectRow(row.originKey, task?.id || '');
                                        }
                                    }}
                                >
                                    <div className="origin-cell origin-cell-main">
                                        <div className="origin-title">{taskTitle}</div>
                                        <div className="origin-meta">
                                            {originLabel}
                                            {originSubtitle ? ` - ${originSubtitle}` : ''}
                                            {bucketLabel ? <span className="origin-bucket-pill">{bucketLabel}</span> : null}
                                        </div>
                                    </div>
                                    <div className="origin-cell origin-cell-next">
                                        {task && (
                                            <button
                                                type="button"
                                                className="origin-summary-check"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    toggleTask(task);
                                                }}
                                                disabled={progressMeta ? !progressMeta.nextStep : false}
                                                aria-label="Mark next step complete"
                                            >
                                                {task.completed && <span aria-hidden="true">&#10003;</span>}
                                            </button>
                                        )}
                                        <span className="origin-next-text">
                                            {task ? getTaskNextStepLabel(task) : 'No open tasks'}
                                        </span>
                                    </div>
                                    <div className="origin-cell origin-cell-priority">
                                        {task ? (
                                            <span className={`priority-pill ${getDisplayClass(task)}`}>
                                                {getDisplayLabel(task)}
                                            </span>
                                        ) : (
                                            <span className="muted">-</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    </Card>
);

export default TodoListCard;
