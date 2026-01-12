import { useEffect, useMemo, useState } from 'react';
import { FaDownload } from 'react-icons/fa';
import Card from '../components/Card';
import { API_URL } from '../services/apiConfig';
import './Finance.css';

const createChecks = () =>
    Array.from({ length: 18 }, (_, index) => ({
        id: `manual-${index + 1}`,
        checkNumber: '',
        amount: '',
        budget: ''
    }));

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

const base64ToBlob = (base64, contentType = 'application/pdf') => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    return new Blob([new Uint8Array(byteNumbers)], { type: contentType });
};

const Finance = () => {
    const [checks, setChecks] = useState(createChecks());
    const [slipUrl, setSlipUrl] = useState('');
    const [slipBusy, setSlipBusy] = useState(false);
    const [slipError, setSlipError] = useState('');

    const updateCheck = (index, field, value) => {
        setChecks((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    useEffect(() => {
        if (!slipUrl) return undefined;
        const anchor = document.createElement('a');
        anchor.href = slipUrl;
        anchor.download = 'deposit-slip.pdf';
        anchor.click();
        return () => {
            URL.revokeObjectURL(slipUrl);
        };
    }, [slipUrl]);

    const budgetTotals = useMemo(() => {
        return checks.reduce((acc, check) => {
            const budget = String(check.budget || '').trim();
            const amount = Number(check.amount);
            if (!budget || Number.isNaN(amount)) return acc;
            acc[budget] = (acc[budget] || 0) + amount;
            return acc;
        }, {});
    }, [checks]);

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

    const handleGenerateDepositSlip = async () => {
        setSlipError('');
        setSlipUrl('');
        setSlipBusy(true);
        try {
            const payloadChecks = checks.map((entry) => ({
                checkNumber: entry.checkNumber || '',
                amount: entry.amount || ''
            }));
            const response = await fetch(`${API_URL}/deposit-slip/manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checks: payloadChecks })
            });
            if (!response.ok) throw new Error('Failed to build deposit slip');
            const data = await response.json();
            if (!data?.pdfBase64) throw new Error('Missing PDF data');
            const blob = base64ToBlob(data.pdfBase64, 'application/pdf');
            setSlipUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return URL.createObjectURL(blob);
            });
        } catch (error) {
            console.error('Deposit slip error:', error);
            setSlipError('Unable to generate deposit slip with the provided entries.');
        } finally {
            setSlipBusy(false);
        }
    };

    return (
        <div className="page-finance">
            <header className="finance-header">
                <h1>Finance & Accounts</h1>
            </header>

            <Card className="deposit-card manual-deposit">
                <div className="deposit-header">
                    <div>
                        <h2>Deposit Slip Builder</h2>
                        <p>Enter up to 18 checks with check number, amount, and budget code information.</p>
                    </div>
                    <button
                        type="button"
                        className="deposit-download-button"
                        onClick={handleGenerateDepositSlip}
                        disabled={slipBusy || overallTotal <= 0}
                        aria-label="Download deposit slip"
                    >
                        <FaDownload />
                    </button>
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
                            {slipError && <div className="alert error">{slipError}</div>}
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default Finance;
