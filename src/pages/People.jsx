import { useState } from 'react';
import { FaPlus, FaUserClock, FaPrayingHands, FaUsers, FaClock } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { PEOPLE } from '../data/people';
import { ROLE_DEFINITIONS } from '../models/roles';
import './People.css';

const People = () => {
    const [activeTab, setActiveTab] = useState('timesheets');
    const [showModal, setShowModal] = useState(false);

    // Timesheets Mock
    const [timesheets, setTimesheets] = useState([
        { id: 1, date: '2025-12-15', name: 'Janet (Admin)', hours: 8, task: 'Office Admin' },
        { id: 2, date: '2025-12-16', name: 'Janet (Admin)', hours: 7.5, task: 'Bulletin Prep' },
        { id: 3, date: '2025-12-15', name: 'Bob (Sexton)', hours: 4, task: 'Cleaning' },
    ]);
    const [newTime, setNewTime] = useState({ date: '', name: '', hours: '', task: '' });

    // Ministry Mock
    const ministries = [
        { id: 1, name: 'Altar Guild', leader: 'Martha Stewart', email: 'martha@example.com' },
        { id: 2, name: 'Choir', leader: 'Bach', email: 'jsb@example.com' },
        { id: 3, name: 'Outreach', leader: 'Mother Teresa', email: 'mt@example.com' },
    ];

    const handleTimeSubmit = (e) => {
        e.preventDefault();
        setTimesheets([...timesheets, { ...newTime, id: Date.now(), hours: parseFloat(newTime.hours) }]);
        setShowModal(false);
        setNewTime({ date: '', name: '', hours: '', task: '' });
    };

    const renderTimesheets = () => (
        <Card>
            <table className="finance-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Staff Name</th>
                        <th>Task</th>
                        <th className="text-right">Hours</th>
                    </tr>
                </thead>
                <tbody>
                    {timesheets.map(t => (
                        <tr key={t.id}>
                            <td>{t.date}</td>
                            <td>{t.name}</td>
                            <td>{t.task}</td>
                            <td className="text-right font-mono">{t.hours}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );

    const renderVolunteerPools = () => {
        const rosterRoles = ['lector', 'chaliceBearer', 'acolyte', 'usher', 'sound'];

        return (
            <div className="rosters-container">
                {rosterRoles.map(roleKey => {
                    const role = ROLE_DEFINITIONS.find(r => r.key === roleKey);
                    const people = PEOPLE.filter(person => person.roles.includes(roleKey));

                    return (
                        <Card key={roleKey} className="roster-card">
                            <h3 className="roster-title">{role?.label || roleKey}</h3>
                            <p className="roster-note">Eligible volunteers by role</p>
                            <ul className="roster-list">
                                {people.map(person => (
                                    <li key={person.id}>
                                        <span className="week-badge">{person.tags.join(', ') || 'volunteer'}</span> {person.displayName}
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    );
                })}
            </div>
        );
    };

    const renderMinistries = () => (
        <Card>
            <table className="finance-table">
                <thead>
                    <tr>
                        <th>Group Name</th>
                        <th>Leader</th>
                        <th>Contact</th>
                    </tr>
                </thead>
                <tbody>
                    {ministries.map(m => (
                        <tr key={m.id}>
                            <td><span className="category-tag">{m.name}</span></td>
                            <td>{m.leader}</td>
                            <td>{m.email}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );

    return (
        <div className="page-people">
            <header className="people-header">
                <h1>People & Ministries</h1>
                {activeTab === 'timesheets' && (
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        <FaPlus /> Log Hours
                    </button>
                )}
            </header>

            <div className="people-tabs">
                <button className={`tab-btn ${activeTab === 'timesheets' ? 'active' : ''}`} onClick={() => setActiveTab('timesheets')}>
                    <FaUserClock /> Timesheets
                </button>
                <button className={`tab-btn ${activeTab === 'volunteers' ? 'active' : ''}`} onClick={() => setActiveTab('volunteers')}>
                    <FaPrayingHands /> Liturgical Roster
                </button>
                <button className={`tab-btn ${activeTab === 'ministry' ? 'active' : ''}`} onClick={() => setActiveTab('ministry')}>
                    <FaUsers /> Ministry Groups
                </button>
            </div>

            {activeTab === 'timesheets' && renderTimesheets()}
            {activeTab === 'volunteers' && renderVolunteerPools()}
            {activeTab === 'ministry' && renderMinistries()}

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Log Staff Hours"
            >
                <form className="event-form" onSubmit={handleTimeSubmit}>
                    <div className="form-group">
                        <label>Date</label>
                        <input
                            type="date"
                            required
                            value={newTime.date}
                            onChange={(e) => setNewTime({ ...newTime, date: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Staff Name</label>
                        <input
                            type="text"
                            required
                            value={newTime.name}
                            onChange={(e) => setNewTime({ ...newTime, name: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Hours</label>
                        <input
                            type="number"
                            min="0"
                            step="0.25"
                            required
                            value={newTime.hours}
                            onChange={(e) => setNewTime({ ...newTime, hours: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Task</label>
                        <input
                            type="text"
                            required
                            value={newTime.task}
                            onChange={(e) => setNewTime({ ...newTime, task: e.target.value })}
                        />
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">
                            <FaClock /> Save Entry
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default People;
