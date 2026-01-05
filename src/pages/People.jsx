import { useEffect, useMemo, useState } from 'react';
import { FaUserTie, FaUsers, FaHandsHelping, FaPlus, FaPen, FaTrash } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { ROLE_DEFINITIONS } from '../models/roles';
import { createPerson } from '../models/person';
import { clearLiturgicalCache } from '../services/liturgicalService';
import './People.css';

const CATEGORY_CONFIG = [
    {
        key: 'clergy',
        label: 'Clergy',
        description: 'Ordained leaders who preside, preach, and provide sacramental care.',
        icon: <FaUserTie />
    },
    {
        key: 'staff',
        label: 'Staff',
        description: 'Paid and contract team members supporting parish operations and worship.',
        icon: <FaUsers />
    },
    {
        key: 'volunteer',
        label: 'Volunteers',
        description: 'Roster of trained parishioners available for liturgical and hospitality roles.',
        icon: <FaHandsHelping />
    }
];

const roleLabel = (key) => ROLE_DEFINITIONS.find((role) => role.key === key)?.label || key;

const defaultFormState = {
    name: '',
    email: '',
    category: 'volunteer',
    roles: [],
    tags: ''
};

const People = () => {
    const [people, setPeople] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formState, setFormState] = useState(defaultFormState);
    const [editingId, setEditingId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [tagFilter, setTagFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');

    useEffect(() => {
        const loadPeople = async () => {
            setLoading(true);
            setError('');
            try {
                const response = await fetch('http://localhost:3001/api/people');
                if (!response.ok) throw new Error('Failed to load people');
                const data = await response.json();
                setPeople(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Failed to load people:', err);
                setError('Unable to load people. Please refresh and try again.');
            } finally {
                setLoading(false);
            }
        };

        loadPeople();
    }, []);

    const openAdd = () => {
        setEditingId(null);
        setFormState(defaultFormState);
        setIsModalOpen(true);
    };

    const openEdit = (person) => {
        setEditingId(person.id);
        setFormState({
            name: person.displayName || '',
            email: person.email || '',
            category: person.category || 'volunteer',
            roles: person.roles || [],
            tags: person.tags ? person.tags.join(', ') : ''
        });
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
    };

    const parseTags = (value) => value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

    const handleRoleToggle = (roleKey) => {
        setFormState((prev) => {
            const exists = prev.roles.includes(roleKey);
            return {
                ...prev,
                roles: exists
                    ? prev.roles.filter((role) => role !== roleKey)
                    : [...prev.roles, roleKey]
            };
        });
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedName = formState.name.trim();
        if (!trimmedName) return;

        const tags = parseTags(formState.tags);
        const base = createPerson({ name: trimmedName, roles: formState.roles, tags });
        const payload = {
            displayName: base.displayName,
            email: formState.email.trim(),
            category: formState.category,
            roles: base.roles,
            tags: base.tags
        };

        try {
            const response = await fetch(
                editingId
                    ? `http://localhost:3001/api/people/${editingId}`
                    : 'http://localhost:3001/api/people',
                {
                    method: editingId ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }
            );

            if (!response.ok) throw new Error('Failed to save person');
            const saved = await response.json();

            setPeople((prev) => {
                if (editingId) {
                    return prev.map((person) => (person.id === editingId ? saved : person));
                }
                return [...prev, saved];
            });

            clearLiturgicalCache();
            setIsModalOpen(false);
        } catch (err) {
            console.error('Failed to save person:', err);
            setError('Unable to save changes. Please try again.');
        }
    };

    const handleDelete = async () => {
        if (!editingId) return;
        if (!confirm('Delete this person? This cannot be undone.')) return;
        try {
            const response = await fetch(`http://localhost:3001/api/people/${editingId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete person');
            setPeople((prev) => prev.filter((person) => person.id !== editingId));
            clearLiturgicalCache();
            setIsModalOpen(false);
        } catch (err) {
            console.error('Failed to delete person:', err);
            setError('Unable to delete person. Please try again.');
        }
    };

    const tagOptions = useMemo(() => {
        const tags = new Set();
        people.forEach((person) => {
            (person.tags || []).forEach((tag) => tags.add(tag));
        });
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    }, [people]);

    const filteredPeople = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return people.filter((person) => {
            if (categoryFilter !== 'all' && person.category !== categoryFilter) return false;
            if (roleFilter !== 'all' && !(person.roles || []).includes(roleFilter)) return false;
            if (tagFilter !== 'all' && !(person.tags || []).includes(tagFilter)) return false;
            if (!query) return true;

            const nameMatch = person.displayName?.toLowerCase().includes(query);
            const emailMatch = person.email?.toLowerCase().includes(query);
            const tagMatch = (person.tags || []).some((tag) => tag.toLowerCase().includes(query));
            return nameMatch || emailMatch || tagMatch;
        });
    }, [people, searchTerm, roleFilter, tagFilter, categoryFilter]);

    const groupedPeople = useMemo(() => {
        const collator = new Intl.Collator('en', { sensitivity: 'base' });
        const sorted = [...filteredPeople].sort((a, b) => {
            const lastA = (a.displayName || '').split(' ').slice(-1)[0];
            const lastB = (b.displayName || '').split(' ').slice(-1)[0];
            const lastCompare = collator.compare(lastA, lastB);
            if (lastCompare !== 0) return lastCompare;
            return collator.compare(a.displayName || '', b.displayName || '');
        });

        return CATEGORY_CONFIG.map((category) => ({
            ...category,
            people: sorted.filter((person) => person.category === category.key)
        }));
    }, [filteredPeople]);

    const renderPersonCard = (person) => {
        const tags = person.tags || [];
        const extensionTag = tags.find((tag) => tag.startsWith('ext-'));
        const titleTags = tags.filter((tag) => tag && tag !== extensionTag);
        const metaChips = [...titleTags, ...(extensionTag ? [extensionTag] : [])];

        return (
        <Card key={person.id} className="person-card">
            <div className="person-card__header">
                <div className="person-main">
                    <div className="person-name">{person.displayName}</div>
                    {person.email && <div className="person-email">{person.email}</div>}
                    {metaChips.length > 0 && (
                        <div className="meta-chip-row">
                            {metaChips.map((tag) => (
                                <span key={tag} className="tag-chip">{tag}</span>
                            ))}
                        </div>
                    )}
                    {tags.length > metaChips.length && (
                        <div className="tag-row">
                            {tags.filter((tag) => !metaChips.includes(tag)).map((tag) => (
                                <span key={tag} className="tag-chip">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
                <button className="btn-ghost icon-only" onClick={() => openEdit(person)} aria-label="Edit person">
                    <FaPen />
                </button>
            </div>
            <div className="roles">
                <span className="roles-label">Eligible roles</span>
                <div className="role-chip-row">
                    {person.roles.map((roleKey) => (
                        <span key={roleKey} className="role-chip">{roleLabel(roleKey)}</span>
                    ))}
                </div>
            </div>
        </Card>
        );
    };

    return (
        <div className="page-people">
            <header className="people-header">
                <div>
                    <p className="page-kicker">People database</p>
                    <h1>People</h1>
                    <p className="page-subtitle">
                        Clergy, staff, and volunteer pools with their eligible liturgical and hospitality roles.
                    </p>
                </div>
                <div className="people-header-actions">
                    <button className="btn-primary" onClick={openAdd}>
                        <FaPlus /> Add Person
                    </button>
                </div>
            </header>

            <div className="people-filters">
                <div className="filter-row">
                    <div className="filter-group grow">
                        <label>Search</label>
                        <input
                            className="filter-input"
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Search by name, email, or tag"
                        />
                    </div>
                    <div className="filter-group">
                        <label>Category</label>
                        <select
                            className="filter-select"
                            value={categoryFilter}
                            onChange={(event) => setCategoryFilter(event.target.value)}
                        >
                            <option value="all">All categories</option>
                            {CATEGORY_CONFIG.map((category) => (
                                <option key={category.key} value={category.key}>{category.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Role</label>
                        <select
                            className="filter-select"
                            value={roleFilter}
                            onChange={(event) => setRoleFilter(event.target.value)}
                        >
                            <option value="all">All roles</option>
                            {ROLE_DEFINITIONS.map((role) => (
                                <option key={role.key} value={role.key}>{role.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Tag</label>
                        <select
                            className="filter-select"
                            value={tagFilter}
                            onChange={(event) => setTagFilter(event.target.value)}
                        >
                            <option value="all">All tags</option>
                            {tagOptions.map((tag) => (
                                <option key={tag} value={tag}>{tag}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => {
                                setSearchTerm('');
                                setCategoryFilter('all');
                                setRoleFilter('all');
                                setTagFilter('all');
                            }}
                        >
                            Clear
                        </button>
                    </div>
                </div>
                {error && <div className="people-error">{error}</div>}
            </div>

            <div className="people-groups">
                {loading ? (
                    <Card className="people-loading">Loading people...</Card>
                ) : groupedPeople.map((category) => {
                    return (
                        <section key={category.key} className="people-section">
                            <div className="section-header">
                                <div className="section-title">
                                    <span className="section-icon">{category.icon}</span>
                                    <div>
                                        <h2>{category.label}</h2>
                                        <p className="section-description">{category.description}</p>
                                    </div>
                                </div>
                                <span className="section-count">{category.people.length} people</span>
                            </div>

                            <div className="person-grid">
                                {category.people.length === 0 ? (
                                    <Card className="empty-card">No people match these filters.</Card>
                                ) : (
                                    category.people.map(renderPersonCard)
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingId ? 'Edit Person' : 'Add Person'}
            >
                <form className="people-form" onSubmit={handleSubmit}>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Name</label>
                            <input
                                type="text"
                                required
                                value={formState.name}
                                onChange={(event) => setFormState({ ...formState, name: event.target.value })}
                                placeholder="Full name"
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={formState.email}
                                onChange={(event) => setFormState({ ...formState, email: event.target.value })}
                                placeholder="name@example.com"
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Category</label>
                            <select
                                value={formState.category}
                                onChange={(event) => setFormState({ ...formState, category: event.target.value })}
                            >
                                {CATEGORY_CONFIG.map((category) => (
                                    <option key={category.key} value={category.key}>{category.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Tags</label>
                            <input
                                type="text"
                                value={formState.tags}
                                onChange={(event) => setFormState({ ...formState, tags: event.target.value })}
                                placeholder="volunteer, choir, hospitality"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Roles</label>
                        <div className="role-selector">
                            {ROLE_DEFINITIONS.map((role) => (
                                <label key={role.key} className="role-option">
                                    <input
                                        type="checkbox"
                                        checked={formState.roles.includes(role.key)}
                                        onChange={() => handleRoleToggle(role.key)}
                                    />
                                    <span>{role.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                        {editingId && (
                            <button type="button" className="btn-danger" onClick={handleDelete}>
                                <FaTrash /> Delete
                            </button>
                        )}
                        <button type="submit" className="btn-primary">
                            {editingId ? 'Save Changes' : 'Add Person'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default People;
