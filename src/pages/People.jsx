import { formatPhone } from '../utils/formatters';
import { ROLE_OPTIONS } from '../utils/constants';
import PeopleDetailPanel from './people/PeopleDetailPanel';
import { CATEGORY_LABELS } from './people/peopleHelpers';
import { usePeopleData } from './people/usePeopleData';
import './People.css';

const People = () => {
    const {
        people,
        loading,
        error,
        backupBusy,
        backupError,
        selectedId,
        panelMode,
        filters,
        editForm,
        createForm,
        selectedPerson,
        categories,
        roles,
        tags,
        teams,
        filteredPeople,
        setSelectedId,
        setPanelMode,
        setEditForm,
        setCreateForm,
        handleFilterChange,
        resetFilters,
        beginCreate,
        beginEdit,
        handleRoleToggle,
        handleTeamChange,
        handleSaveEdit,
        handleCreate,
        handleDelete,
        handleRestoreBackup
    } = usePeopleData();

    return (
        <section className="page-people">
            <header className="people-header page-header-bar">
                <div className="page-header-title">
                    <h1>People</h1>
                    <p className="page-subtitle page-header-subtitle">
                        Maintain the canonical people database used across schedules, teams, and communications.
                    </p>
                </div>
                <div className="people-header-actions page-header-actions">
                    <button className="btn-secondary" type="button" onClick={handleRestoreBackup} disabled={backupBusy}>
                        {backupBusy ? 'Checking backup...' : 'Restore Backup'}
                    </button>
                    <button className="btn-primary" type="button" onClick={beginCreate}>
                        Add person
                    </button>
                </div>
            </header>

            <div className="people-filter-bar">
                <div className="filter-row">
                    <div className="filter-group grow">
                        <label htmlFor="people-search">Search</label>
                        <input
                            id="people-search"
                            className="filter-input"
                            value={filters.search}
                            placeholder="Search name, email, tags"
                            onChange={(event) => handleFilterChange('search', event.target.value)}
                        />
                    </div>
                    <div className="filter-group">
                        <label htmlFor="people-category">Category</label>
                        <select
                            id="people-category"
                            className="filter-select"
                            value={filters.category}
                            onChange={(event) => handleFilterChange('category', event.target.value)}
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
                        <label htmlFor="people-role">Role</label>
                        <select
                            id="people-role"
                            className="filter-select"
                            value={filters.role}
                            onChange={(event) => handleFilterChange('role', event.target.value)}
                        >
                            <option value="">All roles</option>
                            {ROLE_OPTIONS.filter((role) => roles.includes(role.value)).map((role) => (
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
                            onChange={(event) => handleFilterChange('tag', event.target.value)}
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
                            onChange={(event) => handleFilterChange('team', event.target.value)}
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
                    <button className="btn-secondary" type="button" onClick={resetFilters}>
                        Clear filters
                    </button>
                </div>
            </div>

            {error && <div className="people-error">{error}</div>}
            {backupError && <div className="people-error">{backupError}</div>}

            <div className="people-workspace people-workspace--split">
                <div className="people-panel people-list-panel">
                    <div className="panel-title--row">
                        <h2 className="panel-title">Directory</h2>
                        <span className="panel-meta">
                            {filteredPeople.length} of {people.length}
                        </span>
                    </div>
                    {loading ? (
                        <div className="people-loading">Loading people...</div>
                    ) : filteredPeople.length === 0 ? (
                        <div className="empty-card">No people match the current filters.</div>
                    ) : (
                        <div className="people-list">
                            {filteredPeople.map((person) => (
                                <button
                                    className={`people-list-item ${person.id === selectedId ? 'active' : ''}`}
                                    key={person.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedId(person.id);
                                        setPanelMode('view');
                                    }}
                                >
                                    <div className="people-list-row">
                                        <div className="people-list-cell people-list-env">
                                            {(() => {
                                                const envelopeTag = (person.tags || []).find((tag) => /^env-\d+/i.test(tag));
                                                if (!envelopeTag) return null;
                                                const label = envelopeTag.replace(/^env-/i, '');
                                                return <span className="env-chip env-chip--list">{label}</span>;
                                            })()}
                                        </div>
                                        <div className="people-list-cell people-list-name">
                                            <span>{person.displayName}</span>
                                        </div>
                                        <div className="people-list-cell people-list-email">
                                            {person.email || ''}
                                        </div>
                                        <div className="people-list-cell people-list-phone">
                                            {formatPhone(person.phonePrimary || person.phoneAlternate || '')}
                                        </div>
                                        <div className="people-list-cell people-list-category">
                                            {person.category && (
                                                <span className={`category-chip category-${person.category}`}>
                                                    {CATEGORY_LABELS[person.category] || person.category}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <PeopleDetailPanel
                    panelMode={panelMode}
                    selectedPerson={selectedPerson}
                    categories={categories}
                    createForm={createForm}
                    setCreateForm={setCreateForm}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    onCancelCreate={() => setPanelMode('view')}
                    onBeginEdit={beginEdit}
                    onCreate={handleCreate}
                    onSaveEdit={handleSaveEdit}
                    onDelete={handleDelete}
                    handleRoleToggle={handleRoleToggle}
                    handleTeamChange={handleTeamChange}
                />
            </div>
        </section>
    );
};

export default People;
