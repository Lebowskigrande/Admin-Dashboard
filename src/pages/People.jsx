import { FaUserTie, FaUsers, FaHandsHelping } from 'react-icons/fa';
import Card from '../components/Card';
import { PEOPLE } from '../data/people';
import { ROLE_DEFINITIONS } from '../models/roles';
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

const People = () => {
    const renderPersonCard = (person) => (
        <Card key={person.id} className="person-card">
            <div className="person-card__header">
                <div>
                    <div className="person-name">{person.displayName}</div>
                    {person.tags?.length > 0 && (
                        <div className="tag-row">
                            {person.tags.map((tag) => (
                                <span key={tag} className="tag-chip">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
                {person.email && <div className="contact">{person.email}</div>}
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
            </header>

            <div className="people-groups">
                {CATEGORY_CONFIG.map((category) => {
                    const people = PEOPLE.filter((person) => person.category === category.key);

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
                                <span className="section-count">{people.length} people</span>
                            </div>

                            <div className="person-grid">
                                {people.map(renderPersonCard)}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
};

export default People;
