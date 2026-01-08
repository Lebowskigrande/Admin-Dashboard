import { useState } from 'react';
import { FaEnvelopeOpen, FaFileAlt, FaPaperPlane, FaPlus } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import './Communications.css';

const Communications = () => {
    const [activeTab, setActiveTab] = useState('mail');
    const [showModal, setShowModal] = useState(false);

    // Mail Log
    const [mailLog, setMailLog] = useState([
        { id: 1, date: '2025-12-21', sender: 'Diocese', description: 'Annual Report Forms', status: 'To File' },
        { id: 2, date: '2025-12-21', sender: 'Utility Co', description: 'Bill', status: 'To Finance' },
    ]);
    const [newMail, setNewMail] = useState({ sender: '', description: '', status: 'To File' });

    // Bulletins Checklist
    const [bulletinTasks, setBulletinTasks] = useState([
        { id: 1, text: 'Collect scripture readings', done: true },
        { id: 2, text: 'Select hymns with Music Director', done: true },
        { id: 3, text: 'Draft 8am Service', done: false },
        { id: 4, text: 'Draft 10am Service', done: false },
        { id: 5, text: 'Print Inserts', done: false },
        { id: 6, text: 'Print & fold Bulletins', done: false },
        { id: 7, text: 'Stuff inserts', done: false },
        { id: 8, text: 'Place in Narthex', done: false },
    ]);

    // Weekly Email
    const [emailTasks, setEmailTasks] = useState([
        { id: 1, text: 'Collect announcements', done: true },
        { id: 2, text: 'Write Rector\'s corner', done: false },
        { id: 3, text: 'Update calendar section', done: false },
        { id: 4, text: 'Proofread', done: false },
        { id: 5, text: 'Schedule/Send via Constant Contact', done: false },
    ]);

    const handleMailSubmit = (e) => {
        e.preventDefault();
        setMailLog([...mailLog, { ...newMail, id: Date.now(), date: new Date().toISOString().split('T')[0] }]);
        setShowModal(false);
        setNewMail({ sender: '', description: '', status: 'To File' });
    };

    const toggleTask = (list, setList, id) => {
        setList(list.map(t => t.id === id ? { ...t, done: !t.done } : t));
    };

    const renderMailLog = () => (
        <Card>
            <table className="finance-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Sender</th>
                        <th>Description</th>
                        <th>Status/Action</th>
                    </tr>
                </thead>
                <tbody>
                    {mailLog.map(m => (
                        <tr key={m.id}>
                            <td>{m.date}</td>
                            <td>{m.sender}</td>
                            <td>{m.description}</td>
                            <td><span className="category-tag">{m.status}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );

    const renderChecklist = (tasks, setTasks, title) => (
        <Card title={title}>
            <div className="checklist">
                {tasks.map(t => (
                    <div key={t.id} className={`checklist-item ${t.done ? 'checked' : ''}`}>
                        <input
                            type="checkbox"
                            checked={t.done}
                            onChange={() => toggleTask(tasks, setTasks, t.id)}
                        />
                        <span>{t.text}</span>
                    </div>
                ))}
            </div>
        </Card>
    );

    return (
        <div className="page-communications">
            <header className="comms-header">
                <h1>Communications</h1>
                {activeTab === 'mail' && (
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        <FaPlus /> Log Mail
                    </button>
                )}
            </header>

            <div className="comms-tabs">
                <button className={`tab-btn ${activeTab === 'mail' ? 'active' : ''}`} onClick={() => setActiveTab('mail')}>
                    <FaEnvelopeOpen /> Mail Log
                </button>
                <button className={`tab-btn ${activeTab === 'bulletins' ? 'active' : ''}`} onClick={() => setActiveTab('bulletins')}>
                    <FaFileAlt /> Bulletins
                </button>
                <button className={`tab-btn ${activeTab === 'email' ? 'active' : ''}`} onClick={() => setActiveTab('email')}>
                    <FaPaperPlane /> Weekly Email
                </button>
            </div>

            {activeTab === 'mail' && renderMailLog()}
            {activeTab === 'bulletins' && renderChecklist(bulletinTasks, setBulletinTasks, "Sunday Bulletin Production")}
            {activeTab === 'email' && renderChecklist(emailTasks, setEmailTasks, "Wireless Weekly Email")}

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Log Incoming Mail"
            >
                <form className="event-form" onSubmit={handleMailSubmit}>
                    <div className="form-group">
                        <label>Sender</label>
                        <input
                            type="text"
                            required
                            value={newMail.sender}
                            onChange={(e) => setNewMail({ ...newMail, sender: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <input
                            type="text"
                            required
                            value={newMail.description}
                            onChange={(e) => setNewMail({ ...newMail, description: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Action/Status</label>
                        <select
                            value={newMail.status}
                            onChange={(e) => setNewMail({ ...newMail, status: e.target.value })}
                        >
                            <option value="To File">To File</option>
                            <option value="To Finance">To Finance</option>
                            <option value="To Rector">To Rector</option>
                            <option value="To Music">To Music</option>
                            <option value="Junk">Junk</option>
                        </select>
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Log Mail</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Communications;
