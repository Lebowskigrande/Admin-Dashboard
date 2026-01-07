import { useEffect, useState } from 'react';
import { FaPlus, FaArrowUp, FaArrowDown, FaMoneyBillWave, FaCheck, FaPaperPlane } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import './Finance.css';

const Finance = () => {
    const [activeTab, setActiveTab] = useState('ar'); // ar = receivable (income), ap = payable (expenses)
    const [showModal, setShowModal] = useState(false);
    const [depositFiles, setDepositFiles] = useState([]);
    const [depositBusy, setDepositBusy] = useState(false);
    const [depositError, setDepositError] = useState('');
    const [depositUrl, setDepositUrl] = useState('');
    const [depositChecks, setDepositChecks] = useState([]);
    const [depositDebug, setDepositDebug] = useState(false);
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

    useEffect(() => {
        return () => {
            if (depositUrl) {
                URL.revokeObjectURL(depositUrl);
            }
        };
    }, [depositUrl]);

    const handleDepositFiles = (event) => {
        const files = Array.from(event.target.files || []);
        setDepositFiles(files);
        setDepositError('');
        setDepositChecks([]);
        if (depositUrl) {
            URL.revokeObjectURL(depositUrl);
            setDepositUrl('');
        }
    };

    const base64ToBlob = (base64, contentType) => {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i += 1) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        return new Blob([new Uint8Array(byteNumbers)], { type: contentType });
    };

    const renderOcrNote = (check) => {
        const missing = [];
        if (check?.missing?.checkNumber) missing.push('check number');
        if (check?.missing?.amount) missing.push('numeric amount');
        if (check?.missing?.legalAmountText) missing.push('written amount');
        if (missing.length === 0) return 'OK';
        if (missing.length === 2) return `Missing ${missing[0]} and ${missing[1]}`;
        return `Missing ${missing[0]}`;
    };

    const handleBuildDepositSlip = async () => {
        if (depositFiles.length === 0) {
            setDepositError('Select one or more check images to upload.');
            return;
        }

        setDepositBusy(true);
        setDepositError('');
        try {
            const formData = new FormData();
            depositFiles.forEach((file) => formData.append('checks', file));
            formData.append('debugOcr', depositDebug ? '1' : '0');

            const response = await fetch(`${API_URL}/deposit-slip`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Failed to generate deposit slip');
            }

            const data = await response.json();
            if (!data?.pdfBase64) {
                throw new Error('Deposit slip response missing PDF data');
            }

            const blob = base64ToBlob(data.pdfBase64, 'application/pdf');
            const url = URL.createObjectURL(blob);
            setDepositUrl(url);
            setDepositChecks(Array.isArray(data.checks) ? data.checks : []);
        } catch (error) {
            console.error(error);
            setDepositError('Unable to generate deposit slip. Check OCR tools and try again.');
        } finally {
            setDepositBusy(false);
        }
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

            <Card className="deposit-card">
                <div className="deposit-header">
                    <div>
                        <h2>Deposit Slip Builder</h2>
                        <p>Upload scanned check images to generate a filled deposit slip.</p>
                    </div>
                    <button className="btn-primary" onClick={handleBuildDepositSlip} disabled={depositBusy}>
                        {depositBusy ? 'Processing...' : 'Generate Deposit Slip'}
                    </button>
                </div>
                <div className="deposit-body">
                    <div className="deposit-upload">
                        <label className="upload-label">
                            <span>Select check images (PNG or JPG)</span>
                            <input
                                type="file"
                                accept="image/png,image/jpeg"
                                multiple
                                onChange={handleDepositFiles}
                            />
                        </label>
                        <label className="debug-toggle">
                            <input
                                type="checkbox"
                                checked={depositDebug}
                                onChange={(event) => setDepositDebug(event.target.checked)}
                            />
                            Show OCR debug details
                        </label>
                        {depositFiles.length > 0 && (
                            <div className="upload-list">
                                {depositFiles.map((file) => (
                                    <div key={file.name} className="upload-item">
                                        <span>{file.name}</span>
                                        <span className="text-muted">{(file.size / 1024).toFixed(1)} KB</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="deposit-output">
                        {depositError && <div className="alert error">{depositError}</div>}
                        {depositUrl ? (
                            <div className="deposit-result">
                                <p>Deposit slip ready.</p>
                                <a className="btn-secondary" href={depositUrl} download="deposit-slip.pdf">
                                    Download PDF
                                </a>
                                {depositChecks.length > 0 && (
                                    <div className="ocr-results">
                                        <h3>OCR Results</h3>
                                        <table className="ocr-table">
                                            <thead>
                                                <tr>
                                                    <th>Image</th>
                                                    <th>Check #</th>
                                                    <th className="text-right">Amount</th>
                                                    <th>Status</th>
                                                    <th>Written Amount</th>
                                                    <th>Match</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {depositChecks.map((check, index) => {
                                                    const note = renderOcrNote(check);
                                                    const statusClass = note === 'OK' ? 'ok' : 'missing';
                                                    let matchLabel = 'Unverified';
                                                    let matchClass = 'missing';
                                                    if (check.amountMatch === true) {
                                                        matchLabel = 'Match';
                                                        matchClass = 'ok';
                                                    } else if (check.amountMatch === false) {
                                                        matchLabel = 'Mismatch';
                                                        matchClass = 'error';
                                                    }
                                                    return (
                                                        <tr key={`${check.source || 'check'}-${index}`}>
                                                            <td>{check.source || 'Unknown'}</td>
                                                            <td className="font-mono">{check.checkNumber || '--'}</td>
                                                            <td className="text-right font-mono">
                                                                {check.amount != null ? `$${check.amount.toFixed(2)}` : '--'}
                                                            </td>
                                                            <td>
                                                                <span className={`ocr-status ${statusClass}`}>{note}</span>
                                                            </td>
                                                            <td>{check.legalAmountText || '--'}</td>
                                                            <td>
                                                                <span className={`ocr-status ${matchClass}`}>{matchLabel}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        {depositDebug && (
                                            <div className="ocr-debug">
                                                {depositChecks.map((check, index) => (
                                                    <details key={`ocr-debug-${check.source || 'check'}-${index}`}>
                                                        <summary>{check.source || `Check ${index + 1}`}</summary>
                                                        <div className="ocr-debug-lines">
                                                            {check.ocrError && (
                                                                <div className="text-muted">OCR error: {check.ocrError}</div>
                                                            )}
                                                            {check.ocrRegions && (
                                                                <div className="ocr-region-results">
                                                                    {check.alignedPreviewBase64 && (
                                                                        <div className="ocr-preview">
                                                                            <img
                                                                                src={`data:image/png;base64,${check.alignedPreviewBase64}`}
                                                                                alt="Aligned check preview"
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    {Object.entries(check.ocrRegions).map(([regionKey, region]) => (
                                                                        <div key={`${regionKey}-${index}`}>
                                                                            <span className="font-mono">{regionKey}:</span>
                                                                            <span>{` ${region.text || '--'} `}</span>
                                                                            <span className="text-muted">{`(${region.engine || 'n/a'})`}</span>
                                                                            {region.previewBase64 && (
                                                                                <div className="ocr-preview">
                                                                                    <img
                                                                                        src={`data:image/png;base64,${region.previewBase64}`}
                                                                                        alt={`${regionKey} preview`}
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                            {region.candidates && (
                                                                                <div className="text-muted">
                                                                                    {Object.entries(region.candidates).map(([engine, text]) => (
                                                                                        <div key={`${regionKey}-${engine}`}>
                                                                                            <span className="font-mono">{engine}:</span>
                                                                                            <span>{` ${text || '--'}`}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {(check.ocrLines || []).map((line, lineIndex) => (
                                                                <div key={`ocr-line-${index}-${lineIndex}`}>
                                                                    <span className="font-mono">{line.text || '--'}</span>
                                                                    <span className="text-muted">
                                                                        {` [${Math.round(line.left)},${Math.round(line.top)} - ${Math.round(line.right)},${Math.round(line.bottom)}]`}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {(check.ocrLines || []).length === 0 && (
                                                                <div className="text-muted">No OCR lines captured.</div>
                                                            )}
                                                        </div>
                                                    </details>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="deposit-placeholder">
                                Upload checks to generate the deposit slip PDF.
                            </div>
                        )}
                    </div>
                </div>
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
