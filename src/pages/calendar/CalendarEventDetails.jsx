import { createElement } from 'react';
import { format } from 'date-fns';
import { FaArrowRight, FaCheckCircle, FaExclamationTriangle, FaEye, FaExternalLinkAlt, FaFileAlt, FaFolderOpen, FaPaperclip } from 'react-icons/fa';

import DataPill from '../../components/DataPill';
import '../../components/tasks/taskDisplays.css';
import { getTaskPriorityClass, getTaskPriorityLabel, isTaskBlocked } from '../../components/tasks/taskDisplayHelpers';
import { getDueInfo } from '../todo/todoHelpers';
import { getSectionPresentation } from '../todo/sectionCatalog';
import { getSectionIconComponent } from '../todo/todoVisuals';
import { getTaskActionLabel, getTaskProgressMeta } from '../../utils/taskProgress';

const RENTAL_ONLY_FIELD_KEYS = new Set(['rental_rate']);
const CONTRACT_REQUIRED_EVENT_TYPES = new Set(['wedding', 'concert', 'private-rental']);
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

const compareDueInfo = (a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.due?.getTime?.() ?? Number.POSITIVE_INFINITY) - (b.due?.getTime?.() ?? Number.POSITIVE_INFINITY);
};

const getEventTaskStateKey = (task, progressMeta) => {
    if (task?.completed) return 'done';
    if (isTaskBlocked(task)) return 'blocked';
    if (progressMeta?.currentIndex >= 0) return 'in_progress';
    return 'open';
};

const getEventTaskStateIcon = (stateKey) => {
    if (stateKey === 'done') return <FaCheckCircle />;
    if (stateKey === 'blocked') return <FaExclamationTriangle />;
    if (stateKey === 'in_progress') return <FaArrowRight />;
    return <FaFileAlt />;
};

const getEventModeMeta = ({ calendarRole, entryKind, taskPolicy, displayGroup }) => {
    const role = String(calendarRole || '').trim().toLowerCase();
    const kind = String(entryKind || '').trim().toLowerCase();
    const policy = String(taskPolicy || '').trim().toLowerCase();
    const group = String(displayGroup || '').trim();

    if (role === 'personal' || kind === 'personal') {
        return { tone: 'personal', label: group || 'Personal' };
    }
    if (kind === 'out of office' || kind === 'schedule') {
        return { tone: 'schedule', label: kind === 'out of office' ? 'Out of Office' : 'Schedule' };
    }
    if (kind === 'reminder' || kind === 'deadline') {
        return { tone: 'reminder', label: kind === 'deadline' ? 'Deadline' : 'Reminder' };
    }
    if (policy === 'never' || policy === 'manual only') {
        return { tone: 'reference', label: group || 'Reference' };
    }
    return { tone: 'work', label: group || 'Work' };
};

const DocumentRows = ({
    docs,
    emptyMessage,
    onPreviewDocument,
    onOpenDocument,
    onOpenLocation
}) => {
    if (!docs.length) {
        return <div className="event-detail-empty">{emptyMessage}</div>;
    }

    return docs.map((doc) => (
        <div key={doc.id} className="event-document-row">
            <div className="event-document-meta">
                <span className="event-document-name">{doc.file_name}</span>
                {doc.label && <span className="event-document-tag">{doc.label}</span>}
            </div>
            <div className="event-document-actions">
                <button type="button" className="btn-icon small" onClick={() => onPreviewDocument(doc)} disabled={!doc.preview} title="Preview">
                    <FaEye />
                </button>
                <button type="button" className="btn-icon small" onClick={() => onOpenDocument(doc)} title="Open">
                    <FaExternalLinkAlt />
                </button>
                <button type="button" className="btn-icon small" onClick={() => onOpenLocation(doc)} title="Open File Location">
                    <FaFolderOpen />
                </button>
            </div>
        </div>
    ));
};

