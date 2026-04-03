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
    onSelectRow,
    formatOriginLabel,
    getWorkPackageTitle,
    getWorkPackageSubtitle,
    getWorkPackageSummary,
    getOriginColorClass,
    getDisplayClass,
    getDisplayLabel,
    toggleTask
}) => (
    <Card className="tasks-list-card allow-overflow todo-queue-card">
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

        {tasksLoading && <div className="empty-state">Loading tasks...</div>}
        {error && !tasksLoading && <div className="empty-state">{error}</div>}
        {!tasksLoading && !error && rows.length === 0 && (
            <div className="empty-state">{emptyLabel}</div>
        )}
        {!tasksLoading && !error && rows.length > 0 && (
            <div className="queue-card-list">
                {rows.map((row) => {
                    const task = row.task;
                    const origin = row.origin;
                    const originLabel = formatOriginLabel(origin.sample);
                    const originSubtitle = getWorkPackageSubtitle(origin);
                    const taskTitle = getWorkPackageTitle(origin);
                    const workPackage = getWorkPackageSummary(origin);
                    const primarySection = workPackage.primarySection;
                    const isActive = row.originKey === selectedOriginKey;
                    const bucketLabel = row.bucket === 'this_week'
                        ? 'This Week'
                        : row.bucket === 'next_week'
                            ? 'Next Week'
                            : row.bucket === 'later'
                                ? 'Later'
                                : '';
                    const currentLabel = primarySection
                        ? `${primarySection.title}: ${primarySection.currentLabel}`
                        : 'Checklist complete';
                    const actionTask = primarySection?.actionTask || task;

                    return (
                        <div
                            key={row.originKey}
                            role="button"
                            tabIndex={0}
                            className={`queue-card ${getOriginColorClass(origin.sample?.origin_type)} ${isActive ? 'active' : ''}`}
                            onClick={() => onSelectRow(row.originKey, task?.id || '')}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onSelectRow(row.originKey, task?.id || '');
                                }
                            }}
                        >
                            <div className="queue-card-topline">
                                <div className="queue-card-heading">
                                    <div className="queue-card-title">{taskTitle}</div>
                                    <div className="origin-meta">
                                        {originLabel}
                                        {originSubtitle ? ` - ${originSubtitle}` : ''}
                                        {bucketLabel ? <span className="origin-bucket-pill">{bucketLabel}</span> : null}
                                    </div>
                                </div>
                                <div className="queue-card-pills">
                                    {task ? (
                                        <span className={`priority-pill ${getDisplayClass(task)}`}>
                                            {getDisplayLabel(task)}
                                        </span>
                                    ) : null}
                                    <span className="queue-progress-pill">
                                        {workPackage.completedCount}/{workPackage.totalCount}
                                    </span>
                                </div>
                            </div>

                            <div className="queue-card-summary">
                                <div className="queue-card-current">
                                    <span className="queue-card-current-label">Current</span>
                                    <strong>{currentLabel}</strong>
                                </div>
                                {actionTask ? (
                                    <button
                                        type="button"
                                        className="queue-complete-btn"
                                        disabled={!primarySection?.actionTask}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            toggleTask(actionTask);
                                        }}
                                    >
                                        {primarySection?.checklist?.mode === 'progressive' ? 'Advance Checklist' : 'Complete Next'}
                                    </button>
                                ) : null}
                            </div>

                            <div className="queue-progress-bar" aria-hidden="true">
                                <div
                                    className="queue-progress-fill"
                                    style={{ width: `${Math.round(workPackage.progress * 100)}%` }}
                                />
                            </div>

                            <div className="queue-mini-checklist">
                                {workPackage.sections.slice(0, 4).map((section) => (
                                    <span key={section.key} className={`mini-checklist-chip status-${section.status}`}>
                                        {section.title} {section.completedCount}/{section.totalCount}
                                    </span>
                                ))}
                                {workPackage.sections.length > 4 && (
                                    <span className="mini-checklist-chip overflow">+{workPackage.sections.length - 4}</span>
                                )}
                            </div>

                            {isActive && (
                                <div className="queue-expanded-checklist">
                                    {workPackage.sections.map((section) => (
                                        <div
                                            key={section.key}
                                            className={`queue-checklist-row status-${section.status}`}
                                            role={section.actionTask ? 'button' : undefined}
                                            tabIndex={section.actionTask ? 0 : undefined}
                                            onClick={section.actionTask ? (event) => {
                                                event.stopPropagation();
                                                onSelectRow(row.originKey, section.actionTask.id || '');
                                            } : undefined}
                                            onKeyDown={section.actionTask ? (event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    onSelectRow(row.originKey, section.actionTask.id || '');
                                                }
                                            } : undefined}
                                        >
                                            <div className={`queue-checklist-marker status-${section.status}`}>
                                                {section.status === 'done' ? '\u2713' : ''}
                                            </div>
                                            <div className="queue-checklist-copy">
                                                <div className="queue-checklist-title">{section.title}</div>
                                                <div className="queue-checklist-meta">
                                                    {section.completedCount}/{section.totalCount} complete
                                                    {section.currentLabel ? ` - ${section.currentLabel}` : ''}
                                                </div>
                                            </div>
                                            {section.actionTask ? (
                                                <button
                                                    type="button"
                                                    className="queue-checklist-action"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        toggleTask(section.actionTask);
                                                    }}
                                                >
                                                    {section.checklist.mode === 'progressive' ? 'Advance' : (section.actionTask.completed ? 'Undo' : 'Done')}
                                                </button>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        )}
    </Card>
);

export default TodoListCard;
