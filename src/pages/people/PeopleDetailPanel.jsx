import { formatPhone, normalizePhoneDigits } from '../../utils/formatters';
import { buildTeamRoleKeys, CATEGORY_LABELS, roleLabel } from './peopleHelpers';
import PeopleForm from './PeopleForm';

const renderTagChips = (tagsList) => {
    if (!tagsList || tagsList.length === 0) {
        return null;
    }
    return (
        <div className="tag-row">
            {tagsList.map((tag) => {
                const normalized = tag.toLowerCase();
                const isVestry = normalized === 'vestry';
                const isVestryMember = normalized === 'vestry member';
                const isVolunteer = normalized === 'volunteer';
                return (
                    <span
                        className={`tag-chip ${isVestry ? 'tag-chip--vestry' : ''} ${isVestryMember ? 'tag-chip--vestry-member' : ''} ${isVolunteer ? 'tag-chip--volunteer' : ''}`}
                        key={tag}
                    >
                        {tag}
                    </span>
                );
            })}
        </div>
    );
};

const renderRoleChips = (rolesList, teams = {}) => {
    if (!rolesList || rolesList.length === 0) {
        return null;
    }
    return (
        <div className="role-chip-row">
            {rolesList.map((role) => {
                const rotations = Array.isArray(teams?.[role]) ? teams[role] : [];
                return (
                    <span className="role-chip" key={role}>
                        {roleLabel(role)}
                        {rotations.map((rotation, index) => (
                            <span
                                className="role-chip-rotation"
                                key={`${role}-${rotation}`}
                                style={{ '--rotation-index': index }}
                            >
                                {rotation}
                            </span>
                        ))}
                    </span>
                );
            })}
        </div>
    );
};

const PeopleDetailPanel = ({
    panelMode,
    selectedPerson,
    categories,
    createForm,
    setCreateForm,
    editForm,
    setEditForm,
    onCancelCreate,
    onBeginEdit,
    onCreate,
    onSaveEdit,
    onDelete,
    handleRoleToggle,
    handleTeamChange
}) => {
    if (panelMode === 'create') {
        const teamRoleKeys = buildTeamRoleKeys(createForm.roles, createForm.teams);
        return (
            <div className="people-panel people-detail-panel">
                <div className="panel-title--row">
                    <h2 className="panel-title">New Person</h2>
                    <button className="btn-ghost" type="button" onClick={onCancelCreate}>
                        Cancel
                    </button>
                </div>
                <PeopleForm
                    idPrefix="create"
                    formData={createForm}
                    setFormData={setCreateForm}
                    categories={categories}
                    teamRoleKeys={teamRoleKeys}
                    submitLabel="Create person"
                    onSubmit={onCreate}
                    handleRoleToggle={handleRoleToggle}
                    handleTeamChange={handleTeamChange}
                />
            </div>
        );
    }

    if (panelMode === 'edit') {
        const teamRoleKeys = buildTeamRoleKeys(editForm.roles, editForm.teams);
        return (
            <div className="people-panel people-detail-panel">
                <div className="panel-title--row">
                    <h2 className="panel-title">Edit Person</h2>
                </div>
                <PeopleForm
                    idPrefix="edit"
                    formData={editForm}
                    setFormData={setEditForm}
                    categories={categories}
                    teamRoleKeys={teamRoleKeys}
                    submitLabel="Save changes"
                    onSubmit={onSaveEdit}
                    onDelete={() => onDelete(selectedPerson)}
                    handleRoleToggle={handleRoleToggle}
                    handleTeamChange={handleTeamChange}
                />
            </div>
        );
    }

    if (!selectedPerson) {
        return (
            <div className="people-panel people-detail-panel">
                <div className="empty-card">Select a person to view details.</div>
            </div>
        );
    }

    return (
        <div className="people-panel people-detail-panel">
            <div className="panel-title--row">
                <div className="panel-title-row">
                    <h2 className="panel-title">{selectedPerson.displayName}</h2>
                    {(() => {
                        const label = selectedPerson.envelopeNumber || '';
                        if (!label) return null;
                        return <span className="env-chip">{label}</span>;
                    })()}
                </div>
                <div className="panel-actions">
                    <button className="btn-ghost" type="button" onClick={() => onBeginEdit(selectedPerson)}>
                        Edit
                    </button>
                </div>
            </div>
            {(selectedPerson.category || selectedPerson.email || selectedPerson.phonePrimary || selectedPerson.phoneAlternate) ? (
                <div className="detail-section detail-section--inline">
                    {selectedPerson.category ? (
                        <span className={`category-chip category-${selectedPerson.category}`}>
                            {CATEGORY_LABELS[selectedPerson.category] || selectedPerson.category}
                        </span>
                    ) : null}
                    {selectedPerson.email ? (
                        <a className="panel-meta panel-link" href={`mailto:${selectedPerson.email}`}>
                            {selectedPerson.email}
                        </a>
                    ) : null}
                    {(() => {
                        const phoneParts = [selectedPerson.phonePrimary, selectedPerson.phoneAlternate].filter(Boolean);
                        if (!phoneParts.length) return null;
                        return (
                            <span className="panel-meta">
                                {phoneParts.map((phone, index) => {
                                    const digits = normalizePhoneDigits(phone);
                                    const display = formatPhone(phone);
                                    return (
                                        <span key={`${phone}-${index}`}>
                                            <a className="panel-link" href={`tel:${digits || phone}`}>
                                                {display}
                                            </a>
                                            {index < phoneParts.length - 1 ? ' | ' : ''}
                                        </span>
                                    );
                                })}
                            </span>
                        );
                    })()}
                </div>
            ) : null}
            {(() => {
                const streetParts = [selectedPerson.addressLine1, selectedPerson.addressLine2].filter(Boolean);
                const cityState = [selectedPerson.city, selectedPerson.state].filter(Boolean).join(', ');
                const zip = selectedPerson.postalCode;
                const cityLine = [cityState, zip].filter(Boolean).join(' ');
                const addressLines = [...streetParts, cityLine].filter(Boolean);
                if (!addressLines.length) return null;
                const mapQuery = encodeURIComponent(addressLines.join(', '));
                return (
                    <div className="detail-section">
                        <a
                            className="panel-meta panel-link address-link"
                            href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {addressLines.map((line) => (
                                <span className="address-line" key={line}>{line}</span>
                            ))}
                        </a>
                    </div>
                );
            })()}
            {(() => {
                const tags = (selectedPerson.tags || []).filter((tag) => !/^env-\d+/i.test(tag));
                const chips = renderTagChips(tags);
                return chips ? <div className="detail-section">{chips}</div> : null;
            })()}
            {selectedPerson.roles?.length ? (
                <div className="detail-section">
                    <span className="detail-label">Roles</span>
                    {renderRoleChips(selectedPerson.roles, selectedPerson.teams)}
                </div>
            ) : null}
        </div>
    );
};

export default PeopleDetailPanel;
