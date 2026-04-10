import Card from '../../components/Card';
import { getSectionIconComponent } from './todoVisuals';
import {
    getTaskCycleChipText,
    getTaskCycleLabel,
    getTaskCycleState
} from '../../../shared/taskStatus.js';

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
            <div className="workboard-grid">
                {rows.map((row) => {
                    const task = row.task;
                    const origin = row.origin;
                    const originLabel = formatOriginLabel(origin.sample);
                    const packageSubtitle = getWorkPackageSubtitle(origin);
                    const packageTitle = getWorkPackageTitle(origin);
                    const workPackage = getWorkPackageSummary(origin);
                    const primarySection = workPackage.primarySection || workPackage.sections[0] || null;
                    const primaryTask = primarySection?.actionTask || primarySection?.currentTask || null;
                    const isActive = row.originKey === selectedOriginKey;
                    const bucketLabel = row.bucket === 'this_week'
                        ? 'This Week'
                        : row.bucket === 'next_week'
                            ? 'Next Week'
                            : row.bucket === 'later'
                                ? 'Later'
                                : '';

                    return (
                        <article
                            key={row.originKey}
                            role="button"
                            tabIndex={0}
                            className={`package-card ${getOriginColorClass(origin.sample?.origin_type)} ${isActive ? 'active' : ''}`}
                            onClick={() => onSelectRow(
                                row.originKey,
                                primarySection?.key || '',
                                primaryTask?.id || ''
                            )}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    onSelectRow(
                                        row.originKey,
                                        primarySection?.key || '',
                                        primaryTask?.id || ''
                                    );
                                }
                            }}
                        >
                            <div className="package-card-accent" aria-hidden="true" />
                            <div className="package-card-head">
                                <div className="package-card-kicker">
                                    <span className="package-origin-label">{originLabel}</span>
                                    {bucketLabel ? <span className="package-bucket-pill">{bucketLabel}</span> : null}
                                </div>
                                <div className="package-card-title">{packageTitle}</div>
                                <div className="package-card-subtitle">{packageSubtitle}</div>
                            </div>

                            <div className="package-section-strip">
                                {workPackage.sections.map((section) => {
                                    const Icon = getSectionIconComponent(section.iconKey);
                                    const isFocused = isActive && section.key === selectedSectionKey;
                                    const chipText = getTaskCycleChipText(section.actionTask || section.currentTask);
                                    const chipState = getTaskCycleState(section.actionTask || section.currentTask);
                                    return (
                                        <div
                                            key={section.key}
                                            className={`section-node attention-${section.attention} ${isFocused ? 'is-focused' : ''}`}
                                        >
                                            <button
                                                type="button"
                                                className="section-node-icon-button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    if (section.actionTask) toggleTask(section.actionTask);
                                                }}
                                                disabled={!section.actionTask}
                                                aria-label={section.actionTask ? `${section.title}: ${getTaskCycleLabel(section.actionTask)}` : section.title}
                                                title={section.actionTask ? `${section.title}: click to cycle status` : section.title}
                                            >
                                                <span className={`section-node-icon state-${section.status}`}>
                                                    <Icon />
                                                    {chipText ? <span className={`section-state-chip status-${chipState}`}>{chipText}</span> : null}
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                className="section-node-select"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onSelectRow(
                                                        row.originKey,
                                                        section.key,
                                                        section.actionTask?.id || section.currentTask?.id || ''
                                                    );
                                                }}
                                            >
                                                <span className="section-node-label">{section.shortLabel}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                        </article>
                    );
                })}
            </div>
        )}
    </Card>
);

export default TodoListCard;
