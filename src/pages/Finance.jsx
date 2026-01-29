import { useEffect, useMemo, useRef, useState } from 'react';
import { FaEye, FaPrint, FaSave } from 'react-icons/fa';
import Card from '../components/Card';
import Modal from '../components/Modal';
import { API_URL } from '../services/apiConfig';
import './Finance.css';

const createChecks = () =>
    Array.from({ length: 18 }, (_, index) => ({
        id: `manual-${index + 1}`,
        checkNumber: '',
        amount: '',
        budget: ''
    }));

const DEPOSIT_STORAGE_KEY = 'deposit-slip-checks';

const normalizeStorageAmount = (value) => {
    if (value == null) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(2);
};

const formatCurrency = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(numeric);
};

const formatDateStamp = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
};

const buildDepositFilename = (total) => {
    const numeric = Number(total);
    const amount = Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
    return `${formatDateStamp()} Deposit $${amount}.pdf`;
};

const normalizeAmountInput = (value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return '';
    return numeric.toFixed(2);
};

const buildPayloadAmount = (value) => {
    const normalized = normalizeAmountInput(value);
    if (!normalized) return '';
    return `$${normalized}`;
};

const loadSavedChecks = () => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(DEPOSIT_STORAGE_KEY);
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const Finance = () => {
    const [checks, setChecks] = useState(() => {
        const saved = loadSavedChecks();
        const template = createChecks();
        if (!saved || !saved.length) return template;
        return template.map((entry, index) => {
            const savedEntry = saved[index];
            if (!savedEntry) return entry;
            return {
                ...entry,
                checkNumber: savedEntry.checkNumber != null ? String(savedEntry.checkNumber) : entry.checkNumber,
                amount: normalizeStorageAmount(savedEntry.amount) || entry.amount,
                budget: savedEntry.budget != null ? String(savedEntry.budget) : entry.budget
            };
        });
    });
    const [slipBusy, setSlipBusy] = useState(false);
    const [slipError, setSlipError] = useState('');
    const [saveMessage, setSaveMessage] = useState('');
    const [previewModal, setPreviewModal] = useState({
        open: false,
        url: '',
        fileId: ''
    });
    const [previewNotice, setPreviewNotice] = useState('');
    const [previewError, setPreviewError] = useState('');
    const [previewActionBusy, setPreviewActionBusy] = useState({ save: false, print: false });
    const [depositSlipFileId, setDepositSlipFileId] = useState('');
    const saveMessageTimeoutRef = useRef(null);
    const [checksPdfFile, setChecksPdfFile] = useState(null);
    const [cashPdfFile, setCashPdfFile] = useState(null);
    const [uploadResetKey, setUploadResetKey] = useState(0);

    const updateCheck = (index, field, value) => {
        setChecks((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
        if (depositSlipFileId) {
            setDepositSlipFileId('');
        }
    };

    const handleSaveDepositData = () => {
        if (typeof window === 'undefined') {
            setSaveMessage('Unable to save deposit data.');
            return;
        }
        try {
            window.localStorage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify(checks));
            setSaveMessage('Deposit data saved locally.');
        } catch (error) {
            console.error('Failed to save deposit data:', error);
            setSaveMessage('Unable to save deposit data.');
        } finally {
            if (saveMessageTimeoutRef.current) {
                clearTimeout(saveMessageTimeoutRef.current);
            }
            saveMessageTimeoutRef.current = window.setTimeout(() => {
                setSaveMessage('');
                saveMessageTimeoutRef.current = null;
            }, 4000);
        }
    };

    const handleBuildDepositPacket = async () => {
        if (!checksPdfFile || !cashPdfFile) {
            setSlipError('Upload both the checks PDF and the cash count PDF.');
            return;
        }
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        setSlipBusy(true);
        try {
            let slipFileId = depositSlipFileId;
            if (!slipFileId) {
                slipFileId = await requestDepositSlipFile();
                setDepositSlipFileId(slipFileId);
            }
            const formData = new FormData();
            formData.append('checksPdf', checksPdfFile);
            formData.append('cashPdf', cashPdfFile);
            formData.append('slipFileId', slipFileId);
            const payloadChecks = checks.map((entry) => ({
                checkNumber: entry.checkNumber || '',
                amount: buildPayloadAmount(entry.amount)
            }));
            formData.append('checks', JSON.stringify(payloadChecks));
            formData.append('totals', JSON.stringify({
                cash: cashTotal,
                subtotal: overallTotal,
                total: overallTotal
            }));
            formData.append('fundsReport', JSON.stringify({
                entries: fundsReportEntries
            }));
            const response = await fetch(`${API_URL}/deposit-slip/pdf`, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) throw new Error('Failed to build deposit packet');
            const data = await response.json();
            if (!data?.fileId) throw new Error('Missing PDF data');
            setPreviewModal({
                open: true,
                url: buildPreviewUrl(data.fileId),
                fileId: data.fileId
            });
        } catch (error) {
            console.error('Deposit packet error:', error);
            setSlipError('Unable to build the deposit packet with the uploaded PDFs.');
        } finally {
            setSlipBusy(false);
        }
    };

    useEffect(() => () => {
        if (saveMessageTimeoutRef.current) {
            clearTimeout(saveMessageTimeoutRef.current);
        }
    }, []);

    const budgetTotals = useMemo(() => {
        return checks.reduce((acc, check) => {
            const budget = String(check.budget || '').trim();
            const amount = Number(check.amount);
            if (!budget || Number.isNaN(amount)) return acc;
            acc[budget] = (acc[budget] || 0) + amount;
            return acc;
        }, {});
    }, [checks]);

    const fundsReportEntries = useMemo(() => {
        return Object.entries(budgetTotals)
            .map(([code, total]) => ({ code, amount: total }))
            .sort((a, b) => a.code.localeCompare(b.code));
    }, [budgetTotals]);

    const cashTotal = useMemo(() => {
        return checks.reduce((sum, check) => {
            const hasCheck = String(check.checkNumber || '').trim();
            const amount = Number(check.amount);
            if (Number.isNaN(amount) || amount <= 0) return sum;
            if (hasCheck) return sum;
            return sum + amount;
        }, 0);
    }, [checks]);

    const overallTotal = useMemo(() => {
        return checks.reduce((sum, check) => {
            const amount = Number(check.amount);
            if (Number.isNaN(amount)) return sum;
            return sum + amount;
        }, 0);
    }, [checks]);

    const buildPreviewUrl = (fileId) => `${API_URL}/deposit-slip/file/${fileId}`;

    const requestDepositSlipFile = async () => {
        const payloadChecks = checks.map((entry) => ({
            checkNumber: entry.checkNumber || '',
            amount: buildPayloadAmount(entry.amount)
        }));
        const response = await fetch(`${API_URL}/deposit-slip/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                checks: payloadChecks,
                totals: {
                    cash: cashTotal,
                    subtotal: overallTotal,
                    total: overallTotal
                },
                fundsReport: {
                    entries: fundsReportEntries
                }
            })
        });
        if (!response.ok) throw new Error('Failed to build deposit slip');
        const data = await response.json();
        if (!data?.fileId) throw new Error('Missing PDF file');
        return data.fileId;
    };

    const handleGenerateDepositSlip = async () => {
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        setSlipBusy(true);
        try {
            const fileId = depositSlipFileId || await requestDepositSlipFile();
            if (!depositSlipFileId) {
                setDepositSlipFileId(fileId);
            }
            setPreviewModal({
                open: true,
                url: buildPreviewUrl(fileId),
                fileId
            });
        } catch (error) {
            console.error('Deposit slip error:', error);
            setSlipError('Unable to generate deposit slip with the provided entries.');
        } finally {
            setSlipBusy(false);
        }
    };

    const closePreviewModal = () => {
        setPreviewModal({ open: false, url: '', fileId: '' });
        setPreviewNotice('');
        setPreviewError('');
        setPreviewActionBusy({ save: false, print: false });
    };

    const handleSaveSlip = async () => {
        if (!previewModal.fileId) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, save: true }));
        const filename = buildDepositFilename(overallTotal);
        try {
            const response = await fetch(buildPreviewUrl(previewModal.fileId));
            if (!response.ok) throw new Error('Unable to load deposit slip.');
            const blob = await response.blob();
            if (window?.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [
                        {
                            description: 'PDF',
                            accept: { 'application/pdf': ['.pdf'] }
                        }
                    ]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                setPreviewNotice('Deposit slip saved.');
                return;
            }
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
            setPreviewNotice('Deposit slip saved.');
        } catch (error) {
            console.error('Deposit slip save error:', error);
            setPreviewError('Unable to save the deposit slip.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, save: false }));
        }
    };

    const handlePrintSlip = async () => {
        if (!previewModal.fileId) return;
        setPreviewError('');
        setPreviewNotice('');
        setPreviewActionBusy((prev) => ({ ...prev, print: true }));
        try {
            const response = await fetch(`${API_URL}/deposit-slip/print-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: previewModal.fileId })
            });
            if (!response.ok) {
                throw new Error('Unable to print the deposit slip.');
            }
            setPreviewNotice('Sent to printer.');
        } catch (error) {
            console.error('Deposit slip print error:', error);
            setPreviewError(error?.message || 'Unable to print the deposit slip.');
        } finally {
            setPreviewActionBusy((prev) => ({ ...prev, print: false }));
        }
    };

    const handleClearDepositForm = async () => {
        setChecks(createChecks());
        setChecksPdfFile(null);
        setCashPdfFile(null);
        setUploadResetKey((value) => value + 1);
        setSlipError('');
        setPreviewError('');
        setPreviewNotice('');
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.removeItem(DEPOSIT_STORAGE_KEY);
            } catch {
                // ignore
            }
        }
        const idsToDelete = new Set([depositSlipFileId, previewModal.fileId].filter(Boolean));
        if (idsToDelete.size > 0) {
            await Promise.all(
                Array.from(idsToDelete).map((fileId) => (
                    fetch(`${API_URL}/deposit-slip/file/${fileId}`, { method: 'DELETE' }).catch(() => {})
                ))
            );
        }
        setDepositSlipFileId('');
        setPreviewModal({ open: false, url: '', fileId: '' });
    };

    return (
        <div className="page-finance">
            <header className="finance-header page-header-bar">
                <div className="page-header-title">
                    <h1>Finance & Accounts</h1>
                    <p className="page-header-subtitle is-empty" aria-hidden="true">Spacer</p>
                </div>
            </header>

            <Card className="deposit-card manual-deposit">
                <div className="deposit-header">
                    <div>
                        <h2>Deposit Slip Builder</h2>
                        <p>Enter up to 18 checks with check number, amount, and budget code information.</p>
                    </div>
                    <div className="deposit-header-actions">
                        <button
                            type="button"
                            className="deposit-clear-button"
                            onClick={handleClearDepositForm}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="deposit-save-button"
                            onClick={handleSaveDepositData}
                        >
                            Save deposit data
                        </button>
                        <button
                            type="button"
                            className="deposit-download-button"
                            onClick={handleGenerateDepositSlip}
                            disabled={slipBusy || overallTotal <= 0}
                            aria-label="Preview deposit slip"
                        >
                            <FaEye />
                        </button>
                    </div>
                </div>
                <div className="deposit-builder-body">
                        <div className="deposit-checks-table-wrapper">
                            <table className="deposit-checks-table">
                            <thead>
                                <tr>
                                    <th>Check #</th>
                                    <th>Amount</th>
                                    <th>Budget Code</th>
                                </tr>
                            </thead>
                            <tbody>
                                {checks.map((check, index) => (
                                    <tr key={check.id}>
                                        <td>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min="0"
                                                step="1"
                                                pattern="[0-9]*"
                                                value={check.checkNumber}
                                                onChange={(event) => updateCheck(index, 'checkNumber', event.target.value)}
                                                placeholder="e.g. 1034"
                                            />
                                        </td>
                                        <td>
                                            <div className="amount-input">
                                                <span>$</span>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="0.01"
                                                    value={check.amount}
                                                    onChange={(event) => updateCheck(index, 'amount', event.target.value)}
                                                    onBlur={(event) => updateCheck(index, 'amount', normalizeAmountInput(event.target.value))}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                pattern="[A-Za-z0-9]*"
                                                value={check.budget}
                                                onChange={(event) => updateCheck(index, 'budget', event.target.value)}
                                                placeholder="Budget code"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="deposit-side-panel">
                        <div className="deposit-total-panel">
                            <h3>Totals by Budget Code</h3>
                            <div className="deposit-total-list">
                                {Object.keys(budgetTotals).length === 0 ? (
                                    <p className="empty-state">Enter budget codes to see totals.</p>
                                ) : (
                                    Object.entries(budgetTotals).map(([code, total]) => (
                                        <div key={code} className="deposit-total-line">
                                            <span>{code}</span>
                                            <strong>{formatCurrency(total)}</strong>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className="deposit-total-line cash">
                                <span>Cash (no check #)</span>
                                <strong>{formatCurrency(cashTotal)}</strong>
                            </div>
                            <div className="deposit-total-divider" />
                            <div className="deposit-total-line overall">
                                <span>Total</span>
                                <strong>{formatCurrency(overallTotal)}</strong>
                            </div>
                            <div className="deposit-status-area">
                                {saveMessage && <p className="deposit-save-message">{saveMessage}</p>}
                                {slipError && <div className="alert error">{slipError}</div>}
                            </div>
                        </div>
                        <div className="deposit-upload-panel">
                            <h3>Deposit Attachments</h3>
                            <div className="deposit-upload-field">
                                <label htmlFor="deposit-checks-pdf">Checks PDF</label>
                                <input
                                    key={`checks-${uploadResetKey}`}
                                    id="deposit-checks-pdf"
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(event) => setChecksPdfFile(event.target.files?.[0] || null)}
                                />
                                <p className="deposit-upload-hint">
                                    {checksPdfFile ? checksPdfFile.name : 'Upload the scanned checks PDF.'}
                                </p>
                            </div>
                            <div className="deposit-upload-field">
                                <label htmlFor="deposit-cash-pdf">Cash Count PDF</label>
                                <input
                                    key={`cash-${uploadResetKey}`}
                                    id="deposit-cash-pdf"
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(event) => setCashPdfFile(event.target.files?.[0] || null)}
                                />
                                <p className="deposit-upload-hint">
                                    {cashPdfFile ? cashPdfFile.name : 'Upload the cash count PDF.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="deposit-build-button deposit-build-secondary"
                                onClick={handleBuildDepositPacket}
                                disabled={slipBusy || overallTotal <= 0 || !checksPdfFile || !cashPdfFile}
                            >
                                Build deposit
                            </button>
                        </div>
                    </div>
                </div>
            </Card>

            <Modal isOpen={previewModal.open} onClose={closePreviewModal} title="Deposit Slip Preview" className="modal-large deposit-preview-modal">
                <div className="deposit-preview">
                    <div className="deposit-preview-toolbar">
                        <div className="deposit-preview-actions">
                            <button
                                className="btn-icon"
                                type="button"
                                aria-label="Save deposit slip"
                                disabled={!previewModal.fileId || previewActionBusy.save}
                                onClick={handleSaveSlip}
                            >
                                <FaSave />
                            </button>
                            <button
                                className="btn-icon"
                                type="button"
                                aria-label="Print deposit slip"
                                disabled={!previewModal.fileId || previewActionBusy.print}
                                onClick={handlePrintSlip}
                            >
                                <FaPrint />
                            </button>
                        </div>
                    </div>
                    {previewError && <div className="alert error">{previewError}</div>}
                    {previewNotice && <div className="alert success">{previewNotice}</div>}
                    <div className="deposit-preview-frame">
                        {previewModal.url ? (
                            <div className="deposit-preview-page">
                                <iframe
                                    src={`${previewModal.url}#view=FitV&toolbar=0&navpanes=0`}
                                    title="Deposit slip preview"
                                />
                            </div>
                        ) : (
                            <span className="text-muted">No preview available.</span>
                        )}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Finance;