const EventTemplateFieldsSection = ({
    templateFields,
    templateData,
    eventTypeSlug,
    onTemplateChange
}) => {
    if (!templateFields.length) return null;
    const rentalLocked = eventTypeSlug === 'private-rental';
    const rentalActive = rentalLocked || !!templateData?.rental;
    const visibleFields = templateFields.filter((field) => {
        const key = String(field.field_key || '').trim();
        if (!key) return false;
        if (key === 'rental' && rentalLocked) return false;
        if (key === 'setup_description' && !templateData?.setup_required) return false;
        if (RENTAL_ONLY_FIELD_KEYS.has(key) && !rentalActive) return false;
        return true;
    });
    if (!visibleFields.length) return null;

    return (
        <div className="event-detail-section event-detail-meta">
            <div className="event-detail-header-row">
                <span className="event-detail-label">Event Details</span>
            </div>
            <div className="event-detail-template-grid">
                {visibleFields.map((field) => {
                    const value = templateData?.[field.field_key];
                    const fieldType = field.field_type || 'text';
                    const key = field.field_key;

                    if (fieldType === 'textarea') {
                        return (
                            <label key={key} className="event-detail-template-field">
                                <span>{field.label}{field.required ? ' *' : ''}</span>
                                <textarea
                                    value={value || ''}
                                    placeholder={field.placeholder || ''}
                                    onChange={(event) => onTemplateChange(key, event.target.value)}
                                    rows="3"
                                />
                                {field.help_text ? <small>{field.help_text}</small> : null}
                            </label>
                        );
                    }

                    if (fieldType === 'select') {
                        const options = Array.isArray(field.options) ? field.options : [];
                        return (
                            <label key={key} className="event-detail-template-field">
                                <span>{field.label}{field.required ? ' *' : ''}</span>
                                <select
                                    value={value || ''}
                                    onChange={(event) => onTemplateChange(key, event.target.value)}
                                >
                                    <option value="">Select...</option>
                                    {options.map((option) => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                                {field.help_text ? <small>{field.help_text}</small> : null}
                            </label>
                        );
                    }

                    if (fieldType === 'checkbox') {
                        return (
                            <label key={key} className="event-detail-template-field event-detail-template-checkbox">
                                <input
                                    type="checkbox"
                                    checked={!!value}
                                    onChange={(event) => onTemplateChange(key, event.target.checked)}
                                />
                                <span>{field.label}{field.required ? ' *' : ''}</span>
                            </label>
                        );
                    }

                    return (
                        <label key={key} className="event-detail-template-field">
                            <span>{field.label}{field.required ? ' *' : ''}</span>
                            <input
                                type={fieldType}
                                value={value || ''}
                                placeholder={field.placeholder || ''}
                                onChange={(event) => onTemplateChange(key, event.target.value)}
                            />
                            {field.help_text ? <small>{field.help_text}</small> : null}
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

const EventTaskGroupCard = ({ group, onTaskToggle }) => {
    const presentation = getSectionPresentation({
        originType: 'event',
        listKey: group.listKey,
        listTitle: group.title,
        taskText: group.items[0]?.text || ''
    });
    const iconElement = createElement(getSectionIconComponent(presentation.iconKey));
    const openItems = group.items.filter((task) => !task.completed);
    const blockedCount = openItems.filter((task) => isTaskBlocked(task)).length;
    const groupDue = openItems
        .map((task) => getDueInfo(task))
        .filter(Boolean)
        .sort(compareDueInfo)[0] || null;
    const dueIndicator = groupDue?.rank === 0 ? 'overdue' : (groupDue?.rank === 1 ? 'today' : '');
    const groupStatus = openItems.length === 0
        ? 'done'
        : blockedCount === openItems.length && blockedCount > 0
            ? 'blocked'
            : openItems.some((task) => {
                const meta = getTaskProgressMeta(task);
                return meta?.currentIndex >= 0;
            })
                ? 'in_progress'
                : 'open';
    const totalCount = group.items.length;

    return (
        <div className="event-task-cluster">
            <div className="event-task-cluster-head">
                <div className="event-task-cluster-ident">
                    <span className={`section-node-icon state-${groupStatus}`}>
                        {iconElement}
                        {dueIndicator ? <span className={`section-due-chip is-${dueIndicator}`}>{dueIndicator === 'overdue' ? '!' : ''}</span> : null}
                        {openItems.length > 0 ? <span className={`section-state-chip status-${groupStatus}`}>{openItems.length}</span> : null}
                    </span>
                    <div className="event-task-cluster-copy">
                        <div className="event-task-cluster-title-row">
                            <strong className="event-detail-task-title">{presentation.title}</strong>
                        </div>
                        <div className="event-task-cluster-meta">
                            <span>{totalCount} task{totalCount === 1 ? '' : 's'}</span>
                            {blockedCount ? <span>{blockedCount} blocked</span> : null}
                            {groupDue ? <span className={`priority-pill ${groupDue.className}`}>{groupDue.label}</span> : null}
                        </div>
                    </div>
                </div>
                {openItems.length > 0 ? <span className="event-detail-task-count">{openItems.length} open</span> : null}
            </div>

            <div className="event-task-cluster-list">
                {group.items.map((task) => {
                    const progressMeta = getTaskProgressMeta(task);
                    const taskDue = getDueInfo(task);
                    const stateKey = getEventTaskStateKey(task, progressMeta);
                    const actionLabel = getTaskActionLabel(task, { progressiveFallback: 'Advance', completeLabel: 'Complete' });
                    const priorityClass = getTaskPriorityClass(task);
                    const showPriority = priorityClass !== 'priority-normal';
                    return (
                        <div key={task.id} className={`event-task-row ${task.completed ? 'completed' : ''} state-${stateKey}`}>
                            <span className={`event-task-state state-${stateKey}`} aria-hidden="true">
                                {getEventTaskStateIcon(stateKey)}
                            </span>
                            <div className="event-task-row-main">
                                <div className="event-task-row-title">
                                    <span className="event-task-row-text">{task.text}</span>
                                    <div className="event-task-row-pills">
                                        {showPriority ? <span className={`priority-pill ${priorityClass}`}>{getTaskPriorityLabel(task)}</span> : null}
                                        {taskDue ? <span className={`priority-pill ${taskDue.className}`}>{taskDue.label}</span> : null}
                                    </div>
                                </div>
                                <div className="event-task-row-meta">
                                    <span>{progressMeta?.currentLabel || (task.completed ? 'Done' : 'Open')}</span>
                                    {progressMeta?.nextLabel && !task.completed ? (
                                        <span className="event-detail-task-next">{progressMeta.nextLabel}</span>
                                    ) : null}
                                    {isTaskBlocked(task) ? <span className="event-task-inline-flag">Blocked</span> : null}
                                </div>
                            </div>
                            <button type="button" className="btn-secondary event-task-row-action" onClick={() => onTaskToggle(task)}>
                                {actionLabel}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const CalendarEventDetails = ({
    loadingDetails,
    selectedEvent,
    eventDetails,
    serviceLabel,
    locationId,
    locationName,
    openTaskCount,
    isWorshipPlanning,
    templateFields,
    templateData,
    onTemplateChange,
    planningState,
    planningActions,
    planningHelpers,
    seriesState,
    notesState,
    notesActions,
    documentsState,
    documentActions,
    taskState,
    taskActions,
    onLocationClick
}) => {
    if (loadingDetails && !eventDetails) {
        return <div className="event-detail-loading">Loading event details...</div>;
    }

    const {
        buildings,
        people,
        planningDraft,
        guestMusicianInput,
        planningRoleKey,
        planningSaving,
        planningError,
        openRosterMenu,
        rosterMenuDirection,
        orderedRoleDefinitions,
        availablePlanningRoles
    } = planningState;
    const {
        setPlanningDraft,
        setGuestMusicianInput,
        setPlanningRoleKey,
        handleSavePlanning,
        handleAddGuestMusician,
        handleRemoveGuestMusician,
        handleAddPlanningRole,
        handleRemovePlanningRole,
        toggleRosterMenu,
        toggleRosterPersonSelection,
        toggleRosterTeamSelection
    } = planningActions;
    const {
        roleAllowsMultiple,
        normalizeRosterIds,
        getEligibleRosterPeople,
        getTeamMap,
        getRoleDisplayLabel
    } = planningHelpers;
    const { applyToSeries, setApplyToSeries, detailSaving, detailError } = seriesState;
    const { eventNotes } = notesState;
    const { setEventNotes, handleSaveDetails } = notesActions;
    const {
        bulletinDocs,
        contractDocs,
        attachmentDocs,
        linkedBulletinDoc,
        documentBusy,
        isRegularSundayService
    } = documentsState;
    const {
        handlePickBulletin,
        handlePickContract,
        handlePickOtherDocument,
        handlePreviewDocument,
        handleOpenDocument,
        handleOpenLocation
    } = documentActions;
    const { taskGroups, taskInput } = taskState;
    const { setTaskInput, handleAddTask, handleTaskToggle } = taskActions;

    const eventTypeSlug = eventDetails?.event?.type_slug || '';
    const rentalActive = eventTypeSlug === 'private-rental' || !!templateData?.rental;
    const showContractSlot = !isWorshipPlanning && (rentalActive || CONTRACT_REQUIRED_EVENT_TYPES.has(eventTypeSlug));
    const resolvedBulletinDocs = bulletinDocs.length > 0 ? bulletinDocs : (linkedBulletinDoc ? [linkedBulletinDoc] : []);
    const totalDocumentCount = resolvedBulletinDocs.length + contractDocs.length + attachmentDocs.length;
    const primaryDocs = isWorshipPlanning ? resolvedBulletinDocs : contractDocs;
    const secondaryDocs = showContractSlot ? attachmentDocs : [...contractDocs, ...attachmentDocs];
    const primaryDocTitle = isWorshipPlanning ? 'Bulletin' : 'Contract';
    const primaryDocBusy = isWorshipPlanning ? documentBusy?.bulletin : documentBusy?.contract;
    const primaryDocExists = primaryDocs.length > 0;
    const primaryEmptyMessage = isWorshipPlanning
        ? (isRegularSundayService ? 'No bulletin found in the Sunday bulletin folder yet.' : 'No bulletin uploaded.')
        : 'No contract uploaded.';
    const contactSummary = [
        eventDetails?.metadata?.contact_person || eventDetails?.metadata?.contactName || templateData?.contact_person || '',
        eventDetails?.metadata?.contact_email || '',
        eventDetails?.metadata?.contact_phone || ''
    ].filter(Boolean).join(' • ');
    const entryKind = String(
        selectedEvent?.entry_kind
        || eventDetails?.metadata?.entryKind
        || eventDetails?.notes?.classification?.entryKind
        || ''
    ).replace(/_/g, ' ');
    const displayGroup = selectedEvent?.display_group
        || eventDetails?.metadata?.displayGroup
        || eventDetails?.notes?.calendar?.displayGroup
        || '';
    const taskPolicy = String(
        selectedEvent?.task_policy
        || eventDetails?.metadata?.taskPolicy
        || eventDetails?.notes?.classification?.taskPolicy
        || ''
    ).replace(/_/g, ' ');
    const calendarRole = String(
        selectedEvent?.calendar_role
        || eventDetails?.metadata?.calendarRole
        || eventDetails?.notes?.calendar?.role
        || ''
    ).replace(/_/g, ' ');
    const modeMeta = getEventModeMeta({ calendarRole, entryKind, taskPolicy, displayGroup });
    const detailFlags = Array.isArray(eventDetails?.flags) ? eventDetails.flags : (Array.isArray(selectedEvent?.flags) ? selectedEvent.flags : []);
    const futureOccurrenceCount = Number(eventDetails?.package?.futureOccurrenceCount || 0);
    const summaryMeta = [
        modeMeta.label,
        entryKind && entryKind.toLowerCase() !== modeMeta.label.toLowerCase() ? entryKind : '',
        taskPolicy && taskPolicy.toLowerCase() !== 'auto' ? `${taskPolicy} tasks` : ''
    ].filter(Boolean);

    return (
        <div className="event-detail-modal">
            <div className={`event-detail-section event-detail-summary tone-${modeMeta.tone}`}>
                <div className="event-detail-grid">
                    <div>
                        <span className="event-detail-label">Date</span>
                        <span className="event-detail-value">
                            {selectedEvent?.date ? format(selectedEvent.date, 'MMMM d, yyyy') : '-'}
                        </span>
                    </div>
                    <div>
                        <span className="event-detail-label">Time</span>
                        <span className="event-detail-value">{selectedEvent?.time || 'All day'}</span>
                    </div>
                    <div>
                        <span className="event-detail-label">Type</span>
                        <span className="event-detail-value">{serviceLabel}</span>
                    </div>
                    <div>
                        <span className="event-detail-label">Location</span>
                        <span className="event-detail-value">
                            {locationName ? (
                                <DataPill
                                    type="building"
                                    value={locationName}
                                    label={locationName}
                                    showType={false}
                                    tooltip={`Location: ${locationName}`}
                                    onClick={() => {
                                        if (!locationId) return;
                                        onLocationClick();
                                    }}
                                />
                            ) : 'TBD'}
                        </span>
                    </div>
                    {contactSummary ? (
                        <div>
                            <span className="event-detail-label">Contact</span>
                            <span className="event-detail-value">{contactSummary}</span>
                        </div>
                    ) : null}
                </div>
                {eventDetails?.event?.description ? (
                    <div className="event-detail-description">{eventDetails.event.description}</div>
                ) : null}
                {summaryMeta.length > 0 ? (
                    <div className="event-detail-summary-strip">
                        {summaryMeta.map((value) => (
                            <span key={value} className="event-summary-pill">{value}</span>
                        ))}
                    </div>
                ) : null}
                {(futureOccurrenceCount > 1 || detailFlags.length > 0 || detailError) ? (
                    <div className="event-detail-summary-actions">
                        {futureOccurrenceCount > 1 ? (
                            <label className="event-series-toggle">
                                <input
                                    type="checkbox"
                                    checked={applyToSeries}
                                    onChange={(event) => setApplyToSeries(event.target.checked)}
                                />
                                <span>Edit all future occurrences in this series</span>
                            </label>
                        ) : <span />}
                        <button className="btn-primary" type="button" onClick={handleSaveDetails} disabled={detailSaving}>
                            {detailSaving ? 'Saving...' : 'Save Details'}
                        </button>
                    </div>
                ) : (
                    <div className="event-detail-summary-actions event-detail-summary-actions--compact">
                        <button className="btn-primary" type="button" onClick={handleSaveDetails} disabled={detailSaving}>
                            {detailSaving ? 'Saving...' : 'Save Details'}
                        </button>
                    </div>
                )}
                {detailFlags.length > 0 ? (
                    <div className="event-detail-flag-row">
                        {detailFlags.map((flag) => (
                            <span key={flag.key || flag.label} className={`event-detail-flag tone-${flag.tone || 'warning'}`} title={flag.detail || flag.label}>
                                {flag.label}
                            </span>
                        ))}
                    </div>
                ) : null}
                {detailError ? <div className="event-detail-inline-error">{detailError}</div> : null}
            </div>

            <div className="event-detail-column event-detail-column-left">
                <div className="event-detail-section event-detail-tasks-section">
                    <div className="event-detail-task-toolbar">
                        <div className="event-detail-task-heading">
                            <span className="event-detail-label">Tasks & Checklists</span>
                            <div className="event-task-toolbar-stats">
                                <span className="event-detail-section-meta">{openTaskCount} open</span>
                                <span className="event-detail-section-meta">{taskGroups.length} section{taskGroups.length === 1 ? '' : 's'}</span>
                            </div>
                        </div>
                        <div className="event-detail-task-add event-detail-task-add--inline">
                            <input
                                type="text"
                                placeholder="Add task..."
                                value={taskInput}
                                onChange={(event) => setTaskInput(event.target.value)}
                            />
                            <button className="btn-primary" type="button" onClick={handleAddTask}>
                                Add Task
                            </button>
                        </div>
                    </div>
                    {taskGroups.length === 0 ? (
                        <div className="event-detail-empty">No tasks for this occurrence yet.</div>
                    ) : (
                        <div className="event-task-cluster-grid">
                            {taskGroups.map((group) => (
                                <EventTaskGroupCard key={`${group.listKey || group.title}-${group.items.length}`} group={group} onTaskToggle={handleTaskToggle} />
                            ))}
                        </div>
                    )}
                </div>

                <EventTemplateFieldsSection
                    templateFields={templateFields}
                    templateData={templateData}
                    eventTypeSlug={eventTypeSlug}
                    onTemplateChange={onTemplateChange}
                />

                {isWorshipPlanning && (
                    <div className="event-detail-section event-detail-planning">
                        <div className="event-detail-header-row">
                            <span className="event-detail-label">Planning</span>
                            <button className="btn-secondary" type="button" onClick={handleSavePlanning} disabled={planningSaving}>
                                {planningSaving ? 'Saving...' : 'Save Planning'}
                            </button>
                        </div>
                        {eventDetails?.planning?.shared_source === 'liturgical-schedule' && (
                            <div className="event-roster-sync-note">Sunday roster changes here are shared with the Liturgical Schedule.</div>
                        )}
                        <div className="event-planning-stack">
                            <div className="event-planning-grid event-planning-grid--flat">
                                <div className="event-planning-card">
                                    <div className="event-detail-label">Setup</div>
                                    <label className="event-detail-template-field">
                                        <span>Location</span>
                                        <select
                                            value={planningDraft.buildingId || ''}
                                            onChange={(event) => setPlanningDraft((prev) => ({ ...prev, buildingId: event.target.value }))}
                                        >
                                            <option value="">Select location...</option>
                                            {buildings.map((building) => (
                                                <option key={building.id} value={building.id}>{building.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <div className="event-planning-card">
                                    <div className="event-detail-label">Music</div>
                                    <div className="event-planning-copy">
                                        <strong>Defaults</strong>
                                        <div className="event-chip-list">
                                            {(eventDetails?.planning?.musicians?.regular || []).length > 0 ? (
                                                (eventDetails?.planning?.musicians?.regular || []).map((entry) => (
                                                    <span key={entry} className="event-chip-tag event-chip-tag-regular">{entry}</span>
                                                ))
                                            ) : (
                                                <span className="event-detail-empty">No default musicians.</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="event-planning-copy">
                                        <strong>Guests</strong>
                                        <div className="event-chip-list">
                                            {planningDraft.guestMusicians.length > 0 ? (
                                                planningDraft.guestMusicians.map((entry) => (
                                                    <span key={entry} className="event-chip-tag event-chip-tag-guest">
                                                        {entry}
                                                        <button type="button" onClick={() => handleRemoveGuestMusician(entry)} aria-label={`Remove ${entry}`}>
                                                            x
                                                        </button>
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="event-detail-empty">No guest musicians added.</span>
                                            )}
                                        </div>
                                        <div className="event-inline-form">
                                            <input
                                                type="text"
                                                placeholder="Add guest musician"
                                                value={guestMusicianInput}
                                                onChange={(event) => setGuestMusicianInput(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key !== 'Enter') return;
                                                    event.preventDefault();
                                                    handleAddGuestMusician();
                                                }}
                                            />
                                            <button type="button" className="btn-secondary" onClick={handleAddGuestMusician}>Add Guest</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="event-roster-header">
                                <span className="event-detail-label">Roles & Staffing</span>
                            </div>

                            {eventDetails?.planning?.custom_roles_enabled && (
                                <div className="event-role-adder">
                                    <div className="event-role-adder-copy">
                                        <strong>Add role slot</strong>
                                        <span>Choose from known liturgical roles. Add only what this service actually needs.</span>
                                    </div>
                                    <div className="event-role-adder-controls">
                                        <select
                                            value={planningRoleKey}
                                            onChange={(event) => setPlanningRoleKey(event.target.value)}
                                        >
                                            <option value="">Select role...</option>
                                            {availablePlanningRoles.map((role) => (
                                                <option key={role.key} value={role.key}>{getRoleDisplayLabel(role)}</option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            className="btn-secondary"
                                            onClick={() => handleAddPlanningRole()}
                                            disabled={!planningRoleKey}
                                        >
                                            Add Role
                                        </button>
                                    </div>
                                    {availablePlanningRoles.length > 0 && (
                                        <div className="event-role-suggestions">
                                            {availablePlanningRoles.map((role) => (
                                                <button
                                                    key={role.key}
                                                    type="button"
                                                    className="event-role-suggestion"
                                                    onClick={() => handleAddPlanningRole(role.key)}
                                                >
                                                    {getRoleDisplayLabel(role)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="event-roster-list">
                                {orderedRoleDefinitions.map((role) => {
                                const selectedIds = normalizeRosterIds(role.key, planningDraft.roster?.[role.key] || []);
                                const eligiblePeople = getEligibleRosterPeople(role.key);
                                const teamEntries = Array.from(getTeamMap(role.key, eligiblePeople).entries()).sort((a, b) => a[0] - b[0]);
                                const selectedPeople = selectedIds
                                    .map((personId) => people.find((person) => person.id === personId))
                                    .filter(Boolean);
                                const menuOpen = openRosterMenu === role.key;
                                const roleLabel = getRoleDisplayLabel(role);
                                const triggerMeta = selectedPeople.length === 0
                                    ? (eligiblePeople.length === 0 ? 'No matches' : 'Select people')
                                    : (selectedPeople.length === 1 ? selectedPeople[0].displayName : `${selectedPeople.length} assigned`);
                                const triggerCount = selectedPeople.length === 0 ? '+' : String(selectedPeople.length);

                                return (
                                    <div key={role.key} className="event-roster-row">
                                        <div className="event-roster-row-header">
                                            <div className="role-menu-anchor">
                                                <button
                                                    type="button"
                                                    className="role-menu-trigger role-label-trigger"
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        toggleRosterMenu(role.key);
                                                    }}
                                                    disabled={eligiblePeople.length === 0}
                                                    aria-expanded={menuOpen ? 'true' : 'false'}
                                                >
                                                    <span className="role-trigger-copy">
                                                        <span className="role-label">{roleLabel}</span>
                                                        <span className="role-trigger-meta">{triggerMeta}</span>
                                                    </span>
                                                    <span className="role-trigger-count">{triggerCount}</span>
                                                    <span className={`caret-icon ${menuOpen ? 'open' : ''}`}>{menuOpen ? 'v' : '>'}</span>
                                                </button>
                                                {menuOpen && (
                                                    <div
                                                        className={`person-menu ${rosterMenuDirection === 'down' ? 'open-down' : 'open-up'}`}
                                                        data-roster-menu-key={role.key}
                                                    >
                                                        {roleAllowsMultiple(role.key) && teamEntries.length > 0 && (
                                                            <div className="person-menu-section">
                                                                <div className="person-menu-title">Teams</div>
                                                                {teamEntries.map(([teamNumber, memberIds]) => {
                                                                    const teamSelected = memberIds.every((personId) => selectedIds.includes(personId));
                                                                    return (
                                                                        <button
                                                                            key={`${role.key}-team-${teamNumber}`}
                                                                            type="button"
                                                                            className="person-menu-item"
                                                                            onClick={() => toggleRosterTeamSelection(role.key, memberIds)}
                                                                        >
                                                                            <span className={`person-chip person-chip-volunteer ${teamSelected ? 'chip-selected' : ''}`}>
                                                                                Team {teamNumber}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })}
                                                                <div className="person-menu-divider" />
                                                            </div>
                                                        )}
                                                        <div className="person-menu-section">
                                                            <div className="person-menu-title">People</div>
                                                            {eligiblePeople.map((person) => {
                                                                const isSelected = selectedIds.includes(person.id);
                                                                const category = person.category || 'volunteer';
                                                                return (
                                                                    <button
                                                                        key={`${role.key}-${person.id}`}
                                                                        type="button"
                                                                        className="person-menu-item"
                                                                        onClick={() => toggleRosterPersonSelection(role.key, person.id)}
                                                                    >
                                                                        <span className={`person-chip person-chip-${category} ${person.isPledger ? 'person-chip-pledger' : ''} ${isSelected ? 'chip-selected' : ''}`}>
                                                                            {person.displayName}
                                                                        </span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {role.is_custom && (
                                                <button type="button" className="btn-text" onClick={() => handleRemovePlanningRole(role.key)}>
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                        {selectedPeople.length === 0 ? (
                                            <span className="event-detail-empty">No one assigned.</span>
                                        ) : (
                                            <div className="role-chip-list event-role-chip-list">
                                                {selectedPeople.map((person) => (
                                                    <span
                                                        key={`${role.key}-${person.id}`}
                                                        className="person-chip-wrapper"
                                                        onClick={() => toggleRosterPersonSelection(role.key, person.id)}
                                                    >
                                                        <span className={`person-chip person-chip-${person.category || 'volunteer'} ${person.isPledger ? 'person-chip-pledger' : ''}`}>
                                                            {person.displayName}
                                                        </span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                                })}
                            </div>
                        </div>
                        {planningError && <div className="event-planning-error">{planningError}</div>}
                    </div>
                )}

            </div>

            <div className="event-detail-column event-detail-column-right">
                <div className="event-detail-section event-detail-documents-section">
                    <div className="event-detail-header-row">
                        <span className="event-detail-label">Documents</span>
                        <span className="event-detail-section-meta">{totalDocumentCount} total</span>
                    </div>
                    <div className="event-documents">
                        {(isWorshipPlanning || showContractSlot) && (
                            <div className="event-document-slot">
                                <div className="event-document-slot-header">
                                    <div className="event-document-slot-title">
                                        <span>{primaryDocTitle}</span>
                                        <span className="event-document-slot-subtitle">
                                            {isWorshipPlanning
                                                ? (isRegularSundayService
                                                    ? 'Checked automatically from the Sunday bulletin folder. Pick a file only if you need to override it here.'
                                                    : 'Keep the current bulletin for this service here.')
                                                : 'Keep the signed contract here.'}
                                        </span>
                                    </div>
                                    <div className="event-document-upload">
                                        <span className={`event-document-state ${primaryDocExists ? 'event-document-state--present' : ''}`}>
                                            {primaryDocExists ? <FaCheckCircle /> : <FaFileAlt />}
                                        </span>
                                        <label className="btn-icon event-document-upload-button" title={primaryDocExists ? `Change ${primaryDocTitle}` : `Pick ${primaryDocTitle}`}>
                                            <FaPaperclip />
                                            <input
                                                type="file"
                                                accept={DOCUMENT_ACCEPT}
                                                disabled={primaryDocBusy}
                                                onChange={async (event) => {
                                                    const file = event.target.files?.[0] || null;
                                                    if (isWorshipPlanning) {
                                                        await handlePickBulletin(file);
                                                    } else {
                                                        await handlePickContract(file);
                                                    }
                                                    event.target.value = '';
                                                }}
                                            />
                                        </label>
                                        {primaryDocBusy && <span className="event-document-inline-status">Uploading...</span>}
                                    </div>
                                </div>
                                <DocumentRows
                                    docs={primaryDocs}
                                    emptyMessage={primaryEmptyMessage}
                                    onPreviewDocument={handlePreviewDocument}
                                    onOpenDocument={handleOpenDocument}
                                    onOpenLocation={handleOpenLocation}
                                />
                            </div>
                        )}

                        <div className="event-document-slot">
                            <div className="event-document-slot-header">
                                <div className="event-document-slot-title">
                                    <span>Other Documents</span>
                                    <span className="event-document-slot-subtitle">
                                        {showContractSlot || isWorshipPlanning
                                            ? 'Add permits, schedules, or notes.'
                                            : 'Add contracts, schedules, or notes only when they matter.'}
                                    </span>
                                </div>
                                <div className="event-document-upload">
                                    <span className={`event-document-state ${secondaryDocs.length > 0 ? 'event-document-state--present' : ''}`}>
                                        {secondaryDocs.length > 0 ? <FaCheckCircle /> : <FaFileAlt />}
                                    </span>
                                    <label className="btn-icon event-document-upload-button" title="Pick document">
                                        <FaPaperclip />
                                        <input
                                            type="file"
                                            accept={DOCUMENT_ACCEPT}
                                            disabled={documentBusy?.attachment}
                                            onChange={async (event) => {
                                                const file = event.target.files?.[0] || null;
                                                await handlePickOtherDocument(file);
                                                event.target.value = '';
                                            }}
                                        />
                                    </label>
                                    {documentBusy?.attachment && <span className="event-document-inline-status">Uploading...</span>}
                                </div>
                            </div>
                            <DocumentRows
                                docs={secondaryDocs}
                                emptyMessage="No documents uploaded."
                                onPreviewDocument={handlePreviewDocument}
                                onOpenDocument={handleOpenDocument}
                                onOpenLocation={handleOpenLocation}
                            />
                        </div>
                    </div>
                </div>

                <div className="event-detail-section event-detail-notes-section">
                    <div className="event-detail-header-row">
                        <span className="event-detail-label">Internal Notes</span>
                    </div>
                    <textarea
                        className="event-detail-notes"
                        value={eventNotes}
                        onChange={(event) => setEventNotes(event.target.value)}
                        placeholder="Add internal notes for this occurrence..."
                        rows="3"
                    />
                </div>

            </div>
        </div>
    );
};

export default CalendarEventDetails;
