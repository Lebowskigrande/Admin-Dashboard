import { format } from 'date-fns';
import { FaCheckCircle, FaEye, FaExternalLinkAlt, FaFileAlt, FaFolderOpen, FaPaperclip } from 'react-icons/fa';

import DataPill from '../../components/DataPill';
import { getTaskActionLabel, getTaskProgressMeta } from '../../utils/taskProgress';

const RENTAL_ONLY_FIELD_KEYS = new Set(['rental_rate']);
const CONTRACT_REQUIRED_EVENT_TYPES = new Set(['wedding', 'concert', 'private-rental']);
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

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
                                <span>{field.label}</span>
                                <textarea
                                    value={value || ''}
                                    placeholder={field.placeholder || ''}
                                    onChange={(event) => onTemplateChange(key, event.target.value)}
                                    rows="3"
                                />
                            </label>
                        );
                    }

                    if (fieldType === 'select') {
                        const options = Array.isArray(field.options) ? field.options : [];
                        return (
                            <label key={key} className="event-detail-template-field">
                                <span>{field.label}</span>
                                <select
                                    value={value || ''}
                                    onChange={(event) => onTemplateChange(key, event.target.value)}
                                >
                                    <option value="">Select...</option>
                                    {options.map((option) => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
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
                                <span>{field.label}</span>
                            </label>
                        );
                    }

                    return (
                        <label key={key} className="event-detail-template-field">
                            <span>{field.label}</span>
                            <input
                                type={fieldType}
                                value={value || ''}
                                placeholder={field.placeholder || ''}
                                onChange={(event) => onTemplateChange(key, event.target.value)}
                            />
                        </label>
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
    assignedRosterCount,
    isWorshipPlanning,
    templateFields,
    templateData,
    onTemplateChange,
    planningState,
    planningActions,
    planningHelpers,
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
    const { eventNotes } = notesState;
    const { setEventNotes, handleSaveNotes } = notesActions;
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

    return (
        <div className="event-detail-modal">
            <div className="event-detail-section event-detail-summary">
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
                </div>
                <div className="event-detail-summary-strip">
                    <span className="event-summary-pill">{openTaskCount} open task{openTaskCount === 1 ? '' : 's'}</span>
                    <span className="event-summary-pill">{totalDocumentCount} document{totalDocumentCount === 1 ? '' : 's'}</span>
                    {isWorshipPlanning && (
                        <span className="event-summary-pill">{assignedRosterCount} roster assignment{assignedRosterCount === 1 ? '' : 's'}</span>
                    )}
                </div>
            </div>

            <div className="event-detail-column event-detail-column-left">
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

                <div className="event-detail-section event-detail-notes-section">
                    <div className="event-detail-header-row">
                        <span className="event-detail-label">Internal Notes</span>
                        <button className="btn-secondary" type="button" onClick={handleSaveNotes}>
                            Save Notes
                        </button>
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

                <div className="event-detail-section event-detail-tasks-section">
                    <div className="event-detail-header-row">
                        <span className="event-detail-label">Tasks & Checklists</span>
                        <span className="event-detail-section-meta">{openTaskCount} open</span>
                    </div>
                    {taskGroups.length === 0 ? (
                        <div className="event-detail-empty">No tasks for this occurrence yet.</div>
                    ) : (
                        taskGroups.map((group) => (
                            <div key={group.title} className="event-detail-task-group">
                                <div className="event-detail-task-group-header">
                                    <div className="event-detail-task-title">{group.title}</div>
                                    <span className="event-detail-task-count">
                                        {group.items.filter((task) => !task.completed).length} open
                                    </span>
                                </div>
                                <div className="event-detail-task-list">
                                    {group.items.map((task) => {
                                        const progressMeta = getTaskProgressMeta(task);
                                        const isProgressive = Boolean(progressMeta);
                                        return (
                                            <div key={task.id} className={`event-detail-task ${task.completed ? 'completed' : ''} ${isProgressive ? 'progressive' : ''}`}>
                                                {isProgressive ? (
                                                    <>
                                                        <div className="event-detail-task-copy">
                                                            <span>{task.text}</span>
                                                            <div className="event-detail-task-progress-row">
                                                                <small>{progressMeta.currentLabel || 'Not Started'}</small>
                                                                {progressMeta.nextLabel && (
                                                                    <span className="event-detail-task-next">{progressMeta.nextLabel}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <button type="button" className="btn-secondary" onClick={() => handleTaskToggle(task)}>
                                                            {getTaskActionLabel(task, { progressiveFallback: 'Advance', completeLabel: 'Complete' })}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <label className={`event-detail-task-toggle ${task.completed ? 'completed' : ''}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={task.completed}
                                                            onChange={() => handleTaskToggle(task)}
                                                        />
                                                        <span>{task.text}</span>
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                    <div className="event-detail-task-add">
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
            </div>
        </div>
    );
};

export default CalendarEventDetails;
