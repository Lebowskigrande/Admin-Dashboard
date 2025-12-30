import { useState, useEffect } from 'react';
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

    // Team Rosters (from user's data)
    const lectors8am = ['Mary Beth', 'Betsy', 'David', 'Nancy', 'Bob M.'];
    const lectors10am = [
        { pair: 'Tori & Kimberly', week: 1 },
        { pair: 'Tom & Pam', week: 2 },
        { pair: 'Joel & Volunteer', week: 3 },
        { pair: 'Karen & Diane', week: 4 }
    ];
    const acolyteTeams = [
        { team: 'Angela, Veronica, Natalia', week: 1 },
        { team: 'Kimberly, Tori, Amy', week: 2 },
        { team: 'Eli, Carolyn, Peter', week: 3 },
        { team: 'Jackson, Quinn, Angela', week: 4 }
    ];
    const lemTeams = [
        { team: 'Angela, Veronica', week: 1 },
        { team: 'Kimberly, Tori', week: 2 },
        { team: 'Eli, Carolyn', week: 3 },
        { team: 'Kimberly, Angela', week: 4 }
    ];
    const soundEngineer = 'Cristo Nava';

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
        <div className="rosters-container">
            <Card className="roster-card">
                <h3 className="roster-title">8:00 AM - Rite I Lectors</h3>
                <p className="roster-note">Weekly Rotation (5-week cycle)</p>
                <ul className="roster-list">
                    {lectors8am.map((name, idx) => (
                        <li key={idx}><span className="week-badge">Week {idx + 1}</span> {name}</li>
                    ))}
                </ul>
            </Card>

            <Card className="roster-card">
                <h3 className="roster-title">10:00 AM - Rite II Lectors</h3>
                <p className="roster-note">Weekly Rotation (4-week cycle)</p>
                <ul className="roster-list">
                    {lectors10am.map((item, idx) => (
                        <li key={idx}><span className="week-badge">Week {item.week}</span> {item.pair}</li>
                    ))}
                </ul>
            </Card>

            <Card className="roster-card">
                <h3 className="roster-title">Acolytes (10:00 AM)</h3>
                <p className="roster-note">Weekly Rotation (4-week cycle)</p>
                <ul className="roster-list">
                    {acolyteTeams.map((item, idx) => (
                        <li key={idx}><span className="week-badge">Week {item.week}</span> {item.team}</li>
                    ))}
                </ul>
            </Card>

            <Card className="roster-card">
                <h3 className="roster-title">LEMs / Chalice Bearers (10:00 AM)</h3>
                <p className="roster-note">Weekly Rotation (4-week cycle)</p>
                <ul className="roster-list">
                    {lemTeams.map((item, idx) => (
                        <li key={idx}><span className="week-badge">Week {item.week}</span> {item.team}</li>
                    ))}
                </ul>
            </Card>

            <Card className="roster-card">
                <h3 className="roster-title">Sound Engineer (10:00 AM)</h3>
                <div className="single-role">
                    <span className="role-value">{soundEngineer}</span>
                </div>
            </Card>
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
