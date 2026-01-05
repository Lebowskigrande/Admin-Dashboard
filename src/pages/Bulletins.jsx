import { useState } from 'react';
import { FaPlus, FaArrowRight, FaPrint, FaCheck } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import './Bulletins.css';

const Bulletins = () => {
    const [bulletins, setBulletins] = useState([
        { id: 1, title: 'Dec 21 Sunday Service', date: '2025-12-21', status: 'draft' },
        { id: 2, title: 'Dec 24 Christmas Eve', date: '2025-12-24', status: 'review' },
        { id: 3, title: 'Dec 14 Sunday Service', date: '2025-12-14', status: 'printed' },
    ]);

    const [showModal, setShowModal] = useState(false);
    const [newBulletin, setNewBulletin] = useState({ title: '', date: '' });

    const columns = [
        { id: 'draft', label: 'Drafting', icon: '📝' },
        { id: 'review', label: 'In Review', icon: '👀' },
        { id: 'ready', label: 'Ready to Print', icon: '🖨️' },
        { id: 'printed', label: 'Printed', icon: '✅' },
    ];

    const moveBulletin = (id, currentStatus) => {
        const statusOrder = ['draft', 'review', 'ready', 'printed'];
        const currentIndex = statusOrder.indexOf(currentStatus);
        if (currentIndex < statusOrder.length - 1) {
            const nextStatus = statusOrder[currentIndex + 1];
            setBulletins(bulletins.map(b => b.id === id ? { ...b, status: nextStatus } : b));
        }
    };

    const addBulletin = (e) => {
        e.preventDefault();
        setBulletins([...bulletins, {
            id: Date.now(),
            title: newBulletin.title,
            date: newBulletin.date,
            status: 'draft'
        }]);
        setShowModal(false);
        setNewBulletin({ title: '', date: '' });
    };

    return (
        <div className="page-bulletins">
            <header className="page-header-controls">
                <h1>Sunday Bulletins</h1>
                <button className="btn-primary" onClick={() => setShowModal(true)}>
                    <FaPlus /> New Bulletin
                </button>
            </header>

            <div className="kanban-board">
                {columns.map(col => (
                    <div key={col.id} className="kanban-column">
                        <div className={`column-header header-${col.id}`}>
                            <span className="col-icon">{col.icon}</span>
                            <h3>{col.label}</h3>
                            <span className="count">{bulletins.filter(b => b.status === col.id).length}</span>
                        </div>
                        <div className="column-content">
                            {bulletins.filter(b => b.status === col.id).map(bulletin => (
                                <Card key={bulletin.id} className="bulletin-card">
                                    <div className="bulletin-info">
                                        <h4>{bulletin.title}</h4>
                                        <p>{bulletin.date}</p>
                                    </div>
                                    <div className="bulletin-actions">
                                        {col.id !== 'printed' && (
                                            <button
                                                className="btn-move"
                                                onClick={() => moveBulletin(bulletin.id, bulletin.status)}
                                                title="Move to next stage"
                                            >
                                                Advance <FaArrowRight />
                                            </button>
                                        )}
                                        {col.id === 'ready' && (
                                            <button className="btn-action-icon print-btn" title="Print Now">
                                                <FaPrint />
                                            </button>
                                        )}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Start New Bulletin">
                <form className="event-form" onSubmit={addBulletin}>
                    <div className="form-group">
                        <label>Bulletin Title</label>
                        <input
                            type="text"
                            required
                            value={newBulletin.title}
                            onChange={e => setNewBulletin({ ...newBulletin, title: e.target.value })}
                            placeholder="e.g. Jan 5 Service"
                        />
                    </div>
                    <div className="form-group">
                        <label>Service Date</label>
                        <input
                            type="date"
                            required
                            value={newBulletin.date}
                            onChange={e => setNewBulletin({ ...newBulletin, date: e.target.value })}
                        />
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Create Draft</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Bulletins;
