import { useState } from 'react';
import { FaPlus, FaTools, FaHammer, FaClipboardList, FaAddressBook, FaCheckCircle, FaExclamationCircle } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import './Buildings.css';

const Buildings = () => {
    const [activeTab, setActiveTab] = useState('repairs');
    const [showModal, setShowModal] = useState(false);

    // Repairs Data
    const [repairs, setRepairs] = useState([
        { id: 1, title: 'Leaky Faucet in Kitchen', description: 'Sink in the main kitchen drips constantly.', status: 'complaint', date: '2025-12-10' },
        { id: 2, title: 'Broken pew kneeler', description: 'Row 4, left side.', status: 'repair', date: '2025-12-15' },
        { id: 3, title: 'HVAC Filter Change', description: 'Routine maintenance.', status: 'complete', date: '2025-11-20' },
    ]);
    const [newRepair, setNewRepair] = useState({ title: '', description: '', status: 'complaint' });

    // Needs Data
    const [needs, setNeeds] = useState([
        { id: 1, text: 'Repaint Parish Hall', priority: 'High' },
        { id: 2, text: 'Replace carpet in Vestry', priority: 'Medium' },
    ]);
    const [newNeed, setNewNeed] = useState('');

    // Vendors Data
    const [vendors, setVendors] = useState([
        { id: 1, name: 'Joe Plumber', service: 'Plumbing', phone: '555-0101', notes: 'Best for emergencies' },
        { id: 2, name: 'Sparky Electric', service: 'Electrician', phone: '555-0102', notes: 'Has keys' },
        { id: 3, name: 'Green Tree Care', service: 'Arborist', phone: '555-0103', notes: '' },
    ]);

    const handleRepairSubmit = (e) => {
        e.preventDefault();
        setRepairs([...repairs, { ...newRepair, id: Date.now(), date: new Date().toISOString().split('T')[0] }]);
        setShowModal(false);
        setNewRepair({ title: '', description: '', status: 'complaint' });
    };

    const handleStatusChange = (id, newStatus) => {
        setRepairs(repairs.map(r => r.id === id ? { ...r, status: newStatus } : r));
    };

    const renderRepairs = () => (
        <div className="repairs-view">
            <div className="repairs-grid">
                {repairs.map(r => (
                    <div key={r.id} className={`repair-card status-${r.status}`}>
                        <div className="repair-header">
                            <span className="repair-date">{r.date}</span>
                            <span className="repair-status">{r.status}</span>
                        </div>
                        <h3>{r.title}</h3>
                        <p>{r.description}</p>
                        <div className="repair-actions" style={{ marginTop: '1rem' }}>
                            <select
                                value={r.status}
                                onChange={(e) => handleStatusChange(r.id, e.target.value)}
                                style={{ padding: '5px' }}
                            >
                                <option value="complaint">Complaint</option>
                                <option value="troubleshoot">Troubleshoot</option>
                                <option value="repair">Repair</option>
                                <option value="complete">Complete</option>
                            </select>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderNeeds = () => (
        <Card>
            <div className="needs-list">
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Add new long term need..."
                        style={{ flex: 1, padding: '8px' }}
                        value={newNeed}
                        onChange={e => setNewNeed(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && newNeed) {
                                setNeeds([...needs, { id: Date.now(), text: newNeed, priority: 'Medium' }]);
                                setNewNeed('');
                            }
                        }}
                    />
                    <button className="btn-primary" onClick={() => {
                        if (newNeed) {
                            setNeeds([...needs, { id: Date.now(), text: newNeed, priority: 'Medium' }]);
                            setNewNeed('');
                        }
                    }}>Add</button>
                </div>
                <ul>
                    {needs.map(n => (
                        <li key={n.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                            {n.text} <span style={{ fontSize: '0.8rem', color: '#888' }}>({n.priority})</span>
                        </li>
                    ))}
                </ul>
            </div>
        </Card>
    );

    const renderVendors = () => (
        <Card>
            <table className="vendors-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    {vendors.map(v => (
                        <tr key={v.id}>
                            <td><span className="category-tag">{v.service}</span></td>
                            <td>{v.name}</td>
                            <td>{v.phone}</td>
                            <td>{v.notes}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );

    return (
        <div className="page-buildings">
            <header className="buildings-header">
                <h1>Buildings & Grounds</h1>
                {activeTab === 'repairs' && (
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        <FaPlus /> Report Issue
                    </button>
                )}
            </header>

            <div className="buildings-tabs">
                <button className={`tab-btn ${activeTab === 'repairs' ? 'active' : ''}`} onClick={() => setActiveTab('repairs')}>
                    <FaTools /> Repairs
                </button>
                <button className={`tab-btn ${activeTab === 'needs' ? 'active' : ''}`} onClick={() => setActiveTab('needs')}>
                    <FaClipboardList /> Long Term Needs
                </button>
                <button className={`tab-btn ${activeTab === 'vendors' ? 'active' : ''}`} onClick={() => setActiveTab('vendors')}>
                    <FaAddressBook /> Preferred Vendors
                </button>
            </div>

            {activeTab === 'repairs' && renderRepairs()}
            {activeTab === 'needs' && renderNeeds()}
            {activeTab === 'vendors' && renderVendors()}

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Report Repair Issue"
            >
                <form className="event-form" onSubmit={handleRepairSubmit}>
                    <div className="form-group">
                        <label>Issue Title</label>
                        <input
                            type="text"
                            required
                            value={newRepair.title}
                            onChange={(e) => setNewRepair({ ...newRepair, title: e.target.value })}
                            placeholder="e.g. Broken Window"
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <textarea
                            required
                            rows="3"
                            value={newRepair.description}
                            onChange={(e) => setNewRepair({ ...newRepair, description: e.target.value })}
                            placeholder="Details about the location and issue..."
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Submit Report</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Buildings;
