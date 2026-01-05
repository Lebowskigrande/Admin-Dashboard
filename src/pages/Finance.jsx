import { useState } from 'react';
import { FaPlus, FaArrowUp, FaArrowDown, FaMoneyBillWave, FaCheck, FaPaperPlane, FaTag } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import './Finance.css';

const Finance = () => {
    const [activeTab, setActiveTab] = useState('ar'); // ar = receivable (income), ap = payable (expenses)
    const [showModal, setShowModal] = useState(false);
    const [transactions, setTransactions] = useState([
        { id: 1, date: '2025-12-01', description: 'Weekly Offering', amount: 5200.00, type: 'income', category: 'Donation', glCode: '4001', approved: true, sentToEsp: true, checkType: 'Check' },
        { id: 2, date: '2025-12-05', description: 'Utility Bill - Nov', amount: 450.00, type: 'expense', category: 'Utilities', glCode: '5010', approved: false, sentToEsp: false },
        { id: 3, date: '2025-12-08', description: 'Building Fund', amount: 1500.00, type: 'income', category: 'Donation', glCode: '4002', approved: true, sentToEsp: false, checkType: 'Electronic' },
    ]);

    const [newTrans, setNewTrans] = useState({ date: '', description: '', amount: '', category: 'General', type: 'Check', glCode: '' });

    const income = transactions.filter(t => t.type === 'income');
    const expenses = transactions.filter(t => t.type === 'expense');

    const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
    const net = totalIncome - totalExpenses;

    const handleSubmit = (e) => {
        e.preventDefault();
        setTransactions([...transactions, {
            id: Date.now(),
            date: newTrans.date,
            description: newTrans.description,
            amount: parseFloat(newTrans.amount),
            type: activeTab === 'ar' ? 'income' : 'expense',
            category: newTrans.category,
            glCode: newTrans.glCode || 'Pending',
            approved: false, // Default to unapproved
            sentToEsp: false,
            checkType: newTrans.type // For deposits
        }]);
        setShowModal(false);
        setNewTrans({ date: '', description: '', amount: '', category: 'General', type: 'Check', glCode: '' });
    };

    const handleApprove = (id) => {
        setTransactions(transactions.map(t => t.id === id ? { ...t, approved: true } : t));
    };

    const handleSendToEsp = (id) => {
        // Mock sending to ESP
        setTransactions(transactions.map(t => t.id === id ? { ...t, sentToEsp: true } : t));
    };

    return (
        <div className="page-finance">
            <header className="finance-header">
                <h1>Finance & Accounts</h1>
                <button className="btn-primary" onClick={() => setShowModal(true)}>
                    <FaPlus /> Record {activeTab === 'ar' ? 'Income' : 'Expense'}
                </button>
            </header>

            <div className="finance-summary">
                <div className="summary-card income">
                    <div className="summary-icon"><FaArrowUp /></div>
                    <div>
                        <span className="summary-label">Total Income</span>
                        <div className="summary-value">${totalIncome.toLocaleString()}</div>
                    </div>
                </div>
                <div className="summary-card expense">
                    <div className="summary-icon"><FaArrowDown /></div>
                    <div>
                        <span className="summary-label">Total Expenses</span>
                        <div className="summary-value">${totalExpenses.toLocaleString()}</div>
                    </div>
                </div>
                <div className="summary-card net">
                    <div className="summary-icon"><FaMoneyBillWave /></div>
                    <div>
                        <span className="summary-label">Net Balance</span>
                        <div className={`summary-value ${net >= 0 ? 'pos' : 'neg'}`}>${net.toLocaleString()}</div>
                    </div>
                </div>
            </div>

            <div className="finance-tabs">
                <button
                    className={`tab-btn ${activeTab === 'ar' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ar')}
                >
                    Accounts Receivable (Income)
                </button>
                <button
                    className={`tab-btn ${activeTab === 'ap' ? 'active' : ''}`}
                    onClick={() => setActiveTab('ap')}
                >
                    Accounts Payable (Expenses)
                </button>
            </div>

            <Card className="finance-table-card">
                <table className="finance-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>GL Code</th>
                            <th>Status</th>
                            <th>ESP</th>
                            <th className="text-right">Amount</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(activeTab === 'ar' ? income : expenses).map(t => (
                            <tr key={t.id}>
                                <td>{t.date}</td>
                                <td>
                                    {t.description}
                                    {activeTab === 'ar' && <div className="text-sm text-muted">{t.checkType}</div>}
                                </td>
                                <td><span className="category-tag">{t.category}</span></td>
                                <td className="font-mono text-sm">{t.glCode}</td>
                                <td>
                                    <span className={`status-badge ${t.approved ? 'success' : 'warning'}`}>
                                        {t.approved ? 'Approved' : 'Pending'}
                                    </span>
                                </td>
                                <td>
                                    <span className={`status-badge ${t.sentToEsp ? 'success' : 'neutral'}`}>
                                        {t.sentToEsp ? 'Sent' : 'Unsent'}
                                    </span>
                                </td>
                                <td className="text-right font-mono">
                                    ${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                                <td className="table-actions">
                                    {!t.approved && (
                                        <button className="btn-icon small success" title="Approve" onClick={() => handleApprove(t.id)}>
                                            <FaCheck />
                                        </button>
                                    )}
                                    {!t.sentToEsp && t.approved && (
                                        <button className="btn-icon small primary" title="Send to ESP" onClick={() => handleSendToEsp(t.id)}>
                                            <FaPaperPlane />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title={`Record New ${activeTab === 'ar' ? 'Income' : 'Expense'}`}
            >
                <form className="event-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Date</label>
                        <input
                            type="date"
                            required
                            value={newTrans.date}
                            onChange={e => setNewTrans({ ...newTrans, date: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Description</label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. Weekly Offering"
                            value={newTrans.description}
                            onChange={e => setNewTrans({ ...newTrans, description: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label>Amount ($)</label>
                        <input
                            type="number"
                            required
                            step="0.01"
                            min="0"
                            value={newTrans.amount}
                            onChange={e => setNewTrans({ ...newTrans, amount: e.target.value })}
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Category</label>
                            <select
                                value={newTrans.category}
                                onChange={e => setNewTrans({ ...newTrans, category: e.target.value })}
                            >
                                <option value="General">General</option>
                                <option value="Donation">Donation</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Maintenance">Maintenance</option>
                                <option value="Salary">Salary</option>
                                <option value="Event">Event Cost</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>GL Code</label>
                            <input
                                type="text"
                                placeholder="e.g. 5001"
                                value={newTrans.glCode}
                                onChange={e => setNewTrans({ ...newTrans, glCode: e.target.value })}
                            />
                        </div>
                    </div>
                    {activeTab === 'ar' && (
                        <div className="form-group">
                            <label>Deposit Type</label>
                            <select
                                value={newTrans.type}
                                onChange={e => setNewTrans({ ...newTrans, type: e.target.value })}
                            >
                                <option value="Check">Check</option>
                                <option value="Electronic">Electronic Gift</option>
                                <option value="Cash">Cash</option>
                            </select>
                        </div>
                    )}
                    <div className="form-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                        <button type="submit" className="btn-primary">Save Transaction</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Finance;
