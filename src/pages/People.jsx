import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../services/apiConfig';
import './People.css';

const CATEGORY_LABELS = {
    clergy: 'Clergy',
    staff: 'Staff',
    parishioner: 'Parishioner'
};

const ROLE_OPTIONS = [
    { value: 'celebrant', label: 'Celebrant' },
    { value: 'preacher', label: 'Preacher' },
    { value: 'officiant', label: 'Officiant' },
    { value: 'lector', label: 'Lector' },
    { value: 'lem', label: 'LEM' },
    { value: 'acolyte', label: 'Acolyte' },
    { value: 'thurifer', label: 'Thurifer' },
    { value: 'usher', label: 'Usher' },
    { value: 'altarGuild', label: 'Altar Guild' },
    { value: 'choirmaster', label: 'Choirmaster' },
    { value: 'organist', label: 'Organist' },
    { value: 'sound', label: 'Sound' },
    { value: 'coffeeHour', label: 'Coffee Hour' },
    { value: 'buildingSupervisor', label: 'Building Supervisor' },
    { value: 'childcare', label: 'Childcare' }
];

const getLastName = (name = '') => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (raw.includes(',')) {
        const [last] = raw.split(',');
        return last.trim();
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[tokens.length - 1] : '';
};

const getFirstName = (name = '') => {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (raw.includes(',')) {
        const [, rest] = raw.split(',');
        return (rest || '').trim();
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.length ? tokens[0] : '';
};

const sortPeople = (list) => {
    return [...list].sort((a, b) => {
        const lastA = getLastName(a.displayName).toLowerCase();
        const lastB = getLastName(b.displayName).toLowerCase();
        if (lastA !== lastB) return lastA.localeCompare(lastB);
        const firstA = getFirstName(a.displayName).toLowerCase();
        const firstB = getFirstName(b.displayName).toLowerCase();
        if (firstA !== firstB) return firstA.localeCompare(firstB);
        return (a.displayName || '').localeCompare(b.displayName || '');
    });
};

const parseCommaList = (value) => {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const parseTeamList = (value) => {
    return parseCommaList(value)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
};

const formatTeams = (teams) => {
    if (!Array.isArray(teams) || teams.length === 0) return '';
    return teams.join(', ');
};

const roleLabel = (roleKey) => {
    return ROLE_OPTIONS.find((role) => role.value === roleKey)?.label || roleKey;
};

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const formatPhone = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = normalizePhoneDigits(raw);
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
        return `1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return raw;
};

const buildTeamRoleKeys = (roles, teams) => {
    const roleSet = new Set(roles || []);
    Object.keys(teams || {}).forEach((roleKey) => roleSet.add(roleKey));
    return Array.from(roleSet);
};

const defaultPersonForm = () => ({
    displayName: '',
    email: '',
    phonePrimary: '',
    phoneAlternate: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    category: 'parishioner',
    roles: [],
    tagsText: '',
    teams: {}
});

const People = () => {
    const [people, setPeople] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [backupBusy, setBackupBusy] = useState(false);
    const [backupError, setBackupError] = useState('');

    const [selectedId, setSelectedId] = useState('');
    const [panelMode, setPanelMode] = useState('view');

    const [filters, setFilters] = useState({
        search: '',
        category: '',
        role: '',
        tag: '',
        team: ''
    });

    const [editForm, setEditForm] = useState(defaultPersonForm());
    const [createForm, setCreateForm] = useState(defaultPersonForm());

    const loadPeople = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_URL}/people`);
            if (!response.ok) throw new Error('Failed to load people');
            const data = await response.json();
            setPeople(sortPeople(Array.isArray(data) ? data : []));
        } catch (err) {
            console.error(err);
            setError('Unable to load people records.');
        } finally {
            setLoading(false);
        }
    };

    const formatBackupTimestamp = (value) => {
        if (!value) return 'Unknown time';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Unknown time';
        return date.toLocaleString();
    };

    const handleRestoreBackup = async () => {
        setBackupBusy(true);
        setBackupError('');
        try {
            const response = await fetch(`${API_URL}/db-backups/latest`);
            if (!response.ok) throw new Error('Failed to load backup info');
            const latest = await response.json();
            const timestamp = formatBackupTimestamp(latest.modified);
            const confirmed = window.confirm(
                `Restore the backup from ${timestamp}? This will replace the current database.`
            );
            if (!confirmed) return;

            const restoreResponse = await fetch(`${API_URL}/db-backups/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: latest.path })
            });
            if (!restoreResponse.ok) throw new Error('Failed to restore backup');
            window.alert('Backup restored. The server will restart to load the restored database.');
        } catch (err) {
            console.error(err);
            setBackupError('Unable to restore the database backup.');
        } finally {
            setBackupBusy(false);
        }
    };

    useEffect(() => {
        loadPeople();
    }, []);

    const peopleById = useMemo(() => {
        const map = new Map();
        people.forEach((person) => map.set(person.id, person));
        return map;
    }, [people]);

    const selectedPerson = selectedId ? peopleById.get(selectedId) : null;

    useEffect(() => {
        if (selectedPerson) return;
        if (selectedId) setSelectedId('');
        if (panelMode === 'edit') setPanelMode('view');
    }, [selectedPerson, selectedId, panelMode]);

    const categories = useMemo(() => {
        const values = new Set(['clergy', 'staff', 'parishioner']);
        people.forEach((person) => {
            if (person.category) values.add(person.category);
        });
        return Array.from(values);
    }, [people]);

    const roles = useMemo(() => {
        const values = new Set();
        people.forEach((person) => {
            (person.roles || []).forEach((role) => values.add(role));
        });
        return Array.from(values);
    }, [people]);

    const tags = useMemo(() => {
        const values = new Set();
        people.forEach((person) => {
            (person.tags || []).forEach((tag) => values.add(tag));
        });
        return Array.from(values);
    }, [people]);

    const teams = useMemo(() => {
        const values = new Set();
        people.forEach((person) => {
            Object.values(person.teams || {}).forEach((teamList) => {
                if (!Array.isArray(teamList)) return;
                teamList.forEach((team) => values.add(String(team)));
            });
        });
        return Array.from(values);
    }, [people]);
    const filteredPeople = useMemo(() => {
        const normalizedSearch = filters.search.toLowerCase().trim();
        const teamValue = Number(filters.team);
        const hasTeamFilter = Number.isFinite(teamValue);

        return people.filter((person) => {
            if (normalizedSearch) {
                const haystack = [
                    person.displayName,
                    person.email,
                    ...(person.tags || [])
                ].join(' ').toLowerCase();
                if (!haystack.includes(normalizedSearch)) return false;
            }
            if (filters.category && person.category !== filters.category) return false;
            if (filters.role && !(person.roles || []).includes(filters.role)) return false;
            if (filters.tag && !(person.tags || []).includes(filters.tag)) return false;
            if (filters.team && !hasTeamFilter) return false;
            if (filters.team && hasTeamFilter) {
                const teamMatch = Object.values(person.teams || {}).some((teamList) => {
                    if (!Array.isArray(teamList)) return false;
                    return teamList.map(Number).includes(teamValue);
                });
                if (!teamMatch) return false;
            }
            return true;
        });
    }, [people, filters]);

    const handleFilterChange = (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
    };

    const resetFilters = () => {
        setFilters({ search: '', category: '', role: '', tag: '', team: '' });
    };

    const beginCreate = () => {
        setSelectedId('');
        setCreateForm(defaultPersonForm());
        setPanelMode('create');
    };

    const beginEdit = (person) => {
        setEditForm({
            displayName: person.displayName || '',
            email: person.email || '',
            phonePrimary: person.phonePrimary || '',
            phoneAlternate: person.phoneAlternate || '',
            addressLine1: person.addressLine1 || '',
            addressLine2: person.addressLine2 || '',
            city: person.city || '',
            state: person.state || '',
            postalCode: person.postalCode || '',
            category: person.category || 'parishioner',
            roles: Array.isArray(person.roles) ? [...person.roles] : [],
            tagsText: (person.tags || []).join(', '),
            teams: { ...(person.teams || {}) }
        });
        setPanelMode('edit');
    };

    const handleRoleToggle = (roleKey, formSetter) => {
        formSetter((prev) => {
            const rolesSet = new Set(prev.roles || []);
            if (rolesSet.has(roleKey)) {
                rolesSet.delete(roleKey);
            } else {
                rolesSet.add(roleKey);
            }
            return { ...prev, roles: Array.from(rolesSet) };
        });
    };

    const handleTeamChange = (roleKey, value, formSetter) => {
        formSetter((prev) => ({
            ...prev,
            teams: {
                ...(prev.teams || {}),
                [roleKey]: parseTeamList(value)
            }
        }));
    };

    const updatePersonInState = (updated) => {
        setPeople((prev) => sortPeople(prev.map((person) => (person.id === updated.id ? updated : person))));
    };

    const handleSaveEdit = async () => {
        if (!selectedPerson) return;
        const payload = {
            displayName: editForm.displayName,
            email: editForm.email,
            phonePrimary: editForm.phonePrimary,
            phoneAlternate: editForm.phoneAlternate,
            addressLine1: editForm.addressLine1,
            addressLine2: editForm.addressLine2,
            city: editForm.city,
            state: editForm.state,
            postalCode: editForm.postalCode,
            category: editForm.category,
            roles: editForm.roles || [],
            tags: parseCommaList(editForm.tagsText),
            teams: editForm.teams || {}
        };
        try {
            const response = await fetch(`${API_URL}/people/${selectedPerson.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('Failed to update person');
            const updated = await response.json();
            updatePersonInState(updated);
            setPanelMode('view');
        } catch (err) {
            console.error(err);
            setError('Unable to save changes.');
        }
    };

    const handleCreate = async () => {
        const payload = {
            displayName: createForm.displayName,
            email: createForm.email,
            phonePrimary: createForm.phonePrimary,
            phoneAlternate: createForm.phoneAlternate,
            addressLine1: createForm.addressLine1,
            addressLine2: createForm.addressLine2,
            city: createForm.city,
            state: createForm.state,
            postalCode: createForm.postalCode,
            category: createForm.category,
            roles: createForm.roles || [],
            tags: parseCommaList(createForm.tagsText),
            teams: createForm.teams || {}
        };
        try {
            const response = await fetch(`${API_URL}/people`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error('Failed to create person');
            const created = await response.json();
            setPeople((prev) => sortPeople([...prev, created]));
            setSelectedId(created.id);
            setPanelMode('view');
        } catch (err) {
            console.error(err);
            setError('Unable to create person.');
        }
    };

    const handleDelete = async (person) => {
        if (!person) return;
        const confirmed = window.confirm(`Delete ${person.displayName}? This cannot be undone.`);
        if (!confirmed) return;
        try {
            const response = await fetch(`${API_URL}/people/${person.id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete person');
            setPeople((prev) => prev.filter((item) => item.id !== person.id));
            setSelectedId('');
            setPanelMode('view');
        } catch (err) {
            console.error(err);
            setError('Unable to delete person.');
        }
    };

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

    const renderDetailPanel = () => {
        if (panelMode === 'create') {
            return (
                <div className="people-panel people-detail-panel">
                    <div className="panel-title--row">
                        <h2 className="panel-title">New Person</h2>
                        <button className="btn-ghost" type="button" onClick={() => setPanelMode('view')}>
                            Cancel
                        </button>
                    </div>
                    <div className="people-form">
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="create-name">Display name</label>
                                <input
                                    id="create-name"
                                    value={createForm.displayName}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, displayName: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-email">Email</label>
                                <input
                                    id="create-email"
                                    value={createForm.email}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="create-phone-primary">Primary phone</label>
                                <input
                                    id="create-phone-primary"
                                    value={createForm.phonePrimary}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, phonePrimary: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-phone-alt">Alternate phone</label>
                                <input
                                    id="create-phone-alt"
                                    value={createForm.phoneAlternate}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, phoneAlternate: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="create-address1">Address line 1</label>
                                <input
                                    id="create-address1"
                                    value={createForm.addressLine1}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, addressLine1: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-address2">Address line 2</label>
                                <input
                                    id="create-address2"
                                    value={createForm.addressLine2}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, addressLine2: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="create-city">City</label>
                                <input
                                    id="create-city"
                                    value={createForm.city}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, city: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-state">State</label>
                                <input
                                    id="create-state"
                                    value={createForm.state}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, state: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-postal">Postal code</label>
                                <input
                                    id="create-postal"
                                    value={createForm.postalCode}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="create-category">Category</label>
                                <select
                                    id="create-category"
                                    value={createForm.category}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, category: event.target.value }))}
                                >
                                    {categories.map((category) => (
                                        <option key={category} value={category}>
                                            {CATEGORY_LABELS[category] || category}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="create-tags">Tags (comma separated)</label>
                                <input
                                    id="create-tags"
                                    value={createForm.tagsText}
                                    onChange={(event) => setCreateForm((prev) => ({ ...prev, tagsText: event.target.value }))}
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
                                            checked={(createForm.roles || []).includes(role.value)}
                                            onChange={() => handleRoleToggle(role.value, setCreateForm)}
                                        />
                                        {role.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Team assignments (comma separated team numbers)</label>
                            <div className="team-grid">
                                {buildTeamRoleKeys(createForm.roles, createForm.teams).map((roleKey) => (
                                    <div className="form-group" key={roleKey}>
                                        <label>{roleLabel(roleKey)}</label>
                                        <input
                                            value={formatTeams(createForm.teams?.[roleKey])}
                                            onChange={(event) => handleTeamChange(roleKey, event.target.value, setCreateForm)}
                                        />
                                    </div>
                                ))}
                                {buildTeamRoleKeys(createForm.roles, createForm.teams).length === 0 && (
                                    <span className="panel-meta">Select roles to add team assignments.</span>
                                )}
                            </div>
                        </div>
                        <div className="form-actions">
                            <button className="btn-primary" type="button" onClick={handleCreate}>
                                Save person
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        if (!selectedPerson) {
            return (
                <div className="people-panel people-detail-panel">
                    <h2 className="panel-title">Person details</h2>
                    <p className="panel-meta">Select someone from the list to see full details.</p>
                    <div className="detail-actions">
                        <button className="btn-primary" type="button" onClick={beginCreate}>
                            Add person
                        </button>
                    </div>
                </div>
            );
        }
        if (panelMode === 'edit') {
            const teamRoleKeys = buildTeamRoleKeys(editForm.roles, editForm.teams);
            return (
                <div className="people-panel people-detail-panel">
                    <div className="panel-title--row">
                        <h2 className="panel-title">Edit profile</h2>
                        <button className="btn-ghost" type="button" onClick={() => setPanelMode('view')}>
                            Cancel
                        </button>
                    </div>
                    <div className="people-form">
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="edit-name">Display name</label>
                                <input
                                    id="edit-name"
                                    value={editForm.displayName}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, displayName: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-email">Email</label>
                                <input
                                    id="edit-email"
                                    value={editForm.email}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="edit-phone-primary">Primary phone</label>
                                <input
                                    id="edit-phone-primary"
                                    value={editForm.phonePrimary}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, phonePrimary: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-phone-alt">Alternate phone</label>
                                <input
                                    id="edit-phone-alt"
                                    value={editForm.phoneAlternate}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, phoneAlternate: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="edit-address1">Address line 1</label>
                                <input
                                    id="edit-address1"
                                    value={editForm.addressLine1}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, addressLine1: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-address2">Address line 2</label>
                                <input
                                    id="edit-address2"
                                    value={editForm.addressLine2}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, addressLine2: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="edit-city">City</label>
                                <input
                                    id="edit-city"
                                    value={editForm.city}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, city: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-state">State</label>
                                <input
                                    id="edit-state"
                                    value={editForm.state}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, state: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-postal">Postal code</label>
                                <input
                                    id="edit-postal"
                                    value={editForm.postalCode}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="edit-category">Category</label>
                                <select
                                    id="edit-category"
                                    value={editForm.category}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, category: event.target.value }))}
                                >
                                    {categories.map((category) => (
                                        <option key={category} value={category}>
                                            {CATEGORY_LABELS[category] || category}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="edit-tags">Tags (comma separated)</label>
                                <input
                                    id="edit-tags"
                                    value={editForm.tagsText}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, tagsText: event.target.value }))}
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
                                            checked={(editForm.roles || []).includes(role.value)}
                                            onChange={() => handleRoleToggle(role.value, setEditForm)}
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
                                            value={formatTeams(editForm.teams?.[roleKey])}
                                            onChange={(event) => handleTeamChange(roleKey, event.target.value, setEditForm)}
                                        />
                                    </div>
                                ))}
                                {teamRoleKeys.length === 0 && (
                                    <span className="panel-meta">Select roles to add team assignments.</span>
                                )}
                            </div>
                        </div>
                        <div className="form-actions">
                            <button className="btn-primary" type="button" onClick={handleSaveEdit}>
                                Save changes
                            </button>
                            <button className="btn-danger" type="button" onClick={() => handleDelete(selectedPerson)}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="people-panel people-detail-panel">
                <div className="panel-title--row">
                    <div className="panel-title-row">
                        <h2 className="panel-title">{selectedPerson.displayName}</h2>
                        {(() => {
                            const envelopeTag = (selectedPerson.tags || []).find((tag) => /^env-\d+/i.test(tag));
                            if (!envelopeTag) return null;
                            const label = envelopeTag.replace(/^env-/i, '');
                            return <span className="env-chip">{label}</span>;
                        })()}
                    </div>
                    <div className="panel-actions">
                        <button className="btn-ghost" type="button" onClick={() => beginEdit(selectedPerson)}>
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

                {renderDetailPanel()}
            </div>
        </section>
    );
};

export default People;
