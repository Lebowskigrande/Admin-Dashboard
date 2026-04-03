import { useEffect, useMemo, useRef, useState } from 'react';
import { FaCopy } from 'react-icons/fa';
import { formatPhone } from '../utils/formatters';
import { ROLE_OPTIONS } from '../utils/constants';
import PeopleDetailPanel from './people/PeopleDetailPanel';
import { CATEGORY_LABELS } from './people/peopleHelpers';
import { usePeopleData } from './people/usePeopleData';
import './People.css';

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const normalizeLastName = (displayName) => {
    const raw = String(displayName || '').trim();
    if (!raw) return '';
    if (raw.includes(',')) {
        const [last] = raw.split(',');
        return normalizeText(last);
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return normalizeText(tokens[tokens.length - 1] || '');
};

const prettyLastName = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/(^|[\s-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);

const buildAddressKey = (person) => {
    const line1 = normalizeText(person.addressLine1);
    const line2 = normalizeText(person.addressLine2);
    const city = normalizeText(person.city);
    const state = normalizeText(person.state);
    const postalCode = normalizeText(person.postalCode);
    const key = [line1, line2, city, state, postalCode].join('|');
    return key.replace(/\|/g, '').trim() ? key : '';
};

const buildFamilyLabel = (members) => {
    const uniqueLastNames = [];
    members.forEach((member) => {
        const lastName = normalizeLastName(member.displayName);
        if (lastName && !uniqueLastNames.includes(lastName)) {
            uniqueLastNames.push(lastName);
        }
    });
    // Avoid duplicate-looking labels when a hyphenated child surname is present
    // alongside each parent surname (e.g. Chatfield + Kirhoffer + Chatfield-Kirhoffer).
    const filteredLastNames = uniqueLastNames.filter((name) => {
        if (!name.includes('-')) return true;
        const parts = name.split('-').map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2) return true;
        const allPartsAlreadyPresent = parts.every((part) => uniqueLastNames.includes(part));
        return !allPartsAlreadyPresent;
    });
    const finalLastNames = filteredLastNames.length > 0 ? filteredLastNames : uniqueLastNames;
    if (uniqueLastNames.length === 0) return 'Family';
    return `${finalLastNames.map(prettyLastName).join('-')} family`;
};

const buildFamilyRows = (people) => {
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const neighbors = new Map(people.map((person) => [person.id, new Set()]));

    const connect = (aId, bId) => {
        if (!aId || !bId || aId === bId) return;
        neighbors.get(aId)?.add(bId);
        neighbors.get(bId)?.add(aId);
    };

    const envelopeGroups = new Map();
    people.forEach((person) => {
        const envelope = String(person.envelopeNumber || '').trim();
        if (!envelope) return;
        if (!envelopeGroups.has(envelope)) envelopeGroups.set(envelope, []);
        envelopeGroups.get(envelope).push(person.id);
    });
    envelopeGroups.forEach((memberIds) => {
        if (memberIds.length < 2) return;
        for (let i = 0; i < memberIds.length; i += 1) {
            for (let j = i + 1; j < memberIds.length; j += 1) {
                connect(memberIds[i], memberIds[j]);
            }
        }
    });

    const nameAddressGroups = new Map();
    people.forEach((person) => {
        const lastName = normalizeLastName(person.displayName);
        const addressKey = buildAddressKey(person);
        if (!lastName || !addressKey) return;
        const key = `${lastName}::${addressKey}`;
        if (!nameAddressGroups.has(key)) nameAddressGroups.set(key, []);
        nameAddressGroups.get(key).push(person.id);
    });
    nameAddressGroups.forEach((memberIds) => {
        if (memberIds.length < 2) return;
        for (let i = 0; i < memberIds.length; i += 1) {
            for (let j = i + 1; j < memberIds.length; j += 1) {
                connect(memberIds[i], memberIds[j]);
            }
        }
    });

    const familyByPersonId = new Map();
    const families = [];
    const visited = new Set();
    people.forEach((person) => {
        if (visited.has(person.id)) return;
        const queue = [person.id];
        const componentIds = [];
        visited.add(person.id);
        while (queue.length > 0) {
            const currentId = queue.shift();
            componentIds.push(currentId);
            (neighbors.get(currentId) || []).forEach((nextId) => {
                if (visited.has(nextId)) return;
                visited.add(nextId);
                queue.push(nextId);
            });
        }

        const members = componentIds
            .map((id) => peopleById.get(id))
            .filter(Boolean);
        if (members.length < 2) return;

        const envelopeValues = Array.from(new Set(
            members
                .map((member) => String(member.envelopeNumber || '').trim())
                .filter(Boolean)
        ));
        const envelopeNumber = envelopeValues.length === 1 ? envelopeValues[0] : '';

        const family = {
            id: `family-cluster-${componentIds.slice().sort().join('-')}`,
            members,
            envelopeNumber,
            label: buildFamilyLabel(members)
        };
        families.push(family);
        members.forEach((member) => familyByPersonId.set(member.id, family));
    });

    const rendered = [];
    const renderedFamilyIds = new Set();
    people.forEach((person) => {
        const family = familyByPersonId.get(person.id);
        if (!family) {
            rendered.push({ type: 'person', person });
            return;
        }
        if (renderedFamilyIds.has(family.id)) return;
        renderedFamilyIds.add(family.id);
        rendered.push({ type: 'family', family });
    });

    return rendered;
};

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

    const familyRows = useMemo(() => buildFamilyRows(filteredPeople), [filteredPeople]);
    const [expandedFamilies, setExpandedFamilies] = useState(new Set());
    const availableFamilyIds = useMemo(
        () => new Set(familyRows.filter((row) => row.type === 'family').map((row) => row.family.id)),
        [familyRows]
    );
    const visibleExpandedFamilies = useMemo(() => {
        const next = new Set();
        expandedFamilies.forEach((id) => {
            if (availableFamilyIds.has(id)) next.add(id);
        });
        return next;
    }, [availableFamilyIds, expandedFamilies]);
    const [copyNotice, setCopyNotice] = useState('');
    const copyNoticeTimeoutRef = useRef(null);

    useEffect(() => () => {
        if (copyNoticeTimeoutRef.current) {
            clearTimeout(copyNoticeTimeoutRef.current);
        }
    }, []);

    const showCopyNotice = (message) => {
        setCopyNotice(message);
        if (copyNoticeTimeoutRef.current) {
            clearTimeout(copyNoticeTimeoutRef.current);
        }
        copyNoticeTimeoutRef.current = window.setTimeout(() => {
            setCopyNotice('');
            copyNoticeTimeoutRef.current = null;
        }, 1500);
    };

    const copyValue = async (value, message) => {
        const text = String(value || '').trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            showCopyNotice(message);
        } catch (error) {
            console.error('Clipboard copy failed:', error);
            showCopyNotice('Copy failed');
        }
    };

    const handleInlineCopy = (event, value, message) => {
        event.preventDefault();
        event.stopPropagation();
        copyValue(value, message);
    };

    const toggleFamily = (familyId) => {
        setExpandedFamilies((prev) => {
            const next = new Set(prev);
            if (next.has(familyId)) {
                next.delete(familyId);
            } else {
                next.add(familyId);
            }
            return next;
        });
    };

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
                            placeholder="Search name, email, envelope, tags, pledger"
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
                        <label htmlFor="people-pledger">Pledger</label>
                        <select
                            id="people-pledger"
                            className="filter-select"
                            value={filters.pledger}
                            onChange={(event) => handleFilterChange('pledger', event.target.value)}
                        >
                            <option value="">All</option>
                            <option value="yes">Pledgers</option>
                            <option value="no">Non-pledgers</option>
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
                            {familyRows.map((row) => {
                                if (row.type === 'person') {
                                    const person = row.person;
                                    return (
                                        <div
                                            className={`people-list-item ${person.id === selectedId ? 'active' : ''}`}
                                            key={person.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => {
                                                setSelectedId(person.id);
                                                setPanelMode('view');
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    setSelectedId(person.id);
                                                    setPanelMode('view');
                                                }
                                            }}
                                        >
                                            <div className="people-list-row">
                                                <div className="people-list-cell people-list-env">
                                                    {(() => {
                                                        const label = String(person.envelopeNumber || '').trim();
                                                        if (!label) return null;
                                                        return (
                                                            <span
                                                                className={`env-chip env-chip--list${
                                                                    person.isPledger ? ' env-chip--pledger' : ''
                                                                }`}
                                                            >
                                                                {label}
                                                            </span>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="people-list-cell people-list-name">
                                                    <span>{person.displayName}</span>
                                                </div>
                                                <div className="people-list-cell people-list-email">
                                                    {person.email ? (
                                                        <span className="people-copy-inline">
                                                            <span>{person.email}</span>
                                                            <button
                                                                type="button"
                                                                className="people-copy-button"
                                                                aria-label="Copy email"
                                                                onClick={(event) => handleInlineCopy(event, person.email, 'Email copied')}
                                                            >
                                                                <FaCopy />
                                                            </button>
                                                        </span>
                                                    ) : ''}
                                                </div>
                                                <div className="people-list-cell people-list-phone">
                                                    {(() => {
                                                        const phone = formatPhone(person.phonePrimary || person.phoneAlternate || '');
                                                        if (!phone) return '';
                                                        return (
                                                            <span className="people-copy-inline">
                                                                <span>{phone}</span>
                                                                <button
                                                                    type="button"
                                                                    className="people-copy-button"
                                                                    aria-label="Copy phone"
                                                                    onClick={(event) => handleInlineCopy(event, phone, 'Phone copied')}
                                                                >
                                                                    <FaCopy />
                                                                </button>
                                                            </span>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="people-list-cell people-list-category">
                                                    {person.category && (
                                                        <span className={`category-chip category-${person.category}`}>
                                                            {CATEGORY_LABELS[person.category] || person.category}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                const { family } = row;
                                const isExpanded = visibleExpandedFamilies.has(family.id);
                                const memberIds = new Set(family.members.map((member) => member.id));
                                const hasSelectedMember = selectedId && memberIds.has(selectedId);
                                const familyHasPledger = family.members.some((member) => Boolean(member.isPledger));
                                return (
                                    <div className="people-family-group" key={family.id}>
                                        <button
                                            className={`people-list-item people-list-item--family${
                                                hasSelectedMember ? ' active' : ''
                                            }`}
                                            type="button"
                                            onClick={() => toggleFamily(family.id)}
                                        >
                                            <div className="people-list-row">
                                                <div className="people-list-cell people-list-env">
                                                    {family.envelopeNumber ? (
                                                        <span className={`env-chip env-chip--list${familyHasPledger ? ' env-chip--pledger' : ''}`}>
                                                            {family.envelopeNumber}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="people-list-cell people-list-name people-list-family-name">
                                                    <span className={`people-list-chevron${isExpanded ? ' expanded' : ''}`}>&#9656;</span>
                                                    <span>{family.label}</span>
                                                </div>
                                                <div className="people-list-cell people-list-email">
                                                    {family.members.length} member{family.members.length === 1 ? '' : 's'}
                                                </div>
                                                <div className="people-list-cell people-list-phone" />
                                                <div className="people-list-cell people-list-category" />
                                            </div>
                                        </button>
                                        {isExpanded &&
                                            family.members.map((member) => (
                                                <div
                                                    className={`people-list-item people-list-item--member ${
                                                        member.id === selectedId ? 'active' : ''
                                                    }`}
                                                    key={member.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => {
                                                        setSelectedId(member.id);
                                                        setPanelMode('view');
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            setSelectedId(member.id);
                                                            setPanelMode('view');
                                                        }
                                                    }}
                                                >
                                                    <div className="people-list-row">
                                                        <div className="people-list-cell people-list-env">
                                                            {(() => {
                                                                const label = String(member.envelopeNumber || '').trim();
                                                                if (!label) return null;
                                                                return (
                                                                    <span
                                                                        className={`env-chip env-chip--list${
                                                                            member.isPledger ? ' env-chip--pledger' : ''
                                                                        }`}
                                                                    >
                                                                        {label}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                        <div className="people-list-cell people-list-name">
                                                            <span>{member.displayName}</span>
                                                        </div>
                                                        <div className="people-list-cell people-list-email">
                                                            {member.email ? (
                                                                <span className="people-copy-inline">
                                                                    <span>{member.email}</span>
                                                                    <button
                                                                        type="button"
                                                                        className="people-copy-button"
                                                                        aria-label="Copy email"
                                                                        onClick={(event) => handleInlineCopy(event, member.email, 'Email copied')}
                                                                    >
                                                                        <FaCopy />
                                                                    </button>
                                                                </span>
                                                            ) : ''}
                                                        </div>
                                                        <div className="people-list-cell people-list-phone">
                                                            {(() => {
                                                                const phone = formatPhone(
                                                                    member.phonePrimary || member.phoneAlternate || ''
                                                                );
                                                                if (!phone) return '';
                                                                return (
                                                                    <span className="people-copy-inline">
                                                                        <span>{phone}</span>
                                                                        <button
                                                                            type="button"
                                                                            className="people-copy-button"
                                                                            aria-label="Copy phone"
                                                                            onClick={(event) => handleInlineCopy(event, phone, 'Phone copied')}
                                                                        >
                                                                            <FaCopy />
                                                                        </button>
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>
                                                        <div className="people-list-cell people-list-category">
                                                            {member.category && (
                                                                <span className={`category-chip category-${member.category}`}>
                                                                    {CATEGORY_LABELS[member.category] || member.category}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                </div>

                                            ))}
                                    </div>
                                );
                            })}
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
                    onCopyValue={copyValue}
                />
            </div>
            {copyNotice && (
                <div className="people-copy-toast" role="status" aria-live="polite">
                    {copyNotice}
                </div>
            )}
        </section>
    );
};

export default People;

