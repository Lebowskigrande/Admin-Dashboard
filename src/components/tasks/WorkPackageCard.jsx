import { getTaskCycleChipText, getTaskCycleLabel, getTaskCycleState } from '../../../shared/taskStatus.js';
import { getSectionIconComponent } from '../../pages/todo/todoVisuals';
import './taskDisplays.css';

const WorkPackageCard = ({
    originLabel,
    bucketLabel,
    title,
    subtitle,
    colorClass = '',
    active = false,
    sections = [],
    selectedSectionKey = '',
    onClick,
    onSectionSelect,
    footer = null
}) => {
    const handleKeyDown = (event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
        }
    };

    return (
        <article
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            className={`package-card ${colorClass} ${active ? 'active' : ''}`}
            onClick={onClick}
            onKeyDown={handleKeyDown}
        >
            <div className="package-card-accent" aria-hidden="true" />
            <div className="package-card-head">
                <div className="package-card-kicker">
                    {originLabel ? <span className="package-origin-label">{originLabel}</span> : null}
                    {bucketLabel ? <span className="package-bucket-pill">{bucketLabel}</span> : null}
                </div>
                <div className="package-card-title">{title}</div>
                {subtitle ? <div className="package-card-subtitle">{subtitle}</div> : null}
            </div>

            <div className="package-section-strip">
                {sections.map((section) => {
                    const Icon = getSectionIconComponent(section.iconKey);
                    const isFocused = Boolean(selectedSectionKey) && section.key === selectedSectionKey;
                    const chipText = getTaskCycleChipText(section.actionTask || section.currentTask);
                    const chipState = getTaskCycleState(section.actionTask || section.currentTask);
                    const content = (
                        <>
                            <span className={`section-node-icon state-${section.status}`}>
                                <Icon />
                                {section.dueIndicator ? <span className={`section-due-chip is-${section.dueIndicator}`}>{section.dueIndicator === 'overdue' ? '!' : ''}</span> : null}
                                {chipText ? <span className={`section-state-chip status-${chipState}`}>{chipText}</span> : null}
                            </span>
                            <span className="section-node-label">{section.shortLabel}</span>
                        </>
                    );

                    return (
                        <div
                            key={section.key}
                            className={`section-node attention-${section.attention} ${isFocused ? 'is-focused' : ''}`}
                        >
                            {onSectionSelect ? (
                                <button
                                    type="button"
                                    className="section-node-button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onSectionSelect(section);
                                    }}
                                    aria-label={section.actionTask ? `${section.title}: ${getTaskCycleLabel(section.actionTask)}` : section.title}
                                    title={section.actionTask ? `${section.title}: ${getTaskCycleLabel(section.actionTask)}` : section.title}
                                >
                                    {content}
                                </button>
                            ) : (
                                <div className="section-node-button static" aria-hidden="true">
                                    {content}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {footer ? <div className="package-card-footer">{footer}</div> : null}
        </article>
    );
};

export default WorkPackageCard;
