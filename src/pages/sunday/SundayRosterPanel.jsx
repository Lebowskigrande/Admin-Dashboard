import Card from '../../components/Card';

const SundayRosterPanel = ({
    services,
    buildings,
    roleDrafts,
    locationDrafts,
    people,
    peopleById,
    openMenu,
    openTooltipKey,
    menuDirection,
    toggleRoleMenu,
    toggleTeamSelection,
    togglePersonSelection,
    updateLocationDraft,
    renderTooltipCard,
    renderRoleProgress,
    getTeamMap,
    getServiceRoleKeys,
    defaultLocationForTime,
    formatServiceTime,
    multiAssignmentRoles,
    roleDefinitions,
    onTooltipToggle
}) => {
    const servicePanels = services.map((service) => (
        <Card key={service.id} className="sunday-service-card">
            <header className="sunday-service-header">
                <div>
                    <h3>{formatServiceTime(service.time)} Sunday Service - {service.rite || 'Rite II'}</h3>
                    <div className="service-location">
                        <span>Location</span>
                        <select
                            value={locationDrafts?.[service.time] || service.location || defaultLocationForTime(service.time)}
                            onChange={(event) => updateLocationDraft(service.time, event.target.value)}
                        >
                            {buildings.length === 0 ? (
                                <option value={defaultLocationForTime(service.time)}>
                                    {defaultLocationForTime(service.time)}
                                </option>
                            ) : (
                                buildings.map((building) => (
                                    <option key={building.id} value={building.id}>
                                        {building.name}
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                </div>
            </header>
            <div className="service-roles-grid">
                {roleDefinitions.filter((role) => getServiceRoleKeys(service).includes(role.key)).map((role) => {
                    const isMulti = multiAssignmentRoles.has(role.key);
                    const selectedValue = roleDrafts?.[service.time]?.[role.key];
                    const selectValue = isMulti
                        ? (Array.isArray(selectedValue) ? selectedValue : (selectedValue ? [selectedValue] : []))
                        : (Array.isArray(selectedValue) ? (selectedValue[0] || '') : (selectedValue || ''));
                    const eligiblePeople = people.filter((person) => (person.roles || []).includes(role.key));
                    const teamMap = getTeamMap(role.key, eligiblePeople);
                    const teamEntries = Array.from(teamMap.entries()).sort((a, b) => a[0] - b[0]);
                    const selectedPeople = (Array.isArray(selectValue) ? selectValue : [selectValue])
                        .map((id) => peopleById.get(id))
                        .filter(Boolean);
                    const menuOpen = openMenu?.serviceTime === service.time && openMenu?.roleKey === role.key;

                    return (
                        <div key={`${service.id}-${role.key}`} className="role-edit-row">
                            <div className="role-menu-anchor">
                                <button
                                    type="button"
                                    className="role-menu-trigger"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        toggleRoleMenu(service.time, role.key);
                                    }}
                                    disabled={eligiblePeople.length === 0}
                                    aria-expanded={menuOpen ? 'true' : 'false'}
                                >
                                    <span>{role.label}</span>
                                    <span className={`caret-icon ${menuOpen ? 'open' : ''}`}>&#9656;</span>
                                </button>
                                {menuOpen && (
                                    <div
                                        className={`person-menu ${menuDirection === 'down' ? 'open-down' : 'open-up'}`}
                                        data-menu-key={`${service.time}-${role.key}`}
                                    >
                                        {isMulti && teamEntries.length > 0 && (
                                            <div className="person-menu-section">
                                                <div className="person-menu-title">Teams</div>
                                                {teamEntries.map(([teamNumber, memberIds]) => {
                                                    const teamSelected = memberIds.every((id) => selectValue.includes(id));
                                                    return (
                                                        <button
                                                            key={`${service.id}-${role.key}-team-${teamNumber}`}
                                                            type="button"
                                                            className="person-menu-item"
                                                            onClick={() => toggleTeamSelection(service.time, role.key, memberIds)}
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
                                                const isSelected = isMulti
                                                    ? selectValue.includes(person.id)
                                                    : selectValue === person.id;
                                                const category = person.category || 'volunteer';
                                                return (
                                                    <button
                                                        key={`${service.id}-${role.key}-${person.id}`}
                                                        type="button"
                                                        className="person-menu-item"
                                                        onClick={() => togglePersonSelection(service.time, role.key, person.id, isMulti)}
                                                    >
                                                        <span className={`person-chip person-chip-${category} ${isSelected ? 'chip-selected' : ''}`}>
                                                            {person.displayName}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            {selectedPeople.length > 0 ? (
                                <div className="role-chip-list">
                                    {selectedPeople.map((person) => (
                                        <span
                                            key={person.id}
                                            className={`person-chip-wrapper ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'tooltip-open' : ''}`}
                                            onClick={(event) => onTooltipToggle(event, `${service.time}-${role.key}-${person.id}`)}
                                        >
                                            <span className={`person-chip person-chip-${person.category || 'volunteer'}`}>{person.displayName}</span>
                                            <span className={`person-tooltip ${openTooltipKey === `${service.time}-${role.key}-${person.id}` ? 'open' : ''}`}>
                                                {renderTooltipCard(person)}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </Card>
    ));

    return (
        <section id="volunteers" className="sunday-services">
            <div className="section-header">
                <h2>Service Roles</h2>
                <span className="text-muted">Every role for each service is listed below.</span>
            </div>
            {renderRoleProgress()}
            {servicePanels.length > 0 ? servicePanels : (
                <Card className="empty-card">No service assignments available for this Sunday.</Card>
            )}
        </section>
    );
};

export default SundayRosterPanel;
