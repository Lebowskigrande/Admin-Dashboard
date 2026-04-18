import Card from '../../components/Card';
import WorkPackageCard from '../../components/tasks/WorkPackageCard';

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
    selectedSectionKey,
    onSelectRow,
    formatOriginLabel,
    getWorkPackageTitle,
    getWorkPackageSubtitle,
    getWorkPackageSummary,
    getOriginColorClass
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
            <div className="workboard-grid">
                {rows.map((row) => {
                    const origin = row.origin;
                    const originLabel = formatOriginLabel(origin.sample);
                    const packageSubtitle = getWorkPackageSubtitle(origin);
                    const packageTitle = getWorkPackageTitle(origin);
                    const workPackage = getWorkPackageSummary(origin);
                    const primarySection = workPackage.primarySection || workPackage.sections[0] || null;
                    const primaryTask = primarySection?.actionTask || primarySection?.currentTask || null;
                    const isActive = row.originKey === selectedOriginKey;
                    const bucketLabel = row.packageDueInfo?.label || (row.bucket === 'this_week'
                        ? 'This Week'
                        : row.bucket === 'next_week'
                            ? 'Next Week'
                            : row.bucket === 'later'
                                ? 'Later'
                                : '');

                    return (
                        <WorkPackageCard
                            key={row.originKey}
                            colorClass={getOriginColorClass(origin.sample?.origin_type)}
                            active={isActive}
                            originLabel={originLabel}
                            bucketLabel={bucketLabel}
                            title={packageTitle}
                            subtitle={packageSubtitle}
                            sections={workPackage.sections}
                            selectedSectionKey={selectedSectionKey}
                            onClick={() => onSelectRow(
                                row.originKey,
                                primarySection?.key || '',
                                primaryTask?.id || ''
                            )}
                            onSectionSelect={(section) => onSelectRow(
                                row.originKey,
                                section.key,
                                section.actionTask?.id || section.currentTask?.id || ''
                            )}
                        />
                    );
                })}
            </div>
        )}
    </Card>
);

export default TodoListCard;
