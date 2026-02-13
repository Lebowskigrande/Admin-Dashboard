import { ROLE_OPTIONS } from '../../utils/constants';
import { CATEGORY_LABELS, MEMBER_STATUS_LABELS, formatTeams, roleLabel } from './peopleHelpers';

const PeopleForm = ({
    idPrefix,
    formData,
    setFormData,
    categories,
    teamRoleKeys,
    submitLabel,
    onSubmit,
    onDelete,
    handleRoleToggle,
    handleTeamChange
}) => (
    <div className="people-form">
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-name`}>Display name</label>
                <input
                    id={`${idPrefix}-name`}
                    value={formData.displayName}
                    onChange={(event) => setFormData((prev) => ({ ...prev, displayName: event.target.value }))}
                />
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-email`}>Email</label>
                <input
                    id={`${idPrefix}-email`}
                    value={formData.email}
                    onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-phone-primary`}>Primary phone</label>
                <input
                    id={`${idPrefix}-phone-primary`}
                    value={formData.phonePrimary}
                    onChange={(event) => setFormData((prev) => ({ ...prev, phonePrimary: event.target.value }))}
                />
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-phone-alt`}>Alternate phone</label>
                <input
                    id={`${idPrefix}-phone-alt`}
                    value={formData.phoneAlternate}
                    onChange={(event) => setFormData((prev) => ({ ...prev, phoneAlternate: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-address1`}>Address line 1</label>
                <input
                    id={`${idPrefix}-address1`}
                    value={formData.addressLine1}
                    onChange={(event) => setFormData((prev) => ({ ...prev, addressLine1: event.target.value }))}
                />
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-address2`}>Address line 2</label>
                <input
                    id={`${idPrefix}-address2`}
                    value={formData.addressLine2}
                    onChange={(event) => setFormData((prev) => ({ ...prev, addressLine2: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-city`}>City</label>
                <input
                    id={`${idPrefix}-city`}
                    value={formData.city}
                    onChange={(event) => setFormData((prev) => ({ ...prev, city: event.target.value }))}
                />
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-state`}>State</label>
                <input
                    id={`${idPrefix}-state`}
                    value={formData.state}
                    onChange={(event) => setFormData((prev) => ({ ...prev, state: event.target.value }))}
                />
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-postal`}>Postal code</label>
                <input
                    id={`${idPrefix}-postal`}
                    value={formData.postalCode}
                    onChange={(event) => setFormData((prev) => ({ ...prev, postalCode: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-category`}>Category</label>
                <select
                    id={`${idPrefix}-category`}
                    value={formData.category}
                    onChange={(event) => setFormData((prev) => ({ ...prev, category: event.target.value }))}
                >
                    {categories.map((category) => (
                        <option key={category} value={category}>
                            {CATEGORY_LABELS[category] || category}
                        </option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-member-status`}>Member status</label>
                <select
                    id={`${idPrefix}-member-status`}
                    value={formData.memberStatus || 'unknown'}
                    onChange={(event) => setFormData((prev) => ({ ...prev, memberStatus: event.target.value }))}
                >
                    {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
            </div>
            <div className="form-group">
                <label htmlFor={`${idPrefix}-envelope`}>Envelope #</label>
                <input
                    id={`${idPrefix}-envelope`}
                    value={formData.envelopeNumber || ''}
                    onChange={(event) => setFormData((prev) => ({ ...prev, envelopeNumber: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-row">
            <div className="form-group">
                <label htmlFor={`${idPrefix}-tags`}>Tags (comma separated)</label>
                <input
                    id={`${idPrefix}-tags`}
                    value={formData.tagsText}
                    onChange={(event) => setFormData((prev) => ({ ...prev, tagsText: event.target.value }))}
                />
            </div>
        </div>
        <div className="form-group">
            <label>Roles</label>
            <div className="role-selector">
                {ROLE_OPTIONS.map((role) => (
                    <label className="role-option" key={role.value}>
                        <input
                            type="checkbox"
                            checked={(formData.roles || []).includes(role.value)}
                            onChange={() => handleRoleToggle(role.value, setFormData)}
                        />
                        {role.label}
                    </label>
                ))}
            </div>
        </div>
        <div className="form-group">
            <label>Team assignments (comma separated team numbers)</label>
            <div className="team-grid">
                {teamRoleKeys.map((roleKey) => (
                    <div className="form-group" key={roleKey}>
                        <label>{roleLabel(roleKey)}</label>
                        <input
                            value={formatTeams(formData.teams?.[roleKey])}
                            onChange={(event) => handleTeamChange(roleKey, event.target.value, setFormData)}
                        />
                    </div>
                ))}
                {teamRoleKeys.length === 0 && (
                    <span className="panel-meta">Select roles to add team assignments.</span>
                )}
            </div>
        </div>
        <div className="form-actions">
            <button className="btn-primary" type="button" onClick={onSubmit}>
                {submitLabel}
            </button>
            {onDelete && (
                <button className="btn-danger" type="button" onClick={onDelete}>
                    Delete
                </button>
            )}
        </div>
    </div>
);

export default PeopleForm;
