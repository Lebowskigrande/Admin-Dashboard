import { useState } from 'react';
import { FaPlus, FaUserClock, FaPrayingHands, FaUsers, FaClock } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
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

    // Volunteers Mock
    const [services, setServices] = useState([
        { id: 1, date: '2025-12-21', time: '8:00 AM', roles: { Lector: 'Mary S.', Usher: 'Tom B.', Chalice: 'Rev. Dave' } },
        { id: 2, date: '2025-12-21', time: '10:00 AM', roles: { Lector: 'John D.', Usher: 'Sarah W.', Chalice: 'Rev. Dave' } },
        { id: 3, date: '2025-12-24', time: '6:00 PM', roles: { Lector: 'Kids', Usher: 'Parents', Chalice: 'All Staff' } },
    ]);

    // Ministry Mock
    const [ministries, setMinistries] = useState([
        { id: 1, name: 'Altar Guild', leader: 'Martha Stewart', email: 'martha@example.com' },
        { id: 2, name: 'Choir', leader: 'Bach', email: 'jsb@example.com' },
        { id: 3, name: 'Outreach', leader: 'Mother Teresa', email: 'mt@example.com' },
    ]);

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

    const renderVolunteers = () => (
        <div className="volunteers-grid">
            {services.map(s => (
                <div key={s.id} className="service-card">
                    <h3>{s.date} - {s.time}</h3>
                    <hr style={{ margin: '0.5rem 0', border: 'none', borderTop: '1px solid #eee' }} />
                    {Object.entries(s.roles).map(([role, person]) => (
                        <div key={role} className="role-row">
                            <span className="role-name">{role}:</span>
                            <span className="role-person">{person}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );

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
            {activeTab === 'volunteers' && renderVolunteers()}
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
                            placeholder="e.g. Janet"
                            value={newTime.name}
                            onChange={(e) => setNewTime({ ...newTime, name: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Hours Worked</label>
                        <input
                            type="number"
                            required
                            step="0.5"
                            value={newTime.hours}
                            onChange={(e) => setNewTime({ ...newTime, hours: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Task Description</label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. Office Admin"
                            value={newTime.task}
                            onChange={(e) => setNewTime({ ...newTime, task: e.target.value })}
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Save Entry</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default People;
