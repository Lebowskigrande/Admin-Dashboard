import { CATEGORY_LABELS, MEMBER_STATUS_LABELS } from './peopleHelpers';

const PeopleFilters = ({
    filters,
    categories,
    roles,
    tags,
    teams,
    roleOptions,
    onFilterChange,
    onResetFilters
}) => (
    <div className="people-filter-bar">
        <div className="filter-row">
            <div className="filter-group grow">
                <label htmlFor="people-search">Search</label>
                <input
                    id="people-search"
                    className="filter-input"
                    value={filters.search}
                    placeholder="Search name, email, envelope, tags"
                    onChange={(event) => onFilterChange('search', event.target.value)}
                />
            </div>
            <div className="filter-group">
                <label htmlFor="people-category">Category</label>
                <select
                    id="people-category"
                    className="filter-select"
                    value={filters.category}
                    onChange={(event) => onFilterChange('category', event.target.value)}
                >
                    <option value="">All categories</option>
                    {categories.map((category) => (
                        <option key={category} value={category}>
                            {CATEGORY_LABELS[category] || category}
                        </option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label htmlFor="people-member-status">Member status</label>
                <select
                    id="people-member-status"
                    className="filter-select"
                    value={filters.memberStatus}
                    onChange={(event) => onFilterChange('memberStatus', event.target.value)}
                >
                    <option value="">All statuses</option>
                    {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label htmlFor="people-role">Role</label>
                <select
                    id="people-role"
                    className="filter-select"
                    value={filters.role}
                    onChange={(event) => onFilterChange('role', event.target.value)}
                >
                    <option value="">All roles</option>
                    {roleOptions.filter((role) => roles.includes(role.value)).map((role) => (
                        <option key={role.value} value={role.value}>
                            {role.label}
                        </option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label htmlFor="people-tag">Tag</label>
                <select
                    id="people-tag"
                    className="filter-select"
                    value={filters.tag}
                    onChange={(event) => onFilterChange('tag', event.target.value)}
                >
                    <option value="">All tags</option>
                    {tags.map((tag) => (
                        <option key={tag} value={tag}>
                            {tag}
                        </option>
                    ))}
                </select>
            </div>
            <div className="filter-group">
                <label htmlFor="people-team">Team #</label>
                <select
                    id="people-team"
                    className="filter-select"
                    value={filters.team}
                    onChange={(event) => onFilterChange('team', event.target.value)}
                >
                    <option value="">Any team</option>
                    {teams.map((team) => (
                        <option key={team} value={team}>
                            {team}
                        </option>
                    ))}
                </select>
            </div>
        </div>
        <div className="filter-actions">
            <button className="btn-secondary" type="button" onClick={onResetFilters}>
                Clear filters
            </button>
        </div>
    </div>
);

export default PeopleFilters;
