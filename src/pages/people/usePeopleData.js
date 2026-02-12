import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_URL } from '../../services/apiConfig';
import { defaultPersonForm, parseCommaList, parseTeamList, sortPeople } from './peopleHelpers';

const formatBackupTimestamp = (value) => {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString();
};

export const usePeopleData = () => {
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

    const loadPeople = useCallback(async () => {
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
    }, []);

    const handleRestoreBackup = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        loadPeople();
    }, [loadPeople]);

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

    return {
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
    };
};
